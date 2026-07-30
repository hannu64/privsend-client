// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// WHERE THE API LIVES. Every network call in the client goes through api(), and
// every share/status link is built from SITE_ORIGIN, so this one module decides
// which server the client talks to.
//
// On the WEBSITE this is a no-op by construction: the page is served from
// https://privsend.app (or dev.privsend.app), location.protocol is 'https:', so
// SITE_ORIGIN is just location.origin and api('/api/x') returns '/api/x'
// unchanged -- the same same-origin relative fetch the client has always made.
// The bytes of these files change; the website's network behaviour does not.
//
// In the BROWSER EXTENSION the very same files are loaded from a
// chrome-extension:// (or moz-extension://) origin, where a relative '/api/...'
// would resolve against the extension itself and reach nothing. There, api() and
// SITE_ORIGIN point at the real production server. The extension is a production
// artifact and never talks to dev -- there is nothing to configure and no way to
// point it elsewhere, which is precisely the point: the crypto that runs is the
// installed, audited copy, and the server it uses is fixed.
const EXTENSION_ORIGINS = ['chrome-extension:', 'moz-extension:', 'safari-web-extension:'];
export const IN_EXTENSION = EXTENSION_ORIGINS.includes(location.protocol);

// The origin used to BUILD links (the share link, the status link). Same-origin
// on the web; production in the extension.
export const SITE_ORIGIN = IN_EXTENSION ? 'https://privsend.app' : location.origin;

// THE PAGES THE EXTENSION RUNS LOCALLY, keyed by the site path the HTML links to.
// On the website the server routes these; in the extension there is no server
// routing, so a bare "/drops" would hit the extension root and 404 -- it has to
// name the bundled file instead.
//
// WHICH pages are in here is a deliberate line, and the line is NOT "does this page
// touch keys". That was the first answer and it was wrong. Sending the explainers to
// the live site opened a quiet exit from the extension: a link on the compose page
// led to privsend.app/how, and the perfectly ordinary "Send a secret" link on THAT
// page then led to the website's compose form -- so two unremarkable clicks walked a
// user out of the installed copy and back onto server-delivered crypto, with nothing
// to mark the moment except a banner that stopped appearing. An escape hatch nobody
// can see is worse than no hatch.
//
// The line that actually holds is WHAT THE PAGE DESCRIBES:
//
//   Bundled -- pages that describe THE CODE YOU INSTALLED. The compose and drop
//   pages, and the explainers of how they work. A bundled explainer stays in step
//   with the bundled client, which is the whole point: when the site's shortest
//   lifetime moved from 1 hour to 4, the published extension went on offering 1 hour,
//   and its own /how saying "1 hour" is RIGHT for that user while the live site's
//   /how would have described a choice their copy does not have.
//
//   Live site -- pages that are a legal instrument or a statement about the service
//   as it stands TODAY: /terms, /privacy, /report. These do not describe the
//   installed code, they bind Zumitomi Oy, and the version that governs is the one
//   published on the website. A frozen copy could contradict it, and the frozen copy
//   would be the one the reader believed.
//
// `newTab` marks the pages that open in a new tab so a half-composed secret in the
// current one is never disturbed. That was always true of the informational links;
// making them local does not change the reason for it.
const BUNDLED_PAGES = {
  '/':             { file: '/index.html' },
  '/fi':           { file: '/fi/index.html' },
  '/drops':        { file: '/drops.html' },
  '/fi/drops':     { file: '/fi/drops.html' },

  '/how':          { file: '/how.html', newTab: true },
  '/fi/how':       { file: '/fi/how.html', newTab: true },
  '/drops/how':    { file: '/drops-how.html', newTab: true },
  '/fi/drops/how': { file: '/fi/drops-how.html', newTab: true },
  '/verify':       { file: '/verify.html', newTab: true },
  '/fi/verify':    { file: '/fi/verify.html', newTab: true },
};

/** The bundled page a site path maps to ({ file, newTab }), or null if this page is
 *  not carried locally and belongs on the live site. Only consulted in the extension. */
export const bundledPage = (path) => BUNDLED_PAGES[path] || null;

// Where a "home" / brand link should point.
//
// It is language-aware: the compose page has a Finnish twin at /fi, and "Create
// another" on the Finnish page must come back to the Finnish page rather than dump
// a Finnish speaker into English mid-task. Routing is this module's job, so the
// language check lives here rather than being threaded through the callers.
const FI_PAGE = document.documentElement.lang === 'fi';
const homePath = FI_PAGE ? '/fi' : '/';
export const homeHref = IN_EXTENSION ? BUNDLED_PAGES[homePath].file : homePath;

// Where the "Open my inbox" button goes once a drop address has just been created.
//
// Note what does NOT change: the console link the page DISPLAYS and copies is always
// the https://privsend.app/SECRET#<token> form, because that is what the owner
// bookmarks. It has to keep working on their phone, on a machine without the
// extension, and after they uninstall it. Only the immediate navigation differs --
// inside the extension it goes straight to the bundled inbox rather than out to the
// website and back in via the content script. The token rides in the fragment in
// both cases and is never sent anywhere.
export const consoleHref = (token) =>
  IN_EXTENSION ? '/inbox.html#' + token : SITE_ORIGIN + '/SECRET#' + token;

// Turn a server-relative API path ('/api/secret') into the URL to fetch. On the
// web it is the identity function -- it returns the path untouched, so the fetch
// target is character-for-character what it has always been. In the extension it
// is prefixed with the production origin.
export const api = (path) => (IN_EXTENSION ? SITE_ORIGIN + path : path);

// The id a per-item page is about. On the WEBSITE it is the last path segment --
// /s/{id} for a secret, /public/{id} for a drop address -- unchanged from before.
// In the EXTENSION those pages are bundled files that a content script navigates
// to, and a bundled file has no meaningful path, so the id is carried across in a
// ?id= query parameter instead.
//
// SECRETS ARE NOT INVOLVED EITHER WAY. A secret's decryption key and a drop
// owner's console token both live in the FRAGMENT (location.hash), which is never
// part of a request; this helper only ever concerns the public, non-secret id --
// the same id that was in the URL bar a moment ago.
const idFromLocation = () =>
  IN_EXTENSION
    ? new URLSearchParams(location.search).get('id')
    : location.pathname.split('/').pop();

/** The id of the secret being revealed (/s/{id} on the web). */
export const secretId = idFromLocation;

/** The id of the drop address being written to (/public/{id} on the web). */
export const dropId = idFromLocation;
