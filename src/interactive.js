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
import { setSchema, validateMicro } from './micro.js';

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
// the prompt. An engine's `pitch` is its matcher-facing sentence; without one it falls
// back to name and subject rather than being silently unmatchable.
const pitch = (e) => e.pitch ?? `${e.name}, for ${e.subject}`;

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
        + engines.map((e) => `${e.id} = ${pitch(e)}`).join('; ')
        + `; ${NO_ENGINE} = nothing here fits, so write cards instead.`,
    },
    sentence: {
      type: 'string', maxLength: SENTENCE_MAX,
      description: 'One sentence telling the student what to do in the simulation, addressed to '
        + 'them. Alexandria says this, never the simulation, so it must stand alone. Leave it '
        + `empty when engine is "${NO_ENGINE}".`,
    },
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
    required: ['engine', 'cards'],
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
  const engine = pickEngine(engines, out?.engine);
  if (!engine) return { producer: 'micro', set: cards };

  const kind = Object.keys(engine.taskSpace)
    .find((k) => out[`${taskKey(engine.id)}__${k}`] != null);
  if (!kind) return { producer: 'micro', set: cards };   // chose an engine, gave it nothing

  return {
    producer: 'sandbox',
    engine,
    task: { kind, params: out[`${taskKey(engine.id)}__${kind}`], sentence: out.sentence ?? '' },
    // Carried, not discarded: this is what the arena degrades TO when the engine is cold.
    set: cards,
  };
}

export function validateInteractive(engines, out) {
  // Key ORDER is part of the comparison the fixture makes, so it is fixed here rather than
  // left to however the spread happened to land. Set-scope failures pass through untouched.
  const failures = validateMicro(out?.cards).map((f) =>
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
