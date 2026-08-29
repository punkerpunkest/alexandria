// Verifies the code still produces the blessed fixture, and that every failure site
// in the runtime is reached by a hostile case. Model-free, no network, milliseconds.
// A red result is a real change: either a bug, or something to re-bless deliberately.
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, buildSystemPrompt } from '../src/schema.js';
import { paginate, readingTimeMs } from '../src/paginate.js';
import { validate } from '../src/validate.js';
import { resolveAsset, declaredAssets } from '../src/assets.js';
import { validateEngine, buildTaskSchema, shapeResult, entryUrl } from '../src/engine.js';
import { validateMicro, answeringTimeMs, shapeCardResult } from '../src/micro.js';
import { buildInteractiveSchema, readInteractive, validateInteractive, offerable } from '../src/interactive.js';
import { validateManifest, MANIFEST_RULES } from '../src/manifest.js';
import { memberPath, checkEntry, checkIdentity, overCap, CAPS } from '../src/install.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = join(ROOT, 'fixtures');
const read = async (p) => readFile(join(F, p), 'utf8');
const json = async (p) => JSON.parse(await read(p));
const world = async (id) => JSON.parse(await readFile(join(ROOT, 'worlds', id, 'world.json'), 'utf8'));

let pass = 0; const fails = [];
const eq = (name, got, want) => {
  const g = typeof got === 'string' ? got : JSON.stringify(got, null, 2) + '\n';
  if (g === want) pass++;
  else fails.push(`${name}\n    got:  ${String(g).slice(0, 200)}\n    want: ${String(want).slice(0, 200)}`);
};

// `null` in a patch DELETES the key, which is how a case removes screenFor.default.
function merge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

// ---- 1. the golden outputs ---------------------------------------------------
const modules = (await readdir(join(F, 'beats'))).filter((f) => f.endsWith('.json')).sort();
for (const id of ['cartoon', 'visual-novel', 'longform']) {
  const w = await world(id);
  eq(`${id}/schema.json`, buildSchema(w), await read(`${id}/schema.json`));
  eq(`${id}/system-prompt.txt`, buildSystemPrompt(w) + '\n', await read(`${id}/system-prompt.txt`));
  const reading = {};
  for (const file of modules.filter((f) => f.startsWith(id + '.'))) {
    const variant = file.slice(id.length + 1, -5);
    const mod = await json(`beats/${file}`);
    eq(`${id} ${variant} validates clean`, validate(w, mod), '[]\n');
    eq(`${id}/screens.${variant}.json`, paginate(w, mod.beats, mod), await read(`${id}/screens.${variant}.json`));
    reading[variant] = readingTimeMs(w, mod.beats, mod);
  }
  eq(`${id}/reading-time.json`, reading, await read(`${id}/reading-time.json`));
}

// ---- 1b. the two interface seams ---------------------------------------------
// The asset resolver is the ONLY place a path is built, so the check is that it
// reproduces every asset URL in the blessed snapshots. A contract that lives as string
// concatenation cannot be checked; this is what turns it into one.
//
// LONGFORM IS DELIBERATELY ABSENT from this loop and must stay absent. It ships no assets
// at all — its only media is generated at runtime from a diagram spec — so it has no path
// for the resolver to reproduce, and the `at least one asset` assertion below would fail on
// a world that is behaving correctly. Adding it here would be testing the resolver against
// a world that never calls it.
for (const id of ['cartoon', 'visual-novel']) {
  const w = await world(id);
  const declared = new Set(Object.values(declaredAssets(w)).flatMap((m) => Object.values(m)));
  const used = new Set();
  for (const dir of (await readdir(join(F, 'dom'))).filter((d) => d.startsWith(id + '.'))) {
    for (const f of await readdir(join(F, 'dom', dir))) {
      const html = await read(`dom/${dir}/${f}`);
      for (const m of html.matchAll(/src="([^"]*\/assets\/[^"]+)"/g)) used.add(m[1]);
    }
  }
  const missing = [...used].filter((u) => !declared.has(u));
  eq(`${id}: every asset URL in the snapshots is one the resolver produces`,
     JSON.stringify(missing), '[]');
  eq(`${id}: the snapshots use at least one asset`, String(used.size > 0), 'true');
}

// The chrome-to-host surface carries exactly these members, and degrades to a stub
// off-app. Two lists rather than one since 27 Aug: CALLS are things the chrome asks for
// and EVENTS are things the host tells it. Growing either is a three-file change by
// design, and this check is the thing that makes the growth visible — so when it goes
// red, the question is whether the new member was meant, never how to quiet it.
{
  const { host, isApp } = await import('../public/host.js');
  eq('host surface: the call list is fixed',
     JSON.stringify(Object.keys(host).filter((k) => k !== 'host' && !k.startsWith('on')).sort()),
     JSON.stringify(['close', 'minimize', 'revealWorlds', 'worldsDir']));
  eq('host surface: the event list is fixed',
     JSON.stringify(Object.keys(host).filter((k) => k.startsWith('on')).sort()),
     JSON.stringify(['onFullscreen']));
  eq('host surface: outside the app it is the browser stub', `${host.host} ${isApp}`, 'browser false');
  eq('host surface: a call off-app resolves rather than throwing', String(await host.revealWorlds()), 'null');
  // An event off-app must be subscribable and simply never fire. If this threw, every
  // chrome that listens for one would break the moment it ran in a browser.
  eq('host surface: an event off-app subscribes without throwing',
     String(host.onFullscreen(() => {})), 'undefined');
}

// ---- 2. the hostile cases ----------------------------------------------------
const { cases } = await json('hostile/cases.json');
for (const c of cases) {
  let w = await world(c.world);
  if (c.patch) w = merge(w, c.patch);
  let mod = c.module ?? await json(`beats/${c.world}.${c.variant ?? 'max'}.json`);
  if (c.modulePatch) mod = merge(mod, c.modulePatch);
  if (c.beatPatch) {
    mod = { ...mod, beats: mod.beats.map((b, i) => (c.beatPatch[i] ? merge(b, c.beatPatch[i]) : b)) };
  }
  try {
    if (c.throws) {
      let threw = null;
      try {
        if (c.call === 'readingTime') readingTimeMs(w, mod.beats, mod);
        else { buildSchema(w); paginate(w, mod.beats, mod); }
      } catch (e) { threw = e.message; }
      eq(`hostile/${c.id}`, threw, c.throws);
    } else {
      eq(`hostile/${c.id}`, validate(w, mod), JSON.stringify(c.failures, null, 2) + '\n');
    }
  } catch (e) { fails.push(`hostile/${c.id} blew up: ${e.message}`); }
}

// ---- 3. completeness: every failure site has a case --------------------------
const sites =
  (await readFile(join(ROOT, 'src/paginate.js'), 'utf8')).split('throw new Error').length - 1 +
  (await readFile(join(ROOT, 'src/schema.js'), 'utf8')).split('throw new Error').length - 1 +
  (await readFile(join(ROOT, 'src/validate.js'), 'utf8')).split('failures.push').length - 1 + 1; // +1: the early `return [{no beats}]`
// Every `throw new Error` in src/ and every `failures.push` in validate.js must be reached
// by a case. Adding a failure path without a case turns this red, which is the point.
eq('every failure site has a hostile case', String(cases.length), String(sites));

// ---- 4. engines and the arena boundary ---------------------------------------
// The arena is the trust boundary, so the properties that make it one are pinned here
// rather than left to a manual pass. All model-free and offline, like everything above.
const em = await json('engines/manifests.json');

// Every shipped package is loadable, and its entry actually exists on disk. A broken
// package must fail at LOAD; this is the offline half of that promise.
const engineIds = (await readdir(join(ROOT, 'engines'), { withFileTypes: true }))
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();
for (const id of engineIds) {
  const e = JSON.parse(await readFile(join(ROOT, 'engines', id, 'engine.json'), 'utf8'));
  eq(`engines/${id} manifest is valid`, validateEngine(e), '[]\n');
  eq(`engines/${id} id matches its directory`, e.id, id);
  let onDisk = true;
  try { await readFile(join(ROOT, 'engines', id, e.entry)); } catch { onDisk = false; }
  eq(`engines/${id} entry exists`, onDisk, 'true\n');
  eq(`engines/${id} entry url`, entryUrl(e), `/engines/${id}/${e.entry}`);
  for (const kind of Object.keys(e.taskSpace)) {
    eq(`engines/${id}/${kind} task schema`, buildTaskSchema(e, kind),
       await read(`engines/${id}.${kind}.schema.json`));
  }
}

for (const c of em.cases) {
  eq(`engines/hostile/${c.id}`, validateEngine(merge(em.base, c.patch)),
     JSON.stringify(c.failures, null, 2) + '\n');
}
const engineRules = (await readFile(join(ROOT, 'src/engine.js'), 'utf8')).split('f.push(').length - 1;
eq('every engine rule has a hostile case', String(engineRules), String(em.rules));

// THE RETURN CHANNEL'S GUARANTEES. A hostile engine cannot name itself, claim to be a
// first-party micro card, or report its own clock; a cyclic graph terminates instead of
// hanging; an injection in `notes` is capped. Verified live against the arena on 27 Aug;
// pinned here so it stays true.
const scored = { id: 'x', version: '1.0.0', review: 'unreviewed', scored: true };
const cyc = { a: 1 }; cyc.self = cyc;
const hostile = shapeResult({
  engine: scored, timeOnTaskMs: 50, completed: true,
  raw: { producer: 'micro', engine: { id: 'trusted' }, time_on_task_ms: 999999,
         correctness: 'definitely', confidence: 42, attempt: cyc, notes: 'x'.repeat(5000) },
});
eq('arena stamps the producer', hostile.producer, 'sandbox');
eq('arena stamps the identity', hostile.engine.id, 'x');
eq('arena stamps the clock', hostile.time_on_task_ms, '50\n');
eq('a mistyped correctness is dropped, not coerced', hostile.correctness, 'null\n');
eq('an out-of-range confidence is dropped', hostile.confidence, 'null\n');
eq('notes are capped', String(hostile.notes.length), '600');
eq('a cyclic attempt terminates', String(JSON.stringify(hostile.attempt).length < 400), 'true');

// An unscored engine has no completion event to have lacked, so both keys are ABSENT
// rather than false — a `false` would read downstream as a failed attempt.
const unscored = shapeResult({ engine: { ...scored, scored: false }, raw: { correctness: true }, timeOnTaskMs: 10 });
eq('unscored has no correctness key', String('correctness' in unscored), 'false');
eq('unscored has no completed key', String('completed' in unscored), 'false');

// ---- 5. the boundary: what plays after a module ------------------------------
// The chooser, the card sets and the fallback, all model-free. These are the pieces the
// loop needs and none of them may drift silently.
const allEngines = [];
for (const id of engineIds) {
  allEngines.push(JSON.parse(await readFile(join(ROOT, 'engines', id, 'engine.json'), 'utf8')));
}
const catalog = offerable(allEngines);

// A test fixture must never be offerable. `hostile-probe` mounts untrusted code on purpose
// and `never-ready` never starts; a matcher that could pick either has a hole in it.
eq('test engines are not offerable', catalog.map((e) => e.id).sort().join(','), 'microscope,molecule-builder');
eq('interactive schema', buildInteractiveSchema(catalog), await read('interactive/schema.json'));

for (const [name, want] of [['micro', 'micro'], ['sandbox', 'sandbox']]) {
  const out = await json(`interactive/${name}.json`);
  eq(`interactive/${name} validates`, validateInteractive(catalog, out), '[]\n');
  const played = readInteractive(catalog, out);
  eq(`interactive/${name} producer`, played.producer, want);
  // The cards survive a sandbox choice on purpose: they are what the arena degrades TO.
  eq(`interactive/${name} keeps its fallback cards`, String(played.set.length > 0), 'true');
}
eq('sandbox carries a sentence Alexandria wrote',
   String(readInteractive(catalog, await json('interactive/sandbox.json')).task.sentence.length > 0), 'true');
eq('answering time is stable', await json('interactive/answering-time.json'),
   await read('interactive/answering-time.json'));

const ic = await json('interactive/cases.json');
const icBase = await json('interactive/micro.json');
for (const c of ic.cases) {
  eq(`interactive/hostile/${c.id}`, validateInteractive(catalog, merge(icBase, c.patch)),
     JSON.stringify(c.failures, null, 2) + '\n');
}
// +2 for the two EARLY RETURNS, which are rules that do not go through `failures.push`:
// an empty set, and a card type that is not one of the two. Both have hostile cases.
const microRules = (await readFile(join(ROOT, 'src/micro.js'), 'utf8')).split('failures.push(').length - 1 + 2;
const interRules = (await readFile(join(ROOT, 'src/interactive.js'), 'utf8')).split('failures.push(').length - 1;
eq('every boundary rule has a hostile case', String(microRules + interRules), String(ic.rules));

// NOTHING INSIDE A MICRO INTERACTIVE WAITS. A card whose chosen option has no banked
// response would force a round trip between answering and responding, which is the one
// rule micro exists to make structurally impossible.
const banked = (await json('interactive/micro.json')).cards
  .filter((c) => c.type === 'multiple-choice')
  .every((c) => c.options.every((o) => o.response && o.response.trim().length > 0));
eq('every option ships its response', String(banked), 'true');

// ONE KIND PER SET, and it is a schema guarantee rather than a repaired mistake: the type
// is declared once beside the cards, so a mixed set cannot be represented at all.
eq('a card cannot declare its own type',
   String((await json('interactive/micro.json')).cards.every((c) => c.type === undefined)), 'true');
eq('the set declares one kind',
   String(typeof (await json('interactive/micro.json')).card_type === 'string'), 'true');

const mres = shapeCardResult({ card: icBase.cards[0], cardType: icBase.card_type, index: 0, chosen: 1, timeOnTaskMs: 4200 });
eq('micro stamps its producer', mres.producer, 'micro');
eq('micro grades against the banked key', String(mres.correctness), 'true');
eq('micro carries no notes — no agent is present when the answer lands', mres.notes, 'null\n');

// ---- 6. the manifest validator -----------------------------------------------
// `docs/contracts/world-loader.md` section 6 specifies these rules and says none of them
// exist. They exist now, and this is what stops one being added without a case.
//
// The completeness sum in section 3 counts `throw new Error` in two files and
// `failures.push` in a third, so a NEW file is invisible to it — the contract says as
// much. Hence an explicit rule here rather than an extension of that count: every id in
// MANIFEST_RULES must be the `rule` of at least one case below.
{
  const worldDir = (id) => join(ROOT, 'worlds', id);
  const walk = async (dir, base = dir) => {
    const out = [];
    for (const d of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) out.push(...await walk(p, base));
      else out.push(relative(base, p).split(sep).join('/'));
    }
    return out;
  };
  // The package as it is on disk, read once per world: the file list rules E1-E3 need and
  // the template text rules E7-E9 and F2 need. The validator itself stays pure — it is
  // handed both rather than reaching for either.
  // Read exactly the way `server.js` does, including its refusal to open a path the
  // containment rule would reject — otherwise a case patching `screens` would be checked
  // against templates the server would never have loaded.
  const readTemplates = async (id, w) => {
    const t = {};
    for (const [k, p] of Object.entries(w.screens ?? {})) {
      if (typeof p !== 'string' || p.startsWith('/') || /^[a-z]+:/i.test(p) || p.split('/').includes('..')) continue;
      try { t[k] = await readFile(join(worldDir(id), p), 'utf8'); } catch { /* E3 reports it */ }
    }
    return t;
  };
  const pkg = {};
  for (const id of ['cartoon', 'visual-novel', 'longform']) {
    const w = await world(id);
    pkg[id] = { w, files: await walk(worldDir(id)), templates: await readTemplates(id, w) };
  }
  const line = (r) => `${r.rule} ${r.severity}: ${r.reason}`;
  const run = (id, world, templates) =>
    validateManifest(world, { dir: id, files: pkg[id].files, templates }).map(line);

  // EVERY SHIPPED WORLD LOADS. The strongest assertion in this section and the cheapest:
  // a rule that rejects a world Alexandria actually ships is a wrong rule, and this is
  // what catches one the moment it is written.
  for (const id of ['cartoon', 'visual-novel', 'longform']) {
    const errs = run(id, pkg[id].w, pkg[id].templates).filter((l) => l.includes(' error:'));
    eq(`manifest/${id} loads clean`, JSON.stringify(errs), '[]');
  }
  // The visual novel's three standing F2 warnings are DELIBERATE — its README documents
  // the empty opening stage as a designed state — so they are pinned rather than fixed.
  eq('manifest/visual-novel keeps its three advisory warnings',
     String(run('visual-novel', pkg['visual-novel'].w, pkg['visual-novel'].templates).length), '3');

  const mc = await json('manifest/cases.json');
  const covered = new Set();
  for (const c of mc.cases) {
    covered.add(c.rule);
    const base = pkg[c.world];
    const w = c.patch ? merge(base.w, c.patch) : base.w;
    let templates = c.patch?.screens ? await readTemplates(c.world, w) : base.templates;
    if (c.templatePatch) {
      templates = { ...templates };
      for (const [name, edits] of Object.entries(c.templatePatch)) {
        for (const [find, replaceWith] of edits) templates[name] = templates[name].split(find).join(replaceWith);
      }
    }
    // A case asserts the DELTA from the unpatched world, so a world's standing advisories
    // do not have to be restated in every case that uses it.
    const before = new Set(run(c.world, base.w, base.templates));
    const delta = run(c.world, w, templates).filter((l) => !before.has(l));
    eq(`manifest/${c.id}`, JSON.stringify(delta, null, 2) + '\n',
       JSON.stringify(c.expect, null, 2) + '\n');
  }
  eq('every manifest rule has a case',
     MANIFEST_RULES.filter((r) => !covered.has(r)).join(','), '');
  eq('every manifest case names a real rule',
     [...covered].filter((r) => !MANIFEST_RULES.includes(r)).join(','), '');
}

// ---- the install rules ---------------------------------------------------------
//
// The PURE half. The impure half — fetch, hash, gunzip, extract, rename — is exercised
// against a real gzipped tar over a real HTTP server by `tools/check-install.mjs`, because
// the interesting failures there are I/O ordering rather than decisions.
const inst = await json('install/cases.json');
for (const c of inst.members) {
  const got = memberPath(c.name);
  eq(`install/member/${c.id}`, got.reason ?? got.path, c.reason ?? c.path);
}
for (const c of inst.entries) {
  eq(`install/entry/${c.id}`, checkEntry(c.entry).map((f) => f.reason).join('\n'), c.failures.join('\n'));
}
for (const c of inst.identity) {
  eq(`install/identity/${c.id}`,
     checkIdentity({ manifest: c.manifest, entry: c.entry, idSegment: c.idSegment, versionSegment: c.versionSegment })
       .map((f) => f.reason).join('\n'),
     c.failures.join('\n'));
}
// COUNTED, NOT READ. A decompression bomb has a small honest header, so the cap can only be
// enforced against bytes already seen.
eq('install cap refuses a bomb', String(Boolean(overCap(CAPS.bytes + 1, 1))), 'true');
eq('install cap refuses too many members', String(Boolean(overCap(0, CAPS.members + 1))), 'true');
eq('install cap passes a real engine', String(overCap(64 * 1024, 12)), 'null');

// `CONTRACT.md` invariant 3 and `registry.md` invariant 7: the fetch does not live in `src/`.
// A grep, so it is run rather than claimed.
{
  const src = await readFile(join(ROOT, 'src/install.js'), 'utf8');
  eq('install rules do no network', String(/\bfetch\(|node:https?|XMLHttpRequest/.test(src)), 'false');
  eq('install rules touch no filesystem', String(/node:fs|child_process/.test(src)), 'false');
}

console.log(`${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`);
if (fails.length) { console.log('\n' + fails.join('\n\n')); process.exit(1); }
