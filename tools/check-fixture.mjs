// Verifies the code still produces the blessed fixture, and that every failure site
// in the runtime is reached by a hostile case. Model-free, no network, milliseconds.
// A red result is a real change: either a bug, or something to re-bless deliberately.
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, buildSystemPrompt } from '../src/schema.js';
import { paginate, readingTimeMs } from '../src/paginate.js';
import { validate } from '../src/validate.js';
import { resolveAsset, declaredAssets } from '../src/assets.js';
import { validateEngine, buildTaskSchema, shapeResult, entryUrl } from '../src/engine.js';

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
for (const id of ['cartoon', 'visual-novel']) {
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

// The chrome-to-host surface carries exactly these calls, and degrades to a stub off-app.
{
  const { host, isApp } = await import('../public/host.js');
  eq('host surface: the call list is fixed',
     JSON.stringify(Object.keys(host).sort()), JSON.stringify(['close', 'host', 'minimize', 'revealWorlds', 'worldsDir']));
  eq('host surface: outside the app it is the browser stub', `${host.host} ${isApp}`, 'browser false');
  eq('host surface: a call off-app resolves rather than throwing', String(await host.revealWorlds()), 'null');
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

console.log(`${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`);
if (fails.length) { console.log('\n' + fails.join('\n\n')); process.exit(1); }
