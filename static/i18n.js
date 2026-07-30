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

  // The PUBLIC drop page (/public/{id}). Like reveal, it carries both languages on one
  // URL and a toggle: the sender did not choose this address -- the owner published it --
  // and a /fi/public/{id} would announce the owner's language to anyone who saw the link.
  drop: {
    pageTitle: 'privsend — send a private message',
    sendBtn: 'Encrypt & send',
    encrypting: 'Encrypting…',
    placeholder: 'Write your message…',
    writeFirst: 'Please write a message first.',
    tooLong: 'Message is too long.',
    sendFailed: 'Could not send the message.',
    // The recipient's opt-in "still watched" signal, worded honestly: the owner's own
    // console sets it after a read, so it is a hint, not a proof (2026-07-29 review).
    lastActive: (bucket) =>
      `The owner's console was last active in this inbox ${bucket} — a rough hint, not a guarantee.`,
    lastUnknown:
      "We can't tell you whether this inbox is still being watched — the owner hasn't chosen to show that.",
    // Keyed by the server's coarse last_seen CODE (see api.lastSeenBucket).
    buckets: {
      week: 'within the last week',
      month: 'within the last month',
      quarter: 'within the last 3 months',
      half: 'within the last 6 months',
      older: 'more than 6 months ago',
    },
    // Files (v2). A drop can carry files as well as, or instead of, a message. These are
    // the DYNAMIC strings the script writes; the field labels and the persist-not-burn
    // note are fixed prose in drop.html (both languages).
    remove: 'Remove',
    needSomething: 'Please write a message or attach a file first.',
    tooManyFiles: (n, max) => `Too many files — ${n} chosen, the limit is ${max}.`,
    fileTooBig: (name, size, max) => `“${name}” is ${size}, over the ${max} limit for one file.`,
    filesTooBig: (total, max) => `Those files total ${total}, over the ${max} limit.`,
    encryptingFile: 'Encrypting file…',
    encryptingFileN: (i, n) => `Encrypting file ${i} of ${n}…`,
    uploadingFile: 'Uploading file…',
    uploadingFileN: (i, n) => `Uploading file ${i} of ${n}…`,
    uploadFailed: 'Could not upload the file. Please try again.',
  },

  // The passphrase strength gate (passphrase.js), shared by the create page and the
  // console's change-passphrase. A FLOOR, not a verdict on quality -- see passphrase.js.
  pass: {
    ok: 'Looks good ✓',
    tooShort: (min) =>
      `Use at least ${min} characters. A dozen varied characters is fine, and four everyday words — like “amber tractor velvet moon” — is easy to remember.`,
    common: 'That is one of the most common passwords in the world — an attacker tries it first. Choose something only you would think of.',
    digitsOnly: 'Digits alone are easy to guess. Add words or letters, or make it much longer.',
    repeats: 'That repeats too much to be safe — a repeated block is only as strong as the block itself, however long you make it. Use more varied characters, or four everyday words.',
  },

  // The create-a-drop-address page (/drops and /fi/drops). URL-chosen language, no toggle.
  drops: {
    pageTitle: 'privsend — create a drop address',
    createBtn: 'Create my drop address',
    creating: 'Creating…',
    chooseFirst: 'Choose a passphrase first.',
    createFailed: 'Could not create the drop address.',
    copyConsole: 'Copy SECRET console link',
    copyAddr: 'Copy public drop address',
    copyFailed: 'Copy failed — select and copy manually',
    confirmUnsaved: 'Have you saved your console link? Without it you cannot get back in.',
  },

  // The recipient's console (/SECRET#token: inbox.html + inbox.js). A TOGGLE page: the one
  // SECRET link is generated language-agnostic, so it cannot encode a choice -- and nothing
  // is persisted -- so like reveal it carries both languages on one URL, a visible toggle,
  // and the browser locale as the opening guess. Fixed prose lives twice in the HTML; the
  // text this table holds is what the script WRITES at runtime and must re-render on a toggle.
  inbox: {
    pageTitle: 'privsend — your drop inbox',
    checkNew: 'Check for new messages',
    unlockBtn: 'Unlock inbox',
    passPlaceholder: 'Your passphrase',
    saveSettings: 'Save settings',
    saveChanges: 'Save changes',
    saveRetention: 'Save retention',
    changePass: 'Change passphrase',
    deleteAddr: 'Delete this address permanently',
    curPassPh: 'Current passphrase',
    newPassPh: 'New passphrase',
    newPass2Ph: 'Repeat new passphrase',
    days7: '7 days',
    days14: '14 days',
    days30: '30 days',
    deleteBtn: 'Delete',
    emptyMsg: '(empty message)',
    undecryptable: '[This message could not be decrypted.]',
    // Attachments (v2 files). A drop's files are NOT one-time: they persist,
    // re-downloadable, until the message is deleted or retention expires.
    filesHeading: 'Attachments',
    download: 'Download',
    downloading: 'Downloading…',
    decrypting: 'Decrypting…',
    saved: 'Saved ✓',
    fileGone: 'This file is no longer available.',
    downloadFailed: 'Download failed — please try again.',
    fpUnavailable: '(unavailable)',

    countEmpty: 'No messages in your inbox yet. Enter your passphrase to open it.',
    countSome: (n) =>
      `Your inbox holds ${n} message${n === 1 ? '' : 's'} in total. ` +
      `Enter your passphrase to read ${n === 1 ? 'it' : 'them'}.`,

    enterPass: 'Enter your passphrase.',
    wrongPass: 'Wrong passphrase.',

    // The failed-unlock intrusion warning. `others` are attempts from another session or
    // device -- the real intrusion signal; `mine` are this tab's own wrong guesses, shown
    // so a genuine "others" count can never be mistaken for one's own fumbling, or vice versa.
    intrusionOthers: (others, mine) => {
      const o = others >= 999 ? '999+' : String(others);
      return `⚠️ Since you last read your messages: ${o} failed passphrase attempt${others === 1 ? '' : 's'} from another session or device`
        + (mine > 0 ? `, plus ${mine} you just made in this one` : '')
        + `. If those other attempts were not you, your SECRET link may be exposed — consider “Delete this address permanently” below, then share a fresh drop address.`;
    },
    intrusionMineOnly: (mine) =>
      `You just made ${mine} failed passphrase attempt${mine === 1 ? '' : 's'}, and there were no other attempts since you last read — nothing to worry about.`,

    settingsSaved: 'Settings saved.',
    settingsSavedPending: 'Settings saved. Senders will see your “last active” time once you unlock and read your inbox.',
    settingsFailed: 'Could not save settings. Please try again.',

    retentionSaved: (days) => `Saved. New messages will be kept for ${days} days.`,
    daysLegacy: (days) => `${days} days (no longer offered)`,
    retentionFailed: 'Could not save. Please try again.',

    passFill: 'Fill in your current and new passphrase.',
    passMismatch: 'The two new passphrases do not match.',
    passWrongCur: 'Wrong current passphrase.',
    passChanged: 'Passphrase changed. Use the new one from now on.',
    passSaveFailed: 'Could not save the change. Please try again.',

    confirmDestroy: 'Permanently delete this address and every message in it? This cannot be undone.',
    destroyFailed: 'Could not delete the address. Please try again.',
  },

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

  // The browser extension's own banner. It appears ONLY when these pages are the
  // installed extension, never on the website, where the claim would be false --
  // see ext.js. It lives here rather than in ext.js because the extension now
  // carries the Finnish pages too, and a Finn who installed it to be told the truth
  // about their own privacy should be told it in Finnish.
  ext: {
    running: '🔒 Running locally',
    explains:
      'The code on this page — including the encryption — is the copy installed in your ' +
      'browser, not downloaded from a server. Only encrypted data is ever sent to privsend.app.',
    howVerified: 'How is this verified? →',
    build: (v) => 'Extension build ' + v,
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

  // Julkinen vastaanottosivu (/public/{id}). Kuten paljastussivu, se kantaa molempia kieliä
  // yhdessä osoitteessa ja tarjoaa valitsimen: lähettäjä ei valinnut tätä osoitetta —
  // omistaja julkaisi sen — ja /fi/public/{id} paljastaisi omistajan kielen kenelle tahansa,
  // joka näkee linkin.
  drop: {
    pageTitle: 'privsend — lähetä yksityinen viesti',
    sendBtn: 'Salaa ja lähetä',
    encrypting: 'Salataan…',
    placeholder: 'Kirjoita viestisi…',
    writeFirst: 'Kirjoita ensin viesti.',
    tooLong: 'Viesti on liian pitkä.',
    sendFailed: 'Viestin lähettäminen ei onnistunut.',
    lastActive: (bucket) =>
      `Omistajan konsoli oli tässä postilaatikossa aktiivinen ${bucket} — karkea vihje, ei takuu.`,
    lastUnknown:
      'Emme voi kertoa, seurataanko tätä postilaatikkoa yhä — omistaja ei ole valinnut sen näyttämistä.',
    // Avaimena palvelimen karkea last_seen-KOODI (ks. api.lastSeenBucket).
    buckets: {
      week: 'viimeisen viikon aikana',
      month: 'viimeisen kuukauden aikana',
      quarter: 'viimeisen 3 kuukauden aikana',
      half: 'viimeisen 6 kuukauden aikana',
      older: 'yli 6 kuukautta sitten',
    },
    // Tiedostot (v2). Skripti kirjoittaa nämä; kenttien nimikkeet ja säilytys-huomautus
    // ovat kiinteää tekstiä drop.html:ssä (molemmat kielet).
    remove: 'Poista',
    needSomething: 'Kirjoita viesti tai liitä tiedosto ensin.',
    tooManyFiles: (n, max) => `Liikaa tiedostoja — valittuna ${n}, raja on ${max}.`,
    fileTooBig: (name, size, max) => `”${name}” on ${size}, ja yhden tiedoston raja on ${max}.`,
    filesTooBig: (total, max) => `Tiedostoja on yhteensä ${total}, ja raja on ${max}.`,
    encryptingFile: 'Salataan tiedostoa…',
    encryptingFileN: (i, n) => `Salataan tiedostoa ${i}/${n}…`,
    uploadingFile: 'Lähetetään tiedostoa…',
    uploadingFileN: (i, n) => `Lähetetään tiedostoa ${i}/${n}…`,
    uploadFailed: 'Tiedoston lähettäminen ei onnistunut. Yritä uudelleen.',
  },

  // Salalauseen vahvuustarkistus (passphrase.js), jaettu luontisivun ja konsolin
  // salalauseen vaihdon kesken. LATTIA, ei arvio laadusta — ks. passphrase.js.
  pass: {
    ok: 'Näyttää hyvältä ✓',
    tooShort: (min) =>
      `Käytä vähintään ${min} merkkiä. Tusina vaihtelevaa merkkiä riittää, ja neljä arkista sanaa — kuten ”meripihka traktori sametti kuu” — on helppo muistaa.`,
    common: 'Tämä on yksi maailman yleisimmistä salasanoista — hyökkääjä kokeilee sitä ensimmäisenä. Valitse jokin, jonka vain sinä keksisit.',
    digitsOnly: 'Pelkät numerot on helppo arvata. Lisää sanoja tai kirjaimia, tai tee siitä paljon pidempi.',
    repeats: 'Tämä toistuu liikaa ollakseen turvallinen — toistuva lohko on vain yhtä vahva kuin lohko itse, olipa se kuinka pitkä tahansa. Käytä vaihtelevampia merkkejä tai neljää arkista sanaa.',
  },

  // Vastaanotto-osoitteen luontisivu (/drops ja /fi/drops). Kieli valitaan osoitteesta, ei valitsinta.
  drops: {
    pageTitle: 'privsend — luo vastaanotto-osoite',
    createBtn: 'Luo vastaanotto-osoitteeni',
    creating: 'Luodaan…',
    chooseFirst: 'Valitse ensin salalause.',
    createFailed: 'Vastaanotto-osoitteen luominen ei onnistunut.',
    copyConsole: 'Kopioi salainen hallintalinkki',
    copyAddr: 'Kopioi julkinen vastaanotto-osoite',
    copyFailed: 'Kopiointi epäonnistui — valitse ja kopioi käsin',
    confirmUnsaved: 'Oletko tallentanut hallintalinkkisi? Ilman sitä et pääse takaisin sisään.',
  },

  // Vastaanottajan konsoli (/SECRET#token: inbox.html + inbox.js). VALITSINSIVU: yksi
  // SECRET-linkki luodaan kielineutraalina, eikä mitään tallenneta — joten kuten paljastussivu
  // se kantaa molempia kieliä yhdessä osoitteessa, näkyvän valitsimen ja selaimen kielen
  // aloitusarvauksena. Kiinteä teksti on HTML:ssä kahtena; tämä taulu on se, minkä skripti
  // KIRJOITTAA ajon aikana ja mikä on piirrettävä uudelleen kieltä vaihdettaessa.
  inbox: {
    pageTitle: 'privsend — vastaanottolaatikkosi',
    checkNew: 'Tarkista uudet viestit',
    unlockBtn: 'Avaa postilaatikko',
    passPlaceholder: 'Salalauseesi',
    saveSettings: 'Tallenna asetukset',
    saveChanges: 'Tallenna muutokset',
    saveRetention: 'Tallenna säilytysaika',
    changePass: 'Vaihda salalause',
    deleteAddr: 'Poista tämä osoite pysyvästi',
    curPassPh: 'Nykyinen salalause',
    newPassPh: 'Uusi salalause',
    newPass2Ph: 'Toista uusi salalause',
    days7: '7 vuorokautta',
    days14: '14 vuorokautta',
    days30: '30 vuorokautta',
    deleteBtn: 'Poista',
    emptyMsg: '(tyhjä viesti)',
    undecryptable: '[Tätä viestiä ei voitu purkaa.]',
    // Liitteet (v2-tiedostot). Dropin tiedostot EIVÄT ole kertakäyttöisiä: ne säilyvät
    // ladattavina, kunnes viesti poistetaan tai säilytysaika täyttyy.
    filesHeading: 'Liitteet',
    download: 'Lataa',
    downloading: 'Ladataan…',
    decrypting: 'Puretaan…',
    saved: 'Tallennettu ✓',
    fileGone: 'Tätä tiedostoa ei ole enää saatavilla.',
    downloadFailed: 'Lataus epäonnistui — yritä uudelleen.',
    fpUnavailable: '(ei saatavilla)',

    countEmpty: 'Postilaatikossasi ei ole vielä viestejä. Avaa se salalauseellasi.',
    countSome: (n) =>
      `Postilaatikossasi on yhteensä ${n} ${n === 1 ? 'viesti' : 'viestiä'}. ` +
      `Lue ${n === 1 ? 'se' : 'ne'} salalauseellasi.`,

    enterPass: 'Anna salalauseesi.',
    wrongPass: 'Väärä salalause.',

    // Epäonnistuneiden avausten tunkeutumisvaroitus. `others` ovat yrityksiä toisesta
    // istunnosta tai laitteesta — todellinen tunkeutumissignaali; `mine` ovat tämän välilehden
    // omia vääriä arvauksia, näytetään jotta aitoa "others"-lukua ei voi sekoittaa omaan
    // hapuiluun eikä päinvastoin.
    intrusionOthers: (others, mine) => {
      const o = others >= 999 ? '999+' : String(others);
      return `⚠️ Sen jälkeen kun viimeksi luit viestisi: ${o} ${others === 1 ? 'epäonnistunut salalauseyritys' : 'epäonnistunutta salalauseyritystä'} toisesta istunnosta tai laitteesta`
        + (mine > 0 ? `, sekä ${mine}, jotka teit juuri tässä` : '')
        + `. Jos nuo muut yritykset eivät olleet sinä, SECRET-linkkisi on voinut paljastua — harkitse alla olevaa ”Poista tämä osoite pysyvästi” ja jaa sitten uusi vastaanotto-osoite.`;
    },
    intrusionMineOnly: (mine) =>
      `Teit juuri ${mine} ${mine === 1 ? 'epäonnistuneen salalauseyrityksen' : 'epäonnistunutta salalauseyritystä'}, eikä muita yrityksiä ole tehty sen jälkeen kun viimeksi luit — ei syytä huoleen.`,

    settingsSaved: 'Asetukset tallennettu.',
    settingsSavedPending: 'Asetukset tallennettu. Lähettäjät näkevät ”viimeksi aktiivinen” -ajan, kun avaat ja luet postilaatikkosi.',
    settingsFailed: 'Asetusten tallentaminen ei onnistunut. Yritä uudelleen.',

    retentionSaved: (days) => `Tallennettu. Uudet viestit säilytetään ${days} vuorokautta.`,
    daysLegacy: (days) => `${days} vuorokautta (ei enää valittavissa)`,
    retentionFailed: 'Tallennus ei onnistunut. Yritä uudelleen.',

    passFill: 'Täytä nykyinen ja uusi salalause.',
    passMismatch: 'Uudet salalauseet eivät täsmää.',
    passWrongCur: 'Väärä nykyinen salalause.',
    passChanged: 'Salalause vaihdettu. Käytä uutta tästä lähtien.',
    passSaveFailed: 'Muutoksen tallentaminen ei onnistunut. Yritä uudelleen.',

    confirmDestroy: 'Poistetaanko tämä osoite ja kaikki sen viestit pysyvästi? Tätä ei voi perua.',
    destroyFailed: 'Osoitteen poistaminen ei onnistunut. Yritä uudelleen.',
  },

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

  ext: {
    running: '🔒 Toimii paikallisesti',
    explains:
      'Tämän sivun koodi — myös salaus — on selaimeesi asennettu kopio, jota ei ladata ' +
      'palvelimelta. privsend.appiin lähetetään vain salattua tietoa.',
    howVerified: 'Miten tämän voi varmistaa? →',
    build: (v) => 'Laajennuksen versio ' + v,
  },
};
