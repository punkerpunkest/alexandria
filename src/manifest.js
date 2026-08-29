// THE MANIFEST VALIDATOR. `docs/contracts/world-loader.md` section 6 is titled
// "THE GAP: there is no manifest validation" and enumerates the rules one must check.
// This is that list, implemented. The rule ids below are the contract's own — A1, C4,
// E7 — so a rule and its specification can always be lined up.
//
// It RETURNS a list rather than throwing on the first problem. An author who dropped a
// folder in should see every problem in one run, not one per restart. `severity` splits
// the two outcomes the contract asks for: an `error` means the package does not load, a
// `warning` means it loads and something is worth knowing.
//
// Purity (CONTRACT.md invariant 3): this file imports nothing from `node:*` and touches
// no clock, no network and no filesystem. The two rule groups that need the disk take an
// INJECTED file list and injected template text, so `validateManifest(world, {dir, files,
// templates})` stays a pure function of its arguments. The caller does the reading.
//
// Error text follows the shape already in use — `world "<id>": <subject> "<name>" <what
// is wrong>` — so a manifest failure reads like the one manifest failure that already
// existed before this file.

import { declaredAssets, packageBase } from './assets.js';
import { paginate } from './paginate.js';
import { ARCHETYPES, archetypeNames } from './archetypes.js';

// The ordered list of every rule this file can report. Exported so the fixture's
// completeness check can assert that each one is reached by a case — the same discipline
// `fixtures/hostile/cases.json` applies to every `throw new Error` in `src/`. Adding a
// rule without a case turns the check red, which is the point.
export const MANIFEST_RULES = [
  'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9',
  'B1', 'B2', 'B3',
  'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7',
  'D1', 'D2', 'D3', 'D4', 'D5',
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10',
  'F1', 'F2',
];

// WHICH KEYS THE RUNTIME ACTUALLY READS ON A CHANNEL, by channel kind. This is rule C7,
// the typo detector, and it is the cheapest rule here: a manifest is hand-written JSON
// with no editor support, so `maxlength`, `restricts`, `keyBy` and `holds` are all
// accepted in perfect silence today. Derived by reading every `ch.<key>` dereference in
// src/schema.js, src/validate.js, src/paginate.js, src/assets.js and public/app.js.
const UNIVERSAL = ['kind', 'job', 'opening', 'optional'];
const READS = {
  text: [...UNIVERSAL, 'maxLength', 'mustBeClaim', 'mustAsk'],
  enum: [...UNIVERSAL, 'set', 'values', 'restrict', 'hold'],
  asset: [...UNIVERSAL, 'set', 'values', 'restrict', 'hold', 'keyedBy'],
  diagram: [...UNIVERSAL, 'captionMaxLength'],
};
// The kinds `property()` in src/schema.js actually dispatches on. Rule C1's message and
// throw are `buildSchema`'s, verbatim and pinned by the fixture; this list has to agree
// with that dispatch or the validator would reject a world the loader can compile.
const KINDS = Object.keys(READS);

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isStrList = (v) => Array.isArray(v) && v.every(isStr);

// A world author's own notes. Every manifest in the repo carries them and they are
// documentation, so no rule may trip over one.
const authorNote = (k) => k.startsWith('_');

export function validateManifest(world, { dir = null, files = null, templates = null } = {}) {
  const out = [];
  const m = world ?? {};
  const id = m.id;
  const say = (rule, where, reason, severity = 'error') =>
    out.push({ rule, where, severity, reason: `world "${id}": ${reason}` });
  const warn = (rule, where, reason) => say(rule, where, reason, 'warning');

  // ---- A. structural presence — the fields the loader dereferences unguarded -------
  if (!isStr(id)) say('A1', 'id', 'manifest id must be a non-empty string');
  else if (dir && id !== dir) {
    say('A1', 'id', `manifest id does not match its directory "${dir}"; ` +
        'every asset URL is composed from the id');
  }

  const beats = m.beats;
  if (!isObj(beats)) say('A2', 'beats', 'no beats block');
  const kinds = Array.isArray(beats?.kinds) ? beats.kinds : [];
  if (!kinds.length || !isStrList(kinds) || new Set(kinds).size !== kinds.length) {
    say('A3', 'beats.kinds', 'beats.kinds must be a non-empty list of beat kinds');
  }
  if (isObj(beats)) {
    const { min, max } = beats;
    if (min == null || max == null) {
      say('A4', 'beats', 'beats.min and beats.max are both required; without them the ' +
          'model is handed an unbounded beat array and a module stops having a length');
    } else if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1) {
      say('A4', 'beats', `beats.min ${min} and beats.max ${max} must be whole numbers with min at least 1`);
    } else if (min > max) {
      say('A4', 'beats', `beats.min ${min} is greater than beats.max ${max}; ` +
          'no response can satisfy the schema');
    }
    for (const need of beats.require ?? []) {
      if (!kinds.includes(need)) {
        say('A5', 'beats.require', `beats.require names kind "${need}", which is not in beats.kinds`);
      }
    }
  }

  const channels = isObj(m.channels) ? m.channels : {};
  if (!Object.keys(channels).length) say('A6', 'channels', 'no channels declared');
  const moduleChannels = isObj(m.module?.channels) ? m.module.channels : {};

  const v = m.voice;
  if (!isObj(v)) say('A7', 'voice', 'no voice block; the preamble is built from it');
  else {
    if (!isStr(v.person)) say('A7', 'voice.person', 'voice.person must be a non-empty string');
    if (!isStr(v.register)) say('A7', 'voice.register', 'voice.register must be a non-empty string');
    if (!isStrList(v.forbidden)) say('A7', 'voice.forbidden', 'voice.forbidden must be a list of strings');
    if (!isStrList(v.samples)) say('A7', 'voice.samples', 'voice.samples must be a list of strings');
  }

  const assets = isObj(m.assets) ? m.assets : null;
  const all = [
    ...Object.entries(channels).map(([n, ch]) => [n, ch, 'beat']),
    ...Object.entries(moduleChannels).map(([n, ch]) => [n, ch, 'module']),
  ];
  const subject = (name, scope) => (scope === 'module' ? `module channel "${name}"` : `channel "${name}"`);
  if (!assets) {
    for (const [name, ch] of all) {
      if (isObj(ch) && ch.set) {
        say('A8', `channels.${name}`, `channel "${name}" declares set "${ch.set}" ` +
            'but the manifest has no assets block');
      }
    }
  }

  const archetype = ARCHETYPES[m.archetype];
  if (!archetype) {
    say('A9', 'archetype', `unknown archetype "${m.archetype}". ` +
        `Known archetypes: ${archetypeNames().join(', ')}`);
  }

  // ---- B. reserved and colliding names --------------------------------------------
  // B1 and B2 are the two silent catastrophes: one overwrites the beat's kind enum and
  // pushes "kind" into `required` twice, the other replaces the entire beats array with
  // a string property. B3 is the one that silently deletes a prompt line.
  if ('kind' in channels) {
    say('B1', 'channels.kind', 'channel "kind" collides with the beat\'s own kind field');
  }
  if ('beats' in moduleChannels) {
    say('B2', 'module.channels.beats', 'module channel "beats" collides with the beats array');
  }
  for (const name of Object.keys(moduleChannels)) {
    if (name in channels) {
      say('B3', `module.channels.${name}`,
          `"${name}" is declared as both a beat channel and a module channel`);
    }
  }

  // ---- C. per-channel well-formedness ---------------------------------------------
  // The resolved value list for an enum or asset channel: `values` when declared, the
  // set's keys otherwise. Same resolution `buildSchema` and `validate` both use.
  const valuesOf = (ch) => ch.values ?? Object.keys(assets?.[ch.set] ?? {});

  for (const [name, ch, scope] of all) {
    const where = scope === 'module' ? `module.channels.${name}` : `channels.${name}`;
    if (!isObj(ch)) {
      say('C1', where, `${subject(name, scope)} is not a channel object`);
      continue;
    }
    // C1: the ONE manifest rule that already existed, in `buildSchema`. Message and
    // wording are kept exactly; the fixture pins them and the validator only catches it
    // earlier than the loader does.
    if (!KINDS.includes(ch.kind)) {
      say('C1', where, `channel "${name}" has unknown kind "${ch.kind}"`);
      continue;                                   // every later rule is kind-dispatched
    }

    if (!isStr(ch.job)) {
      say('C6', where, `${subject(name, scope)} declares no job; ` +
          'the model is handed a field with no instruction');
    }

    if (ch.kind === 'text') {
      if (ch.maxLength == null) {
        say('C2', where, `${subject(name, scope)} is text and declares no maxLength; ` +
            'the panel has no defence against a long value');
      } else if (!Number.isInteger(ch.maxLength) || ch.maxLength < 1) {
        say('C2', where, `${subject(name, scope)} declares maxLength ${ch.maxLength}, ` +
            'which must be a whole number of at least 1');
      }
    }

    if (ch.kind === 'enum' || ch.kind === 'asset') {
      // C4 first: an unresolvable set is the reason an enum comes back empty, and
      // reporting both would name the same typo twice.
      if (ch.set != null && assets) {
        const set = assets[ch.set];
        if (!isObj(set) || !Object.keys(set).length) {
          say('C4', where, `${subject(name, scope)} declares set "${ch.set}", ` +
              'which is not in world.assets');
        } else {
          for (const [k, desc] of Object.entries(set)) {
            if (!isStr(desc)) {
              say('C4', where, `asset set "${ch.set}" describes "${k}" with something ` +
                  'that is not a non-empty string; the description is folded into the prompt');
            }
          }
          if (Array.isArray(ch.values)) {
            const keys = Object.keys(set);
            for (const val of ch.values) {
              if (!keys.includes(val)) {
                say('C5', where, `${subject(name, scope)} lists value "${val}", ` +
                    `which is not a key of asset set "${ch.set}"`);
              }
            }
            if (ch.values.length && ch.values.every((x) => keys.includes(x)) &&
                ch.values.length < keys.length) {
              warn('C5', where, `${subject(name, scope)}: asset set "${ch.set}" describes ` +
                   `${keys.length} options but only ${ch.values.length} are selectable; ` +
                   'the extra descriptions are still folded into the prompt');
            }
          }
        }
      }
      if (!valuesOf(ch).length) {
        say('C3', where, `${subject(name, scope)} resolves to an empty enum; ` +
            'no response can satisfy the schema');
      }
    }

    // C7, the typo detector. Author notes (`_`-prefixed) are documentation and exempt.
    for (const key of Object.keys(ch)) {
      if (authorNote(key) || READS[ch.kind].includes(key)) continue;
      const readBy = KINDS.filter((k) => READS[k].includes(key));
      say('C7', where, readBy.length
        ? `${subject(name, scope)} declares ${key}, which is only read on ` +
          `${readBy.length === 1 ? `a ${readBy[0]}` : readBy.join(' or ')} channel`
        : `${subject(name, scope)} declares ${key}, which the runtime never reads`);
    }

    // ---- D. cross-channel declarations --------------------------------------------
    if (ch.restrict != null) {
      if (scope === 'module') {
        // The restriction loop in buildSystemPrompt reads BOTH scopes, so this emits a
        // well-formed sentence about a beat for a value that is never on one, and the
        // validator never enforces it.
        say('D2', where, `module channel "${name}" declares restrict, which only applies to a beat`);
      } else {
        const allowed = valuesOf(ch);
        for (const [val, kind] of Object.entries(ch.restrict)) {
          if (allowed.length && !allowed.includes(val)) {
            say('D1', where, `channel "${name}" restricts value "${val}", ` +
                'which is not one of its own values');
          }
          if (kinds.length && !kinds.includes(kind)) {
            say('D1', where, `channel "${name}" restricts to kind "${kind}", ` +
                'which is not in beats.kinds');
          }
        }
      }
    }

    if (ch.hold != null) {
      if (scope === 'module') {
        say('D3', where, `module channel "${name}" declares hold, which only applies to a beat; ` +
            'a module channel has one value by definition');
      } else if (ch.hold !== 'module') {
        say('D3', where, `${subject(name, scope)} declares hold "${ch.hold}"; ` +
            'the only supported value is "module"');
      }
    }

    if (ch.keyedBy != null) {
      const k = ch.keyedBy;
      const keying = channels[k];
      if (k === name) {
        say('D4', where, `channel "${name}" is keyed by itself`);
      } else if (!keying) {
        say('D4', where, `channel "${name}" is keyed by "${k}", ` +
            (k in moduleChannels
              ? 'which is a module channel; a beat\'s asset key is composed from another beat channel'
              : 'which is not a declared channel'));
      } else if (keying.kind !== 'enum' && keying.kind !== 'asset') {
        say('D4', where, `channel "${name}" is keyed by "${k}", which is a ${keying.kind} ` +
            'channel; its value would be composed into an asset path');
      }
    }

    for (const flag of ['mustBeClaim', 'mustAsk']) {
      if (flag in ch && typeof ch[flag] !== 'boolean') {
        say('D5', where, `${subject(name, scope)} declares ${flag} "${ch[flag]}", which must be a boolean`);
      }
    }
    if (ch.mustBeClaim && ch.mustAsk) {
      say('D5', where, `${subject(name, scope)} declares both mustBeClaim and mustAsk, ` +
          'which cannot both hold');
    }

    // ---- F1. the opening frame ----------------------------------------------------
    // `opening` is the only value in the whole render path that never passes through
    // `validate()`, which only ever sees model output — and it is on the first frame of
    // the session.
    if (ch.opening != null) {
      if (ch.kind === 'enum' || ch.kind === 'asset') {
        const allowed = valuesOf(ch);
        if (allowed.length && !allowed.includes(ch.opening)) {
          say('F1', where, `${subject(name, scope)} declares opening "${ch.opening}", ` +
              'which is not one of its own values');
        }
      } else if (ch.kind === 'text') {
        const s = String(ch.opening);
        if (Number.isInteger(ch.maxLength) && s.length > ch.maxLength) {
          say('F1', where, `${subject(name, scope)} declares an opening of ${s.length} chars, ` +
              `and its cap is ${ch.maxLength}`);
        }
        if (ch.mustAsk && !s.trim().endsWith('?')) {
          say('F1', where, `${subject(name, scope)} declares mustAsk, and its opening ` +
              `"${s}" does not end in a question`);
        }
        if (ch.mustBeClaim && s.trim().endsWith('?')) {
          say('F1', where, `${subject(name, scope)} declares mustBeClaim, and its opening ` +
              `"${s}" is a question`);
        }
      }
    }
  }

  // ---- E. the package on disk ------------------------------------------------------
  // E4/E5/E6 are the paginator's four request-time throws, moved to load. E4 is asked of
  // the PAGINATOR itself rather than restated here: a probe manifest carrying only the
  // policy exercises exactly that one branch, so the vocabulary of known policies has one
  // definition and the message cannot drift from the one a session would have shown.
  const pag = isObj(m.pagination) ? m.pagination : {};
  try {
    paginate({ id, pagination: { policy: pag.policy }, screens: {} }, []);
  } catch (err) {
    say('E4', 'pagination.policy', String(err.message ?? err).replace(`world "${id}": `, ''));
  }

  const screens = isObj(m.screens) ? m.screens : {};
  for (const kind of kinds) {
    const type = pag.screenFor?.[kind] ?? pag.screenFor?.default;
    if (!type) {
      say('E5', 'pagination.screenFor', 'pagination.screenFor declares no screen type for ' +
          `beat kind "${kind}", and no default`);
    } else if (!screens[type]) {
      // Checked across ALL declared kinds rather than the kinds one module happened to
      // contain, which is the real gain: a world with a broken mapping for one kind used
      // to run correctly until the first module that had one.
      say('E5', 'pagination.screenFor', `pagination.screenFor maps to screen type "${type}", ` +
          'which is not declared in world.screens');
    }
  }
  if (pag.closeWith != null && !screens[pag.closeWith]) {
    say('E6', 'pagination.closeWith', `pagination.closeWith names screen type "${pag.closeWith}", ` +
        'which is not declared in world.screens');
  }

  // E3: containment applied to templates. `server.js` joins these onto the world
  // directory with no normalisation, so `../../CONTRACT.md` resolves to a real file
  // outside the package and is served to the browser as a template.
  const has = (p) => !files || files.includes(p);
  for (const [key, p] of Object.entries(screens)) {
    if (typeof p !== 'string' || !p.trim()) {
      say('E3', `screens.${key}`, `screen "${key}" must be a package-relative path`);
      continue;
    }
    if (p.startsWith('/') || /^[a-z]+:/i.test(p) || p.split('/').includes('..')) {
      say('E3', `screens.${key}`, `screen "${key}" points outside the package: "${p}"`);
      continue;
    }
    if (!has(p)) say('E3', `screens.${key}`, `screen "${key}" names ${p}, which is not in the package`);
  }

  // E1: invariant 5 becoming checkable. `declaredAssets` expands a `keyedBy` channel over
  // the full cross product of its keying channel's values, because those are exactly the
  // combinations the model is allowed to produce — and half a cross product is a world
  // that breaks only when one particular character makes one particular face.
  if (files && assets) {
    const base = packageBase(m) + '/';
    for (const [name, map] of Object.entries(declaredAssets(m))) {
      const ch = channels[name] ?? moduleChannels[name];
      for (const [key, url] of Object.entries(map)) {
        const rel = url.startsWith(base) ? url.slice(base.length) : url;
        if (!has(rel)) {
          say('E1', `assets.${ch?.set}`, `asset set "${ch?.set}" declares "${key}" ` +
              `but ${rel} is not in the package`);
        }
      }
    }
  }

  // E2: a set with no declared format is served `.svg` by the resolver's fallback. A
  // warning rather than an error, because `.svg` IS the default and a world shipping SVG
  // legitimately declares nothing; E1 is what turns a wrong guess into a failure.
  for (const [name, ch] of all) {
    if (!isObj(ch) || !ch.set) continue;
    if (m.assetFormat?.[ch.set] == null) {
      warn('E2', `assetFormat.${ch.set}`, `asset set "${ch.set}" declares no assetFormat; ` +
           'the projector will request .svg');
    }
  }

  // ---- E7-E9, F2. the declared templates -------------------------------------------
  // A regex over `data-slot="…"` is enough; `public/app.js` already scans templates this
  // way with `t.includes(attr)`, so no HTML parser is involved.
  if (templates) {
    // COMMENTS ARE STRIPPED FIRST, and that is not tidiness. This is a regex over raw
    // text, so a template that DOCUMENTS a slot — `the runtime mounts into
    // data-slot="interactive"` in a comment above the markup — was reporting the slot
    // twice, and would report one that does not exist at all. Every template in this repo
    // carries exactly that kind of comment, which is the house style.
    const attrs = (html, attr) =>
      [...String(html).replace(/<!--[\s\S]*?-->/g, '')
        .matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))].map((x) => x[1]);
    // Every slot any screen declares itself the host of. Values, not keys: the key is the
    // screen type and the values are what it may host.
    const hosted = new Set(Object.values(world.hosts ?? {}).flat());
    const known = new Set([...Object.keys(channels), ...Object.keys(moduleChannels)]);
    const placed = new Set();
    let anyControls = false;

    for (const [key, html] of Object.entries(templates)) {
      for (const slot of attrs(html, 'data-slot')) {
        if (slot === 'controls') { anyControls = true; continue; }   // runtime-owned
        if (slot === 'ask') continue;                                // runtime-owned
        // A HOSTED SLOT IS RUNTIME-OWNED TOO, and for exactly the same reason as the two
        // above: it names a place the projector mounts something into, not a value the
        // model generates. Cartoon's `hosts: { interactive: ["interactive"] }` declares an
        // arena mount point, and requiring it to be a channel would make a world unable to
        // say where an interactive sits — which is the one thing `Alexandria - World Spec`
        // says the world decides. Read from the manifest rather than hardcoded, so a world
        // hosting something else is covered without touching this rule.
        if (hosted.has(slot)) continue;
        if (!known.has(slot)) {
          say('E7', `screens.${key}`, `screen "${key}" fills slot "${slot}", ` +
              'which is not a declared channel');
        } else placed.add(slot);
      }
      if (archetype) {
        for (const r of attrs(html, 'data-readout')) {
          if (!archetype.readouts.includes(r)) {
            say('E9', `screens.${key}`, `screen "${key}" declares readout "${r}", ` +
                `which archetype "${m.archetype}" does not publish`);
          }
        }
      }
    }

    for (const [name, , scope] of all) {
      if (placed.has(name)) continue;
      warn('E8', scope === 'module' ? `module.channels.${name}` : `channels.${name}`,
           `${subject(name, scope)} is generated on every ${scope === 'module' ? 'module' : 'beat'} ` +
           'and appears in no template');
    }

    // The required-control half of E9. A warning rather than an error, because the
    // runtime already substitutes the chrome's default placement — `Alexandria - World
    // Spec` asks that a world the student cannot leave never ships, and substitution is
    // how that is honoured.
    if (archetype && !anyControls) {
      for (const [cname, def] of Object.entries(archetype.controls)) {
        if (!def.required) continue;
        warn('E9', 'screens', `no screen places data-slot="controls", so archetype ` +
             `"${m.archetype}"'s required control "${cname}" falls back to the chrome's placement`);
      }
    }

    // ---- E10. a host declaration names a screen the package ships --------------
    // A WORLD DECLARES WHERE A NON-BEAT SCREEN SITS, and one naming a screen type the
    // package never shipped is broken: the student reaches a boundary and the interactive
    // has nowhere to go.
    //
    // This began life as a top-level throw in `server.js`, added by the lane that taught a
    // world to host an interactive. It could not survive here — that file no longer has a
    // single `world` to check, it has a registry of them — so the check belongs where every
    // other manifest rule already lives, reported per package through one path instead of
    // killing the process for all of them.
    for (const [type, hosted] of Object.entries(world.hosts ?? {})) {
      if (!screens[type]) {
        say('E10', `hosts.${type}`, `hosts declares screen type "${type}", ` +
            'which is not declared in world.screens');
      } else if (!Array.isArray(hosted) || !hosted.length) {
        say('E10', `hosts.${type}`, `hosts."${type}" must list what that screen type holds, ` +
            'and it lists nothing');
      }
    }

    // F2 is ADVISORY and must stay so. The visual novel's ask.html carries background,
    // speaker_body and speaker_face slots and none of the three declares `opening` —
    // deliberately: its README documents the empty stage as a designed state, detected in
    // CSS by `.stack:not(:has(.bg[src]))`. Cartoon takes the other route. Both are
    // correct, so any rule here that errors would break a shipped world.
    const close = pag.closeWith;
    if (close && templates[close]) {
      for (const slot of attrs(templates[close], 'data-slot')) {
        if (slot === 'controls' || slot === 'ask' || !known.has(slot)) continue;
        const ch = channels[slot] ?? moduleChannels[slot];
        if (ch?.opening == null) {
          warn('F2', `screens.${close}`, `screen "${close}" fills slot "${slot}" from channel ` +
               `"${slot}", which declares no opening; it will be blank at stage 0`);
        }
      }
    }
  }

  return out;
}

// The two halves a caller almost always wants separately: what stops the package
// loading, and what is merely worth saying.
export const errorsOnly = (report) => report.filter((r) => r.severity === 'error');

// One line per problem, in the shape `server.js` prints and `/api/worlds` carries.
export function reportText(report) {
  return report.map((r) => `  [${r.rule} ${r.severity}] ${r.reason}`).join('\n');
}
