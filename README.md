# privsend — the browser client

This is the part of [privsend](https://privsend.app) that does the cryptography. It
runs entirely in your browser: it generates the key, encrypts your secret, and — for
the recipient — decrypts it. **The server never sees any of that.**

It is published so you don't have to take that on faith. A privacy tool you cannot
inspect is just a promise; this is the code, so you can check the promise yourself.

> **Licence: GNU AGPL-3.0-only** (full text in [`LICENSE`](LICENSE)). The server is
> closed source, and that concedes no security claim — the server only ever holds
> ciphertext and never sees a key or a plaintext, so there is nothing
> security-relevant in it to hide. The part that *would* matter if it lied to you is
> here, in the open.

## Read this first

[`static/crypto.js`](static/crypto.js) is the whole security surface. Every key is
generated there, every byte is encrypted and decrypted there, and nothing
cryptographic happens anywhere else. If you audit one file, audit that one. It is
deliberately small, dependency-free, and uses only the browser's own WebCrypto —
nothing is hand-rolled.

- Cipher: **AES-256-GCM**, a fresh 96-bit nonce for every encryption.
- The key is random (CSPRNG). With a passphrase, it is stretched with **PBKDF2,
  600 000 iterations**, then combined with the random key via HKDF — so the
  passphrase and the link are *both* required, and neither the server nor the link
  alone can decrypt.

## What the server can and cannot see

**Never reaches the server, by construction:**

- Your plaintext, or any file's contents.
- The decryption key. It lives only in the part of the link after the `#` — the URL
  *fragment* — which browsers never transmit. The server cannot log what it is never
  sent.
- File names and types, and any file's contents: those live inside the encrypted
  manifest, so the server sees only opaque blobs — never what a file is called or
  what it holds.
- Who the recipient is. privsend never delivers anything; you pass the link on
  yourself, through a channel of your choosing.

**The server does hold, because it must:** the ciphertext, a random link id and a
separate status id, the nonce (and a salt if you used a passphrase — neither is
secret), whether a passphrase was set, each blob's size in bytes (so it does know how
many files a secret carries), and
created/expiry/opened timestamps. No identity, and no IP address, is ever stored
against a secret.

## The two properties worth understanding

- **Burn-on-read.** The secret is destroyed the first time it is successfully read.
  This is atomic on the server: under any amount of concurrency, at most one reader
  ever receives the ciphertext.
- **The interstitial.** Loading a share link does **not** consume the secret — the
  page you land on touches no database and reads nothing. The secret is retrieved and
  destroyed only when a human clicks *Reveal*. This is what stops mail scanners, chat
  link-previewers and antivirus crawlers — which fetch every URL they see — from
  silently destroying a secret before its recipient ever arrives.

## How do you know the code you *ran* is the code you're *reading*?

This is the honest, important question for any in-browser crypto, and it deserves a
straight answer rather than a reassuring one.

- The page forbids third-party scripts entirely (a strict Content-Security-Policy,
  `script-src 'self'`), so no CDN or outside origin can inject or swap the crypto.
  Everything your browser runs is served first-party from privsend.
- Because this repository is public, you can compare the `crypto.js` your browser was
  served against the source here — view it, hash it, diff it — and confirm they match.

But be clear about the limit: **the web client is delivered by the server each visit,
so its integrity ultimately rests on the server serving you this published code — or
on you checking, each time.** A server that had been compromised, or compelled, could
serve *one* targeted person a modified script. Open-sourcing makes that tampering
*detectable* (there is now a canonical version to diff against); it does not make it
*impossible*.

The stronger answer is a **browser extension — and it now exists, in this very
repository.** The files you are reading here *are* the extension: load this folder as
an unpacked extension and the crypto runs from that installed, versioned copy, never
re-fetched from the server. Both the send flow and the receive flow then run from
installed code — opening a share link with the extension present decrypts it from the
bundled page, not from one the server hands you at that moment. A single unmodified
copy of this repository loads in Chromium browsers (Chrome, Edge, Opera, Brave,
Vivaldi) and Firefox alike. That is the verifiable-client story in its complete form,
and it is why the extension matters beyond convenience.

To load it unpacked and review it for yourself:

- **Chromium** (Chrome/Edge/Opera/Brave/Vivaldi): open the extensions page, turn on
  *Developer mode*, choose *Load unpacked*, and select this folder.
- **Firefox**: open `about:debugging` → *This Firefox* → *Load Temporary Add-on*, and
  select this folder's `manifest.json`.

The toolbar button opens the compose page in a full tab.

**Published builds.** The extension is on the
[Chrome Web Store](https://chromewebstore.google.com/detail/jbnbgboabjehjkjhloeeihjamibmjokd)
— which covers Chrome, Edge, Opera, Brave and Vivaldi — and a Firefox build is under
review at addons.mozilla.org. Every published version is **tagged in this repository**,
so the bytes that went to a store have an exact anchor here to diff against, and the
build stamp in the extension's own footer tells you which version you are running. If
you would rather not trust a store at all, load this folder unpacked as above and the
question does not arise.

A fuller walkthrough — the levels of checking, what a store copy looks like next to a
tag, and what verification honestly cannot tell you — is at
[privsend.app/verify](https://privsend.app/verify).

## What this does *not* protect

Being honest about the edges is part of being trustworthy:

- **Metadata.** That *a* secret existed, roughly how large it was, and when it was
  created and opened, is visible to the server. The *contents* are not.
- **Your device.** If the machine you type or read on is compromised, no amount of
  transit encryption helps — the plaintext is on screen.
- **A hostile sender.** privsend authenticates that a file came from whoever held the
  key; it does not vouch for what that file *is*. Treat a received file as you would
  any file from its sender.
- **A lost link or passphrase.** A mistyped or lost link/passphrase makes a secret
  permanently undecryptable — by anyone, including us. That is the design, not a bug.
  It still does not linger: because it is never read, a lost secret is destroyed when
  it **expires** — after the lifetime its sender chose (one hour, one day, or at most
  seven days) — and even its bookkeeping record is deleted seven days after that.
  Nothing is left hanging.

## Reporting a security issue

Found something? Please email **support@zumitomi.fi** first, before opening anything
in public — so the flaw cannot be exploited before it is fixed. We aim to fix
reported issues within a few days, and we are glad to credit you publicly if you
would like. If four days (96 hours) pass without a fix, you are free to disclose it
publicly.
