// Generates candidate fixture beats. NOT the fixture itself: the output of this is
// staged in fixtures/_raw/ for a human to curate to the caps and bless. Run once.
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Generator } from '../src/claude.js';
import { buildSchema, buildSystemPrompt } from '../src/schema.js';
import { validate } from '../src/validate.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.MODEL ?? 'claude-sonnet-5';

// Deliberately two subjects, not one: a fixture generated entirely from computer
// science would bake a subject shape into the reference every agent reads.
const QUESTIONS = {
  'segment-tree': 'How does a segment tree answer a range query in log n time?',
  'ice-floats': 'Why does ice float on water?',
};

// Same prompt shape as server.js, so the capture is faithful to what the app sends.
const askPrompt = (q) => `The student asks: "${q}"\nWrite the module that answers it.`;

for (const id of ['cartoon', 'visual-novel']) {
  const world = JSON.parse(await readFile(join(ROOT, 'worlds', id, 'world.json'), 'utf8'));
  const gen = new Generator({
    schema: buildSchema(world),
    model: MODEL,
    systemPrompt: buildSystemPrompt(world),
  }).start();

  for (const [slug, question] of Object.entries(QUESTIONS)) {
    const res = await gen.turn(askPrompt(question));
    const failures = validate(world, res.data);
    const out = {
      _world: id, _question: question, _model: MODEL,
      _metrics: res.metrics, _validationFailures: failures,
      ...res.data,
    };
    await writeFile(join(ROOT, 'fixtures/_raw', `${id}.${slug}.json`), JSON.stringify(out, null, 2) + '\n');
    const caps = Object.entries(world.channels).filter(([, c]) => c.kind === 'text');
    const worst = caps.map(([n, c]) =>
      `${n} ${Math.max(...res.data.beats.map((b) => (b[n] ?? '').length))}/${c.maxLength}`).join('  ');
    console.log(
      `${id.padEnd(13)} ${slug.padEnd(13)} beats=${res.data.beats.length} ` +
      `kinds=${[...new Set(res.data.beats.map((b) => b.kind))].join('+')} ` +
      `${worst}  ask=${(res.data.ask_line ?? '').length}/${world.module.channels.ask_line.maxLength} ` +
      `${res.metrics.durationMs}ms $${res.metrics.costUsd?.toFixed(4)} fail=${failures.length}`);
  }
  gen.stop();
}
