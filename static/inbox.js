// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// The recipient's console. The owner_token lives in the URL fragment (never sent to
// the server); this page reads it, fetches the inbox with it in a header, and then
// asks for the passphrase to unlock the private key LOCALLY. Reading a drop needs
// both — the console link (something you have) and the passphrase (something you
// know) — which is the two-factor at the heart of the design.

import { unwrapPrivateKey, openDrop, publicKeyFingerprint, rewrapPrivateKey, decryptBytes } from './crypto.js';
import { attachReveal, fmtBytes } from './ui.js';
import { passphraseProblem } from './passphrase.js';
import { api } from './config.js';
import { t, initLangToggle, onLangChange } from './i18n.js';

const $ = (id) => document.getElementById(id);

// The token is everything after '#'. It never leaves this page except as a header.
const ownerToken = location.hash.slice(1);

let priv = null;  // the unwrapped private key (CryptoKey), once the passphrase is entered
let view = null;  // the last inbox response
let myFailedThisSession = 0;  // wrong guesses made in THIS tab, so they never self-alarm
// The failed-unlock warning is decided once at unlock (before the counter resets under it)
// and must survive a language toggle. We remember the resolved split, not the raw counts.
let warnState = null;  // null | { others, mine }

function show(id) {
  for (const s of ['loading', 'invalid', 'console']) {
    $(s).classList.toggle('hidden', s !== id);
  }
}

const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};
const groupFp = (hex) => hex.replace(/(.{4})/g, '$1 ').trim();

/* ---- language --------------------------------------------------------------
 * The console carries BOTH languages on one URL and a visible toggle, because the one
 * SECRET link is generated language-agnostic (the create page cannot bake a choice into
 * it) and nothing is persisted. Fixed prose exists twice in the HTML and CSS shows the
 * right half; text this SCRIPT writes has to be re-rendered on a toggle. `dyn` registers
 * a producer for one element's translatable text and updates ONLY its textContent -- the
 * visibility and colour set at each call site are left untouched, so a dismissed status
 * (hidden by other code) does not pop back when the language changes.
 */
const retexts = new Map();  // element id -> () => string
function dyn(id, produce) { retexts.set(id, produce); $(id).textContent = produce(); }

// Labels and placeholders that live on controls rather than in prose. Called at load
// (before #console is ever shown) and again on every language toggle.
function relabel() {
  document.title = t.inbox.pageTitle;
  $('checkPre').textContent = t.inbox.checkNew;
  $('refresh').textContent = t.inbox.checkNew;
  $('unlockBtn').textContent = t.inbox.unlockBtn;
  $('passphrase').placeholder = t.inbox.passPlaceholder;
  $('saveRetention').textContent = t.inbox.saveRetention;
  $('savePass').textContent = t.inbox.changePass;
  $('destroy').textContent = t.inbox.deleteAddr;
  $('curPass').placeholder = t.inbox.curPassPh;
  $('newPass').placeholder = t.inbox.newPassPh;
  $('newPass2').placeholder = t.inbox.newPass2Ph;
  const days = { '7': t.inbox.days7, '14': t.inbox.days14, '30': t.inbox.days30 };
  for (const o of $('setRetention').options) {
    o.textContent = o.dataset.legacy ? t.inbox.daysLegacy(o.value) : (days[o.value] || o.textContent);
  }
  refreshSaveState();  // owns the Save-settings/Save-changes label; safe before `view` loads
}

// Seed the retention control from what this address is ACTUALLY set to.
//
// The offered set changed on 2026-07-30 (90 days retired in favour of 14), and an address
// created under the old set keeps its own value — the server never rewrites one behind the
// owner's back. Assigning a value that has no matching <option> would leave the control
// BLANK, so the one screen that is supposed to tell an owner how long their messages live
// would say nothing at all — or, worse, invite them to read whichever option looks selected
// as the truth. So an out-of-set value gets an option of its own, labelled as exactly what
// it is. It is never offered to anyone else, and it disappears the moment they choose a
// current value.
function seedRetention(days) {
  const sel = $('setRetention');
  sel.querySelector('option[data-legacy]')?.remove();
  if (![...sel.options].some((o) => o.value === String(days))) {
    const o = document.createElement('option');
    o.value = String(days);
    o.dataset.legacy = '1';
    o.textContent = t.inbox.daysLegacy(days);
    sel.prepend(o);
  }
  sel.value = String(days);
}

// Re-render everything the language toggle touches: control labels, every registered
// dynamic text, and -- if unlocked and showing -- the decrypted list (its Delete buttons
// and the two fallback strings are ours to translate; the messages themselves are not).
function redraw() {
  relabel();
  for (const [id, produce] of retexts) $(id).textContent = produce();
  if (priv && !$('messages').classList.contains('hidden')) render();
}
onLangChange(redraw);
// autodetect: the owner did not choose this URL's language (there is only one SECRET
// link), so the browser locale is the opening guess. Read, never stored, never sent.
initLangToggle({ autodetect: true });
relabel();

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
    .catch(() => { dyn('fingerprint', () => t.inbox.fpUnavailable); });
  $('disabledBanner').classList.toggle('hidden', !view.disabled);
  // Reflect the current settings so the toggles show the truth. These read from the
  // inbox response, which needs only the console link — so pausing (Hold) is possible
  // without the passphrase, which is what makes it usable in a hurry or under duress.
  $('setHold').checked = view.disabled;
  $('setDisclose').checked = view.disclose_last_seen;
  // The retention control lives in the post-unlock "Manage" panel; seed it now so it is
  // ready the moment the panel appears.
  seedRetention(view.retention_days);
  refreshSaveState();
  showCount();
  show('console');
}

function showCount() {
  const n = view.entries.length;
  // Deliberately a TOTAL, not a new/seen split: the console does not track which drops
  // have been read (that would be extra metadata for little value), so it says how many
  // are held, never how many are unread.
  dyn('count', () => (n === 0 ? t.inbox.countEmpty : t.inbox.countSome(n)));
}

$('unlockBtn').addEventListener('click', async () => {
  $('unlockErr').classList.add('hidden');
  const pass = $('passphrase').value;
  if (!pass) {
    $('unlockErr').classList.remove('hidden');
    dyn('unlockErr', () => t.inbox.enterPass);
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
    $('unlockErr').classList.remove('hidden');
    dyn('unlockErr', () => t.inbox.wrongPass);
    return;
  }
  $('passphrase').value = '';
  $('idleNote').classList.add('hidden');
  // Unlocking also checks for new messages, so a drop that landed since the page opened
  // shows up without a separate click. Best-effort: if the refetch fails, render what we
  // already unlocked with. The wrapped-key fields are unchanged, so priv stays valid.
  try { view = await fetchInbox(); } catch { /* keep the loaded view */ }
  $('disabledBanner').classList.toggle('hidden', !view.disabled);
  seedRetention(view.retention_days);
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
  warnState = { others, mine };  // captured so a language toggle re-renders the same verdict
  const warn = $('intrusionWarning');
  if (others > 0) {
    warn.className = 'note danger';
    dyn('intrusionWarning', () => t.inbox.intrusionOthers(warnState.others, warnState.mine));
  } else if (mine > 0) {
    // Only this tab's own fumbles. Say so plainly, so a locked-out owner's guesses -- or your own
    // mistyping -- are acknowledged rather than silently swallowed, and the "all clear" is explicit.
    warn.className = 'note';
    dyn('intrusionWarning', () => t.inbox.intrusionMineOnly(warnState.mine));
  } else {
    warn.className = 'note danger hidden';
    retexts.delete('intrusionWarning');  // nothing to re-render; drop the stale producer
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
    const pendingSignal = saved.disclose_last_seen && !priv;  // captured: the branch, not the text
    if (saved.disclose_last_seen && priv) {
      fetch(api('/api/drop/seen'), { method: 'POST', headers: { 'X-Owner-Token': ownerToken } }).catch(() => {});
    }
    status.className = 'note ok';
    dyn('settingsStatus', () => (pendingSignal ? t.inbox.settingsSavedPending : t.inbox.settingsSaved));
  } catch {
    status.className = 'note danger';
    dyn('settingsStatus', () => t.inbox.settingsFailed);
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
  const btn = $('saveSettings');
  // Called from relabel() at load, before init() has fetched the inbox: with no `view`
  // there is nothing to be dirty against, so just show the resting label.
  if (!view) { btn.textContent = t.inbox.saveSettings; btn.classList.remove('pending'); return; }
  const dirty = settingsDirty();
  btn.classList.toggle('pending', dirty);
  btn.textContent = dirty ? t.inbox.saveChanges : t.inbox.saveSettings;
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
    let opened = null;
    try {
      opened = await openDrop(priv, entry);
    } catch {
      opened = null;  // undecryptable — a corrupt or mis-sealed entry
    }

    const li = document.createElement('li');

    const head = document.createElement('div');
    head.className = 'dropmsg-head';
    const time = document.createElement('span');
    time.className = 'dropmsg-time';
    time.textContent = fmtTime(entry.created_at);
    const rm = document.createElement('button');
    rm.className = 'secondary compact';
    rm.textContent = t.inbox.deleteBtn;
    // Deleting the message marks its file blobs due on the server (store.DeleteEntry),
    // so the attachments go with it -- there is no separate step to clean them up.
    rm.addEventListener('click', () => del(entry.entry_id));
    head.append(time, rm);
    li.append(head);

    const outText = (s) => {
      const body = document.createElement('div');
      body.className = 'secret-out';
      // textContent, never innerHTML: a drop is untrusted sender-supplied text.
      body.textContent = s;
      return body;
    };

    if (!opened) {
      li.append(outText(t.inbox.undecryptable));
    } else {
      // A drop can be a message, files, or both. Show the message if there is one, the
      // attachments if there are any, and only fall back to "(no message)" if neither.
      if (opened.message) li.append(outText(opened.message));
      if (opened.files && opened.files.length > 0) {
        li.append(renderDropFiles(opened.files, opened.aesKey));
      }
      if (!opened.message && (!opened.files || opened.files.length === 0)) {
        li.append(outText(t.inbox.emptyMsg));
      }
    }

    list.append(li);
  }
}

// One drop's attachments. Each file is fetched, decrypted under the DROP's own content
// key (opened.aesKey, closed over here) and its per-file nonce, and saved -- but unlike a
// secret's files, a drop's are NOT burned: they persist, re-downloadable, until the whole
// message is deleted or the address's retention expires. That is the deliberate SEND vs
// RECEIVE difference (see openDrop / store.DeleteEntry).
function renderDropFiles(files, aesKey) {
  const wrap = document.createElement('div');
  wrap.className = 'dropfiles';

  const heading = document.createElement('p');
  heading.className = 'dropfiles-heading soft';
  dynFill(heading, () => t.inbox.filesHeading);
  wrap.append(heading);

  const ul = document.createElement('ul');
  ul.className = 'filelist';
  for (const f of files) {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.textContent = f.name;  // textContent: a hostile sender chose every byte of this

    const size = document.createElement('span');
    size.className = 'soft';
    size.textContent = fmtBytes(f.size);

    const btn = document.createElement('button');
    btn.className = 'secondary compact';
    btn.textContent = t.inbox.download;
    btn.addEventListener('click', () => downloadDropFile(f, aesKey, btn, li));

    li.append(name, size, btn);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

// render() rebuilds these elements on every language toggle, so their labels are simply
// read from `t` at build time -- no dyn() registration needed. This tiny helper just keeps
// the heading's text set at creation for symmetry with the buttons.
function dynFill(el, produce) { el.textContent = produce(); }

async function downloadDropFile(file, aesKey, btn, li) {
  btn.disabled = true;
  const label = t.inbox.download;
  btn.textContent = t.inbox.downloading;
  li.querySelector('.dropfile-err')?.remove();
  try {
    const res = await fetch(api(`/api/blob/${encodeURIComponent(file.ref)}`), { cache: 'no-store' });
    if (!res.ok) throw new Error('no longer available');
    const ciphertext = new Uint8Array(await res.arrayBuffer());

    btn.textContent = t.inbox.decrypting;
    // If this returns, AES-GCM has verified the tag -- every byte arrived, unaltered. A
    // truncated download fails here instead of saving a broken file.
    const plain = await decryptBytes(aesKey, file.nonce, ciphertext);
    save(file.name, plain);

    // NO burn: a drop is not one-time. Leave the file on the server (it dies with the
    // message or at retention) and re-enable, so it can be downloaded again -- here or on
    // another of the recipient's devices.
    btn.textContent = t.inbox.saved;
    setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1600);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = label;
    const msg = document.createElement('p');
    msg.className = 'note danger dropfile-err';
    // Files persist, so a failure is just a retry -- keep the wording calm.
    msg.textContent = /no longer available/i.test(e?.message || '') ? t.inbox.fileGone : t.inbox.downloadFailed;
    li.append(msg);
  }
}

function save(name, bytes) {
  // SECURITY: the Blob type is forced to application/octet-stream and NEVER taken from the
  // manifest -- a blob: URL inherits our origin, so a hostile sender choosing "text/html"
  // would be choosing to run script on privsend's origin. The extension tells the OS what
  // the file is; the real MIME type is not needed to save it. (Mirrors reveal.js save().)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    seedRetention(saved.retention_days);  // drops the legacy option once they leave it
    const days = saved.retention_days;
    status.className = 'note ok';
    dyn('retentionStatus', () => t.inbox.retentionSaved(days));
  } catch {
    status.className = 'note danger';
    dyn('retentionStatus', () => t.inbox.retentionFailed);
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
function showPassStatus(produce, ok) {
  const s = $('passStatus');
  s.className = ok ? 'note ok' : 'note danger';
  dyn('passStatus', produce);
}
$('savePass').addEventListener('click', async () => {
  $('passStatus').classList.add('hidden');
  const cur = $('curPass').value, nw = $('newPass').value, nw2 = $('newPass2').value;
  if (!cur || !nw) { showPassStatus(() => t.inbox.passFill, false); return; }
  if (nw !== nw2) { showPassStatus(() => t.inbox.passMismatch, false); return; }
  // Same hard block as the create page: a passphrase change must not swap a strong key for a
  // weak one. The wrong-current-passphrase check happens locally in rewrapPrivateKey below.
  // passphraseProblem is language-aware, so re-running it on the captured value on a toggle
  // re-renders the reason in the newly chosen language.
  const weak = passphraseProblem(nw);
  if (weak) { showPassStatus(() => passphraseProblem(nw) || '', false); return; }
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
    showPassStatus(() => t.inbox.passWrongCur, false);
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
    showPassStatus(() => t.inbox.passChanged, true);
  } catch {
    showPassStatus(() => t.inbox.passSaveFailed, false);
  } finally {
    btn.disabled = false;
  }
});

/* ---- delete this address permanently (the compromised-link kill switch) ----- */
$('destroy').addEventListener('click', async () => {
  if (!window.confirm(t.inbox.confirmDestroy)) return;
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
    $('destroyStatus').className = 'note danger';
    dyn('destroyStatus', () => t.inbox.destroyFailed);
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
