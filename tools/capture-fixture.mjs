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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = join(ROOT, 'fixtures');
const write = (p, s) => writeFile(join(F, p), typeof s === 'string' ? s : JSON.stringify(s, null, 2) + '\n');

const modules = (await readdir(join(F, 'beats'))).filter((f) => f.endsWith('.json')).sort();

for (const id of ['cartoon', 'visual-novel']) {
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
    reading[variant] = readingTimeMs(world, mod.beats);
    console.log(`${id.padEnd(13)} ${variant.padEnd(4)} beats=${mod.beats.length} ` +
      `screens=${paginate(world, mod.beats, mod).length} reading=${reading[variant]}ms validate=clean`);
  }
  await write(`${id}/reading-time.json`, reading);
}
console.log('\ncaptured to fixtures/');
