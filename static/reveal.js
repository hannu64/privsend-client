// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

import { openSecret, decryptBytes } from './crypto.js';
import { attachReveal, fmtBytes, setBusy } from './ui.js';
import { api, secretId } from './config.js';

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

// On the website this is the last segment of the /s/{id} path; in the extension it
// comes from the ?id= query the content script set. Either way it is only the
// non-secret id -- the decryption key still comes solely from the fragment below.
const id = secretId();

// #5: let the recipient SEE what they typed. Correcting a mistyped passphrase
// while blind was needlessly painful.
attachReveal(document.getElementById('passphrase'));

// The decryption key. It lives ONLY here, in the fragment. It was never sent to
// the server -- browsers do not transmit the part of a URL after '#' (§3.2).
const fragment = location.hash.slice(1);

// Once fetched, the secret is GONE from the server. We hold the payload in memory
// so that a wrong passphrase does not destroy the user's only copy: they can
// retry here without another (impossible) fetch.
let payload = null;

// The sender's browser tucked the download size into the fragment (a third segment
// after the key), so we can tell the recipient how much is coming BEFORE they burn
// the secret -- without the server ever learning it. A phone that is full, or on a
// weak connection, can move to another device now; once revealed, this link is
// spent. Old/text-only links omit it, and then we simply show no size.
const declaredSize = Number(location.hash.slice(1).split('.')[2]);
if (Number.isFinite(declaredSize) && declaredSize > 0) {
  $('sizeHint').textContent =
    `📦 About ${fmtBytes(declaredSize)} will be downloaded. Make sure this device has room and a ` +
    `steady connection before you reveal it — the secret can only be opened once.`;
  show('sizeHint');
}

function busy(msg) {
  $('busyMsg').textContent = msg;
  hide('gate'); hide('passSection'); hide('out'); hide('gone');
  show('busy');
}

function gone(msg) {
  $('goneMsg').textContent = msg;
  hide('gate'); hide('passSection'); hide('out'); hide('busy');
  show('gone');
}

// The AES key, kept for the files: they are fetched and decrypted one at a time,
// after the manifest is already on screen, under the same key.
let aesKey = null;
// Files still live on the server. Emptied as each one is destroyed.
let pending = new Set();

// A generous cap on passphrase attempts. This is a UX guardrail, NOT a security
// control, and the wording is careful not to pretend otherwise: the passphrase is
// checked ONLY here in the browser, so a real attacker keeps the downloaded
// ciphertext and guesses offline, never touching this counter. Its honest job is to
// stop endless fumbling and, when exhausted, drop this tab's copy so a borrowed or
// shared device is not left sitting on an open secret. The real protection is the
// passphrase's own strength, stretched through 600k PBKDF2 iterations.
let passAttempts = 0;
const MAX_PASS_ATTEMPTS = 10;

function render(message, files) {
  // textContent, never innerHTML: the secret is untrusted text and must never be
  // parsed as markup.
  $('plaintext').textContent = message;
  // A secret can now be files with no covering message; an empty box would just
  // be a puzzling blank panel.
  $('msgWrap').classList.toggle('hidden', message === '');
  // With no message there is nothing to copy, so treat it as already saved --
  // otherwise the leave-guard below would nag about an unsaved message that does
  // not exist, forever, no matter what the recipient did.
  if (message === '') copied = true;
  $('filesWrap').classList.toggle('hidden', files.length === 0);
  if (files.length > 0) renderFiles(files);

  hide('gate'); hide('passSection'); hide('busy'); hide('gone');
  show('out');
}

function renderFiles(files) {
  const list = $('dlList');
  list.textContent = '';
  pending = new Set(files.map((f) => f.ref));

  for (const f of files) {
    const li = document.createElement('li');

    const name = document.createElement('span');
    // textContent again. The manifest is AUTHENTIC -- GCM proves it came from
    // whoever held the key -- but authentic is not the same as trustworthy: a
    // hostile sender picked every byte of this filename.
    name.textContent = f.name;

    const size = document.createElement('span');
    size.className = 'soft';
    size.textContent = fmtBytes(f.size);

    const btn = document.createElement('button');
    btn.className = 'secondary compact';
    btn.textContent = 'Download';
    btn.addEventListener('click', () => downloadFile(f, btn, li));

    li.append(name, size, btn);
    list.append(li);
  }
}

async function downloadFile(file, btn, li) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'Downloading…';

  try {
    const res = await fetch(api(`/api/blob/${encodeURIComponent(file.ref)}`));
    if (!res.ok) {
      throw new Error('This file is no longer available on the server.');
    }
    const ciphertext = new Uint8Array(await res.arrayBuffer());

    btn.textContent = 'Decrypting…';
    // THE MOMENT THAT MATTERS. If this returns, AES-GCM has verified the
    // authentication tag -- which means every byte arrived, unaltered. A download
    // that dropped at 90% fails here instead of quietly producing a broken file,
    // so success is proof of delivery rather than a hopeful guess at it. That is
    // what makes it safe to destroy the file on the server in the next breath.
    const plain = await decryptBytes(aesKey, file.nonce, ciphertext);

    save(file.name, plain);

    // Hand it back to the user first, destroy second: the bytes are in this tab's
    // memory now, so the server copy has no further purpose.
    await burn(file.ref);

    btn.textContent = 'Saved ✓';
    li.classList.add('done');
  } catch (e) {
    // Destroy NOTHING on failure -- this is precisely what the grace window is
    // for. Let them try again.
    btn.disabled = false;
    btn.textContent = label;
    li.classList.add('failed');
    const msg = document.createElement('p');
    msg.className = 'note danger';
    // The "do not leave" half is the part that actually saves the file, and it is
    // the part a panicking user most needs. THIS TAB HOLDS THE ONLY KEY: the
    // manifest was destroyed on the server the moment they revealed, so the
    // decryption key and the per-file nonces now exist nowhere else in the world.
    // Reloading, or re-opening the share link in a new tab, gets "no longer
    // available" -- correctly, because the secret really was one-time. Their
    // instinct on a failed download is to reload, and that instinct destroys the
    // file. Say so before they act on it.
    msg.textContent = friendlyError(e) +
      ' Nothing was destroyed — press Download again. ' +
      'Do NOT reload or leave this page: it holds the only key to these files, ' +
      'and re-opening the link in a new tab will not work.';
    li.append(msg);
  }
}

// "Failed to fetch" is what the browser says when the network drops. It is true,
// useless, and frightening in a place where people are already worried about
// losing something. Say what happened instead.
function friendlyError(e) {
  const raw = e?.message || '';
  if (/fetch|network|load failed/i.test(raw)) {
    return 'The connection dropped during the download.';
  }
  if (/no longer available/i.test(raw)) return raw;
  if (/decrypt|tag|operation/i.test(raw)) {
    // A GCM failure here almost always means a truncated transfer, not a broken
    // file: the tag catches a download that ended early.
    return 'The file did not arrive intact — the download was cut short.';
  }
  return raw || 'The download failed.';
}

function save(name, bytes) {
  // SECURITY: the Blob type is forced to application/octet-stream and NEVER taken
  // from the manifest. A blob: URL inherits the origin that created it, so a
  // hostile sender who could choose "text/html" here would be choosing to run
  // script on privsend's own origin. The real type is not needed to save a file --
  // the extension tells the operating system what it is.
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Release the object URL, but not before the browser has taken the download.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function burn(ref) {
  pending.delete(ref);
  if (pending.size === 0) {
    hide('filesPending');
    $('destroyNow').classList.add('hidden');
    show('filesDone');
  }
  try {
    await fetch(api(`/api/blob/${encodeURIComponent(ref)}/burn`), { method: 'POST' });
  } catch {
    // The request failed, but the file is not immortal: the server destroys it at
    // the 30-minute deadline regardless. Saying nothing is right -- the recipient
    // has their file, and there is no action for them to take.
  }
}

$('destroyNow').addEventListener('click', async () => {
  const btn = $('destroyNow');
  btn.disabled = true;
  setBusy(btn, 'Destroying…');
  for (const ref of Array.from(pending)) await burn(ref);
  btn.disabled = false;
  btn.textContent = 'Destroy all files now';
});

/*
 * IMPORTANT: nothing above or below runs on page load except wiring. Merely
 * opening this URL does not touch the secret (§3.5). A crawler that fetches the
 * link gets the static page and leaves the secret intact.
 */

$('reveal').addEventListener('click', async () => {
  // Guard BEFORE burning. If the link has no '#key' (a common way links get
  // mangled -- truncated by a chat app, or copied without the fragment), then
  // fetching would destroy a secret we could never decrypt. Refuse instead.
  if (!fragment) {
    gone('This link is missing its decryption key — the part after the “#”. ' +
         'Nothing was opened. Ask the sender to re-send the complete link.');
    return;
  }

  busy('Retrieving and destroying…');

  let res;
  try {
    res = await fetch(api(`/api/secret/${encodeURIComponent(id)}`));
  } catch {
    gone('Could not reach the server. Nothing was opened; try again.');
    return;
  }

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    gone(j.error || 'This secret is no longer available.');
    return;
  }

  // From this moment the secret exists ONLY in this browser tab.
  payload = await res.json();

  if (payload.has_passphrase) {
    hide('busy');
    show('passSection');
    $('passphrase').focus();
    return;
  }

  await decryptAndShow('');
});

$('unlock').addEventListener('click', () => decryptAndShow($('passphrase').value));
$('passphrase').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') decryptAndShow($('passphrase').value);
});

async function decryptAndShow(passphrase) {
  if (payload.has_passphrase && !passphrase) return;

  hide('passErr');
  busy('Decrypting…');
  // Yield a frame so the spinner actually paints before PBKDF2 (600k iterations)
  // occupies the main thread.
  await new Promise((r) => setTimeout(r, 30));

  try {
    const opened = await openSecret(fragment, payload, passphrase);
    aesKey = opened.aesKey;
    render(opened.message, opened.files);
  } catch (e) {
    hide('busy');

    // Not a passphrase secret? Then a decrypt failure is a corrupt or incompatible
    // payload, not a wrong guess -- retrying will not help and the counter would be
    // nonsense. Show the error and stop.
    if (!payload || !payload.has_passphrase) {
      show('passSection');
      $('passErr').textContent = e.message;
      $('passErr').classList.remove('hidden');
      return;
    }

    passAttempts++;
    const left = MAX_PASS_ATTEMPTS - passAttempts;

    if (left <= 0) {
      // Ten wrong tries. Drop this tab's copy -- the server already destroyed its
      // own at reveal, so the honest word is "cleared from this page", not
      // "destroyed". Nothing is left here to guess against, and a shared device is
      // no longer sitting on an open secret.
      payload = null;
      aesKey = null;
      show('lockoutQuote'); // the wink -- secondary to the help above it
      gone('Ten wrong passphrases — this secret has been cleared from this page. It was ' +
           'already destroyed on the server when it was opened, so it cannot be retrieved. ' +
           'Ask the sender to create a new one.');
      return;
    }

    // The secret is already burned server-side, so we do NOT send them away: the
    // payload is still here in memory and a retry costs nothing.
    show('passSection');
    $('passErr').textContent =
      `Wrong passphrase. You can keep trying — this secret is only in this tab now, so ` +
      `don't reload. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    $('passErr').classList.remove('hidden');
    // #5: CLEAR the field rather than selecting it. Relying on select() to make
    // the next keystroke overwrite the old value did not hold in practice -- the
    // rejected passphrase stayed put and new characters were appended to it,
    // guaranteeing the retry failed too.
    $('passphrase').value = '';
    $('passphrase').focus();
  }
}

// Has the user actually saved the secret? The warning below is only justified if
// they have NOT -- nagging someone who already copied it is pure noise, and noisy
// warnings are the ones people learn to click through without reading.
let copied = false;

$('copy').addEventListener('click', async () => {
  const b = $('copy');
  try {
    await navigator.clipboard.writeText($('plaintext').textContent);
    copied = true;
    b.textContent = 'Copied ✓';
    setTimeout(() => (b.textContent = 'Copy to clipboard'), 1600);
  } catch {
    b.textContent = 'Press Ctrl/Cmd-C to copy';
  }
});

// Also count a manual selection + Ctrl/Cmd-C, so people who never touch our
// button are not nagged either.
$('plaintext').addEventListener('copy', () => { copied = true; });

// Warn on leaving ONLY if there is something to lose: the message is on screen and
// was never saved, or files are still sitting undownloaded on the server. At that
// point the secret exists nowhere else in the world -- the server destroyed the
// manifest when it was collected, so closing this tab loses it permanently.
//
// NOTE: the browser will NOT show our wording. Chrome, Firefox and Safari all
// ignore custom text here and display their own generic "Leave site?" dialog --
// the capability was removed years ago because sites abused it for scare-ware. So
// this can only ask the question, not explain it. The explaining is done on the
// page itself, next to the file list, where we control what is said.
window.addEventListener('beforeunload', (e) => {
  const open = !$('out').classList.contains('hidden');
  if (open && (!copied || pending.size > 0)) {
    e.preventDefault();
    e.returnValue = '';
  }
});
