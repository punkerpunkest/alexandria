// Captures the golden fixture from the blessed beats in fixtures/beats/.
// Deterministic and model-free: it runs the pure functions and freezes their output.
// Re-run it after a DELIBERATE change, read the diff, and re-bless. Never run it to
// make a red test go green.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchema, buildSystemPrompt } from '../src/schema.js';
import { paginate, readingTimeMs } from '../src/paginate.js';
import { validate } from '../src/validate.js';
import { buildTaskSchema, validateEngine } from '../src/engine.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = join(ROOT, 'fixtures');
const write = (p, s) => writeFile(join(F, p), typeof s === 'string' ? s : JSON.stringify(s, null, 2) + '\n');

const modules = (await readdir(join(F, 'beats'))).filter((f) => f.endsWith('.json')).sort();

for (const id of ['cartoon', 'visual-novel', 'longform']) {
  const world = JSON.parse(await readFile(join(ROOT, 'worlds', id, 'world.json'), 'utf8'));
  await mkdir(join(F, id), { recursive: true });

  await write(`${id}/schema.json`, buildSchema(world));
  await write(`${id}/system-prompt.txt`, buildSystemPrompt(world) + '\n');

  const reading = {};
  for (const file of modules.filter((f) => f.startsWith(id + '.'))) {
    const variant = file.slice(id.length + 1, -5);              // "max" | "min"
    const mod = JSON.parse(await readFile(join(F, 'beats', file), 'utf8'));
    const failures = validate(world, mod);
    if (failures.length) throw new Error(`${file} does not validate: ${JSON.stringify(failures)}`);
    await write(`${id}/screens.${variant}.json`, paginate(world, mod.beats, mod));
    reading[variant] = readingTimeMs(world, mod.beats, mod);
    console.log(`${id.padEnd(13)} ${variant.padEnd(4)} beats=${mod.beats.length} ` +
      `screens=${paginate(world, mod.beats, mod).length} reading=${reading[variant]}ms validate=clean`);
  }
  await write(`${id}/reading-time.json`, reading);
}
// ENGINES. A task space is to an engine what a channel set is to a world, so its schema is
// blessed the same way. A package that does not validate stops the capture rather than
// freezing a broken manifest — the fixture is the interface, and an interface captured from
// something invalid is worse than no fixture at all.
await mkdir(join(F, 'engines'), { recursive: true });
const engineIds = (await readdir(join(ROOT, 'engines'), { withFileTypes: true }))
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();

for (const id of engineIds) {
  const engine = JSON.parse(await readFile(join(ROOT, 'engines', id, 'engine.json'), 'utf8'));
  const bad = validateEngine(engine);
  if (bad.length) throw new Error(`engine "${id}" does not validate: ${JSON.stringify(bad)}`);
  const kinds = Object.keys(engine.taskSpace);
  for (const kind of kinds) await write(`engines/${id}.${kind}.schema.json`, buildTaskSchema(engine, kind));
  console.log(`${id.padEnd(17)} ${engine.scored ? 'scored  ' : 'unscored'} ` +
    `kinds=${kinds.length} review=${engine.review} validate=clean`);
}

console.log('\ncaptured to fixtures/');
