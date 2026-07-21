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
const url = chrome.runtime.getURL('index.html');
chrome.tabs.create({ url }, () => window.close());
