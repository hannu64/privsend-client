// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Extension-only page adjustments. Everything here runs ONLY when the page is the
// installed browser extension (chrome-extension:// and friends); on the website
// config.js reports IN_EXTENSION === false and this module returns immediately,
// touching nothing. That keeps the website behaviour byte-for-byte identical --
// the same property the whole "diff the client" trust story depends on.
import { IN_EXTENSION, SITE_ORIGIN, bundledPage } from './config.js';
import { t, onLangChange } from './i18n.js';

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
  const body = document.createElement('span');

  // A way out to the full explanation, for anyone who wants to know what "running
  // locally" actually buys them and how to check it themselves. Deliberately the
  // only link here. Note it is written as a site-absolute path: the rewrite loop
  // below then points it at the live site in a new tab, exactly like every other
  // informational link, so this needs no special handling.
  const more = document.createElement('a');
  more.setAttribute('href', '/verify');

  // The wording comes from i18n.js, in the page's own language. On the compose and
  // drop-address pages that is fixed by the URL the user opened; on the public drop
  // page and the inbox it can be switched at any moment by the language toggle, so
  // the banner re-renders with everything else. textContent, never innerHTML.
  const label = () => {
    head.textContent = t.ext.running;
    body.textContent = t.ext.explains;
    more.textContent = t.ext.howVerified;
  };
  label();
  onLangChange(label);

  banner.append(head, body, more);
  document.body.insertBefore(banner, document.body.firstChild);

  // 2) Internal links can't use the website's server-side routing here, so every
  //    site-relative href has to be re-pointed at something that exists. Which of the
  //    two destinations it gets is decided by BUNDLED_PAGES in config.js, where the
  //    rule and its reasoning live:
  //
  //      - a page that handles plaintext or keys (compose, drop-address creation,
  //        and their Finnish twins) resolves to the LOCAL bundled file, so the user
  //        stays inside the installed copy for the whole job. That includes the
  //        language links: "Suomeksi" now switches to the bundled Finnish page
  //        instead of sending a Finn out to the website at the very moment the
  //        extension finally speaks their language.
  //
  //      - everything else -- how it works, verify, terms, privacy, report -- goes to
  //        the LIVE site in a NEW TAB. New tab (target=_blank) so a half-composed
  //        secret in this one is never disturbed; live site so the text is today's,
  //        not whatever shipped with this build.
  //
  //    Absolute links (the GitHub source link) start with "http", not "/", so the
  //    selector never sees them and they are left untouched.
  for (const a of document.querySelectorAll('a[href^="/"]')) {
    const path = a.getAttribute('href');
    const local = bundledPage(path);
    if (local) {
      a.setAttribute('href', local);
    } else {
      a.setAttribute('href', SITE_ORIGIN + path); // the live website
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  }

  // 3) An honest build stamp in the footer, extension-only. On the website there is
  //    no fixed "version" -- the server can change what it serves at any moment. In
  //    the extension the code is pinned to whatever the user installed, so telling
  //    them which build they are running is meaningful, and it is the string they
  //    would quote when verifying a copy or reporting a problem.
  try {
    const m = chrome.runtime.getManifest();
    const footer = document.querySelector('footer');
    if (m && footer) {
      const version = m.version_name || m.version;
      const stamp = document.createElement('p');
      stamp.className = 'small muted';
      const draw = () => { stamp.textContent = t.ext.build(version); };
      draw();
      onLangChange(draw);
      footer.append(stamp);
    }
  } catch {
    // No extension runtime available -- nothing to stamp. Silent by design.
  }
}
