// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

import { newSecretKey, encryptBytes, sealManifest } from './crypto.js';
import { attachReveal, fmtBytes, setBusy } from './ui.js';

const $ = (id) => document.getElementById(id);

// Must match MaxCiphertextBytes on the server. AES-GCM appends a 16-byte
// authentication tag, so the plaintext budget is slightly smaller than the
// ciphertext cap.
const MAX_CIPHERTEXT = 256 * 1024;
const GCM_TAG = 16;
const MAX_PLAINTEXT = MAX_CIPHERTEXT - GCM_TAG;

// Must match the server: MaxFileBytes and MaxFiles in api.go, and MaxSecretBytes
// in store.go -- which lives beside Create because that transaction is the only
// place a TOTAL can be checked without racing a concurrent bind.
//
// These are checked here only to give an honest error BEFORE a phone spends four
// minutes uploading something that was always going to be rejected. The server
// enforces the real limits; nothing here is a security control.
//
// That last sentence was false when it was written: MaxSecretBytes was enforced on
// the server NOWHERE, so MAX_FILES_TOTAL was in fact the only thing standing
// between a crafted request and a 250 MB secret. This file WAS the control, which
// is precisely what it disclaims (review, 2026-07). It is true now — keep it true.
// A limit that exists only here is not a limit.
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES_TOTAL = 25 * 1024 * 1024;
const MAX_FILES = 10;

let picked = [];

const compose = $('compose');
const done = $('done');
const err = $('err');
const btn = $('create');
const secret = $('secret');

// Reveal toggles on both passphrase fields (#1, #5).
attachReveal($('passphrase'));
attachReveal($('passphrase2'));

/* ---- #6: live size counter ----
 * We measure UTF-8 BYTES, not characters, because bytes are what the limit
 * actually bounds -- an emoji costs 4 bytes, a Latin letter 1. Any Unicode
 * character is accepted; there is no restricted character set.
 */
const encoder = new TextEncoder();
$('cap').textContent = `limit ${fmtBytes(MAX_PLAINTEXT)}`;

function used() {
  return encoder.encode(secret.value).length;
}
function updateCounter() {
  const n = used();
  $('used').textContent = fmtBytes(n);
  $('counter').classList.toggle('over', n > MAX_PLAINTEXT);
  btn.disabled = n > MAX_PLAINTEXT
    || filesTotal() > MAX_FILES_TOTAL
    || picked.length > MAX_FILES
    || picked.some((f) => f.size > MAX_FILE);
}
secret.addEventListener('input', updateCounter);
updateCounter();

$('usePass').addEventListener('change', (e) => {
  $('passWrap').classList.toggle('hidden', !e.target.checked);
  if (e.target.checked) $('passphrase').focus();
});

/* ------------------------------------------------------------------- files */

$('fileCap').textContent = ` / ${fmtBytes(MAX_FILES_TOTAL)}`;

// Files ACCUMULATE across picks rather than replacing the previous selection.
//
// This matters more than it looks. Mobile photo pickers are frequently
// single-select -- tapping a file input on Android and choosing Photos often
// yields exactly one image, while the Files/Documents chooser happily returns
// several. The old code assigned `picked = Array.from(e.target.files)`, so a
// second pick silently discarded the first, and the product appeared to have a
// hard "one image per secret" limit that exists nowhere in the code. Nothing
// here or in the crypto has ever looked at a file's type; the limit was the
// operating system's chooser, and the fix is to let people add files one at a
// time.
function addFiles(list) {
  for (const f of list) {
    // Dedupe on the triple, so adding the same file twice is a no-op rather than
    // a duplicate upload. Two genuinely different files sharing all three is not
    // a case worth engineering around.
    const dup = picked.some((p) =>
      p.name === f.name && p.size === f.size && p.lastModified === f.lastModified);
    if (!dup) picked.push(f);
  }
  renderFiles();
}

$('files').addEventListener('change', (e) => {
  addFiles(e.target.files || []);
  // Clear the input. Two reasons: the list below is now the single source of
  // truth for what will be sent, and without this, re-picking the SAME file
  // fires no change event at all -- so removing a file and adding it back would
  // silently do nothing.
  e.target.value = '';
});

/* drag and drop */

const drop = $('drop');
for (const ev of ['dragenter', 'dragover']) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
}
for (const ev of ['dragleave', 'drop']) {
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('over');
  });
}
drop.addEventListener('drop', (e) => addFiles(e.dataTransfer?.files || []));

// A file dropped ANYWHERE ELSE on the page makes the browser navigate to it --
// which would throw away a half-composed secret, passphrase and all, because the
// user missed a drop zone by twenty pixels. Refuse the default everywhere; the
// zone above still gets its own drops.
for (const ev of ['dragover', 'drop']) {
  window.addEventListener(ev, (e) => e.preventDefault());
}

function filesTotal() {
  return picked.reduce((n, f) => n + f.size, 0);
}

// The one thing wrong with the size limits, stated plainly. A red number is a
// symptom; this says what it means and what to do about it.
function fileProblem() {
  if (picked.length > MAX_FILES) {
    return `Too many files — ${picked.length} chosen, the limit is ${MAX_FILES}.`;
  }
  const big = picked.find((f) => f.size > MAX_FILE);
  if (big) {
    return `File too large — “${big.name}” is ${fmtBytes(big.size)}, and the limit is ` +
           `${fmtBytes(MAX_FILE)} for one file. Remove it, or send it another way.`;
  }
  if (filesTotal() > MAX_FILES_TOTAL) {
    return `Files too large — ${fmtBytes(filesTotal())} in total, and the limit is ` +
           `${fmtBytes(MAX_FILES_TOTAL)} for one secret. Remove one, or send them separately.`;
  }
  return '';
}

function renderFiles() {
  const list = $('fileList');
  list.textContent = '';

  for (const f of picked) {
    const li = document.createElement('li');

    const name = document.createElement('span');
    // textContent, never innerHTML: a filename is user-supplied text and must
    // never be parsed as markup, even when the user supplying it is the sender.
    name.textContent = f.name;

    const size = document.createElement('span');
    size.className = 'soft';
    size.textContent = fmtBytes(f.size);

    const rm = document.createElement('button');
    rm.className = 'secondary compact';
    rm.textContent = 'Remove';
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

function fail(msg) {
  err.textContent = msg;
  err.classList.remove('hidden');
  btn.disabled = false;
  btn.textContent = 'Create secret link';
}

btn.addEventListener('click', async () => {
  err.classList.add('hidden');
  $('passMatch').classList.add('hidden');

  const plaintext = secret.value;
  // A secret may now be files with no covering message, so an empty box is only
  // an error when there is nothing else to send.
  if (!plaintext.trim() && picked.length === 0) {
    return fail('Please enter a secret or attach a file first.');
  }
  if (used() > MAX_PLAINTEXT) {
    return fail(`That secret is ${fmtBytes(used())}, over the ${fmtBytes(MAX_PLAINTEXT)} limit.`);
  }
  if (picked.length > MAX_FILES) {
    return fail(`That is ${picked.length} files; the limit is ${MAX_FILES}.`);
  }
  const over = picked.find((f) => f.size > MAX_FILE);
  if (over) {
    return fail(`“${over.name}” is ${fmtBytes(over.size)}, over the ${fmtBytes(MAX_FILE)} limit for one file.`);
  }
  if (filesTotal() > MAX_FILES_TOTAL) {
    return fail(`Those files total ${fmtBytes(filesTotal())}, over the ${fmtBytes(MAX_FILES_TOTAL)} limit.`);
  }

  const usePass = $('usePass').checked;
  const passphrase = usePass ? $('passphrase').value : '';

  if (usePass) {
    if (!passphrase) return fail('Please enter a passphrase, or uncheck the box.');
    // #1: a mistyped passphrase makes the secret PERMANENTLY undecryptable, by
    // anyone. Confirming it is the only defence -- so we refuse to proceed on a
    // mismatch rather than merely warning.
    if (passphrase !== $('passphrase2').value) {
      $('passMatch').classList.remove('hidden');
      $('passphrase2').focus();
      return;
    }
  }

  btn.disabled = true;
  setBusy(btn, 'Encrypting…');

  try {
    // ONE key for the whole secret: the manifest and every file are encrypted
    // under it, each with its own fresh nonce. Derived once here because with a
    // passphrase it costs 600k PBKDF2 iterations, and doing that per file would
    // make a five-file secret five times as slow for no benefit.
    const { aesKey, salt, fragment } = await newSecretKey(passphrase);

    // Files go up FIRST. The manifest has to name their refs, and the manifest is
    // what we encrypt and send as the secret -- so the refs must exist before it
    // can be sealed. Until POST /api/secret binds them, these blobs belong to
    // nobody and the server collects them within the hour, which is exactly what
    // makes it safe to abandon this page halfway through.
    const manifestFiles = [];
    // The total the RECIPIENT will download (sum of file ciphertexts). We hand this
    // to them in the link fragment so they can be warned how much is coming before
    // they burn the secret -- see the share link below. The server never sees it.
    let downloadBytes = 0;
    for (const [i, file] of picked.entries()) {
      setBusy(btn, picked.length > 1
        ? `Encrypting file ${i + 1} of ${picked.length}…`
        : 'Encrypting file…');

      const bytes = new Uint8Array(await file.arrayBuffer());
      const { nonce, ciphertext } = await encryptBytes(aesKey, bytes);
      downloadBytes += ciphertext.length;

      setBusy(btn, picked.length > 1
        ? `Uploading file ${i + 1} of ${picked.length}…`
        : 'Uploading file…');
      const ref = await uploadBlob(ciphertext);

      // The name and type are recorded ONLY here, inside what will become the
      // encrypted manifest. They are never sent as their own field, because the
      // server must not learn them -- "resignation_letter.pdf" gives the game away
      // without decrypting a byte.
      manifestFiles.push({ name: file.name, size: file.size, type: file.type, ref, nonce });
    }

    setBusy(btn, 'Encrypting…');
    const body = await sealManifest(aesKey, salt, passphrase, plaintext, manifestFiles);

    const res = await fetch('/api/secret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        ttl: $('ttl').value,
        blob_refs: manifestFiles.map((f) => f.ref),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return fail(j.error || 'Could not create the secret. Please try again.');
    }
    const { id, status_id } = await res.json();

    // Assembled HERE, in the browser. The server has never seen the fragment.
    //
    // When there are files, we append the total download size as a third fragment
    // segment ("v2.<key>.<bytes>"). It rides in the '#' with the key, so the server
    // never sees it, and it lets the reveal page warn the recipient how much is
    // coming BEFORE they burn the secret. openSecret ignores the extra segment; a
    // link without it (text-only, or made before this existed) just shows no size.
    const sizeTag = downloadBytes > 0 ? `.${downloadBytes}` : '';
    const share = `${location.origin}/s/${id}#${fragment}${sizeTag}`;
    const status = `${location.origin}/status/${status_id}`;

    $('shareLink').textContent = share;
    $('statusLink').textContent = status;
    wireCopy('copyShare', share, 'Copy share link', markCopied);
    wireCopy('copyStatus', status, 'Copy status link');

    // The share link exists ONLY here. The decryption key lives in the '#'
    // fragment, which the server has never seen and cannot reproduce -- so if the
    // user navigates away without saving the link, the secret becomes permanently
    // undecryptable by everyone, including us. It will simply sit as unreadable
    // ciphertext until it expires. That is silent, total data loss, so we guard
    // against it rather than assume care.
    //
    // We detect a manual copy too (Ctrl/Cmd-C, or right-click -> Copy): selecting
    // the link and copying it fires a native 'copy' event, so the guard does not
    // punish people who never touch our button.
    $('shareLink').addEventListener('copy', markCopied);

    secret.value = '';
    $('passphrase').value = '';
    $('passphrase2').value = '';
    picked = [];
    $('files').value = '';
    renderFiles();

    compose.classList.add('hidden');
    done.classList.remove('hidden');
    // The compose form was scrolled DOWN to reach the Create button; the result
    // view is shorter, so the browser keeps (and clamps) that offset and opens the
    // page scrolled to the bottom -- showing the status link but hiding the SHARE
    // link above it, the one link that must not be missed. Put it back to the top.
    // rAF so this runs after the reveal has laid out; some mobile browsers (seen on
    // Android Firefox as an installed PWA) otherwise restore the old offset on top
    // of an immediate scroll.
    requestAnimationFrame(() => window.scrollTo(0, 0));
  } catch (e) {
    fail(e.message || 'Encryption failed.');
  }
});

// Upload one file's ciphertext and return its ref.
//
// The body is RAW BYTES, not base64 in JSON. Base64 inflates by a third, so a
// 25 MB file would become 33 MB of text to build in memory, send, and decode
// again on the far side -- all to move bytes that were already bytes.
async function uploadBlob(ciphertext) {
  const res = await fetch('/api/blob', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ciphertext,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || 'Could not upload the file. Please try again.');
  }
  const { ref } = await res.json();
  return ref;
}

function wireCopy(btnId, text, label, onCopied) {
  const b = document.getElementById(btnId);
  b.onclick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Copied ✓';
      if (onCopied) onCopied();
      setTimeout(() => (b.textContent = label), 1600);
    } catch {
      b.textContent = 'Press Ctrl/Cmd-C to copy';
    }
  };
}

let copied = false;
function markCopied() {
  copied = true;
  $('notCopied').classList.add('hidden');
}

function confirmLeave() {
  if (copied) return true;
  return window.confirm(
    'You have not copied the share link.\n\n' +
    'The decryption key exists only on this page — it is not stored on our server. ' +
    'If you leave now, this secret can never be read by anyone.\n\n' +
    'Leave anyway?'
  );
}

$('again').addEventListener('click', () => {
  if (confirmLeave()) location.href = '/';
});

// Also catch closing the tab / navigating away entirely.
window.addEventListener('beforeunload', (e) => {
  if (!done.classList.contains('hidden') && !copied) {
    e.preventDefault();
    e.returnValue = '';
  }
});
