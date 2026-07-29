// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// The public drop page. An anonymous sender fetches the recipient's public key,
// writes a message, and sealDrop encrypts it TO that key in the browser. No account,
// no key of the sender's own; the server receives only ciphertext and a sealed key.
//
// Like the reveal page, this page carries BOTH languages on one URL (see i18n.js):
// the sender did not choose this address, so a /fi/public/{id} would announce the
// recipient's language to anyone who saw the link.

import { sealDrop, publicKeyFingerprint } from './crypto.js';
import { setBusy, fmtBytes } from './ui.js';
import { api } from './config.js';
import { t, initLangToggle, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);

// Must match MaxCiphertextBytes on the server, less the 16-byte GCM tag.
const MAX_PLAINTEXT = 256 * 1024 - 16;

// Website-only for v1: the drop_id is the last path segment of /public/<id>.
const dropID = location.pathname.split('/').pop();
let pubB64 = null;
// The server's coarse last-seen bucket CODE ("week", "month", …) or null. The wording
// is chosen HERE in the active language, so the exact week never leaves the server.
let lastSeenCode = null;
let sending = false;

function show(id) {
  for (const s of ['loading', 'gone', 'closed', 'compose', 'done']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}
const groupFp = (hex) => hex.replace(/(.{4})/g, '$1 ').trim();

const encoder = new TextEncoder();
const used = () => encoder.encode($('message').value).length;
function updateCounter() {
  const n = used();
  $('used').textContent = fmtBytes(n);
  $('counter').classList.toggle('over', n > MAX_PLAINTEXT);
  $('send').disabled = n === 0 || n > MAX_PLAINTEXT;
}

// The recipient's opt-in "still watched" signal, rendered in the active language from
// the server's coarse code. Re-run on a language change (onLangChange below).
function renderLiveness() {
  const phrase = lastSeenCode && t.drop.buckets[lastSeenCode];
  $('liveness').textContent = phrase ? t.drop.lastActive(phrase) : t.drop.lastUnknown;
}

// Text this script controls that is not fixed prose in the HTML: the title, the
// placeholder, the send button's resting label, and the liveness line.
function relabel() {
  document.title = t.drop.pageTitle;
  $('message').placeholder = t.drop.placeholder;
  if (!sending) $('send').textContent = t.drop.sendBtn;
  renderLiveness();
}

onLangChange(relabel);
// autodetect: the sender did not choose this URL, so their browser locale is the only
// hint about what they read. Read, never stored, never sent.
initLangToggle({ autodetect: true });
relabel();

async function init() {
  if (!dropID) { show('gone'); return; }
  let res;
  try {
    res = await fetch(api(`/api/drop/${encodeURIComponent(dropID)}/pubkey`), { cache: 'no-store' });
  } catch {
    show('gone');
    return;
  }
  if (!res.ok) { show('gone'); return; }
  const info = await res.json();
  if (info.disabled || !info.public_key) { show('closed'); return; }

  pubB64 = info.public_key; // base64 string from the API, exactly what sealDrop wants
  lastSeenCode = info.last_seen || null;
  renderLiveness();

  $('fingerprint').textContent = groupFp(await publicKeyFingerprint(pubB64));
  $('cap').textContent = `/ ${fmtBytes(MAX_PLAINTEXT)}`;
  $('message').addEventListener('input', updateCounter);
  updateCounter();
  show('compose');
}

function failSend(msg) {
  sending = false;
  $('err').textContent = msg;
  $('err').classList.remove('hidden');
  $('send').disabled = false;
  $('send').textContent = t.drop.sendBtn;
}

$('send').addEventListener('click', async () => {
  $('err').classList.add('hidden');
  const msg = $('message').value;
  if (!msg.trim()) return failSend(t.drop.writeFirst);
  if (used() > MAX_PLAINTEXT) return failSend(t.drop.tooLong);

  sending = true;
  $('send').disabled = true;
  setBusy($('send'), t.drop.encrypting);
  try {
    const body = await sealDrop(pubB64, msg, []);
    const res = await fetch(api(`/api/drop/${encodeURIComponent(dropID)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      // The server's own error text is English only; keep it for the rare unexpected
      // case and fall back to our own translated line otherwise (as reveal.js does).
      return failSend(j.error || t.drop.sendFailed);
    }
    sending = false;
    $('message').value = '';
    show('done');
    requestAnimationFrame(() => window.scrollTo(0, 0));
  } catch (e) {
    failSend(e.message || t.encryptFailed);
  }
});

$('again').addEventListener('click', (e) => {
  e.preventDefault();
  location.reload();
});

init();
