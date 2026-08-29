// THE UNSKINNED MICRO CARD — Alexandria's own surface, and the PoC's normal case.
//
// Settled 27 Aug: Alexandria supplies the card (the type, the content, the key, the
// behaviour); a world MAY supply a skin and may equally supply none. So unskinned is the
// default, and the earlier "renders through the projector, inside the world" described only
// the skinned path. See `Alexandria - Glossary`.
//
// IT CARRIES ITS OWN COPY OF THE PALETTE, scoped to the card, and that is not a style
// preference. Custom properties are INHERITED and inheritance crosses a shadow boundary —
// verified in headless Chromium by another session — so a card that relied on `var()`
// fallbacks would silently resolve the chrome's `:root` values instead. Reading the chrome's
// tokens by inheritance is the same mechanism that leaks the chrome into every world.
//
// NOTHING HERE WAITS. Every response the student can see is already in the card, written
// when the set was written, so answering costs no round trip. There is no fetch in this
// file and there must never be one.
//
// BUILT AGAINST THE BOARDS, which is new — the first version of this file was written from
// the design note's prose without opening Figma, and did not match. File
// `jyAPEoZea6zdiSj9IGdIOF`, page `6:27 Anatomy`: `61:2` / `61:49` / `61:103` are multiple
// choice asked / correct / wrong, `62:2` / `62:36` are flashcard cue / revealed. The
// geometry lives in `micro-card.css`; what is here is the structure those boards imply.

import { shapeCardResult } from '/src/micro.js';

// The component ships complete. `public/index.html` belongs to the chrome, and a surface
// that only renders when someone else remembers to link its stylesheet is not a component.
if (!document.querySelector('link[data-micro-card]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/micro-card.css'; link.dataset.microCard = '';
  document.head.append(link);
}

// Tokyo Night Storm, read off the boards' own variables rather than transcribed by eye:
// `get_variable_defs` on `61:103` and `62:2`. `--mc-warn` is the one value not bound to a
// board variable — the Shaky dot is drawn as a raw fill — so it is the standard Storm yellow.
const PALETTE = {
  '--mc-bg-darker': '#1a1b26', '--mc-bg-dark': '#1f2335', '--mc-bg': '#24283b',
  '--mc-bg-hi': '#292e42', '--mc-border': '#3b4261',
  '--mc-text': '#c0caf5', '--mc-dim': '#a9b1d6', '--mc-muted': '#565f89',
  '--mc-accent': '#7aa2f7', '--mc-ok': '#9ece6a', '--mc-warn': '#e0af68', '--mc-bad': '#f7768e',
  '--mc-white': '#ffffff',
};

// Board order, and it runs worst-to-best left to right so the safe answer is not the nearest
// one to the hand. Values are what `shapeCardResult` records as confidence.
const RATINGS = [['Missed', 'is-bad', 0], ['Shaky', 'is-warn', 0.5], ['Knew it', 'is-ok', 1]];
const KEYS = 'abcdefghij';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * Play a set over a host element. Returns a handle; the caller owns teardown.
 *
 * `onCard` fires once per answered card with the ledger payload. `onDone` fires when the
 * set is exhausted or skipped — `skipped` says which, because a skipped set is what makes
 * the ledger owe an item. `kind` is the word in the header: RECALL for a set generated at
 * this boundary, RETURNING for an owed item coming back (board `80:2`).
 */
export function playSet(host, { cards, cardType, kind = 'RECALL', banked = false, onCard = () => {}, onDone = () => {} }) {
  const root = el('div', 'mcard');
  root.dataset.type = cardType;
  for (const [k, v] of Object.entries(PALETTE)) root.style.setProperty(k, v);

  const head = el('div', 'mcard-head');
  const count = el('span', 'mcard-count');
  const skip = el('button', 'mcard-skip', 'Skip');
  const right = el('div', 'mcard-head-right');
  right.append(count, skip);
  head.append(el('span', 'mcard-kind', kind), right);

  const body = el('div', 'mcard-body');
  root.append(head, body);
  host.append(root);

  let i = 0;
  let shownAt = performance.now();
  let done = false;

  const finish = (skipped) => {
    if (done) return;
    done = true;
    root.remove();
    onDone({ skipped, answered: i });
  };

  // Always available and never blocked, exactly as in the arena. A student who wants out
  // gets out; the cost is an owed item, not a locked door.
  skip.addEventListener('click', () => finish(true));

  function advance() {
    i++;
    if (i >= cards.length) return finish(false);
    shownAt = performance.now();
    draw();
  }

  function draw() {
    const card = cards[i];
    // Board format, spaces included: "2 / 4".
    count.textContent = `${i + 1} / ${cards.length}`;
    body.replaceChildren();
    if (cardType === 'multiple-choice') drawChoice(card);
    else drawFlashcard(card);
  }

  function drawChoice(card) {
    const wrap = el('div', 'mcard-mc');
    const list = el('div', 'mcard-options');
    wrap.append(el('p', 'mcard-question', card.front), list);

    card.options.forEach((opt, j) => {
      const b = el('button', 'mcard-option');
      b.append(el('span', 'mcard-key', KEYS[j]), el('span', 'mcard-option-text', opt.text), el('span', 'mcard-flag'));
      b.addEventListener('click', () => {
        // Everything from here is local. The response was banked with the card.
        const correct = j === card.answer;
        for (const other of list.children) other.disabled = true;

        // BOTH rows get marked when they miss it. The key row always turns green and says so;
        // a wrong choice additionally turns red and is named. Boards 61:49 and 61:103.
        const key = list.children[card.answer];
        key?.classList.add('is-correct');
        if (key) key.querySelector('.mcard-flag').textContent = 'correct';
        if (!correct) {
          b.classList.add('is-chosen-wrong');
          b.querySelector('.mcard-flag').textContent = 'you chose this';
        }

        wrap.append(el('p', `mcard-response ${correct ? 'is-right' : 'is-wrong'}`, opt.response), nextButton());
        onCard(shapeCardResult({ card, cardType, index: i, chosen: j, timeOnTaskMs: performance.now() - shownAt }));
      });
      list.append(b);
    });
    body.append(wrap);
  }

  function drawFlashcard(card) {
    const wrap = el('div', 'mcard-fc');
    const deck = el('div', 'mcard-deck');
    const face = el('button', 'mcard-face is-current');
    face.dataset.reveal = '';
    // The neighbours exist to say a deck exists. They are never filled and never focusable.
    deck.append(el('div', 'mcard-face is-peek'), face, el('div', 'mcard-face is-peek'));
    wrap.append(deck);

    face.append(el('span', 'mcard-term', card.front), el('span', 'mcard-hint', 'Click to reveal'));
    // The whole face is the target — the board's affordance is "Click to reveal", not a
    // button under the card. `once` because a second reveal would re-enter with a stale card.
    face.addEventListener('click', () => {
      delete face.dataset.reveal;
      face.replaceChildren(el('span', 'mcard-term-small', card.front), el('p', 'mcard-back', card.back));

      // Self-rating is the ONLY confidence signal micro has, and it is flashcard-only — a
      // multiple-choice answer is graded, so asking how sure they were adds nothing the key
      // does not already say. It sits OUTSIDE the white card: rating is the student talking
      // to Alexandria, not part of the card's content.
      const rate = el('div', 'mcard-rate');
      for (const [label, tone, value] of RATINGS) {
        const b = el('button', 'mcard-rate-btn');
        b.append(el('span', `mcard-dot ${tone}`), el('span', null, label));
        b.addEventListener('click', () => {
          onCard(shapeCardResult({ card, cardType, index: i, selfRating: value, timeOnTaskMs: performance.now() - shownAt }));
          advance();
        });
        rate.append(b);
      }
      wrap.append(rate);
    }, { once: true });

    body.append(wrap);
  }

  function nextButton() {
    // The board draws only the mid-set case. "Done" on the last card is the one label added
    // beyond it, because "Next card" followed by the set ending is a small lie.
    return Object.assign(el('button', 'mcard-next', i === cards.length - 1 ? 'Done' : 'Next card'), {
      onclick: advance,
    });
  }

  draw();
  return {
    el: root,
    // Kept so the handle matches the arena's, but the card no longer changes on it. The
    // filled-once-the-module-lands treatment is the ARENA's rule — its exit relabels to
    // `Continue` — and the boards draw this button filled unconditionally.
    setBanked(v) { banked = v; },
    destroy() { done = true; root.remove(); },
  };
}
