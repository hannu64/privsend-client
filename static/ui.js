// SPDX-FileCopyrightText: 2026 Zumitomi Oy
// SPDX-License-Identifier: AGPL-3.0-only

// Attach a show/hide (eye) toggle to a password field.
//
// This is not cosmetic. A passphrase typed blind is a passphrase typed wrong --
// and for the SENDER, a typo is unrecoverable: nobody, including us, can ever
// decrypt that secret again. For the RECIPIENT, being unable to see what they
// typed made correcting a mistake needlessly hard.
export function attachReveal(input) {
  const wrap = document.createElement('div');
  wrap.className = 'pw-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-toggle';
  btn.setAttribute('aria-label', 'Show passphrase');
  btn.textContent = '👁';
  wrap.appendChild(btn);

  btn.addEventListener('click', () => {
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.textContent = showing ? '👁' : '🙈';
    btn.setAttribute('aria-label', showing ? 'Show passphrase' : 'Hide passphrase');
    input.focus();
  });
  return btn;
}

// Group an integer with thin spaces: 6499628 -> "6 499 628".
//
// U+202F NARROW NO-BREAK SPACE rather than a plain space: it is the SI (and
// Finnish) convention for digit grouping, and being no-break it cannot wrap a
// number across two lines -- which is how "6 499" becomes a lonely "6" at the end
// of one line and "499" at the start of the next.
function group(s) {
  const [whole, frac] = String(s).split('.');
  const spaced = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${spaced}.${frac}` : spaced;
}

// Human-readable byte size.
//
// This used to stop at KB, which was fine when the largest thing in the product
// was 256 KB of text. With 25 MB files it produced "6499628 KB": a number nobody
// can read at a glance, compared against a limit written in the same unhelpful
// unit. Scale to whichever unit makes the number small, and group the digits.
export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${group(kb.toFixed(kb < 10 ? 1 : 0))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${group(mb.toFixed(mb < 10 ? 1 : 0))} MB`;
  return `${group((mb / 1024).toFixed(1))} GB`;
}

// Put a button into a busy state.
//
// Built from DOM nodes rather than an innerHTML string. The strings here are
// static and therefore harmless today -- but this codebase's rule is that
// innerHTML is never used, and a rule with an exception is a rule an auditor has
// to reason about. `grep -r innerHTML client/` returning nothing is a property
// someone can verify in one second.
export function setBusy(btn, label) {
  btn.replaceChildren();
  const sp = document.createElement('span');
  sp.className = 'spinner';
  btn.append(sp, document.createTextNode(label));
}
