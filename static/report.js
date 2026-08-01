// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

import { setBusy } from './ui.js';
import { api } from './config.js';
// One script for /report and /fi/report, exactly as create.js serves / and /fi. The
// language comes from <html lang> on the file the server picked; there is no toggle,
// because the reader followed a footer link and so chose it.
import { t } from './i18n.js';

const $ = (id) => document.getElementById(id);

/**
 * Extract the secret id from whatever the reporter pasted, and DISCARD the key.
 *
 * SECURITY: this is the whole point of doing it here rather than on the server.
 * A share link is /s/<id>#<key> -- the part after '#' IS the decryption key. A
 * well-meaning reporter will paste the entire link they received. If we sent that
 * to the server, we would hand ourselves the key to the very ciphertext we are
 * storing, destroying the zero-knowledge property (§3.1) for that secret and
 * leaving the key sitting in our database.
 *
 * So the fragment is dropped in the browser and never transmitted. The server
 * additionally REJECTS anything containing '#' as defence in depth -- but this
 * function is the line that must never break.
 */
function extractID(input) {
  let s = String(input).trim();
  if (!s) return '';

  // Kill the fragment first, before any other parsing can go wrong.
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);

  // Accept a full URL, a path, or a bare id.
  try {
    if (/^https?:\/\//i.test(s)) s = new URL(s).pathname;
  } catch { /* fall through and treat it as a path */ }

  s = s.replace(/^.*\/s\//, '').replace(/^\/+/, '').replace(/[/?].*$/, '');
  return s;
}

/**
 * The SHAPE of an id we could actually have minted: 22 characters of the base64url
 * alphabet. A mirror of store.ValidID (server/internal/store/store.go), and this copy
 * is NOT the security boundary -- the server whitelists the same shape, and that is
 * what keeps a pasted decryption key out of the database. Never rely on this one.
 *
 * It is here for language. The server's rejection is English only, and on /fi/report
 * that put an English sentence in front of a Finn who had simply mistyped an id. Same
 * rule as reveal.js: answer the cases a real person actually hits from our own table,
 * and keep the server's wording for the genuinely unexpected ones.
 *
 * Because it is a copy it can drift, so smoke.sh asserts that a freshly minted id
 * still matches this pattern -- if the server ever changes id length, the report form
 * must not start refusing perfectly good links.
 */
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

$('link').addEventListener('input', () => {
  const id = extractID($('link').value);
  const p = $('parsed');
  if (id) {
    p.textContent = ID_RE.test(id) ? t.report.parsed(id) : t.report.notAnID;
    p.classList.remove('hidden');
  } else {
    p.classList.add('hidden');
  }
});

$('send').addEventListener('click', async () => {
  const err = $('err');
  err.classList.add('hidden');

  const id = extractID($('link').value);
  if (!id) {
    err.textContent = t.report.needLink;
    err.classList.remove('hidden');
    return;
  }
  if (!ID_RE.test(id)) {
    err.textContent = t.report.notAnID;
    err.classList.remove('hidden');
    return;
  }

  $('send').disabled = true;
  setBusy($('send'), t.report.sending);

  try {
    const res = await fetch(api('/api/report'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only the id and the reason. Never the fragment.
      body: JSON.stringify({ id, reason: $('reason').value }),
    });
    if (!res.ok && res.status !== 204) {
      const j = await res.json().catch(() => ({}));
      // The check above should mean 400 never gets here, but it is the server that
      // decides what a valid id is, so answer its verdict in the reader's language
      // rather than passing through English. 429 is the other one a real reporter
      // can meet. Anything else is unexpected, and the server's text is more use
      // than a generic line -- exactly the split reveal.js makes.
      if (res.status === 400) throw new Error(t.report.notAnID);
      if (res.status === 429) throw new Error(t.rateLimited);
      throw new Error(j.error || t.report.failed);
    }
    $('form').classList.add('hidden');
    $('thanks').classList.remove('hidden');
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
    $('send').disabled = false;
    $('send').textContent = t.report.sendBtn;
  }
});
