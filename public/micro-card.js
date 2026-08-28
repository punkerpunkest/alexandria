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

import { shapeCardResult } from '/src/micro.js';

// The component ships complete. `public/index.html` belongs to the chrome, and a surface
// that only renders when someone else remembers to link its stylesheet is not a component.
if (!document.querySelector('link[data-micro-card]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = '/micro-card.css'; link.dataset.microCard = '';
  document.head.append(link);
}

const PALETTE = {
  '--mc-bg': '#1f2335', '--mc-surface': '#24283b', '--mc-border': '#3b4261',
  '--mc-text': '#c0caf5', '--mc-dim': '#a9b1d6', '--mc-muted': '#565f89',
  '--mc-accent': '#7aa2f7', '--mc-ok': '#9ece6a', '--mc-warn': '#e0af68', '--mc-bad': '#f7768e',
};

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
 * the ledger owe an item.
 */
export function playSet(host, { cards, banked = false, onCard = () => {}, onDone = () => {} }) {
  const root = el('div', 'mcard');
  for (const [k, v] of Object.entries(PALETTE)) root.style.setProperty(k, v);

  const head = el('div', 'mcard-head');
  const count = el('span', 'mcard-count');
  const skip = el('button', 'mcard-skip', 'Skip');
  head.append(count, skip);

  const body = el('div', 'mcard-body');
  const foot = el('div', 'mcard-foot');
  root.append(head, body, foot);
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
    count.textContent = `${i + 1} of ${cards.length}`;
    body.replaceChildren();
    foot.replaceChildren();
    body.append(el('p', 'mcard-front', card.front));
    if (card.type === 'multiple-choice') drawChoice(card);
    else drawFlashcard(card);
  }

  function drawChoice(card) {
    const list = el('div', 'mcard-options');
    card.options.forEach((opt, j) => {
      const b = el('button', 'mcard-option', opt.text);
      b.addEventListener('click', () => {
        // Everything from here is local. The response was banked with the card.
        const right = j === card.answer;
        for (const other of list.querySelectorAll('.mcard-option')) other.disabled = true;
        b.classList.add(right ? 'is-right' : 'is-wrong');
        if (!right) list.children[card.answer]?.classList.add('is-key');
        foot.append(el('p', `mcard-response ${right ? 'is-right' : 'is-wrong'}`, opt.response));
        foot.append(nextButton());
        onCard(shapeCardResult({ card, index: i, chosen: j, timeOnTaskMs: performance.now() - shownAt }));
      });
      list.append(b);
    });
    body.append(list);
  }

  function drawFlashcard(card) {
    const reveal = el('button', 'mcard-primary', 'Show the answer');
    reveal.addEventListener('click', () => {
      foot.replaceChildren();
      body.append(el('p', 'mcard-back', card.back));
      reveal.remove();
      // Self-rating is the ONLY confidence signal micro has, and it is flashcard-only —
      // a multiple-choice answer is graded, so asking how sure they were adds nothing the
      // key does not already say.
      const rate = el('div', 'mcard-rate');
      for (const [label, value] of [['I knew it', 1], ['Not quite', 0.5], ['No idea', 0]]) {
        const b = el('button', 'mcard-option', label);
        b.addEventListener('click', () => {
          onCard(shapeCardResult({ card, index: i, selfRating: value, timeOnTaskMs: performance.now() - shownAt }));
          advance();
        });
        rate.append(b);
      }
      foot.append(rate);
    });
    body.append(reveal);
  }

  function nextButton() {
    const b = el('button', 'mcard-primary', i === cards.length - 1 ? 'Done' : 'Next');
    // The bank becoming visible, the same single control the arena uses: same position,
    // same size, only the weight changes when what comes next is already written.
    if (banked) b.classList.add('is-banked');
    b.addEventListener('click', advance);
    return b;
  }

  draw();
  return {
    el: root,
    setBanked(v) { banked = v; foot.querySelector('.mcard-primary')?.classList.toggle('is-banked', v); },
    destroy() { done = true; root.remove(); },
  };
}
