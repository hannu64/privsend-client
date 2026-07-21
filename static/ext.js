// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Extension-only page adjustments. Everything here runs ONLY when the page is the
// installed browser extension (chrome-extension:// and friends); on the website
// config.js reports IN_EXTENSION === false and this module returns immediately,
// touching nothing. That keeps the website behaviour byte-for-byte identical --
// the same property the whole "diff the client" trust story depends on.
import { IN_EXTENSION, SITE_ORIGIN, homeHref } from './config.js';

if (IN_EXTENSION) {
  // 1) A visible, honest banner. The CODE on this page (the crypto and all) is the
  //    copy installed on this device, never re-fetched -- but encrypted data still
  //    travels to the server, so the wording says exactly that and claims no more.
  //    The deeper anti-tamper story ("this copy can't be swapped out for you alone")
  //    lives on the how/verify page, to keep the compose page uncluttered.
  const banner = document.createElement('div');
  banner.className = 'ext-banner';
  banner.setAttribute('role', 'note');

  const head = document.createElement('strong');
  head.textContent = '🔒 Running locally';

  const body = document.createElement('span');
  // textContent, never innerHTML.
  body.textContent =
    'The code on this page — including the encryption — is the copy installed in your ' +
    'browser, not downloaded from a server. Only encrypted data is ever sent to privsend.app.';

  banner.append(head, body);
  document.body.insertBefore(banner, document.body.firstChild);

  // 2) Internal links can't use the website's server-side routing here. Send the
  //    informational ones to the LIVE site in a NEW TAB (target=_blank, so a
  //    half-composed secret in this tab is never disturbed), and point "home" links
  //    at the local compose page. Absolute links (the GitHub source link) start with
  //    "http", not "/", so they are left untouched.
  for (const a of document.querySelectorAll('a[href^="/"]')) {
    const path = a.getAttribute('href');
    if (path === '/') {
      a.setAttribute('href', homeHref); // local compose page
    } else {
      a.setAttribute('href', SITE_ORIGIN + path); // the live website
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  }
}
