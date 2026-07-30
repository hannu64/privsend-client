// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Toolbar launcher (browser extension only).
//
// The extension deliberately has NO background script. That is what lets a SINGLE
// manifest.json load in every browser: Chromium requires a background service
// worker and rejects Firefox's event-page `scripts`, while Firefox rejects a
// Chromium `service_worker` outright -- there is no background shape both accept.
// With no background at all, the same manifest loads unmodified in Chrome, Edge,
// Opera, Brave, Vivaldi and Firefox.
//
// The one thing a background would have done -- open the compose page when the
// toolbar icon is clicked -- is done here instead. The icon opens this popup, whose
// only job is to open the full compose tab and then close itself. A full tab (not a
// cramped popup) gives the compose form and file picker the room they need and keeps
// the extension's UI identical to the website.
//
// chrome.tabs.create needs no "tabs" permission (creating a tab is unprivileged;
// only reading a tab's URL/title would be). The callback form works in both Chromium
// and Firefox, so we close the popup once the tab has been asked for.
//
// WHICH LANGUAGE it opens is the one decision this file makes. On the website the
// reader picks a language by picking a URL (/ or /fi); there is no URL to pick here,
// so the browser's own locale is the only signal available, and it is a good one --
// someone running Firefox in Finnish would rather compose in Finnish. It is read and
// used immediately; nothing is stored, which keeps the extension's "writes nothing to
// your disk" property intact, and both pages link to each other anyway, so a wrong
// guess costs one click. Same test as i18n.js uses on the pages that autodetect.
const FI = /^fi\b/i.test(navigator.language || '');

// The launcher's own two words, so a Finnish browser does not flash English on the
// way to a Finnish page. The markup carries the English; only the Finnish case edits.
if (FI) {
  document.title = 'Avataan PrivSendiä…';
  const sub = document.querySelector('.sub');
  if (sub) sub.textContent = 'Avataan uutta salaisuutta…';
}

const url = chrome.runtime.getURL(FI ? 'fi/index.html' : 'index.html');
chrome.tabs.create({ url }, () => window.close());
