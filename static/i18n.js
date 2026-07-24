// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// THE TEXT THE TOOL PAGES PRODUCE AT RUNTIME.
//
// Everything a static page says is written straight into its HTML, and the
// Finnish documents are separate files under /fi/. But the tool pages also write
// text while you use them -- the byte counter's cap, the size errors, the
// button's "Encrypting file 2 of 5…", "Ten wrong passphrases", the receipt's
// verdict -- and that text has to be in the same language as the page it appears
// on.
//
// It lives HERE, in one module, rather than in a second Finnish copy of
// create.js and reveal.js. This client is also the browser extension, and its
// whole claim is that the code you read in the repo is the code that runs on
// your device. Two near-identical copies of the code that handles your plaintext
// would make that claim harder to check, not easier -- a reader would have to
// diff them and satisfy themselves the difference really was only wording. One
// file, one code path, a table of words.
//
// ---------------------------------------------------------------- how language
// is chosen, and why it differs per page
//
// COMPOSE (/ and /fi) is chosen by URL. You asked for a page; that is a better
// statement of the language you want than any browser setting, and a Finn who
// opened the English page should get English errors on it. Those pages declare
// <html lang> and never call setLang.
//
// REVEAL (/s/{id}) and STATUS (/status/{id}) cannot work that way. The recipient
// never chose a URL -- the sender did -- and the recipient may not share the
// sender's language at all. A /fi/s/{id} would be worse than useless: it would
// announce to anyone who saw the link that the sender was Finnish, which is
// exactly the kind of metadata this service exists not to leak. So those pages
// carry BOTH languages and a visible toggle, on one URL.
//
// NOTHING IS PERSISTED. No localStorage, no sessionStorage, no cookie. privsend
// stores nothing at all on your device today and this is not the feature worth
// starting with -- the reveal page is opened once in its life, and the receipt
// is glanced at. There is no journey across pages for a remembered preference to
// pay for. navigator.language is read on those two pages as an opening guess; it
// is never sent anywhere and never written down.

const TABLES = {};

// The starting language. <html lang> is authoritative -- that is what the served
// file declares -- and initLangToggle() may revise it once, from the browser's
// own locale, on the two pages where the reader did not pick a URL.
let current = document.documentElement.lang === 'fi' ? 'fi' : 'en';

const listeners = [];

/** The active table. `t.copied` and `t.reveal.download` always read the CURRENT
 *  language, so a call site keeps working after the reader toggles. One line,
 *  so that nothing about it has to be taken on trust. */
export const t = new Proxy({}, { get: (_, key) => TABLES[current][key] });

export function lang() {
  return current;
}

/** Switch language and let the page redraw whatever it has already written. */
export function setLang(next) {
  current = next === 'fi' ? 'fi' : 'en';
  // The <html lang> attribute is the single source of truth: CSS hides the
  // inactive .lang-* blocks off it, screen readers announce the right language
  // from it, and this module reads it at load. Setting it here does all three.
  document.documentElement.lang = current;
  for (const fn of listeners) fn(current);
}

/** Register a redraw for text this page has already put on screen. */
export function onLangChange(fn) {
  listeners.push(fn);
}

/**
 * Wire the two-button language bar. Called ONLY by the reveal and status pages;
 * the compose pages take their language from their URL and have no toggle.
 *
 * `autodetect` makes the browser's locale the opening guess -- the recipient did
 * not choose this page's language, so their own locale is the only signal we
 * have. It is read, never stored and never transmitted.
 */
export function initLangToggle({ autodetect = false } = {}) {
  const en = document.getElementById('lang-en');
  const fi = document.getElementById('lang-fi');
  if (!en || !fi) return;

  if (autodetect && /^fi\b/i.test(navigator.language || '')) setLang('fi');

  const mark = () => {
    en.classList.toggle('active', current === 'en');
    fi.classList.toggle('active', current === 'fi');
    en.setAttribute('aria-pressed', String(current === 'en'));
    fi.setAttribute('aria-pressed', String(current === 'fi'));
  };
  en.addEventListener('click', () => setLang('en'));
  fi.addEventListener('click', () => setLang('fi'));
  onLangChange(mark);
  mark();
}

// Sizes are formatted by fmtBytes ("25 MB", "256 KB") and read the same in both
// languages, so they are passed in rather than translated. Dates come from
// toLocaleString() and follow the reader's own locale.
TABLES.en = {
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

  reveal: {
    pageTitle: 'privsend — a secret is waiting',
    revealBtn: 'Reveal secret',
    unlockBtn: 'Unlock',
    passPlaceholder: 'Passphrase',

    sizeHint: (size) =>
      `📦 About ${size} will be downloaded. Make sure this device has room and a ` +
      `steady connection before you reveal it — the secret can only be opened once.`,

    retrieving: 'Retrieving and destroying…',
    decrypting: 'Decrypting…',

    download: 'Download',
    downloading: 'Downloading…',
    saved: 'Saved ✓',
    destroying: 'Destroying…',
    destroyAll: 'Destroy all files now',
    copyOut: 'Copy to clipboard',

    missingKey:
      'This link is missing its decryption key — the part after the “#”. ' +
      'Nothing was opened. Ask the sender to re-send the complete link.',
    unreachable: 'Could not reach the server. Nothing was opened; try again.',
    unavailable: 'This secret is no longer available.',
    gone410: 'This secret is no longer available. It may already have been opened, or it may have expired.',
    fileGone: 'This file is no longer available on the server.',
    lockout:
      'Ten wrong passphrases — this secret has been cleared from this page. It was ' +
      'already destroyed on the server when it was opened, so it cannot be retrieved. ' +
      'Ask the sender to create a new one.',
    wrongPass: (left) =>
      `Wrong passphrase. You can keep trying — this secret is only in this tab now, so ` +
      `don't reload. ${left} ${left === 1 ? 'try' : 'tries'} left.`,

    dlRetry:
      ' Nothing was destroyed — press Download again. ' +
      'Do NOT reload or leave this page: it holds the only key to these files, ' +
      'and re-opening the link in a new tab will not work.',
    errConnection: 'The connection dropped during the download.',
    errTruncated: 'The file did not arrive intact — the download was cut short.',
    errGeneric: 'The download failed.',
  },

  status: {
    pageTitle: 'privsend — secret status',
    checking: 'Checking…',
    checkAgain: 'Check again',
    unknownTime: 'an unknown time',

    unreachable: ['⚠️', 'Could not reach the server', 'Please try again in a moment.'],
    missing: ['❓', 'This receipt is no longer available',
      'It may never have existed, or the secret may have been opened or expired more than 7 days ago — ' +
      'after which we delete the record entirely.'],
    unopened: ['📬', 'Not opened yet',
      'The recipient has not read this secret. It will be destroyed automatically when it expires, ' +
      'even if nobody ever opens it.'],
    pending: (when, n) => ['⏳', 'Collected — files still being delivered',
      `The encrypted message was collected on ${when} and destroyed at that instant. ` +
      `${n === 1 ? 'One file is' : `${n} files are`} still on our server. A file cannot be destroyed ` +
      `the moment a download begins: if it were, a download that dropped halfway would leave the ` +
      `recipient with nothing and no way to try again. ` +
      `${n === 1 ? 'It is' : 'They are'} destroyed as soon as the recipient's browser confirms the ` +
      `download arrived intact — usually within seconds — and in any case no later than 60 minutes ` +
      `after collection. Check again shortly and this will say "destroyed".`],
    collected: (when) => ['✅', 'Collected and destroyed',
      `The encrypted secret was collected on ${when} and destroyed at that instant — it no longer ` +
      `exists anywhere. Note we can only see that it was collected, never whether it was successfully ` +
      `decrypted: if you set a passphrase and the recipient mistyped it, the secret is now lost to everyone.`],
    takenDown: ['🚫', 'Removed after a report',
      'This secret was reported to us and removed, and its contents were destroyed. ' +
      'We cannot read secrets, so we act on reports about the link itself. ' +
      'If you believe this was a mistake, contact support@zumitomi.fi.'],
    expired: ['⌛', 'Expired — never read',
      'Nobody opened this secret before its time limit ran out, so it was destroyed unread. ' +
      'If the recipient still needs it, send a new one.'],
  },
};

TABLES.fi = {
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

  reveal: {
    pageTitle: 'privsend — sinulle on salaisuus',
    revealBtn: 'Paljasta salaisuus',
    unlockBtn: 'Avaa',
    passPlaceholder: 'Salalause',

    sizeHint: (size) =>
      `📦 Ladattavaa on noin ${size}. Varmista ennen paljastamista, että laitteessa on tilaa ` +
      `ja yhteys on vakaa — salaisuuden voi avata vain kerran.`,

    retrieving: 'Noudetaan ja tuhotaan…',
    decrypting: 'Puretaan salausta…',

    download: 'Lataa',
    downloading: 'Ladataan…',
    saved: 'Tallennettu ✓',
    destroying: 'Tuhotaan…',
    destroyAll: 'Tuhoa kaikki tiedostot nyt',
    copyOut: 'Kopioi leikepöydälle',

    missingKey:
      'Tästä linkistä puuttuu salauksen purkava avain — ”#”-merkin jälkeinen osa. ' +
      'Mitään ei avattu. Pyydä lähettäjää lähettämään koko linkki uudelleen.',
    unreachable: 'Palvelimeen ei saatu yhteyttä. Mitään ei avattu; yritä uudelleen.',
    unavailable: 'Tämä salaisuus ei ole enää saatavilla.',
    gone410: 'Tämä salaisuus ei ole enää saatavilla. Se on ehkä jo avattu tai se on vanhentunut.',
    fileGone: 'Tämä tiedosto ei ole enää saatavilla palvelimella.',
    lockout:
      'Kymmenen väärää salalausetta — salaisuus on poistettu tältä sivulta. Se tuhottiin ' +
      'palvelimelta jo silloin, kun se avattiin, joten sitä ei voi hakea uudelleen. ' +
      'Pyydä lähettäjää luomaan uusi.',
    wrongPass: (left) =>
      `Väärä salalause. Voit yrittää uudelleen — salaisuus on nyt vain tässä välilehdessä, ` +
      `joten älä lataa sivua uudelleen. ${left} ${left === 1 ? 'yritys' : 'yritystä'} jäljellä.`,

    dlRetry:
      ' Mitään ei tuhottu — paina Lataa uudelleen. ' +
      'ÄLÄ lataa sivua uudelleen äläkä poistu siltä: tällä sivulla on ainoa avain näihin ' +
      'tiedostoihin, eikä linkin avaaminen uudessa välilehdessä toimi.',
    errConnection: 'Yhteys katkesi latauksen aikana.',
    errTruncated: 'Tiedosto ei saapunut ehjänä — lataus katkesi kesken.',
    errGeneric: 'Lataus epäonnistui.',
  },

  status: {
    pageTitle: 'privsend — salaisuuden tila',
    checking: 'Tarkistetaan…',
    checkAgain: 'Tarkista uudelleen',
    unknownTime: 'tuntemattomana ajankohtana',

    unreachable: ['⚠️', 'Palvelimeen ei saatu yhteyttä', 'Yritä hetken kuluttua uudelleen.'],
    missing: ['❓', 'Tämä kuitti ei ole enää saatavilla',
      'Sitä ei ehkä ole koskaan ollutkaan, tai salaisuus on avattu tai vanhentunut yli 7 vuorokautta ' +
      'sitten — minkä jälkeen poistamme tiedon kokonaan.'],
    unopened: ['📬', 'Ei vielä avattu',
      'Vastaanottaja ei ole lukenut tätä salaisuutta. Se tuhotaan automaattisesti, kun se vanhenee, ' +
      'vaikka kukaan ei koskaan avaisi sitä.'],
    pending: (when, n) => ['⏳', 'Noudettu — tiedostoja vielä toimitetaan',
      `Salattu viesti noudettiin ${when} ja tuhottiin samalla hetkellä. ` +
      `${n === 1 ? 'Yksi tiedosto on' : `${n} tiedostoa on`} vielä palvelimellamme. Tiedostoa ei voi ` +
      `tuhota sillä hetkellä, kun lataus alkaa: jos niin tehtäisiin, kesken katkennut lataus jättäisi ` +
      `vastaanottajan tyhjin käsin eikä uutta yritystä olisi. ` +
      `${n === 1 ? 'Se tuhotaan' : 'Ne tuhotaan'} heti, kun vastaanottajan selain vahvistaa latauksen ` +
      `saapuneen ehjänä — yleensä sekunneissa — ja joka tapauksessa viimeistään 60 minuutin kuluttua ` +
      `noutamisesta. Tarkista pian uudelleen, niin tässä lukee ”tuhottu”.`],
    collected: (when) => ['✅', 'Noudettu ja tuhottu',
      `Salattu salaisuus noudettiin ${when} ja tuhottiin samalla hetkellä — sitä ei ole enää olemassa ` +
      `missään. Huomaa, että näemme vain sen, että se noudettiin, emme sitä, onnistuiko salauksen ` +
      `purkaminen: jos asetit salalauseen ja vastaanottaja kirjoitti sen väärin, salaisuus on nyt ` +
      `menetetty kaikilta.`],
    takenDown: ['🚫', 'Poistettu ilmoituksen perusteella',
      'Tästä salaisuudesta ilmoitettiin meille, se poistettiin ja sen sisältö tuhottiin. ' +
      'Emme pysty lukemaan salaisuuksia, joten toimimme itse linkkiä koskevien ilmoitusten perusteella. ' +
      'Jos uskot tämän olleen virhe, ota yhteyttä: support@zumitomi.fi.'],
    expired: ['⌛', 'Vanhentui — ei luettu koskaan',
      'Kukaan ei avannut tätä salaisuutta ennen kuin sen määräaika umpeutui, joten se tuhottiin ' +
      'lukemattomana. Jos vastaanottaja tarvitsee sen yhä, lähetä uusi.'],
  },
};
