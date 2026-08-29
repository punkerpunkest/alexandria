// MICRO INTERACTIVES — the card sets that fill the latency window at nearly every
// boundary. First-party and pre-installed, so unlike an engine there is no manifest, no
// download and no third-party code: the SHAPE is fixed here and only the CONTENT is
// generated. That is the whole reason micro is the floor and can never fail to arrive.
//
// A SET is the unit and a CARD is one item in it, so "weight" is how many cards the set
// holds — which is what makes weight a scheduling parameter rather than a difficulty one.
// See `Alexandria - Interactives`.
//
// THE HARD RULE THIS FILE EXISTS TO ENFORCE: nothing inside a micro interactive waits.
// No model round trip may happen between the student answering and the screen responding —
// not for scoring, not for feedback, not for a hint. So the set arrives COMPLETE: every
// prompt, every key, and one banked response per outcome, all written when the set was
// written. Everything below is shaped to make that structurally true rather than a
// discipline someone remembers.

export const CARD_TYPES = ['multiple-choice', 'flashcard'];

// Caps are ENFORCED by the structured-output layer, not steered — a cap set below what the
// model needs fails generation outright rather than returning something shorter. These are
// sized above what a card actually needs for exactly that reason. See `Alexandria - Harness`.
export const CAPS = { front: 200, option: 90, response: 180, back: 260 };
export const SET = { min: 2, max: 5, options: { min: 2, max: 4 } };

// The card fragment of the generated schema. Type-specific fields are OPTIONAL in the
// shape and REQUIRED by `validateMicro` per type, because JSON Schema cannot express
// "these four fields iff type is multiple-choice" in a form the structured-output layer
// reliably honours, and a `oneOf` that is quietly ignored is worse than a semantic check
// that is not.
export function cardSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['front'],
    properties: {
      front: {
        type: 'string', maxLength: CAPS.front,
        description: 'The question, for multiple-choice; the cue to recall from, for a flashcard. '
          + 'It must be answerable from the module the student just read.',
      },
      options: {
        type: 'array',
        minItems: SET.options.min, maxItems: SET.options.max,
        description: 'multiple-choice only. Exactly one option is correct. Every wrong option '
          + 'must be a mistake a real student actually makes here, never a filler answer.',
        items: {
          type: 'object', additionalProperties: false, required: ['text', 'response'],
          properties: {
            text: { type: 'string', maxLength: CAPS.option, description: 'The option as the student reads it.' },
            // THE MISCONCEPTION PAYLOAD, and the reason options are objects rather than
            // strings. A response written per option can name the specific wrong turn that
            // option represents; one shared "that is wrong" cannot. It is banked now
            // because showing it later must cost no round trip.
            response: {
              type: 'string', maxLength: CAPS.response,
              description: 'What the student is told the moment they pick THIS option. For a wrong '
                + 'option, name the specific misunderstanding that leads to it. For the correct one, '
                + 'say briefly why it is right. Never say "correct" or "incorrect" alone.',
            },
          },
        },
      },
      answer: {
        type: 'integer', minimum: 0, maximum: SET.options.max - 1,
        description: 'multiple-choice only. The index of the correct option in `options`.',
      },
      back: {
        type: 'string', maxLength: CAPS.back,
        description: 'flashcard only. The answer the student is checking themselves against.',
      },
    },
  };
}

// ONE KIND PER SET, declared once beside the cards rather than once per card. A schema
// cannot say "every item carries the same enum value", so a per-card `type` could only ever
// be a request the model was free to ignore, repaired after the fact. Lifting it to the set
// makes a mixed set unrepresentable, and the runtime stamps each card from it.
export function cardTypeSchema() {
  return {
    type: 'string',
    enum: CARD_TYPES,
    description: 'What kind of card this whole set is; every card in it is this kind. '
      + 'multiple-choice asks the student to commit to one of several answers. flashcard '
      + 'asks them to recall the answer themselves and then rate how well they did. Choose '
      + 'flashcard when the material is worth generating from memory, multiple-choice when '
      + 'the interesting part is the wrong turns a student takes.',
  };
}

export function setSchema() {
  return {
    type: 'array', minItems: SET.min, maxItems: SET.max, items: cardSchema(),
    description: 'A set of cards on the module just taught. It plays while the next module is '
      + 'being written, so it has to be worth real seconds without being homework.',
  };
}

// Semantic validation. The schema guarantees SHAPE; this checks MEANING — everything the
// schema cannot express or does not enforce. Same failure shape as `src/validate.js`:
// named, never silent, one entry per broken rule.
export function validateMicro(cards, cardType) {
  const failures = [];
  if (!Array.isArray(cards) || cards.length === 0) {
    return [{ scope: 'set', reason: 'no cards returned' }];
  }

  if (!CARD_TYPES.includes(cardType)) {
    return [{ scope: 'set', reason: `card type "${cardType}" is not one of ${CARD_TYPES.join(', ')}` }];
  }

  cards.forEach((c, i) => {
    if (cardType === 'multiple-choice') {
      const n = c.options?.length ?? 0;
      if (n < SET.options.min) {
        failures.push({ card: i, reason: `multiple-choice needs at least ${SET.options.min} options, got ${n}` });
      }
      // An answer index outside the options is the failure that would silently mark every
      // student wrong forever, so it is checked against the ACTUAL length rather than the cap.
      if (!Number.isInteger(c.answer) || c.answer < 0 || c.answer >= n) {
        failures.push({ card: i, reason: `answer ${c.answer} is not an index into ${n} option(s)` });
      }
      (c.options ?? []).forEach((o, j) => {
        if (!o?.response?.trim()) {
          failures.push({ card: i, reason: `option ${j} has no banked response, so answering it would need a round trip` });
        }
      });
      if (c.back != null) failures.push({ card: i, reason: 'multiple-choice must not carry a flashcard back' });
    } else {
      if (!c.back?.trim()) failures.push({ card: i, reason: 'flashcard has no back, so there is nothing to check against' });
      if (c.options != null) failures.push({ card: i, reason: 'flashcard must not carry multiple-choice options' });
      if (c.answer != null) failures.push({ card: i, reason: 'flashcard must not carry an answer index' });
    }
    if (!c.front?.trim()) failures.push({ card: i, reason: 'front is empty' });
  });
  return failures;
}

// WHETHER THE SET COVERS THE WAIT is the whole measurable claim, so it gets a number rather
// than a feeling. Reading is charged at the same 200 wpm `readingTimeMs` uses, plus a flat
// think-and-commit cost per card: choosing between options and recalling an answer are acts
// that take time no word count predicts.
export const THINK_MS = { 'multiple-choice': 6000, flashcard: 9000 };

export function answeringTimeMs(cards, cardType) {
  const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.round(cards.reduce((ms, c) => {
    const opts = c.options ?? [];
    // A student reads EVERY option and exactly ONE response — the one they picked. Charging
    // for all four responses overstated a three-card set at 94s against a 20-40s target,
    // which is the wrong direction to be wrong in: it would have claimed the window was
    // covered when it was not. The mean response stands in for the one they land on.
    const responseWords = opts.length
      ? opts.reduce((n, o) => n + words(o.response), 0) / opts.length : 0;
    const text = words(c.front) + words(c.back)
      + opts.reduce((n, o) => n + words(o.text), 0) + responseWords;
    return ms + (text / 200) * 60 * 1000 + (THINK_MS[cardType] ?? 0);
  }, 0));
}

// The result of one card, in the shape the ledger reads. `producer` is stamped here for the
// same reason the arena stamps it: one shape, two producers, and neither may claim to be
// the other. `notes` is empty by construction — no agent is present when a micro answer
// lands, so there is nobody to observe which rule was broken.
export function shapeCardResult({ card, cardType, index, chosen, selfRating, timeOnTaskMs }) {
  const correct = cardType === 'multiple-choice' ? chosen === card.answer : null;
  return {
    producer: 'micro',
    card: { index, type: cardType },
    scored: cardType === 'multiple-choice',
    time_on_task_ms: Math.max(0, Math.round(timeOnTaskMs)),
    attempt: cardType === 'multiple-choice' ? { chosen } : { revealed: true },
    correctness: correct,
    // Flashcard self-rating only, per the contract: a student's own read on whether they
    // knew it is the only confidence signal micro has.
    confidence: cardType === 'flashcard' && typeof selfRating === 'number' ? selfRating : null,
    notes: null,
  };
}
