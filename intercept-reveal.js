// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// CONTENT SCRIPT — reveal-flow interception (browser extension only).
//
// When a recipient who has this extension installed opens a share link
// (https://privsend.app/s/{id}#{key}), this hands the reveal off to the copy of
// the reveal page BUNDLED in the extension. The decryption then runs from the
// installed, audited code -- the same guarantee the compose side already gives --
// instead of from a page the server freshly delivers at that moment.
//
// Why a content script and not declarativeNetRequest: the decryption key lives in
// the URL FRAGMENT (everything after '#'), and a fragment is never part of a
// network request, so a redirect rule can neither see the key nor carry it across.
// A content script runs in the page and reads location.hash directly, so it moves
// BOTH parts across explicitly and verbatim: the {id} from the path into a ?id=
// query the bundled page reads, and the {key} fragment exactly as-is. Nothing
// about the key is transmitted -- this is a purely client-side navigation from one
// local URL to another; the key never leaves this tab.
//
// It runs at document_start, before the server's (deliberately inert) interstitial
// can run its own script -- and even if it did, that page touches no secret until
// a click, so there is no race worth worrying about. It matches only
// https://privsend.app (production), so it never touches dev, and it never
// re-triggers on the chrome-extension:// page it navigates to (content scripts do
// not run on extension origins).
(() => {
  const id = location.pathname.split('/').pop();
  // location.hash carries its own leading '#', or is '' when the link has no key.
  // Append it verbatim: the bundled reveal page reads the key from the fragment in
  // exactly the same way the website does, with no reformatting. A missing key
  // stays missing, and the reveal page's existing guard refuses to burn it.
  const target =
    chrome.runtime.getURL('reveal.html') +
    '?id=' + encodeURIComponent(id) +
    location.hash;
  // replace(), not assign(): the spent /s/ URL must not linger in history, so Back
  // never returns the recipient to a stale interstitial.
  location.replace(target);
})();
