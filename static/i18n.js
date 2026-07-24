// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// THE TEXT THE TOOL PAGES PRODUCE AT RUNTIME.
//
// Everything a static page says is written straight into its HTML, and the
// Finnish pages are separate files under /fi/. But the compose page also writes
// text while you use it -- the byte counter's cap, the size errors, the button's
// "Encrypting file 2 of 5…", the copy-button feedback -- and that text has to be
// in the same language as the page it appears on.
//
// It lives HERE, in one module keyed off the page's own lang attribute, rather
// than in a second Finnish copy of create.js. This client is also the browser
// extension, and its whole claim is that the code you read in the repo is the
// code that runs on your device. Two near-identical copies of the code that
// handles your plaintext would make that claim harder to check, not easier --
// a reader would have to diff them and satisfy themselves the difference really
// was only wording. One file, one code path, a table of words.
//
// The language comes from <html lang="…">, which the Finnish pages declare and
// the English ones now do too. Not from navigator.language: the page you asked
// for is a better statement of the language you want than the browser's setting,
// and a Finn reading the English page should get English errors on it.
export const LANG = document.documentElement.lang === 'fi' ? 'fi' : 'en';

// Sizes are formatted by fmtBytes ("25 MB", "256 KB") and read the same in both
// languages, so they are passed in rather than translated.
const EN = {
  cap: (max) => `limit ${max}`,
  remove: 'Remove',
  create: 'Create secret link',

  tooManyFiles: (n, max) => `Too many files — ${n} chosen, the limit is ${max}.`,
  fileTooBig: (name, size, max) =>
    `File too large — “${name}” is ${size}, and the limit is ${max} for one file. ` +
    `Remove it, or send it another way.`,
  filesTooBig: (total, max) =>
    `Files too large — ${total} in total, and the limit is ${max} for one secret. ` +
    `Remove one, or send them separately.`,

  needSomething: 'Please enter a secret or attach a file first.',
  secretTooBig: (used, max) => `That secret is ${used}, over the ${max} limit.`,
  countTooMany: (n, max) => `That is ${n} files; the limit is ${max}.`,
  oneTooBig: (name, size, max) => `“${name}” is ${size}, over the ${max} limit for one file.`,
  totalTooBig: (total, max) => `Those files total ${total}, over the ${max} limit.`,
  needPassphrase: 'Please enter a passphrase, or uncheck the box.',

  encrypting: 'Encrypting…',
  encryptingFile: 'Encrypting file…',
  encryptingFileN: (i, n) => `Encrypting file ${i} of ${n}…`,
  uploadingFile: 'Uploading file…',
  uploadingFileN: (i, n) => `Uploading file ${i} of ${n}…`,

  createFailed: 'Could not create the secret. Please try again.',
  uploadFailed: 'Could not upload the file. Please try again.',
  encryptFailed: 'Encryption failed.',

  copyShare: 'Copy share link',
  copyStatus: 'Copy status link',
  copied: 'Copied ✓',
  copyManually: 'Press Ctrl/Cmd-C to copy',

  leaveWarning:
    'You have not copied the share link.\n\n' +
    'The decryption key exists only on this page — it is not stored on our server. ' +
    'If you leave now, this secret can never be read by anyone.\n\n' +
    'Leave anyway?',
};

const FI = {
  cap: (max) => `enintään ${max}`,
  remove: 'Poista',
  create: 'Luo salaisuuslinkki',

  tooManyFiles: (n, max) => `Liikaa tiedostoja — valittuna ${n}, raja on ${max}.`,
  fileTooBig: (name, size, max) =>
    `Tiedosto on liian suuri — ”${name}” on ${size}, ja yhden tiedoston raja on ${max}. ` +
    `Poista se tai lähetä se toista reittiä.`,
  filesTooBig: (total, max) =>
    `Tiedostot ovat liian suuria — yhteensä ${total}, ja yhden salaisuuden raja on ${max}. ` +
    `Poista jokin niistä tai lähetä ne erikseen.`,

  needSomething: 'Kirjoita salaisuus tai liitä tiedosto ensin.',
  secretTooBig: (used, max) => `Salaisuus on ${used}, ja raja on ${max}.`,
  countTooMany: (n, max) => `Tiedostoja on ${n}; raja on ${max}.`,
  oneTooBig: (name, size, max) => `”${name}” on ${size}, ja yhden tiedoston raja on ${max}.`,
  totalTooBig: (total, max) => `Tiedostoja on yhteensä ${total}, ja raja on ${max}.`,
  needPassphrase: 'Kirjoita salalause tai poista rasti ruudusta.',

  encrypting: 'Salataan…',
  encryptingFile: 'Salataan tiedostoa…',
  encryptingFileN: (i, n) => `Salataan tiedostoa ${i}/${n}…`,
  uploadingFile: 'Lähetetään tiedostoa…',
  uploadingFileN: (i, n) => `Lähetetään tiedostoa ${i}/${n}…`,

  createFailed: 'Salaisuuden luominen ei onnistunut. Yritä uudelleen.',
  uploadFailed: 'Tiedoston lähettäminen ei onnistunut. Yritä uudelleen.',
  encryptFailed: 'Salaus epäonnistui.',

  copyShare: 'Kopioi jakolinkki',
  copyStatus: 'Kopioi tilalinkki',
  copied: 'Kopioitu ✓',
  copyManually: 'Kopioi näppäimillä Ctrl/Cmd-C',

  leaveWarning:
    'Et ole kopioinut jakolinkkiä.\n\n' +
    'Salauksen purkava avain on olemassa vain tällä sivulla — sitä ei tallenneta ' +
    'palvelimellemme. Jos poistut nyt, kukaan ei voi enää koskaan lukea tätä salaisuutta.\n\n' +
    'Poistutaanko silti?',
};

export const t = LANG === 'fi' ? FI : EN;
