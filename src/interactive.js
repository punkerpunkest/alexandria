// WHAT PLAYS AT A BOUNDARY. One question, one answer: after this module, does the student
// get a sandbox, or a card set?
//
// ONE SCHEMA AND ONE CALL, and that is forced rather than tidy. The adapter fixes its
// schema at spawn (`--json-schema` is a CLI argument), so a schema per purpose means a
// PROCESS per purpose, and process startup is 4.5-13s — measured, `Alexandria - Harness`.
// The whole window this fills is 8-22s. Spawning to decide what fills the wait would cost
// more than the wait.
//
// So the picker, the engine's task parameters and the fallback card set are one schema
// filled in one turn by one long-lived generator.
//
// THE CARDS ARE ALWAYS GENERATED, even when an engine is chosen. That looks wasteful and
// is not: `Alexandria - Design` requires that the window is never empty and never spins,
// and an engine that is not warm must be REPLACED rather than waited for. Generating the
// substitute in the same breath as the choice is what makes that promise cheap to keep.
//
// THE KNOWN CEILING: every installed engine appears in this schema, which is exactly what
// `Alexandria - Discovery and Scale` says stops scaling — "putting the catalog in the
// model's context is how Find Skills works and exactly what stops working". At PoC size
// that IS exact matching rather than an approximation of it. `pickEngine` below is the
// seam a specificity-tree lookup replaces, and nothing outside this file names an engine.

import { buildTaskSchema } from './engine.js';
import { setSchema, cardTypeSchema, validateMicro } from './micro.js';

export const NO_ENGINE = 'none';

// Test fixtures are packages, and they must never be offered to a student. `hostile-probe`
// and `never-ready` exist to prove the boundary and the degrade; a matcher that could pick
// one has a hole in it. The convention is the subject, so the rule is one line and a new
// fixture cannot forget to opt out.
export const isTestEngine = (e) => String(e.subject ?? '').startsWith('_');
export const offerable = (engines) => engines.filter((e) => !isTestEngine(e));
export const SENTENCE_MAX = 140;

const taskKey = (id) => `task_${id}`;

// A single line per engine, folded into the enum's description — the same shape
// `describeSet` uses in `src/schema.js` for asset channels, because the schema IS part of
// the prompt. An engine's `pitch` is its matcher-facing sentence when it declares one.
//
// WITHOUT ONE THE FALLBACK IS THE TASK SPACE, not the name. It used to be name and subject,
// which is how `microscope` came to introduce itself as "Compound Microscope, for biology" —
// nine words that say what it IS and nothing about what it can ASK. Measured 29 Aug on the
// live loop: a module on how lenses magnify got cards, and the very next module, on the
// coarse and fine focus knobs, got the sandbox. The engine was equally able to pose a task
// about both; the only thing that differed was whether the module's wording happened to
// collide with the engine's name. Neither shipped engine declares a `pitch`, so every choice
// made so far was made on that line.
//
// The job lines are the right fallback because `validateEngine` already REQUIRES one per
// task kind, for this exact reason — "has no job line, so the model cannot be told what it
// is for". An engine that passes validation therefore cannot be unmatchable.
const ASKS = /^ask the student to /i;
const canPose = (e) => Object.values(e.taskSpace ?? {})
  // Trailing stops come off so the join does not produce ".; or".
  .map((k) => String(k?.job ?? '').replace(ASKS, '').trim().replace(/\.$/, ''))
  .filter(Boolean);

// WHAT IT CAN SHOW, not only what it can ask — and the job lines alone do not say.
//
// Measured 29 Aug on a real run: "what do onion cells look like below the microscope" wrote
// a module and then got cards, while `microscope` draws exactly that. Its `specimen` enum is
// `onion-epidermis`, and that parameter's own job calls it a field of brick-shaped plant
// cells with nuclei. The chooser never saw the word "onion", because a task kind's job line
// describes the PROCEDURE ("bring the slide into sharp focus") and the subject matter lives
// one level down in the parameters. An engine whose whole point is what it renders was
// introducing itself purely by what it makes you do.
//
// Enum values only. A text parameter has no vocabulary to advertise, and a number is not a
// noun a module can be about.
const VALUE_CAP = 8;
const varies = (e) => {
  const out = new Map();
  for (const kind of Object.values(e.taskSpace ?? {})) {
    for (const [name, p] of Object.entries(kind?.parameters ?? {})) {
      if (p?.kind !== 'enum' || !Array.isArray(p.values)) continue;
      const seen = out.get(name) ?? new Set();
      for (const v of p.values) seen.add(v);
      out.set(name, seen);                         // shared across kinds, so union not repeat
    }
  }
  return [...out].map(([name, vs]) => `${name} ${[...vs].slice(0, VALUE_CAP).join('/')}`);
};

const pitch = (e) => {
  if (e.pitch) return e.pitch;
  const can = canPose(e);
  // Name and subject stay in front — the model still needs to know what the thing is, it
  // just no longer has to GUESS what it can do from the name alone.
  if (!can.length) return `${e.name}, for ${e.subject}`;
  const v = varies(e);
  return `${e.name} (${e.subject}) — can pose: ${can.join('; or ')}`
    + (v.length ? `. Varies: ${v.join(', ')}` : '');
};

export function buildInteractiveSchema(engines) {
  const ids = engines.map((e) => e.id);
  const properties = {
    engine: {
      type: 'string',
      enum: [...ids, NO_ENGINE],
      description:
        'Which simulation fits the module just taught, or "none". Choose one ONLY if it can '
        + 'pose a task about this material; a simulation about something adjacent is worse than '
        + 'cards, because it costs the student minutes. Options: '
        // ONE LINE PER ENGINE. Joining with "; " put the same separator between engines as
        // `pitch` uses between an engine's own task kinds, so where one entry stopped and the
        // next began was ambiguous exactly where it mattered most.
        + engines.map((e) => `\n- ${e.id} = ${pitch(e)}`).join('')
        + `\n- ${NO_ENGINE} = nothing here fits, so write cards instead.`,
    },
    sentence: {
      type: 'string', maxLength: SENTENCE_MAX,
      description: 'One sentence telling the student what to do in the simulation, addressed to '
        + 'them. Alexandria says this, never the simulation, so it must stand alone. Leave it '
        + `empty when engine is "${NO_ENGINE}".`,
    },
    card_type: cardTypeSchema(),
    cards: setSchema(),
  };

  // One optional parameter object per engine. Only the chosen engine's is read, but all of
  // them have to exist in the schema, because the schema is fixed before the choice is made.
  for (const e of engines) {
    for (const kind of Object.keys(e.taskSpace)) {
      const s = buildTaskSchema(e, kind);
      properties[`${taskKey(e.id)}__${kind}`] = {
        ...s,
        description: `Parameters for ${e.id}, task kind "${kind}". ${e.taskSpace[kind].job} `
          + `Fill this in ONLY if you chose engine "${e.id}" and this kind.`,
      };
    }
  }

  return {
    type: 'object', additionalProperties: false, properties,
    // Cards are required unconditionally: they are the answer when no engine fits AND the
    // substitute when the chosen one is not warm.
    required: ['engine', 'card_type', 'cards'],
  };
}

export function buildInteractivePrompt(engines) {
  return [
    'You choose what a student does immediately after reading a short teaching module,',
    'while the next module is being written underneath them.',
    '',
    'ALWAYS write a card set. It is what plays when no simulation fits, and it is also the',
    'substitute if a chosen simulation is not ready in time. It is never wasted.',
    '',
    'Cards must be answerable from the module just read, and every wrong option must be a',
    'mistake a real student makes rather than a filler answer. Each option carries the',
    'response the student sees the moment they pick it, so write those now — nothing may be',
    'looked up later.',
    '',
    'Pick ONE kind of card for the whole set. A set is all flashcards or all multiple',
    'choice, never a mix — switching format mid-set makes the student re-learn the',
    'interaction instead of the material.',
    '',
    engines.length
      ? 'Choose a simulation only when it genuinely fits the material. Otherwise choose "none".'
      : 'No simulations are installed, so choose "none".',
  ].join('\n');
}

// The seam. Today the model's choice IS the lookup, because the catalog fits in the prompt.
// A specificity-tree walk replaces the BODY of this function and nothing else — no caller
// learns anything new. Keep it that way.
export function pickEngine(engines, chosen) {
  return engines.find((e) => e.id === chosen) ?? null;
}

// Normalise one generated answer into what the boundary actually plays. Nothing downstream
// touches the raw shape, so the `task_<id>__<kind>` encoding stays inside this file.
export function readInteractive(engines, out) {
  const cards = out?.cards ?? [];
  const cardType = out?.card_type;
  const engine = pickEngine(engines, out?.engine);
  if (!engine) return { producer: 'micro', set: cards, cardType };

  const kind = Object.keys(engine.taskSpace)
    .find((k) => out[`${taskKey(engine.id)}__${k}`] != null);
  if (!kind) return { producer: 'micro', set: cards, cardType };  // chose an engine, gave it nothing

  return {
    producer: 'sandbox',
    engine,
    task: { kind, params: out[`${taskKey(engine.id)}__${kind}`], sentence: out.sentence ?? '' },
    // Carried, not discarded: this is what the arena degrades TO when the engine is cold.
    set: cards,
    cardType,
  };
}

export function validateInteractive(engines, out) {
  // Key ORDER is part of the comparison the fixture makes, so it is fixed here rather than
  // left to however the spread happened to land. Set-scope failures pass through untouched.
  const failures = validateMicro(out?.cards, out?.card_type).map((f) =>
    f.scope ? f : { scope: 'cards', card: f.card, reason: f.reason });
  const engine = pickEngine(engines, out?.engine);

  if (out?.engine !== NO_ENGINE && !engine) {
    failures.push({ scope: 'engine', reason: `"${out?.engine}" is not an installed engine` });
    return failures;
  }
  if (!engine) return failures;

  const kinds = Object.keys(engine.taskSpace);
  const filled = kinds.filter((k) => out[`${taskKey(engine.id)}__${k}`] != null);
  if (filled.length === 0) {
    failures.push({ scope: 'engine', reason: `chose "${engine.id}" but filled in no task parameters for it` });
  }
  if (filled.length > 1) {
    failures.push({ scope: 'engine', reason: `filled parameters for ${filled.length} task kinds; exactly one is played` });
  }
  // The sentence is Alexandria's to say. An engine that could shape it would be a tenant
  // renegotiating the one thing the chrome owns about the mount.
  if (!out?.sentence?.trim()) {
    failures.push({ scope: 'engine', reason: `chose "${engine.id}" but wrote no sentence for the student` });
  }
  // Parameters for an engine that was NOT chosen are a sign the model hedged, and playing
  // one of them would mount something nobody selected.
  for (const other of engines.filter((e) => e.id !== engine.id)) {
    for (const k of Object.keys(other.taskSpace)) {
      if (out[`${taskKey(other.id)}__${k}`] != null) {
        failures.push({ scope: 'engine', reason: `filled parameters for "${other.id}", which was not chosen` });
      }
    }
  }
  return failures;
}
