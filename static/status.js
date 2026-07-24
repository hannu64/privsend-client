// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

import { api } from './config.js';
import { t, initLangToggle, onLangChange } from './i18n.js';

const el = document.getElementById('state');
const refresh = document.getElementById('refresh');
const statusID = location.pathname.split('/').pop();

// The last answer the server gave, kept so the verdict can be written again in
// the other language WITHOUT asking again. Re-fetching to change language would
// be pointless traffic, and on a receipt it would also look alarming: the sender
// is watching this page precisely to see whether something changed.
let last = null;

function render([icon, title, detail]) {
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
  last = null;
  el.replaceChildren();
  const i = document.createElement('div');
  i.className = 'icon';
  const sp = document.createElement('span');
  sp.className = 'spinner';
  i.appendChild(sp);
  const h = document.createElement('h2');
  h.textContent = t.status.checking;
  el.append(i, h);
}

/** Turn a server answer into the three parts of a verdict, in the current
 *  language. Kept separate from check() so a language change can re-run it on
 *  the answer already in hand. */
function verdict(data) {
  const S = t.status;
  if (data.unreachable) return S.unreachable;
  if (data.missing) return S.missing;

  // files_pending defaults to 0 so an older server (or a v1 secret, which never
  // has files) takes the plain text-only wording below.
  const { state, opened_at, files_pending = 0 } = data;
  // toLocaleString() follows the reader's own locale, which is what a person
  // reading a timestamp wants regardless of which language the page is in.
  const when = opened_at ? new Date(opened_at).toLocaleString() : S.unknownTime;

  if (state === 'unopened') return S.unopened;

  // THE HONEST CASE FOR FILES. The wording was written when the product was
  // text-only, where "collected" and "destroyed" really are the same instant.
  // With files it became false: the manifest dies at once, but the blobs live on
  // through the download grace window -- so a sender who attached a document,
  // opened their own link and checked this receipt was told the secret "no longer
  // exists anywhere" while their file was demonstrably still on the server.
  // (Found in live testing, 2026-07.) A lie in the receipt is the whole value of
  // the receipt gone.
  if (state === 'opened' && files_pending > 0) return S.pending(when, files_pending);

  // Precision matters here. What actually happened is that the ENCRYPTED secret
  // was COLLECTED and destroyed. Whether the recipient then successfully
  // DECRYPTED it is something we cannot know -- decryption happens in their
  // browser, and a passphrase is checked only there (§4.2). Saying "read" would
  // over-claim. We cannot fix this by delaying the burn until decryption
  // succeeds: the client would have to TELL us it succeeded, and a dishonest
  // client could simply never say so and read the secret repeatedly.
  // Burn-on-collection is the only safe rule, so the wording must be honest.
  if (state === 'opened') return S.collected(when);

  // The sender has no account and we hold no address for them, so this receipt is
  // the ONLY way we can tell them their secret was removed. Saying nothing -- or
  // letting the link go dead -- would leave them to conclude the recipient read it.
  if (state === 'taken_down') return S.takenDown;

  // #4: expired-unread is a genuinely different outcome from opened, and the
  // sender needs to know which -- "nobody read it" vs "someone read it".
  return S.expired;
}

function draw(data) {
  last = data;
  render(verdict(data));
}

async function check() {
  busy();
  // Disabled only for the moment the request is in flight, so a rapid double-tap
  // cannot stack two checks. Re-enabling lives in `finally`, NOT at each exit:
  // when it was written once per path, the success path was the one that got
  // missed, and the button stayed dead for the rest of the page's life on the
  // ordinary case. A new early return must not be able to reintroduce that.
  refresh.disabled = true;
  try {
    let res;
    try {
      res = await fetch(api(`/api/status/${encodeURIComponent(statusID)}`), { cache: 'no-store' });
    } catch {
      draw({ unreachable: true });
      return;
    }

    if (!res.ok) {
      // Either this receipt never existed, or the secret was resolved more than the
      // retention window ago and the row has been purged (#4). We cannot tell which,
      // and we do not guess.
      draw({ missing: true });
      return;
    }

    draw(await res.json());
  } finally {
    refresh.disabled = false;
  }
}

function relabel() {
  document.title = t.status.pageTitle;
  refresh.textContent = t.status.checkAgain;
}

onLangChange(() => {
  relabel();
  if (last) render(verdict(last));
});
// autodetect: this URL was generated, not chosen, so it says nothing about the
// reader's language. Their browser locale is the only opening hint there is.
initLangToggle({ autodetect: true });
relabel();

refresh.addEventListener('click', check);
check();
