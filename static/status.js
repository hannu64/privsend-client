// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

import { api } from './config.js';

const el = document.getElementById('state');
const refresh = document.getElementById('refresh');
const statusID = location.pathname.split('/').pop();

function render(icon, title, detail) {
  el.replaceChildren();
  const i = document.createElement('div');
  i.className = 'icon';
  i.textContent = icon;
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = detail;
  el.append(i, h, p);
}

function busy() {
  el.replaceChildren();
  const i = document.createElement('div');
  i.className = 'icon';
  const sp = document.createElement('span');
  sp.className = 'spinner';
  i.appendChild(sp);
  const h = document.createElement('h2');
  h.textContent = 'Checking…';
  el.append(i, h);
}

async function check() {
  busy();
  refresh.disabled = true;

  let res;
  try {
    res = await fetch(api(`/api/status/${encodeURIComponent(statusID)}`), { cache: 'no-store' });
  } catch {
    render('⚠️', 'Could not reach the server', 'Please try again in a moment.');
    refresh.disabled = false;
    return;
  }

  if (!res.ok) {
    // Either this receipt never existed, or the secret was resolved more than the
    // retention window ago and the row has been purged (#4). We cannot tell which,
    // and we do not guess.
    render('❓', 'This receipt is no longer available',
      'It may never have existed, or the secret may have been opened or expired more than 7 days ago — ' +
      'after which we delete the record entirely.');
    refresh.disabled = false;
    return;
  }

  // files_pending defaults to 0 so an older server (or a v1 secret, which never
  // has files) takes the plain text-only wording below.
  const { state, opened_at, files_pending = 0 } = await res.json();

  if (state === 'unopened') {
    render('📬', 'Not opened yet',
      'The recipient has not read this secret. It will be destroyed automatically when it expires, ' +
      'even if nobody ever opens it.');
  } else if (state === 'opened' && files_pending > 0) {
    // THE HONEST CASE FOR FILES. The wording below was written when the product
    // was text-only, where "collected" and "destroyed" really are the same
    // instant. With files it became false: the manifest dies at once, but the
    // blobs live on through the download grace window -- so a sender who attached
    // a document, opened their own link and checked this receipt was told the
    // secret "no longer exists anywhere" while their file was demonstrably still
    // sitting on the server. (Found in live testing, 2026-07.)
    //
    // A lie in the receipt is the whole value of the receipt gone. Say what is
    // actually true, and say why -- the lag has a reason the sender will accept
    // once they know it.
    const when = opened_at ? new Date(opened_at).toLocaleString() : 'an unknown time';
    const n = files_pending;
    render('⏳', 'Collected — files still being delivered',
      `The encrypted message was collected on ${when} and destroyed at that instant. ` +
      `${n === 1 ? 'One file is' : `${n} files are`} still on our server. A file cannot be destroyed ` +
      `the moment a download begins: if it were, a download that dropped halfway would leave the ` +
      `recipient with nothing and no way to try again. ` +
      `${n === 1 ? 'It is' : 'They are'} destroyed as soon as the recipient's browser confirms the ` +
      `download arrived intact — usually within seconds — and in any case no later than 60 minutes ` +
      `after collection. Check again shortly and this will say "destroyed".`);
  } else if (state === 'opened') {
    const when = opened_at ? new Date(opened_at).toLocaleString() : 'an unknown time';
    // Precision matters here. What actually happened is that the ENCRYPTED secret
    // was COLLECTED and destroyed. Whether the recipient then successfully
    // DECRYPTED it is something we cannot know -- decryption happens in their
    // browser, and a passphrase is checked only there (§4.2). Saying "read" would
    // over-claim: with a passphrase, the recipient may have collected it and then
    // failed to unlock it.
    //
    // We cannot fix this by delaying the burn until decryption succeeds: the
    // client would have to TELL us it succeeded, and a dishonest client could
    // simply never say so and read the secret repeatedly. Burn-on-collection is
    // the only safe rule, so the wording must be honest instead.
    render('✅', 'Collected and destroyed',
      `The encrypted secret was collected on ${when} and destroyed at that instant — it no longer ` +
      `exists anywhere. Note we can only see that it was collected, never whether it was successfully ` +
      `decrypted: if you set a passphrase and the recipient mistyped it, the secret is now lost to everyone.`);
  } else if (state === 'taken_down') {
    // The sender has no account and we hold no address for them, so this receipt
    // is the ONLY way we can tell them their secret was removed. Saying nothing
    // -- or letting the link simply go dead -- would leave them to conclude the
    // recipient had read it.
    render('🚫', 'Removed after a report',
      'This secret was reported to us and removed, and its contents were destroyed. ' +
      'We cannot read secrets, so we act on reports about the link itself. ' +
      'If you believe this was a mistake, contact support@zumitomi.fi.');
  } else {
    // #4: expired-unread is a genuinely different outcome from opened, and the
    // sender needs to know which -- "nobody read it" vs "someone read it".
    render('⌛', 'Expired — never read',
      'Nobody opened this secret before its time limit ran out, so it was destroyed unread. ' +
      'If the recipient still needs it, send a new one.');
  }
  refresh.disabled = false;
}

refresh.addEventListener('click', check);
check();
