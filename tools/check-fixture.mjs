// Verifies the code still produces the blessed fixture, and that every failure site
// in the runtime is reached by a hostile case. Model-free, no network, milliseconds.
// A red result is a real change: either a bug, or something to re-bless deliberately.
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, buildSystemPrompt } from '../src/schema.js';
import { paginate, readingTimeMs } from '../src/paginate.js';
import { validate } from '../src/validate.js';

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

console.log(`${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`);
if (fails.length) { console.log('\n' + fails.join('\n\n')); process.exit(1); }
