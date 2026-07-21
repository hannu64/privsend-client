// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// The whole background, for now: clicking the toolbar icon opens the bundled
// compose page in a new tab.
//
// That page is the SAME index.html the website serves, byte-for-byte. Loaded from
// the extension it talks to https://privsend.app through config.js (see
// static/config.js) -- the crypto that runs is this installed, audited copy, and
// the only server it can reach is production. There is deliberately no popup: a
// full tab gives the compose form and the file picker the room they need, and
// keeps the extension's UI identical to the website a user may already know.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
