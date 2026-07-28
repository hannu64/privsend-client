// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// The public drop page. An anonymous sender fetches the recipient's public key,
// writes a message, and sealDrop encrypts it TO that key in the browser. No account,
// no key of the sender's own; the server receives only ciphertext and a sealed key.

import { sealDrop, publicKeyFingerprint } from './crypto.js';
import { setBusy, fmtBytes } from './ui.js';
import { api } from './config.js';

const $ = (id) => document.getElementById(id);

// Must match MaxCiphertextBytes on the server, less the 16-byte GCM tag.
const MAX_PLAINTEXT = 256 * 1024 - 16;

// Website-only for v1: the drop_id is the last path segment of /d/<id>.
const dropID = location.pathname.split('/').pop();
let pubB64 = null;

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

  // Liveness: tell the sender whether this inbox is likely still watched. The recipient
  // controls this — a coarse bucket ("within the last week") only if they opted in, and
  // an honest "we can't tell you" otherwise. Never precise, never about who they are.
  $('liveness').textContent = info.last_seen
    ? `The owner last read this inbox ${info.last_seen}.`
    : "We can't tell you whether this inbox is still being watched — the owner hasn't chosen to show that.";

  $('fingerprint').textContent = groupFp(await publicKeyFingerprint(pubB64));
  $('cap').textContent = `/ ${fmtBytes(MAX_PLAINTEXT)}`;
  $('message').addEventListener('input', updateCounter);
  updateCounter();
  show('compose');
}

function failSend(msg) {
  $('err').textContent = msg;
  $('err').classList.remove('hidden');
  $('send').disabled = false;
  $('send').textContent = 'Encrypt & send';
}

$('send').addEventListener('click', async () => {
  $('err').classList.add('hidden');
  const msg = $('message').value;
  if (!msg.trim()) return failSend('Write a message first.');
  if (used() > MAX_PLAINTEXT) return failSend('Message is too long.');

  $('send').disabled = true;
  setBusy($('send'), 'Encrypting…');
  try {
    const body = await sealDrop(pubB64, msg, []);
    const res = await fetch(api(`/api/drop/${encodeURIComponent(dropID)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return failSend(j.error || 'Could not send the message.');
    }
    $('message').value = '';
    show('done');
    requestAnimationFrame(() => window.scrollTo(0, 0));
  } catch (e) {
    failSend(e.message || 'Encryption failed.');
  }
});

$('again').addEventListener('click', (e) => {
  e.preventDefault();
  location.reload();
});

init();
