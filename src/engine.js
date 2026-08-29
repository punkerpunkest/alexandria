// THE ENGINE CONTRACT. An engine is community code that ships a simulation. Alexandria
// generates the task, the arena hosts the engine behind an iframe, and the engine hands
// back what the student did. This file is the only place an engine manifest is read, an
// engine URL is built, or an engine's return payload is shaped.
//
// It mirrors `src/assets.js` deliberately, and for the same reason: the Node side imports
// it to check a package on disk, the arena imports it in the browser to mount and receive,
// so the check and the use cannot drift apart. Everything that will later change about
// where an engine lives — a versioned `<id>/<version>/` install path, a custom protocol
// bound to the packages root — changes HERE.
//
// Design in `Alexandria - Design`, "The arena". Why the return channel is the whole point,
// in `Alexandria - Interactives`.

export const PROTOCOL = 1;

// THE ENTIRE MESSAGE VOCABULARY, both directions. Four messages, and each is forced
// rather than chosen:
//
//   ready    the host cannot know when the engine's listener is attached, so the ENGINE
//            speaks first and the host answers. Sending the task on iframe `load` races
//            the engine's own <script> and loses on a cold cache.
//   task     the host's answer to `ready`. Parameters Alexandria generated, never a lesson.
//   state    a partial result, pushed whenever something worth recording happens. See below.
//   complete the engine reports the task was finished. Scored engines only.
//   error    the engine cannot run the task it was handed. The arena degrades instead of
//            sitting on a dead frame, because nothing in the arena may spin.
//
// `state` is the one that looks optional and is not. The exit control is always available,
// so a student may leave mid-task at any moment — and the student who gives up is exactly
// the one whose `notes` matter most, because that field names WHICH RULE their attempts
// kept breaking. Without a pushed partial the arena would have nothing but a clock for
// them. The alternative was asking the engine for a result on the way out, which would put
// a wait inside an exit the design says is never blocked.
//
// An engine hardcodes these strings; it cannot import this file, since it is third-party
// code in an opaque origin. That is why the list is short enough to write down.
export const MSG = {
  ready: 'alexandria:ready',
  task: 'alexandria:task',
  state: 'alexandria:state',
  complete: 'alexandria:complete',
  error: 'alexandria:error',
};

// THE SANDBOX FLAGS. `allow-scripts` and nothing else, and the omission that matters is
// `allow-same-origin`: with both set together the frame can reach out of the sandbox and
// the boundary is decorative. Without it the frame gets an OPAQUE ORIGIN, which has three
// consequences the arena is built around:
//
//   1. `event.origin` on every message from it is the string "null", so origin checks are
//      worthless. Identity is established by `event.source === frame.contentWindow`.
//   2. No cookies, no localStorage, no same-origin fetch back into Alexandria's own API.
//   3. CSP `'self'` matches nothing inside it, so the served CSP names what it blocks
//      rather than what it allows. See `engineCsp` below.
export const SANDBOX_FLAGS = 'allow-scripts';

// Blocks EGRESS, not the engine's own files. `connect-src 'none'` kills fetch, XHR,
// WebSocket and EventSource; the img/media/font lines stop the cheaper trick of
// exfiltrating through a URL on an element. Directives left unset stay permissive on
// purpose, because an engine must be able to load the scripts and styles it shipped, and
// `'self'` cannot express that from an opaque origin.
//
// This is the network half of "no ambient network access" from `Alexandria - Interactives`.
// The DOM half is the sandbox attribute above. Neither is sufficient alone.
export const ENGINE_CSP = [
  "connect-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

// Caps on anything crossing the boundary inwards. A hostile engine's cheapest attack is
// not code execution, it is VOLUME: postMessage uses structured clone, so it will happily
// carry a cyclic graph or a megabyte of prose straight into the agent's context. The depth
// cap is what breaks cycles; the rest bound cost.
export const CAPS = { depth: 6, keys: 32, items: 64, string: 600, notes: 600 };

const REVIEWS = ['unreviewed', 'community', 'verified'];
const REQUIRED = ['id', 'name', 'version', 'author', 'review', 'entry', 'subject', 'scored', 'taskSpace'];

// The package root an engine's files are served from. Callers never join this themselves,
// and `registry.md` invariant 6 is a grep on exactly that: this is the ONLY place an engine
// URL is constructed, so "no engine URL names a remote origin" is checkable rather than
// claimed. Alexandria downloads a package and serves the bytes from its own server; the
// browser never fetches from the registry.
//
// `_base` IS RUNTIME-ASSIGNED, by whatever enumerated the package. A bundled engine keeps
// the one-level path it has always had; an INSTALLED one carries `/packages/engines/<id>/
// <version>`, which is the versioned immutable directory `Alexandria - Storage` settles on.
// Putting the version in the value rather than deriving it here is what keeps two versions
// able to sit side by side without this function needing to know which session pinned which.
export function enginePackageBase(engine) {
  return engine._base ?? `/engines/${engine.id}`;
}

export function entryUrl(engine) {
  return `${enginePackageBase(engine)}/${engine.entry}`;
}

// CONTAINMENT, the same invariant worlds have: every path an engine declares resolves
// inside its own package. Checked as a string rule rather than by resolving on disk,
// because it has to hold in the browser too.
function escapes(p) {
  return typeof p !== 'string' || !p || p.startsWith('/') || p.includes('..') || /^[a-z][a-z0-9+.-]*:/i.test(p);
}

// Named, never silent — every failure says which rule and which field, matching the policy
// in CONTRACT.md and the shape `src/validate.js` returns.
export function validateEngine(manifest) {
  const f = [];
  const m = manifest ?? {};

  for (const key of REQUIRED) {
    if (m[key] === undefined) f.push({ scope: 'manifest', reason: `${key} is missing` });
  }
  if (m.id !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(String(m.id))) {
    f.push({ scope: 'manifest', reason: `id "${m.id}" must be lowercase letters, digits and hyphens` });
  }
  if (m.review !== undefined && !REVIEWS.includes(m.review)) {
    f.push({ scope: 'manifest', reason: `review "${m.review}" is not one of ${REVIEWS.join(', ')}` });
  }
  // Declared, not inferred. An engine that forgets this would silently become unscored and
  // its correctness would be dropped on the floor with no error to read.
  if (m.scored !== undefined && typeof m.scored !== 'boolean') {
    f.push({ scope: 'manifest', reason: `scored must be true or false, not ${typeof m.scored}` });
  }
  if (m.entry !== undefined && escapes(m.entry)) {
    f.push({ scope: 'manifest', reason: `entry "${m.entry}" must be a relative path inside the package` });
  }

  const space = m.taskSpace ?? {};
  const kinds = Object.keys(space);
  if (m.taskSpace !== undefined && !kinds.length) {
    f.push({ scope: 'taskSpace', reason: 'declares no task kinds, so no task can ever be posed' });
  }
  for (const [kind, spec] of Object.entries(space)) {
    if (!spec?.job) f.push({ scope: `taskSpace.${kind}`, reason: 'has no job line, so the model cannot be told what it is for' });
    const params = spec?.parameters ?? {};
    if (!Object.keys(params).length) {
      f.push({ scope: `taskSpace.${kind}`, reason: 'declares no parameters, so it is a fixed lesson rather than a task space' });
    }
    for (const [name, p] of Object.entries(params)) {
      if (p?.kind === 'text') {
        if (!p.maxLength) f.push({ scope: `taskSpace.${kind}.${name}`, reason: 'text parameter has no maxLength' });
      } else if (p?.kind === 'enum') {
        if (!Array.isArray(p.values) || !p.values.length) {
          f.push({ scope: `taskSpace.${kind}.${name}`, reason: 'enum parameter declares no values' });
        }
      } else {
        f.push({ scope: `taskSpace.${kind}.${name}`, reason: `unknown parameter kind "${p?.kind}"` });
      }
      if (!p?.job) f.push({ scope: `taskSpace.${kind}.${name}`, reason: 'has no job line' });
    }
  }
  return f;
}

// TASK SPACE -> the JSON Schema Alexandria hands the model, exactly as `buildSchema` does
// for a world's channels. The symmetry is the point: an engine declares a space of tasks
// the same way a world declares a space of beats, and in both cases the manifest IS part
// of the prompt. Nothing here names any engine.
export function buildTaskSchema(engine, kind) {
  const spec = engine.taskSpace?.[kind];
  if (!spec) throw new Error(`engine "${engine.id}": no task kind "${kind}"`);

  const properties = {};
  for (const [name, p] of Object.entries(spec.parameters)) {
    properties[name] = p.kind === 'enum'
      ? { type: 'string', enum: p.values, description: p.job }
      : { type: 'string', maxLength: p.maxLength, description: p.job };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

// Everything an engine sends is DATA, never instruction — a hostile engine's output flows
// into the agent's context, which `Alexandria - Interactives` names as the sharp edge.
// Structured clone already stripped functions and DOM nodes in transit; this bounds what is
// left. Anything over a cap is truncated rather than rejected, because a returning student
// losing their result to a strict parser is worse than a long note being cut.
function bounded(value, depth = 0) {
  if (value === null) return null;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isFinite(value) || typeof value === 'boolean' ? value : null;
  }
  if (typeof value === 'string') return value.slice(0, CAPS.string);
  if (depth >= CAPS.depth) return null;              // also how a cyclic graph terminates
  if (Array.isArray(value)) return value.slice(0, CAPS.items).map((v) => bounded(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).slice(0, CAPS.keys)) out[key] = bounded(value[key], depth + 1);
    return out;
  }
  return null;
}

// THE LEDGER PAYLOAD. One shape, two producers, per `Alexandria - Interactives`.
//
// The split that matters is which fields the ENGINE may fill and which the ARENA stamps.
// `producer`, the engine's identity and the time on task are all stamped here, because a
// tenant reporting on its own performance is the world-as-narrator problem again — and an
// engine that could name itself could impersonate a first-party micro card.
//
// `correctness` and `completed` are ABSENT, not false, on an unscored engine. A goal is
// optional (narrowed 26 Aug), so an engine with no achievable goal returns time on task
// alone and that is a complete result rather than a failed one — there is no completion
// event for it to have lacked, and a `false` would read as failure to anything downstream.
//
// On a scored engine `completed` is the ledger's owe signal: false means the student left
// mid-task, so the item is owed and comes back later. The payload still carries whatever
// the engine last pushed via `state`, which is the whole reason that message exists.
export function shapeResult({ engine, raw, timeOnTaskMs, completed = false }) {
  const r = raw ?? {};
  const out = {
    producer: 'sandbox',
    engine: { id: engine.id, version: engine.version, review: engine.review },
    scored: engine.scored === true,
    time_on_task_ms: Math.max(0, Math.round(timeOnTaskMs)),
    attempt: bounded(r.attempt),
    // Free-form, and the most valuable field there is: WHICH RULE the invalid attempts
    // kept breaking. Also the likeliest injection vector, so it is capped and it is never
    // handed onward as anything but quoted data.
    notes: typeof r.notes === 'string' ? r.notes.slice(0, CAPS.notes) : null,
    confidence: typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1
      ? r.confidence : null,
  };

  if (out.scored) {
    out.completed = completed === true;
    // boolean for a pass/fail goal, 0..1 for a partial one. Anything else is dropped
    // rather than coerced, because a silently coerced score is a wrong score.
    const c = r.correctness;
    out.correctness = typeof c === 'boolean' ? c
      : (typeof c === 'number' && c >= 0 && c <= 1) ? c
      : null;
  }
  return out;
}
