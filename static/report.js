// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

import { setBusy } from './ui.js';
import { api } from './config.js';

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

$('link').addEventListener('input', () => {
  const id = extractID($('link').value);
  const p = $('parsed');
  if (id) {
    p.textContent = `Will report id: ${id} — the key (after “#”) has been discarded and will not be sent.`;
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
    err.textContent = 'Please paste the privsend link you want to report.';
    err.classList.remove('hidden');
    return;
  }

  $('send').disabled = true;
  setBusy($('send'), 'Sending…');

  try {
    const res = await fetch(api('/api/report'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only the id and the reason. Never the fragment.
      body: JSON.stringify({ id, reason: $('reason').value }),
    });
    if (!res.ok && res.status !== 204) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'Could not send the report.');
    }
    $('form').classList.add('hidden');
    $('thanks').classList.remove('hidden');
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('hidden');
    $('send').disabled = false;
    $('send').textContent = 'Send report';
  }
});
