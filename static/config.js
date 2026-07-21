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
const IN_EXTENSION = EXTENSION_ORIGINS.includes(location.protocol);

// The origin used to BUILD links (the share link, the status link). Same-origin
// on the web; production in the extension.
export const SITE_ORIGIN = IN_EXTENSION ? 'https://privsend.app' : location.origin;

// Turn a server-relative API path ('/api/secret') into the URL to fetch. On the
// web it is the identity function -- it returns the path untouched, so the fetch
// target is character-for-character what it has always been. In the extension it
// is prefixed with the production origin.
export const api = (path) => (IN_EXTENSION ? SITE_ORIGIN + path : path);
