// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// The recipient's console. The owner_token lives in the URL fragment (never sent to
// the server); this page reads it, fetches the inbox with it in a header, and then
// asks for the passphrase to unlock the private key LOCALLY. Reading a drop needs
// both — the console link (something you have) and the passphrase (something you
// know) — which is the two-factor at the heart of the design.

import { unwrapPrivateKey, openDrop, publicKeyFingerprint, rewrapPrivateKey } from './crypto.js';
import { attachReveal } from './ui.js';
import { api } from './config.js';

const $ = (id) => document.getElementById(id);

// The token is everything after '#'. It never leaves this page except as a header.
const ownerToken = location.hash.slice(1);

let priv = null;  // the unwrapped private key (CryptoKey), once the passphrase is entered
let view = null;  // the last inbox response
let myFailedThisSession = 0;  // wrong guesses made in THIS tab, so they never self-alarm

function show(id) {
  for (const s of ['loading', 'invalid', 'console']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}

const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};
const groupFp = (hex) => hex.replace(/(.{4})/g, '$1 ').trim();

// The API returns every binary field as a base64 string, which is exactly what the
// crypto.js helpers consume — so the JSON entries pass straight into openDrop, and
// the wrapped-key fields straight into unwrapPrivateKey, with no conversion.
async function fetchInbox() {
  const res = await fetch(api('/api/drop/inbox'), {
    headers: { 'X-Owner-Token': ownerToken },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('invalid');
  return res.json();
}

async function init() {
  if (!ownerToken) { show('invalid'); return; }
  try {
    view = await fetchInbox();
  } catch {
    show('invalid');
    return;
  }

  $('publicAddr').textContent = `${location.origin}/public/${view.drop_id}`;
  publicKeyFingerprint(view.public_key)
    .then((fp) => { $('fingerprint').textContent = groupFp(fp); })
    .catch(() => { $('fingerprint').textContent = '(unavailable)'; });
  $('disabledBanner').classList.toggle('hidden', !view.disabled);
  // Reflect the current settings so the toggles show the truth. These read from the
  // inbox response, which needs only the console link — so pausing (Hold) is possible
  // without the passphrase, which is what makes it usable in a hurry or under duress.
  $('setHold').checked = view.disabled;
  $('setDisclose').checked = view.disclose_last_seen;
  // The retention control lives in the post-unlock "Manage" panel; seed it now so it is
  // ready the moment the panel appears.
  $('setRetention').value = String(view.retention_days);
  refreshSaveState();
  showCount();
  show('console');
}

function showCount() {
  const n = view.entries.length;
  // Deliberately a TOTAL, not a new/seen split: the console does not track which drops
  // have been read (that would be extra metadata for little value), so it says how many
  // are held, never how many are unread.
  $('count').textContent = n === 0
    ? 'No messages in your inbox yet. Enter your passphrase to open it.'
    : `Your inbox holds ${n} message${n === 1 ? '' : 's'} in total. Enter your passphrase to read ${n === 1 ? 'it' : 'them'}.`;
}

$('unlockBtn').addEventListener('click', async () => {
  $('unlockErr').classList.add('hidden');
  const pass = $('passphrase').value;
  if (!pass) {
    $('unlockErr').textContent = 'Enter your passphrase.';
    $('unlockErr').classList.remove('hidden');
    return;
  }
  try {
    priv = await unwrapPrivateKey(
      { enc: view.enc_private_key, nonce: view.enc_nonce, salt: view.enc_salt },
      pass,
    );
  } catch {
    myFailedThisSession++;
    // Tell the server a guess failed HERE, so the true owner can be warned of attempts on a
    // leaked link the next time they get in. Fire-and-forget; the passphrase never leaves
    // this page, so this reports only that a failure happened, never what was tried.
    fetch(api('/api/drop/unlock-failed'), { method: 'POST', headers: { 'X-Owner-Token': ownerToken } }).catch(() => {});
    $('unlockErr').textContent = 'Wrong passphrase.';
    $('unlockErr').classList.remove('hidden');
    return;
  }
  $('passphrase').value = '';
  $('idleNote').classList.add('hidden');
  // Unlocking also checks for new messages, so a drop that landed since the page opened
  // shows up without a separate click. Best-effort: if the refetch fails, render what we
  // already unlocked with. The wrapped-key fields are unchanged, so priv stays valid.
  try { view = await fetchInbox(); } catch { /* keep the loaded view */ }
  $('disabledBanner').classList.toggle('hidden', !view.disabled);
  $('setRetention').value = String(view.retention_days);
  $('unlock').classList.add('hidden');
  $('messages').classList.remove('hidden');
  // Show the failed-unlock breakdown, never a silently-subtracted total. "others" are attempts
  // that did NOT come from this tab -- another session or device, i.e. the real intrusion signal;
  // "mine" are this tab's own wrong guesses. Showing both means a genuine "others" count can't be
  // mistaken for one's own fumbling (Hannu's catch), and one's own fumbling never looks like an
  // attack. (A ping that hasn't landed yet can only UNDER-count others, never false-alarm.)
  const total = view.failed_unlock_count || 0;
  const mine = Math.min(myFailedThisSession, total);
  const others = Math.max(0, total - myFailedThisSession);
  const warn = $('intrusionWarning');
  if (others > 0) {
    const o = others >= 999 ? '999+' : String(others);
    warn.textContent = `⚠️ Since you last read your messages: ${o} failed passphrase attempt${others === 1 ? '' : 's'} from another session or device`
      + (mine > 0 ? `, plus ${mine} you just made in this one` : '')
      + `. If those other attempts were not you, your SECRET link may be exposed — consider “Delete this address permanently” below, then share a fresh drop address.`;
    warn.className = 'note danger';
  } else if (mine > 0) {
    // Only this tab's own fumbles. Say so plainly, so a locked-out owner's guesses -- or your own
    // mistyping -- are acknowledged rather than silently swallowed, and the "all clear" is explicit.
    warn.textContent = `You just made ${mine} failed passphrase attempt${mine === 1 ? '' : 's'}, and there were no other attempts since you last read — nothing to worry about.`;
    warn.className = 'note';
  } else {
    warn.className = 'note danger hidden';
  }
  // A successful unlock is the ONE moment that proves someone who can READ is here. Record the
  // read: it refreshes "last seen" (only if the recipient opted in -- the server checks) AND
  // clears the failed-unlock counter. Fired on EVERY successful unlock, not just when
  // disclosing, because the reset must happen regardless. Fire-and-forget: a failed ping must
  // never block reading, and this keeps the sender-facing signal honest (a locked-out owner
  // trying passphrases never gets here, so never trips it).
  fetch(api('/api/drop/seen'), { method: 'POST', headers: { 'X-Owner-Token': ownerToken } }).catch(() => {});
  myFailedThisSession = 0;  // the server counter is now cleared; count fresh from here
  markActivity();
  await render();
});

$('saveSettings').addEventListener('click', async () => {
  const status = $('settingsStatus');
  status.classList.add('hidden');
  const btn = $('saveSettings');
  btn.disabled = true;
  try {
    const res = await fetch(api('/api/drop/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Token': ownerToken },
      body: JSON.stringify({
        disabled: $('setHold').checked,
        disclose_last_seen: $('setDisclose').checked,
      }),
    });
    if (!res.ok) throw new Error('save failed');
    const saved = await res.json();
    // Re-render from what the server actually stored, not from the checkboxes.
    view.disabled = saved.disabled;
    view.disclose_last_seen = saved.disclose_last_seen;
    $('setHold').checked = saved.disabled;
    $('setDisclose').checked = saved.disclose_last_seen;
    $('disabledBanner').classList.toggle('hidden', !view.disabled);
    // Turning "last active" ON while UNLOCKED means a real reader is present right now -- so stamp
    // it at once (the /seen ping), which is honest and makes the public page reflect the choice
    // immediately, instead of staying blank until the next unlock. If they are NOT unlocked we
    // must NOT stamp (that is the whole honesty rule -- a locked-out owner toggling settings is not
    // a reader), so the signal only appears once they actually unlock and read; say so, rather than
    // leave them wondering why senders still see nothing. Opting OUT stays a plain erase.
    if (saved.disclose_last_seen && priv) {
      fetch(api('/api/drop/seen'), { method: 'POST', headers: { 'X-Owner-Token': ownerToken } }).catch(() => {});
      status.textContent = 'Settings saved.';
    } else if (saved.disclose_last_seen) {
      status.textContent = 'Settings saved. Senders will see your “last active” time once you unlock and read your inbox.';
    } else {
      status.textContent = 'Settings saved.';
    }
    status.className = 'note ok';
  } catch {
    status.textContent = 'Could not save settings. Please try again.';
    status.className = 'note danger';
    refreshSaveState();
  } finally {
    btn.disabled = false;
  }
});

// The settings save is manual, so make the Save button announce when there is anything
// to save — people are used to settings that persist on their own. When a toggle differs
// from what the server holds, the button lights up (accent) and reads "Save changes".
function settingsDirty() {
  return $('setHold').checked !== view.disabled
      || $('setDisclose').checked !== view.disclose_last_seen;
}
function refreshSaveState() {
  const dirty = settingsDirty();
  const btn = $('saveSettings');
  btn.classList.toggle('pending', dirty);
  btn.textContent = dirty ? 'Save changes' : 'Save settings';
}
for (const id of ['setHold', 'setDisclose']) {
  $(id).addEventListener('change', () => {
    $('settingsStatus').classList.add('hidden'); // a fresh change supersedes the last "saved"
    refreshSaveState();
  });
}

// One "Check for new messages" action, shared by the button shown before unlocking
// (which just updates the count) and the one after (which re-decrypts and re-renders the
// list). A drop cannot arrive on its own — there is no push, by design — so this is how a
// waiting recipient pulls in whatever landed since the page opened.
async function checkForMessages() {
  let latest;
  try {
    latest = await fetchInbox();
  } catch {
    // A transient failure must not blank what is already on screen.
    return;
  }
  view = latest;
  $('disabledBanner').classList.toggle('hidden', !view.disabled);
  showCount();
  if (priv) await render();  // only re-decrypt once unlocked
}
$('checkPre').addEventListener('click', checkForMessages);
$('refresh').addEventListener('click', checkForMessages);

async function render() {
  const list = $('list');
  list.replaceChildren();
  $('empty').classList.toggle('hidden', view.entries.length > 0);

  for (const entry of view.entries) {
    let text;
    try {
      const opened = await openDrop(priv, entry);
      text = opened.message || '(empty message)';
    } catch {
      text = '[This message could not be decrypted.]';
    }

    const li = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'dropmsg-head';
    const time = document.createElement('span');
    time.className = 'dropmsg-time';
    time.textContent = fmtTime(entry.created_at);
    const rm = document.createElement('button');
    rm.className = 'secondary compact';
    rm.textContent = 'Delete';
    rm.addEventListener('click', () => del(entry.entry_id));
    head.append(time, rm);

    const body = document.createElement('div');
    body.className = 'secret-out';
    // textContent, never innerHTML: a drop is untrusted sender-supplied text.
    body.textContent = text;

    li.append(head, body);
    list.append(li);
  }
}

async function del(entryID) {
  const res = await fetch(api(`/api/drop/entry/${encodeURIComponent(entryID)}`), {
    method: 'DELETE',
    headers: { 'X-Owner-Token': ownerToken },
  });
  // 204 = deleted; 404 = already gone. Either way it is no longer in the inbox.
  if (res.status === 204 || res.status === 404) {
    view.entries = view.entries.filter((e) => e.entry_id !== entryID);
    await render();
  }
}

/* ---- idle re-lock ----------------------------------------------------------
 * An unlocked console holds the private key AND decrypted plaintext in memory. If the
 * recipient walks away and leaves the tab open, that must not stay readable forever.
 * After 15 minutes with no DELIBERATE activity we LOCK: drop the key, wipe the decrypted
 * messages from the DOM, and show the passphrase prompt again. The owner_token is still in
 * the URL fragment, so getting back in is just re-entering the passphrase.
 *
 * "Activity" is deliberate use only -- a click, a key, a scroll, a tap. Mouse MOVEMENT is
 * deliberately NOT counted: a cursor drifting over the page, a jittery optical mouse, or
 * just the pointer resting while the page repaints would fire pointermove and reset the
 * timer forever, so the inbox would never lock. That was the real bug -- a tab left open
 * and "watched" stayed unlocked well past 15 minutes because pointermove kept resetting it.
 *
 * And because a browser can FREEZE a backgrounded tab's timers, the interval alone can stall
 * while the tab is hidden. So we also re-check the instant the tab becomes visible again:
 * returning to a long-idle tab locks it at once, rather than waiting for the next tick (or
 * for a frozen interval to resume). */
const IDLE_LOCK_MS = 15 * 60 * 1000;
let lastActivity = Date.now();
function markActivity() { lastActivity = Date.now(); }
// Deliberate interactions only -- pointermove is intentionally absent (see above).
for (const ev of ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart']) {
  window.addEventListener(ev, markActivity, { passive: true });
}
function lock() {
  priv = null;                        // the unwrapped key leaves memory
  $('list').replaceChildren();        // and so does every decrypted message on screen
  $('empty').classList.add('hidden');
  $('manage').removeAttribute('open');
  $('messages').classList.add('hidden');
  $('unlock').classList.remove('hidden');
  $('idleNote').classList.remove('hidden');
  $('passphrase').value = '';
}
function checkIdle() {
  if (priv && Date.now() - lastActivity > IDLE_LOCK_MS) lock();
}
// Coarse poll for the foreground case, plus a re-check on return that covers a frozen
// timer in a backgrounded tab. Becoming visible must CHECK, never reset -- resetting would
// keep a stale tab alive exactly when it should lock.
setInterval(checkIdle, 30 * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkIdle();
});

/* ---- retention (post-unlock; changes only FUTURE messages) ----------------- */
$('saveRetention').addEventListener('click', async () => {
  const status = $('retentionStatus');
  status.classList.add('hidden');
  const btn = $('saveRetention');
  btn.disabled = true;
  try {
    const res = await fetch(api('/api/drop/retention'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Token': ownerToken },
      body: JSON.stringify({ retention_days: Number($('setRetention').value) }),
    });
    if (!res.ok) throw new Error();
    const saved = await res.json();
    view.retention_days = saved.retention_days;
    $('setRetention').value = String(saved.retention_days);
    status.textContent = `Saved. New messages will be kept for ${saved.retention_days} days.`;
    status.className = 'note ok';
  } catch {
    status.textContent = 'Could not save. Please try again.';
    status.className = 'note danger';
  } finally {
    btn.disabled = false;
  }
});

/* ---- change passphrase (post-unlock; re-wraps the same key locally) --------- */
// Eye toggles on all three fields, matching the create page's passphrase inputs.
attachReveal($('curPass'));
attachReveal($('newPass'));
attachReveal($('newPass2'));
// The main unlock field gets the same eye toggle as every other passphrase input.
attachReveal($('passphrase'));
function showPassStatus(msg, ok) {
  const s = $('passStatus');
  s.textContent = msg;
  s.className = ok ? 'note ok' : 'note danger';
}
$('savePass').addEventListener('click', async () => {
  $('passStatus').classList.add('hidden');
  const cur = $('curPass').value, nw = $('newPass').value, nw2 = $('newPass2').value;
  if (!cur || !nw) { showPassStatus('Fill in your current and new passphrase.', false); return; }
  if (nw !== nw2) { showPassStatus('The two new passphrases do not match.', false); return; }
  const btn = $('savePass');
  btn.disabled = true;
  let wrapped;
  try {
    // Re-wrap the SAME private key under the new passphrase, locally. A wrong CURRENT
    // passphrase fails right here and never reaches the server.
    wrapped = await rewrapPrivateKey(
      { enc: view.enc_private_key, nonce: view.enc_nonce, salt: view.enc_salt }, cur, nw,
    );
  } catch {
    showPassStatus('Wrong current passphrase.', false);
    btn.disabled = false;
    return;
  }
  try {
    const res = await fetch(api('/api/drop/passphrase'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Owner-Token': ownerToken },
      body: JSON.stringify({ enc_private_key: wrapped.enc, enc_nonce: wrapped.nonce, enc_salt: wrapped.salt }),
    });
    if (res.status !== 204) throw new Error();
    // Keep the in-memory blob in step so a later idle re-lock + unlock uses the new
    // passphrase. `priv` is unchanged: it is the same key, still valid for reading.
    view.enc_private_key = wrapped.enc;
    view.enc_nonce = wrapped.nonce;
    view.enc_salt = wrapped.salt;
    $('curPass').value = ''; $('newPass').value = ''; $('newPass2').value = '';
    showPassStatus('Passphrase changed. Use the new one from now on.', true);
  } catch {
    showPassStatus('Could not save the change. Please try again.', false);
  } finally {
    btn.disabled = false;
  }
});

/* ---- delete this address permanently (the compromised-link kill switch) ----- */
$('destroy').addEventListener('click', async () => {
  if (!window.confirm('Permanently delete this address and every message in it? This cannot be undone.')) return;
  const btn = $('destroy');
  btn.disabled = true;
  $('destroyStatus').classList.add('hidden');
  try {
    const res = await fetch(api('/api/drop'), { method: 'DELETE', headers: { 'X-Owner-Token': ownerToken } });
    if (res.status !== 204) throw new Error();
    priv = null;
    $('console').classList.add('hidden');
    $('destroyed').classList.remove('hidden');
  } catch {
    $('destroyStatus').textContent = 'Could not delete the address. Please try again.';
    $('destroyStatus').classList.remove('hidden');
    btn.disabled = false;
  }
});

/* ---- switching inboxes in one tab ------------------------------------------
 * The owner_token lives in the URL fragment, and changing ONLY the fragment never reloads
 * the page. Someone who pastes a DIFFERENT console link over the current one (to reuse a
 * tab, rather than opening a new one) would otherwise keep seeing the FIRST inbox -- token,
 * view, and its still-decrypted messages -- while the address bar shows the second. A full
 * reload is the safe reset: it drops the private key and wipes every decrypted message
 * before the new token is read. A partial re-init would risk bleeding one inbox's plaintext
 * into another's view, so reload, deliberately, is the whole fix. */
window.addEventListener('hashchange', () => { location.reload(); });

init();
