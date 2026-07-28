// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Passphrase strength gate for Drops.
//
// A Drop's passphrase is the ONE thing standing between a stranger and the inbox if the
// SECRET console link is ever exposed: the wrapped private key can be fetched with the link
// alone and then attacked OFFLINE, as fast as the attacker's hardware allows. PBKDF2 buys
// time, but only a high-entropy passphrase makes that attack hopeless -- and there is no
// recovery and no server-side rate limit that can help once the blob is in someone's hands.
// So we hard-block the weak ones at the source, where they are chosen.
//
// This is deliberately a small, grep-able check, not a full entropy estimator (no zxcvbn --
// the client stays tiny and auditable). It enforces real length and rejects the obvious junk;
// the copy steers people to the easy strong answer, four everyday words.

const MIN_LEN = 12;

// The usual suspects -- the passwords that top every breach corpus. Matched against the
// passphrase with spaces removed AND against its letters-only core, so "Password1234" and
// "p a s s w o r d" are caught as readily as "password".
const COMMON = new Set([
  'password', 'passphrase', 'passw0rd', 'letmein', 'welcome', 'admin', 'iloveyou',
  'qwerty', 'qwertyuiop', 'azerty', 'dragon', 'monkey', 'football', 'baseball',
  'sunshine', 'princess', 'superman', 'trustno1', 'whatever', 'starwars',
  '123456', '1234567', '12345678', '123456789', '1234567890', '12345',
  '111111', '000000', '123123', '654321', 'abc123', 'qwerty123',
]);

// True if the whole string is one short block repeated to fill it (case-insensitive):
// "aaaa", "abab", "k7e3m8k7e3m8", "K7e3m8k7e3m8k7e3m8k7e3m8". Such a passphrase is only as
// strong as the block, no matter how long -- the classic "looks random but isn't" trap.
function isRepeatedBlock(s) {
  const t = s.toLowerCase();
  const n = t.length;
  for (let L = 1; L <= (n >> 1); L++) {
    if (n % L === 0 && t.slice(0, L).repeat(n / L) === t) return true;
  }
  return false;
}

// Returns null if the passphrase clears the bar, or a human explanation of why not.
//
// The bar is deliberately a FLOOR, not a verdict on quality: accept anything of real length
// that is not one of a few genuinely-weak shapes. We do NOT require spaces or words -- a
// dozen varied characters with no obvious pattern is fine on its own. What we still refuse:
// too short, the world's most common passwords, digits-only under 16 (a small targeted
// space), and blatant repetition -- because a repeated block is only as strong as the block,
// however long it is, which is the one "feels strong but isn't" case worth catching.
export function passphraseProblem(pass) {
  if (pass.length < MIN_LEN) {
    return `Use at least ${MIN_LEN} characters. A dozen varied characters is fine, and four everyday words — like “amber tractor velvet moon” — is easy to remember.`;
  }
  const stripped = pass.toLowerCase().replace(/\s+/g, '');
  const core = pass.toLowerCase().replace(/[^a-z]/g, '');
  if (COMMON.has(stripped) || (core.length >= 4 && COMMON.has(core))) {
    return 'That is one of the most common passwords in the world — an attacker tries it first. Choose something only you would think of.';
  }
  if (/^\d+$/.test(pass) && pass.length < 16) {
    return 'Digits alone are easy to guess. Add words or letters, or make it much longer.';
  }
  // The one "looks strong but isn't" case we still block: a repeated block (or so few distinct
  // characters it amounts to one) carries only the entropy of the little that it repeats.
  if (isRepeatedBlock(pass) || new Set(pass).size < 5) {
    return 'That repeats too much to be safe — a repeated block is only as strong as the block itself, however long you make it. Use more varied characters, or four everyday words.';
  }
  return null;
}
