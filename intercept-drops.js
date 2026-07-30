// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// CONTENT SCRIPT — Drops interception (browser extension only).
//
// The companion to intercept-reveal.js, for the two Drops pages that handle keys:
//
//   https://privsend.app/public/{id}  (and the /d/{id} alias)
//       The PUBLIC page an anonymous sender writes on. They fetch the recipient's
//       public key and seal a message -- and possibly files -- to it, in their own
//       browser. This is the person the installed-code guarantee helps most: they
//       may be writing to a journalist or a compliance line, they have no account
//       and no prior relationship with us, and a server that wanted their plaintext
//       would only have to serve THEM a modified page. Handing this page to the
//       installed copy removes that option.
//
//   https://privsend.app/SECRET  (and the /inbox alias)
//       The recipient's own console. It unwraps their private key with their
//       passphrase and decrypts everything the address has ever received, so it is
//       the single most sensitive page in the service.
//
// Same mechanism and the same reason as intercept-reveal.js: a content script, not
// declarativeNetRequest, because the console's owner_token lives in the URL FRAGMENT
// and a fragment is never part of a network request -- a redirect rule can neither
// see it nor carry it. Running in the page, this reads location.hash directly and
// moves each part across explicitly: the public {id} from the path into a ?id= query,
// and the token fragment verbatim. Both navigations are local-to-local, so nothing
// is transmitted by the hand-off itself.
//
// It runs at document_start, matches only https://privsend.app (never dev), and
// never re-fires on the chrome-extension:// page it navigates to, because content
// scripts do not run on extension origins.
(() => {
  // Which of the two flows this is, decided by the path the manifest matched on.
  // The console paths carry nothing but a fragment; the address paths carry an id.
  const path = location.pathname;
  const isConsole = path === '/SECRET' || path === '/inbox';

  let target;
  if (isConsole) {
    // location.hash includes its own leading '#', and is '' when the link carries no
    // token. A console link without a token is not a console link -- it is somebody
    // who typed /SECRET, or a stripped copy. Leave it to the website rather than
    // redirect to the bundled page (which would only show the same "invalid" state)
    // and needlessly advertise that the extension is installed. Same judgement as
    // intercept-reveal.js makes for a bare /s/.
    if (!location.hash || location.hash === '#') return;
    target = chrome.runtime.getURL('inbox.html') + location.hash;
  } else {
    const id = path.split('/').pop();
    // A bare /public/ or /d/ with no id is not an address. Leave it alone.
    if (!id) return;
    // No fragment is appended here on purpose: a public drop link has none, nothing
    // on the page reads one, and carrying an unread value across would only invite
    // the question of what it was for.
    target = chrome.runtime.getURL('drop.html') + '?id=' + encodeURIComponent(id);
  }

  // replace(), not assign(): the privsend.app URL must not linger in history. For the
  // console that matters twice over -- Back would otherwise return the owner to a
  // server-delivered copy of the most sensitive page they own.
  location.replace(target);
})();
