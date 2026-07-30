// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Extension-only page adjustments. Everything here runs ONLY when the page is the
// installed browser extension (chrome-extension:// and friends); on the website
// config.js reports IN_EXTENSION === false and this module returns immediately,
// touching nothing. That keeps the website behaviour byte-for-byte identical --
// the same property the whole "diff the client" trust story depends on.
import { IN_EXTENSION, SITE_ORIGIN, bundledPage } from './config.js';
import { t, lang, onLangChange } from './i18n.js';

if (IN_EXTENSION) {
  // Resolve a site path the way the rewrite loop below does: to the bundled file if
  // we carry that page, otherwise to the live site. The banner's link is built after
  // the loop has already run, so it cannot rely on being rewritten and has to ask
  // for its own answer.
  const resolve = (path) => {
    const local = bundledPage(path);
    return local ? local.file : SITE_ORIGIN + path;
  };

  // 1) Internal links can't use the website's server-side routing here, so every
  //    site-relative href has to be re-pointed at something that exists. Which of the
  //    two destinations it gets is decided by BUNDLED_PAGES in config.js, where the
  //    rule and its reasoning live: a page that describes the code you installed is
  //    bundled and resolves to the LOCAL file; a page that is a legal instrument or a
  //    statement about the service today (/terms, /privacy, /report) goes to the LIVE
  //    site. Either way an informational link opens in a NEW TAB, so a half-composed
  //    secret in this one is never disturbed.
  //
  //    Bundling the explainers is what keeps the user INSIDE the extension. Before,
  //    "How privsend works" left for the website, and that page's own "Send a secret"
  //    link then landed them on the website's compose form -- two ordinary clicks out
  //    of the installed copy, with no sign it had happened.
  //
  //    The language links go local too: "Suomeksi" switches to the bundled Finnish
  //    page rather than sending a Finn out to the website at the very moment the
  //    extension finally speaks their language.
  //
  //    Absolute links (the GitHub source link) start with "http", not "/", so the
  //    selector never sees them and they are left untouched.
  for (const a of document.querySelectorAll('a[href^="/"]')) {
    const path = a.getAttribute('href');
    const local = bundledPage(path);
    if (local) {
      a.setAttribute('href', local.file);
      if (local.newTab) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
      }
    } else {
      a.setAttribute('href', SITE_ORIGIN + path); // the live website
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  }

  // 2) A visible, honest banner. The CODE on this page (the crypto and all) is the
  //    copy installed on this device, never re-fetched -- but encrypted data still
  //    travels to the server, so the wording says exactly that and claims no more.
  //    The deeper anti-tamper story ("this copy can't be swapped out for you alone")
  //    lives on the verify page, to keep the compose page uncluttered.
  //
  //    Built AFTER the loop above, deliberately: its link resolves itself, so the
  //    loop must not see it. Were it inserted first, a later language switch would
  //    write a site path back into an href the loop had already resolved, and the
  //    link would break the moment someone changed language.
  const banner = document.createElement('div');
  banner.className = 'ext-banner';
  banner.setAttribute('role', 'note');

  const head = document.createElement('strong');
  const body = document.createElement('span');

  // The way out to the full explanation, for anyone who wants to know what "running
  // locally" actually buys them and how to check it. Deliberately the only link here,
  // and omitted on the verify page itself, where it would point at the page already
  // on screen.
  const onVerifyPage = /verify\.html$/.test(location.pathname);
  const more = document.createElement('a');

  // The wording comes from i18n.js, in the page's own language. On the compose and
  // drop-address pages that is fixed by the URL the user opened; on the public drop
  // page and the inbox it can be switched at any moment by the language toggle, so
  // the banner re-renders with everything else -- INCLUDING the link's destination,
  // which follows the language too. A Finn reading a Finnish banner should not be
  // handed the English verify page. textContent, never innerHTML.
  const label = () => {
    head.textContent = t.ext.running;
    body.textContent = t.ext.explains;
    more.textContent = t.ext.howVerified;
    more.setAttribute('href', resolve(lang() === 'fi' ? '/fi/verify' : '/verify'));
    more.setAttribute('target', '_blank');
    more.setAttribute('rel', 'noopener');
  };
  label();
  onLangChange(label);

  banner.append(head, body);
  if (!onVerifyPage) banner.append(more);
  document.body.insertBefore(banner, document.body.firstChild);

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
