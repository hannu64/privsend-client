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
// never as a column the server could read. The server sees one opaque blob of a
// declared length per file, plus an encrypted manifest, and that is very nearly all
// it can know: not what the files are called, not what they are, not their contents.
// It does count the blobs, so it knows HOW MANY files a secret carries -- but
// nothing about them.
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
  // Take the last path segment, then strip the characters that let a name LIE about itself:
  // C0/C1 controls and DEL, plus the Unicode bidi / directional-formatting characters
  // (LRM/RLM/ALM, the LRE..RLO overrides, and the isolate controls). A right-to-left
  // override such as U+202E renders "photo<U+202E>gpj.exe" on screen as "photoexe.jpg"
  // while the file still saves as .exe. A hostile sender controls this name, and it is both
  // shown (textContent) and used as a download filename, so those characters come out here.
  // (Outsider review, 2026-07-29.)
  const base = name.split(/[/\\]/).pop().replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return base.slice(0, 200) || 'file';
}

/* ============================================================================
 * DROPS — receive from anyone, at a stable address
 * ============================================================================
 *
 * Everything above is privsend's SEND direction: the content key rides in the URL
 * fragment to a recipient who holds the link. Drops INVERT that. A recipient
 * publishes a long-lived PUBLIC key at a stable address; anyone -- with no account
 * and no key of their own -- encrypts a message to that address, and the content
 * key is SEALED to the recipient's public key instead of being put in a fragment.
 *
 * This is the ONLY new cryptography Drops adds. The content itself is encrypted
 * EXACTLY as a v2 secret is: sealManifest / parseManifest / deriveAesKey above are
 * reused UNCHANGED -- one fresh 256-bit AES-GCM key per drop, a fresh nonce per
 * encryption. What changes is the delivery of that one key:
 *
 *     send : content key -> URL fragment            (recipient holds the link)
 *     drop : content key -> sealed to a public key   (recipient holds the private key)
 *
 * THE SEAL is a textbook ECIES built from the browser's own WebCrypto: a throwaway
 * ("ephemeral") P-256 key pair does ECDH against the recipient's public key to
 * agree a one-time shared secret; HKDF-SHA-256 turns that into an AES-256-GCM key;
 * that key wraps the drop's content key. Nothing is hand-rolled -- ECDH, HKDF and
 * AES-GCM are the same vetted primitives used above (§3.3).
 *
 * WHY P-256: it is present in EVERY WebCrypto, needs no library, and is
 * deliberately decoupled from any curve chosen elsewhere in the product, so this
 * file stays standalone and readable end to end.
 *
 * THE ONE TRUST POINT Drops adds: the drop page serves the recipient's PUBLIC key,
 * so a compelled server could serve a DIFFERENT key and read inbound drops (the
 * same class of risk as "trust the served crypto.js"). The answer is the same one
 * the rest of the product uses: publicKeyFingerprint below is published
 * out-of-band, so a sender can confirm the key they seal to is the recipient's own.
 */

const CURVE = 'P-256';

// HKDF domain-separation label for the seal. Exactly like 'privsend/v1/aes-key'
// above, it is baked into every sealed drop the instant this ships: changing it
// changes every derived wrap-key, making every drop already sitting in an inbox
// permanently unreadable -- silently. Never change it.
const SEAL_INFO = 'privsend/drop/v1/seal';

/**
 * Mint a recipient's long-lived identity: one P-256 key pair.
 *
 * Returns the public key as raw bytes (published at the drop address so senders can
 * seal to it) and the private key as PKCS#8 bytes (to be wrapped under a passphrase
 * by wrapPrivateKey BEFORE it is ever handed to the server). The private key is
 * generated extractable for one reason only -- so it can be exported here, once, to
 * be wrapped. It is never stored or transmitted in the clear.
 */
export async function generateRecipientKeypair() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  return { publicKeyRaw, privateKeyPkcs8 };
}

// PBKDF2 -> AES-256-GCM key from a passphrase ALONE. Used only to protect the
// recipient's private key at rest. Unlike deriveAesKey above there is no fragment
// key to combine with: for a drop recipient the passphrase is the ONLY secret and
// the sole gate on their inbox, so it must be strong. Same 600k iterations, same
// SHA-256, so it carries the same cost an attacker must pay per guess.
async function passphraseKey(passphrase, salt, usages) {
  const pw = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    pw, { name: 'AES-GCM', length: KEY_BITS }, false, usages
  );
}

/**
 * Encrypt the recipient's private key under their passphrase, for storage.
 *
 * The server only ever sees this blob -- never the key, never the passphrase (§4.2:
 * the passphrase never reaches the server, not even as a hash). Returns base64
 * fields ready to store: { enc, nonce, salt }.
 */
export async function wrapPrivateKey(privateKeyPkcs8, passphrase) {
  if (!passphrase) throw new Error('A passphrase is required to protect the private key.');
  const salt = randomBytes(SALT_BYTES);
  const key = await passphraseKey(passphrase, salt, ['encrypt']);
  const { nonce, ciphertext } = await encryptBytes(key, privateKeyPkcs8);
  return { enc: b64Encode(ciphertext), nonce: b64Encode(nonce), salt: b64Encode(salt) };
}

/**
 * Recover the recipient's private key from its wrapped blob and passphrase.
 *
 * Returns a non-extractable ECDH CryptoKey usable only for deriveBits -- i.e. only
 * for unsealing drops, never for being read back out. A wrong passphrase fails the
 * GCM tag and throws; we cannot and do not distinguish that from a corrupt blob.
 */
export async function unwrapPrivateKey(wrapped, passphrase) {
  const key = await passphraseKey(passphrase, b64Decode(wrapped.salt), ['decrypt']);
  let pkcs8;
  try {
    pkcs8 = await decryptBytes(key, b64Decode(wrapped.nonce), b64Decode(wrapped.enc));
  } catch {
    throw new Error('Wrong passphrase, or the stored key is corrupted.');
  }
  return crypto.subtle.importKey(
    'pkcs8', pkcs8, { name: 'ECDH', namedCurve: CURVE }, false, ['deriveBits']
  );
}

/**
 * Change the passphrase that protects the private key, WITHOUT regenerating it or ever
 * exposing it. Decrypts the wrapped blob with the CURRENT passphrase to recover the
 * PKCS#8 bytes in memory, then re-wraps those bytes under the NEW passphrase with a fresh
 * salt and nonce. Returns a new { enc, nonce, salt } to store in place of the old one.
 *
 * This is all a passphrase change is: the private key is unchanged, so every message ever
 * sealed to the matching PUBLIC key stays readable and nothing is re-encrypted. The
 * recovered PKCS#8 is a local variable that goes out of scope at once -- no extractable
 * CryptoKey is ever held. A wrong current passphrase fails the GCM tag and throws, exactly
 * as unwrapPrivateKey does, so a bad guess never reaches the server.
 */
export async function rewrapPrivateKey(wrapped, currentPassphrase, newPassphrase) {
  if (!newPassphrase) throw new Error('A passphrase is required to protect the private key.');
  const oldKey = await passphraseKey(currentPassphrase, b64Decode(wrapped.salt), ['decrypt']);
  let pkcs8;
  try {
    pkcs8 = await decryptBytes(oldKey, b64Decode(wrapped.nonce), b64Decode(wrapped.enc));
  } catch {
    throw new Error('Wrong current passphrase, or the stored key is corrupted.');
  }
  return wrapPrivateKey(pkcs8, newPassphrase);
}

// The seal's KDF. salt is the ephemeral public key: it is fresh for every single
// seal, so the same recipient key never derives the same wrap-key twice, and it is
// carried in the clear alongside the ciphertext so the recipient can rederive.
// (The recipient's static key already enters the secret through the ECDH itself;
// the ephemeral pub in the salt is what makes each seal independent.)
async function deriveSealKey(sharedBits, ephPubRaw, usages) {
  const hkdf = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephPubRaw, info: enc.encode(SEAL_INFO) },
    hkdf, { name: 'AES-GCM', length: KEY_BITS }, false, usages
  );
}

// Seal one content key to a recipient's raw public key. Returns the ephemeral
// public key (the recipient needs it to rederive) plus the wrapped key and its
// nonce -- all non-secret, all safe to store beside the ciphertext.
async function seal(recipientPubRaw, rawKey) {
  const recipientPub = await crypto.subtle.importKey(
    'raw', recipientPubRaw, { name: 'ECDH', namedCurve: CURVE }, false, []
  );
  const eph = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']
  );
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: recipientPub }, eph.privateKey, KEY_BITS
  ));
  const wrapKey = await deriveSealKey(shared, ephPubRaw, ['encrypt']);
  const { nonce, ciphertext } = await encryptBytes(wrapKey, rawKey);
  return { ephPubRaw, wrapped: ciphertext, wrapNonce: nonce };
}

// Recover a sealed content key with the recipient's private key. Throws on any
// tampering or wrong key -- the GCM tag over the wrapped key catches it.
async function unseal(privateKey, ephPubRaw, wrapped, wrapNonce) {
  const ephPub = await crypto.subtle.importKey(
    'raw', ephPubRaw, { name: 'ECDH', namedCurve: CURVE }, false, []
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephPub }, privateKey, KEY_BITS
  ));
  const wrapKey = await deriveSealKey(shared, ephPubRaw, ['decrypt']);
  return decryptBytes(wrapKey, wrapNonce, wrapped);
}

/**
 * Seal a drop for a recipient's public key. The Drops mirror of
 * newSecretKey + sealManifest: mint a fresh content key, encrypt the v2 manifest
 * under it exactly as any secret, then SEAL that content key to the recipient
 * rather than returning a fragment. The sender is anonymous and needs no key.
 *
 * `recipientPublicB64` is the recipient's raw P-256 public key, base64. `files` is
 * [] for v1 (text-only); the v2 manifest machinery is reused unchanged, so files
 * turn on later with NO change here.
 *
 * Returns the POST /api/drop/{id} body -- every field non-secret and content-blind.
 */
export async function sealDrop(recipientPublicB64, message, files = []) {
  const recipientPubRaw = b64Decode(recipientPublicB64);
  const rawKey = randomBytes(KEY_BITS / 8);
  // No passphrase on the content key: a drop's protection is the asymmetric seal,
  // not a shared secret the anonymous sender could not have.
  const aesKey = await deriveAesKey(rawKey, null, null);
  const sealed = await sealManifest(aesKey, null, null, message, files);
  const { ephPubRaw, wrapped, wrapNonce } = await seal(recipientPubRaw, rawKey);
  return {
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    format_version: sealed.format_version,
    ephemeral_pub: b64Encode(ephPubRaw),
    wrapped_key: b64Encode(wrapped),
    wrap_nonce: b64Encode(wrapNonce),
  };
}

/**
 * Open one drop. The Drops mirror of openSecret's v2 path: unseal the content key
 * with the recipient's private key, then decrypt and VALIDATE the manifest exactly
 * as any secret. Returns { message, files }.
 *
 * `privateKey` is the CryptoKey from unwrapPrivateKey. `entry` is one inbox row:
 * { ephemeral_pub, wrapped_key, wrap_nonce, ciphertext, nonce, format_version }.
 */
export async function openDrop(privateKey, entry) {
  if (!READABLE.includes(entry.format_version)) {
    throw new Error('This drop is from an unsupported version.');
  }
  let rawKey;
  try {
    rawKey = await unseal(
      privateKey,
      b64Decode(entry.ephemeral_pub),
      b64Decode(entry.wrapped_key),
      b64Decode(entry.wrap_nonce)
    );
  } catch {
    throw new Error('This drop could not be unsealed for this address.');
  }
  const aesKey = await deriveAesKey(rawKey, null, null);
  let plain;
  try {
    plain = dec.decode(await decryptBytes(aesKey, b64Decode(entry.nonce), b64Decode(entry.ciphertext)));
  } catch {
    throw new Error('This drop is corrupted and cannot be read.');
  }
  // v1 semantics are identical to a secret's: the plaintext IS the message.
  if (entry.format_version === 'v1') return { message: plain, files: [] };
  return parseManifest(plain);
}

/**
 * A stable fingerprint of a recipient's public key, for out-of-band verification
 * (the one trust point above): SHA-256 of the raw public key, as lowercase hex.
 * The console DISPLAYS it so a recipient can publish it; a sender who has it can
 * confirm the drop page served the right key. Grouping for humans is the UI's job;
 * this returns the honest full digest.
 */
export async function publicKeyFingerprint(recipientPublicB64) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', b64Decode(recipientPublicB64)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
