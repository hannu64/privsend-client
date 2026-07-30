// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// The public drop page. An anonymous sender fetches the recipient's public key,
// writes a message and/or attaches files, and seals it all TO that key in the
// browser. No account, no key of the sender's own; the server receives only
// ciphertext, a sealed key, and opaque file blobs.
//
// Files ride the same v2 manifest a secret uses: each file is encrypted under the
// drop's own content key, uploaded to get an opaque ref, and named ONLY inside the
// encrypted manifest (name/type/size/ref/nonce). The server never learns a filename.
// Unlike a one-time secret, a drop's files are NOT burned on read -- they persist,
// re-downloadable, until the recipient deletes the message or it reaches retention.
//
// Like the reveal page, this page carries BOTH languages on one URL (see i18n.js):
// the sender did not choose this address, so a /fi/public/{id} would announce the
// recipient's language to anyone who saw the link.

import { newDropKey, sealDrop, encryptBytes, publicKeyFingerprint } from './crypto.js';
import { setBusy, fmtBytes } from './ui.js';
import { api } from './config.js';
import { t, initLangToggle, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);

// Must match MaxCiphertextBytes on the server, less the 16-byte GCM tag.
const MAX_PLAINTEXT = 256 * 1024 - 16;

// Must match the server: MaxFileBytes and MaxFiles (api.go) and MaxDropBytes
// (store.go, an alias of MaxSecretBytes). Checked here only to fail fast BEFORE a
// phone spends minutes uploading something that was always going to be rejected --
// the server enforces the real limits, nothing here is a security control.
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES_TOTAL = 25 * 1024 * 1024;
const MAX_FILES = 10;

// Website-only for v1: the drop_id is the last path segment of /public/<id>.
const dropID = location.pathname.split('/').pop();
let pubB64 = null;
// The server's coarse last-seen bucket CODE ("week", "month", …) or null. The wording
// is chosen HERE in the active language, so the exact week never leaves the server.
let lastSeenCode = null;
let sending = false;

// Files ACCUMULATE across picks rather than replacing (mobile pickers are often
// single-select) -- the list below is the single source of truth for what will be sent.
let picked = [];

function show(id) {
  for (const s of ['loading', 'gone', 'closed', 'compose', 'done']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}
const groupFp = (hex) => hex.replace(/(.{4})/g, '$1 ').trim();

const encoder = new TextEncoder();
const used = () => encoder.encode($('message').value).length;

const filesTotal = () => picked.reduce((n, f) => n + f.size, 0);

// The one thing wrong with the current file selection, in the active language, or ''
// if nothing is wrong. Shown live while picking and again as the submit guard.
function fileProblem() {
  if (picked.length > MAX_FILES) return t.drop.tooManyFiles(picked.length, MAX_FILES);
  const big = picked.find((f) => f.size > MAX_FILE);
  if (big) return t.drop.fileTooBig(big.name, fmtBytes(big.size), fmtBytes(MAX_FILE));
  if (filesTotal() > MAX_FILES_TOTAL) return t.drop.filesTooBig(fmtBytes(filesTotal()), fmtBytes(MAX_FILES_TOTAL));
  return '';
}

function updateCounter() {
  const n = used();
  $('used').textContent = fmtBytes(n);
  $('counter').classList.toggle('over', n > MAX_PLAINTEXT);
  // A drop may be files with no covering message, so an empty box is only a problem
  // when there is nothing else to send.
  $('send').disabled = n > MAX_PLAINTEXT
    || (n === 0 && picked.length === 0)
    || Boolean(fileProblem());
}

function addFiles(list) {
  for (const f of list) {
    // Dedupe on the triple so adding the same file twice is a no-op.
    const dup = picked.some((p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified);
    if (!dup) picked.push(f);
  }
  renderFiles();
}

function renderFiles() {
  const list = $('fileList');
  list.textContent = '';
  for (const f of picked) {
    const li = document.createElement('li');

    const name = document.createElement('span');
    // textContent, never innerHTML: a filename is user-supplied text and must never
    // be parsed as markup, even when the user supplying it is the sender.
    name.textContent = f.name;

    const size = document.createElement('span');
    size.className = 'soft';
    size.textContent = fmtBytes(f.size);

    const rm = document.createElement('button');
    rm.className = 'secondary compact';
    rm.textContent = t.drop.remove;
    rm.addEventListener('click', () => {
      picked = picked.filter((p) => p !== f);
      renderFiles();
    });

    li.append(name, size, rm);
    if (f.size > MAX_FILE) li.classList.add('over');
    list.append(li);
  }

  const any = picked.length > 0;
  list.classList.toggle('hidden', !any);
  $('fileTotal').classList.toggle('hidden', !any);
  $('fileNote').classList.toggle('hidden', !any);
  $('fileUsed').textContent = fmtBytes(filesTotal());
  $('fileTotal').classList.toggle('over', filesTotal() > MAX_FILES_TOTAL);

  const problem = fileProblem();
  $('fileErr').textContent = problem;
  $('fileErr').classList.toggle('hidden', !problem);

  updateCounter();
}

// The recipient's opt-in "still watched" signal, rendered in the active language from
// the server's coarse code. Re-run on a language change (onLangChange below).
function renderLiveness() {
  const phrase = lastSeenCode && t.drop.buckets[lastSeenCode];
  $('liveness').textContent = phrase ? t.drop.lastActive(phrase) : t.drop.lastUnknown;
}

// Text this script controls that is not fixed prose in the HTML: the title, the
// placeholder, the send button's resting label, the liveness line, and -- because this
// is a toggle page -- the JS-rendered file rows and any file error, re-rendered here.
function relabel() {
  document.title = t.drop.pageTitle;
  $('message').placeholder = t.drop.placeholder;
  if (!sending) $('send').textContent = t.drop.sendBtn;
  renderLiveness();
  renderFiles();
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
  $('fileCap').textContent = ` / ${fmtBytes(MAX_FILES_TOTAL)}`;
  $('message').addEventListener('input', updateCounter);

  wireFilePicker();
  updateCounter();
  show('compose');
}

function wireFilePicker() {
  $('files').addEventListener('change', (e) => {
    addFiles(e.target.files || []);
    // Clear the input so re-picking the SAME file (after removing it) fires change again,
    // and so the list below stays the single source of truth.
    e.target.value = '';
  });

  const dz = $('drop');
  for (const ev of ['dragenter', 'dragover']) {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); });
  }
  dz.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files || []));

  // A file dropped ANYWHERE ELSE would make the browser navigate to it, throwing away a
  // half-composed message. Refuse the default everywhere; the zone still gets its drops.
  for (const ev of ['dragover', 'drop']) {
    window.addEventListener(ev, (e) => e.preventDefault());
  }
}

function failSend(msg) {
  sending = false;
  $('err').textContent = msg;
  $('err').classList.remove('hidden');
  $('send').disabled = false;
  $('send').textContent = t.drop.sendBtn;
}

// Upload one file's ciphertext (raw bytes, not base64 in JSON) and return its ref.
async function uploadBlob(ciphertext) {
  const res = await fetch(api('/api/blob'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || t.drop.uploadFailed);
  }
  const { ref } = await res.json();
  return ref;
}

$('send').addEventListener('click', async () => {
  $('err').classList.add('hidden');
  const msg = $('message').value;
  // Files-only is allowed; an empty box is an error only when nothing is attached.
  if (!msg.trim() && picked.length === 0) return failSend(t.drop.needSomething);
  if (used() > MAX_PLAINTEXT) return failSend(t.drop.tooLong);
  const problem = fileProblem();
  if (problem) return failSend(problem);

  sending = true;
  $('send').disabled = true;
  setBusy($('send'), t.drop.encrypting);
  try {
    // Mint the drop's content key first: the manifest AND every file are encrypted
    // under it (one key, a fresh nonce each), and the manifest names the files' refs --
    // so the key must exist before the files (see newDropKey).
    const { aesKey, rawKey } = await newDropKey();

    // Files go up FIRST: the manifest has to name their refs, and the manifest is what
    // the seal protects. Until POST /api/drop/{id} binds them, these blobs belong to
    // nobody and the server collects them within the hour -- which is what makes it safe
    // to abandon this page halfway through.
    const manifestFiles = [];
    for (const [i, file] of picked.entries()) {
      setBusy($('send'), picked.length > 1 ? t.drop.encryptingFileN(i + 1, picked.length) : t.drop.encryptingFile);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { nonce, ciphertext } = await encryptBytes(aesKey, bytes);

      setBusy($('send'), picked.length > 1 ? t.drop.uploadingFileN(i + 1, picked.length) : t.drop.uploadingFile);
      const ref = await uploadBlob(ciphertext);

      // name and type are recorded ONLY here, inside what becomes the encrypted manifest.
      manifestFiles.push({ name: file.name, size: file.size, type: file.type, ref, nonce });
    }

    setBusy($('send'), t.drop.encrypting);
    const body = await sealDrop(pubB64, rawKey, msg, manifestFiles);
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
    picked = [];
    $('files').value = '';
    renderFiles();
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
