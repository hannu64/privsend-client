// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Create a drop address. The mirror of create.js for the RECEIVE direction: it
// mints the recipient's key pair in the browser, wraps the private key under a
// passphrase, and asks the server only to store the public key and the opaque
// wrapped blob. The server never sees the private key or the passphrase.

import { generateRecipientKeypair, wrapPrivateKey, publicKeyFingerprint, b64Encode } from './crypto.js';
import { attachReveal, setBusy } from './ui.js';
import { passphraseProblem } from './passphrase.js';
import { SITE_ORIGIN, api } from './config.js';
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

attachReveal($('passphrase'));
attachReveal($('passphrase2'));

// Live strength feedback while typing -- a gentle nudge, not a block; the hard block is at
// submit. Empty clears it; otherwise show either the specific problem or a plain "strong".
const passHint = $('passHint');
$('passphrase').addEventListener('input', () => {
  const v = $('passphrase').value;
  if (!v) { passHint.textContent = ''; passHint.className = 'note hidden'; return; }
  const problem = passphraseProblem(v);
  passHint.textContent = problem || t.pass.ok;
  passHint.className = problem ? 'note' : 'note ok';
});

const btn = $('create');
let consoleUrl = '';
let saved = false;

function fail(msg) {
  $('err').textContent = msg;
  $('err').classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = t.drops.createBtn;
}

// Present the 64-hex-char digest in readable groups of four.
const groupFp = (hex) => hex.replace(/(.{4})/g, '$1 ').trim();

btn.addEventListener('click', async () => {
  $('err').classList.add('hidden');
  $('passMatch').classList.add('hidden');

  const pass = $('passphrase').value;
  if (!pass) return fail(t.drops.chooseFirst);
  // Hard-block a weak passphrase here, where it is chosen: once the SECRET link leaks this is
  // the only thing between a stranger and the inbox, attacked offline with no rate limit.
  const weak = passphraseProblem(pass);
  if (weak) return fail(weak);
  // A mistyped passphrase makes the whole inbox permanently unreadable, so we refuse
  // to proceed on a mismatch rather than warn — the same rule create.js applies.
  if (pass !== $('passphrase2').value) {
    $('passMatch').classList.remove('hidden');
    $('passphrase2').focus();
    return;
  }

  btn.disabled = true;
  setBusy(btn, t.drops.creating);
  try {
    const { publicKeyRaw, privateKeyPkcs8 } = await generateRecipientKeypair();
    const pubB64 = b64Encode(publicKeyRaw);
    const wrapped = await wrapPrivateKey(privateKeyPkcs8, pass);

    const res = await fetch(api('/api/drop'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_key: pubB64,
        enc_private_key: wrapped.enc,
        enc_nonce: wrapped.nonce,
        enc_salt: wrapped.salt,
        retention_days: Number($('retention').value),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return fail(j.error || t.drops.createFailed);
    }
    const { drop_id, owner_token } = await res.json();

    // Assembled HERE, in the browser. The owner_token lives in the '#' fragment,
    // which the server never receives (like a secret's key), so this console link
    // exists only on this page. The two paths are deliberately loud: /SECRET on the
    // private link and /public on the shareable one, so the pasted text itself tells
    // them apart when someone is in a hurry and only glances at what they copied.
    consoleUrl = `${SITE_ORIGIN}/SECRET#${owner_token}`;
    const publicAddr = `${SITE_ORIGIN}/public/${drop_id}`;

    $('consoleLink').textContent = consoleUrl;
    $('publicAddr').textContent = publicAddr;
    $('fingerprint').textContent = groupFp(await publicKeyFingerprint(pubB64));
    wireCopy('copyConsole', consoleUrl, t.drops.copyConsole, markSaved);
    wireCopy('copyAddr', publicAddr, t.drops.copyAddr);
    $('consoleLink').addEventListener('copy', markSaved);

    // The passphrase has done its job (the key is wrapped); do not leave it in the DOM.
    $('passphrase').value = '';
    $('passphrase2').value = '';

    $('create-form').classList.add('hidden');
    $('done').classList.remove('hidden');
    protectLinks();
    requestAnimationFrame(() => window.scrollTo(0, 0));
  } catch (e) {
    fail(e.message || t.drops.createFailed);
  }
});

function wireCopy(id, text, label, onCopied) {
  const b = $(id);
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = t.copied;
      if (onCopied) onCopied();
      setTimeout(() => (b.textContent = label), 1600);
    } catch {
      b.textContent = t.drops.copyFailed;
    }
  };
}

function markSaved() {
  saved = true;
  $('notSaved').classList.add('hidden');
  // Copying the SECRET link is the one irreplaceable step: it carries a secret that
  // exists only on this page. So the way on to the inbox stays disabled (see the button's
  // `disabled` in drops.html) until the link has actually been copied -- by the button or
  // by a manual select-and-copy, both of which land here.
  $('openInbox').disabled = false;
}

$('openInbox').addEventListener('click', () => {
  if (!saved && !window.confirm(t.drops.confirmUnsaved)) {
    return;
  }
  // Going to the inbox means the token now lives in the address bar / history, so
  // the unsaved-link guard has nothing left to protect.
  saved = true;
  location.href = consoleUrl;
});

// Every link on this page LEAVES it — the header brand and sub-nav, the footer, all of
// them — and the SECRET console link exists ONLY on this page (its token rides in the '#'
// fragment, which the server never receives), so following any link before the link is
// copied loses the address for good. The beforeunload guard below catches a close/reload/
// back on desktop, but that prompt is unreliable-to-absent on mobile and is a poor fit for
// a deliberate link click anyway. So the moment the "done" panel appears we send every link
// to a NEW tab: the click still works, but THIS page — the only place the console link
// lives — stays put. (External links here were already target=_blank; this makes the
// internal ones behave the same while it matters.)
function protectLinks() {
  for (const a of document.querySelectorAll('a')) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
}

// Closing the tab, reloading, or a back-navigation before saving the console link loses the
// address forever. This is the desktop net; the new-tab links above are what cover mobile,
// where this prompt is not dependable.
window.addEventListener('beforeunload', (e) => {
  if (!$('done').classList.contains('hidden') && !saved) {
    e.preventDefault();
    e.returnValue = '';
  }
});
