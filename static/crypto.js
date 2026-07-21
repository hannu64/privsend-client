// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// privsend — client-side cryptography.
//
// THIS FILE IS THE WHOLE SECURITY STORY. It is deliberately small so that you
// can read it end to end and satisfy yourself that:
//
//   1. Encryption and decryption happen ONLY here, in your browser (§3.1).
//   2. The key is generated here, never sent to the server, and travels only in
//      the URL fragment (#...), which browsers never transmit (§3.2).
//   3. Only standard, vetted primitives are used, via the browser's own
//      WebCrypto implementation. Nothing is hand-rolled (§3.3).
//
// If any of that is not true of the code below, this product is broken. Please
// tell us.
//
// -----------------------------------------------------------------------------
// FORMAT v1 — text only
// -----------------------------------------------------------------------------
//   cipher      : AES-256-GCM
//   nonce       : 96-bit, fresh from the CSPRNG for EVERY encryption
//   key         : 256-bit, fresh from the CSPRNG for every secret
//   fragment    : "v1." + base64url(key)
//   passphrase  : optional. PBKDF2-HMAC-SHA-256, 600k iterations, 128-bit salt.
//
// The fragment is version-tagged so the format can evolve while old links keep
// working (§4.3). That is what will let us move PBKDF2 -> Argon2id later without
// breaking a single link already in the wild -- and it is what lets v2 exist below
// without breaking any v1 link already out there.
//
// -----------------------------------------------------------------------------
// FORMAT v2 — text + files
// -----------------------------------------------------------------------------
// Same cipher, same key derivation, same fragment shape ("v2." + base64url(key)).
// ONE key per secret, as before. What changes is what the ciphertext holds.
//
// In v1 the ciphertext IS the message. In v2 the ciphertext is a MANIFEST:
//
//   { "message": "…", "files": [ { "name": "contract.pdf", "size": 812340,
//                                  "type": "application/pdf", "ref": "…",
//                                  "nonce": "…" } ] }
//
// and each file's bytes are encrypted SEPARATELY, under the same key with its own
// fresh nonce, and stored as its own blob.
//
// WHY THE INDIRECTION: filenames are sensitive on their own. Nobody needs to
// decrypt "resignation_letter.pdf" to learn the secret. So the name, the type, the
// size, the ref and the per-file nonce all live INSIDE the encrypted manifest --
// never as a column the server could read. The server sees opaque blobs of a
// declared length and an encrypted manifest, and that is genuinely all it can
// know: not what the files are called, not what they are, not even how many there
// are.
//
// The manifest is small, so it stays inline in Postgres and the reveal page can
// show the message and the file list instantly, before any file is fetched.
// -----------------------------------------------------------------------------

export const FORMAT = 'v2';

// Every format this client can still READ. Links are shared out-of-band and live
// as long as their TTL, so a v1 link created before this code shipped must keep
// working exactly as it did (§4.3). Removing a version from here breaks real links
// in the wild; only ever append.
const READABLE = ['v1', 'v2'];

const KEY_BITS = 256;
const NONCE_BYTES = 12;   // 96-bit, the GCM standard
const SALT_BYTES = 16;    // 128-bit
const PBKDF2_ITERATIONS = 600_000;

// crypto.subtle only exists in a SECURE CONTEXT (https:, or localhost). On a
// plain http:// origin it is undefined and nothing below can work. We fail loudly
// rather than silently falling back to something weaker.
if (!globalThis.crypto?.subtle) {
  throw new Error(
    'WebCrypto is unavailable. privsend requires a secure (HTTPS) connection. ' +
    'Refusing to continue — we will not encrypt with anything weaker.'
  );
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/* ---------------------------------------------------------------- base64url */

function b64urlEncode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s.padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// The API speaks standard base64 for binary fields.
export function b64Encode(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function b64Decode(str) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

/* ------------------------------------------------------------ key derivation */

// SECURITY (§3.3): every random value in this file comes from
// crypto.getRandomValues -- the platform CSPRNG. Math.random appears nowhere,
// and must never appear.
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// Derive the actual AES key.
//
// Without a passphrase the AES key IS the random key from the fragment.
//
// With a passphrase, the AES key is derived from BOTH the random key and the
// passphrase. This is the important property: an attacker who obtains the LINK
// (and hence the fragment key) still cannot decrypt without the passphrase, and
// an attacker who obtains the CIPHERTEXT from a server breach cannot even begin
// to brute-force the passphrase, because they lack the fragment key. Both halves
// are required, and they travel by different channels.
//
// SECURITY (§4.2): the passphrase is NEVER sent to the server -- not even as a
// hash. It is verified only by attempting decryption here. A server-checkable
// hash would hand the server an offline-cracking oracle and destroy the
// zero-knowledge property.
async function deriveAesKey(rawKey, passphrase, salt) {
  if (!passphrase) {
    return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  const pwKey = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const pwBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    pwKey,
    KEY_BITS
  ));

  // Combine the two secrets with HKDF rather than by concatenating or XOR-ing
  // them by hand (§3.3: never invent constructions). HKDF-Extract/Expand is the
  // standard, analysed way to turn multiple secrets into one uniform key.
  const ikm = new Uint8Array(rawKey.length + pwBits.length);
  ikm.set(rawKey, 0);
  ikm.set(pwBits, rawKey.length);

  const hkdfKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  // DO NOT "tidy" the info string to v2 now that v2 exists. It is a
  // domain-separation label, not a version number, and it is baked into the key
  // derivation of every passphrase-protected secret ever created. Changing it
  // changes the derived key, which would make every v1 link in the wild
  // permanently undecryptable -- silently, and only for the users who took the
  // trouble to add a passphrase.
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('privsend/v1/aes-key') },
    hkdfKey,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt']
  );
}

/* -------------------------------------------------------------------- public */

/**
 * Begin a new secret: mint its key and derive the AES key once.
 *
 * The SAME AES key encrypts the manifest and every file in the secret -- one key
 * per secret, exactly as in v1. That is safe, and it is safe for the ordinary
 * reason rather than a clever one: GCM requires a unique nonce per encryption
 * under a given key, not a unique key, and every call to encryptBytes below draws
 * a fresh 96-bit nonce from the CSPRNG.
 */
export async function newSecretKey(passphrase) {
  const rawKey = randomBytes(KEY_BITS / 8);
  const salt = passphrase ? randomBytes(SALT_BYTES) : null;
  const aesKey = await deriveAesKey(rawKey, passphrase, salt);
  return {
    aesKey,
    salt,
    // -> NEVER sent anywhere. Goes after the '#' in the link.
    fragment: `${FORMAT}.${b64urlEncode(rawKey)}`,
  };
}

/**
 * Encrypt one payload of bytes. Used for the manifest and for each file.
 * Returns raw Uint8Arrays -- callers decide base64 or not.
 */
export async function encryptBytes(aesKey, bytes) {
  // SECURITY (§3.3): a fresh nonce for every single encryption. Reusing a nonce
  // with the same key in GCM is catastrophic -- it destroys both confidentiality
  // and integrity. This is the ONLY place a nonce is made, and it is made from the
  // CSPRNG every time it is called, so a file and the manifest that describes it
  // can never share one.
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, bytes
  ));
  return { nonce, ciphertext };
}

/**
 * Decrypt one payload of bytes. Throws if the key, passphrase, or data is wrong.
 *
 * AES-GCM AUTHENTICATES, and for files that property does more work than it looks.
 * A truncated download -- the connection dropped at 90% -- fails the tag exactly
 * like a wrong key does. So a successful return here is not merely "some bytes
 * arrived"; it is proof that ALL of them arrived, intact and genuine. That is what
 * lets the reveal page destroy a file server-side the moment it decrypts, without
 * having to trust a byte count.
 */
export async function decryptBytes(aesKey, nonce, ciphertext) {
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, ciphertext
  ));
}

/**
 * Build the encrypted manifest body for POST /api/secret.
 * `files` is [{ name, size, type, ref, nonce }] with nonce as a Uint8Array.
 */
export async function sealManifest(aesKey, salt, passphrase, message, files) {
  const manifest = {
    message,
    files: files.map((f) => ({
      name: f.name, size: f.size, type: f.type, ref: f.ref,
      nonce: b64Encode(f.nonce),
    })),
  };
  const { nonce, ciphertext } = await encryptBytes(aesKey, enc.encode(JSON.stringify(manifest)));
  return {
    ciphertext: b64Encode(ciphertext),
    nonce: b64Encode(nonce),
    salt: salt ? b64Encode(salt) : undefined,
    format_version: FORMAT,
    has_passphrase: Boolean(passphrase),
  };
}

/**
 * Open what the server returned, using the key from the URL fragment.
 *
 * Handles BOTH formats and returns the same shape for each, so callers never
 * branch on version: v1 is simply a v2 secret with no files.
 *
 * Returns { message, files, aesKey }. The aesKey comes back because the files are
 * fetched and decrypted later, one at a time, under the same key.
 */
export async function openSecret(fragment, payload, passphrase) {
  const [version, keyB64] = String(fragment).split('.');
  if (!keyB64 || !READABLE.includes(version)) {
    throw new Error('This link is malformed or from an unsupported version.');
  }
  if (payload.format_version !== version) {
    // The fragment and the stored payload disagree about the format. Something
    // mangled the link; refuse rather than guess which half to believe.
    throw new Error('This link does not match the secret it points to.');
  }

  const rawKey = b64urlDecode(keyB64);
  const nonce = b64Decode(payload.nonce);
  const salt = payload.salt ? b64Decode(payload.salt) : null;
  const ct = b64Decode(payload.ciphertext);

  const aesKey = await deriveAesKey(rawKey, passphrase, salt);

  let plain;
  try {
    plain = dec.decode(await decryptBytes(aesKey, nonce, ct));
  } catch {
    // GCM's authentication tag failed. Either the passphrase is wrong or the link
    // is corrupt. We cannot tell which, and we do not guess.
    throw new Error(
      payload.has_passphrase
        ? 'Wrong passphrase, or the link is corrupted.'
        : 'This link is corrupted and cannot be decrypted.'
    );
  }

  // v1: the plaintext IS the message, and there are no files.
  if (version === 'v1') return { message: plain, files: [], aesKey };

  return { ...parseManifest(plain), aesKey };
}

/**
 * Parse and VALIDATE a decrypted manifest.
 *
 * SECURITY: authenticated does not mean trustworthy. GCM proves this manifest came
 * from whoever held the key -- it proves nothing about whether that person meant
 * us well. A hostile sender controls every byte in here, so this is untrusted
 * input that merely happens to be authentic, and it is treated as such.
 *
 * Note what is NOT relied on: `type` is parsed but the reveal page never uses it
 * to build a Blob, because a blob: URL inherits OUR origin -- a manifest claiming
 * "text/html" could otherwise get script executing on dev.privsend.app. And `name`
 * is only ever written with textContent, never innerHTML.
 */
function parseManifest(json) {
  let m;
  try {
    m = JSON.parse(json);
  } catch {
    throw new Error('This secret is corrupted and cannot be read.');
  }
  if (!m || typeof m !== 'object') throw new Error('This secret is corrupted and cannot be read.');

  const message = typeof m.message === 'string' ? m.message : '';
  const rawFiles = Array.isArray(m.files) ? m.files : [];

  // Match the server's MaxFiles. A manifest claiming ten thousand files would
  // otherwise have the reveal page build ten thousand rows and hang the tab.
  if (rawFiles.length > 10) throw new Error('This secret is corrupted and cannot be read.');

  const files = rawFiles.map((f) => {
    if (!f || typeof f.ref !== 'string' || typeof f.nonce !== 'string') {
      throw new Error('This secret is corrupted and cannot be read.');
    }
    return {
      // Strip any path from the name. Browsers sanitise the `download` attribute
      // themselves, but a name is also something we PRINT, and "../../etc/passwd"
      // on screen is alarming nonsense at best.
      name: safeName(f.name),
      size: Number.isFinite(f.size) && f.size >= 0 ? f.size : 0,
      type: typeof f.type === 'string' ? f.type : '',
      ref: f.ref,
      nonce: b64Decode(f.nonce),
    };
  });

  return { message, files };
}

function safeName(name) {
  if (typeof name !== 'string' || !name) return 'file';
  // Take the last path segment, drop control characters, and bound the length.
  const base = name.split(/[/\\]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base.slice(0, 200) || 'file';
}
