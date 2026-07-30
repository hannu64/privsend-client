// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// CONTENT SCRIPT — entry-page interception (browser extension only).
//
// The simplest of the three interceptors, and the one that makes the other two
// hold. Its whole job is: if you have the extension and you land on the website's
// compose page or drop-address page, you get YOUR installed copy instead.
//
// WHY IT EXISTS. The extension bundles the pages that describe and run the code you
// installed, and leaves /terms, /privacy and /report on the live site, because those
// are a legal instrument and a statement about the service as it stands today rather
// than a description of your copy (see BUNDLED_PAGES in static/config.js). That is
// the right split, but it left one thread to pull: an extension user reading the
// terms is on privsend.app, and the footer of that page offers "Home", and home is
// the website's compose form. Two ordinary clicks and they are typing a secret into
// server-delivered crypto, with nothing to mark the moment.
//
// Blocking the paths was never going to work -- there are too many, and a bookmark
// or a search result is a path too. So this does not try. It intercepts the
// DESTINATION: however you arrive at one of these pages, you arrive at the local
// one. That is the same trade the reveal interceptor already makes, and it is the
// only version of this that cannot be routed around.
//
// Nothing is carried across, because there is nothing to carry: unlike /s/{id} or
// /SECRET#{token}, these pages have no id and no fragment. They are just the front
// doors.
//
// NOTE the deliberate asymmetry with config.js: BUNDLED_PAGES also carries the
// explainers (/how, /verify, /drops/how), and those are NOT intercepted here. Nobody
// is typing a secret into an explainer, and the live version of it is perfectly good
// reading -- and if it tempts someone onward to compose, that click lands here
// anyway. Keeping the match list to the pages that actually handle keys keeps the
// extension's footprint on the website as small as it can be while still being
// airtight where it matters.
(() => {
  // Exactly the crypto-bearing front doors, and their Finnish twins. The mux serves
  // /fi and /fi/ both, so both spellings appear here; everything else is one path.
  const BUNDLED = {
    '/': 'index.html',
    '/fi': 'fi/index.html',
    '/fi/': 'fi/index.html',
    '/drops': 'drops.html',
    '/fi/drops': 'fi/drops.html',
  };

  const file = BUNDLED[location.pathname];
  // The manifest's match patterns are exact paths, so this should always hit -- but a
  // map lookup that can miss must be allowed to miss rather than redirect somewhere
  // arbitrary.
  if (!file) return;

  // replace(), not assign(): the website URL must not sit in history behind the local
  // page, or Back lands the user on the very page this exists to keep them off -- and
  // this time it would be a redirect loop as well.
  location.replace(chrome.runtime.getURL(file));
})();
