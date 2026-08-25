import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Generator } from './src/claude.js';
import { buildSchema, buildSystemPrompt } from './src/schema.js';
import { validate, repairPrompt } from './src/validate.js';
import { paginate, readingTimeMs } from './src/paginate.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORLD_ID = process.env.WORLD ?? 'cartoon';
const worldDir = join(ROOT, 'worlds', WORLD_ID);
const world = JSON.parse(await readFile(join(worldDir, 'world.json'), 'utf8'));

const schema = buildSchema(world);
const gen = new Generator({
  schema,
  model: process.env.MODEL ?? 'claude-haiku-4-5-20251001',
  systemPrompt: buildSystemPrompt(world),
}).start();

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const history = [];

function askPrompt(question) {
  const prior = history.length
    ? `\nThe student has already been taught: ${history.join(' | ')}.\nDo not repeat those beats.\n`
    : '\n';
  return `The student asks: "${question}"${prior}Write the module that answers it.`;
}

async function buildModule(question) {
  const t0 = Date.now();
  let attempts = 0, repairs = 0, calls = [];
  let res = await gen.turn(askPrompt(question));
  attempts++; calls.push(res.metrics);

  let failures = validate(world, res.data);
  while (failures.length && repairs < 2) {
    repairs++;
    res = await gen.turn(repairPrompt(failures));
    calls.push(res.metrics);
    failures = validate(world, res.data);
  }

  const beats = res.data?.beats ?? [];
  const degraded = failures.length > 0;          // the plain world would take over here
  // The headline channel is whichever text channel the world declares first.
  const headline = Object.entries(world.channels).find(([, ch]) => ch.kind === 'text')?.[0];
  if (beats.length && headline) history.push(beats[0][headline]);

  return {
    screens: paginate(world, beats),
    degraded,
    remainingFailures: failures,
    metrics: {
      startupMs: gen.startupMs,
      apiKeySource: gen.apiKeySource,
      sessionId: gen.sessionId,
      attempts, repairs,
      wallMs: Date.now() - t0,
      ttftMs: calls[0]?.ttftMs ?? null,
      costUsd: +(calls.reduce((s, c) => s + (c.costUsd ?? 0), 0)).toFixed(5),
      cacheReadTokens: calls[calls.length - 1]?.cacheReadTokens ?? null,
      readingTimeMs: readingTimeMs(world, beats),
      beats: beats.length,
    },
  };
}

const send = (r, code, body, type = 'application/json') => {
  r.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  r.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/world') {
      const screens = {};
      for (const [k, p] of Object.entries(world.screens)) screens[k] = await readFile(join(worldDir, p), 'utf8');
      return send(res, 200, { world, screens, css: await readFile(join(worldDir, 'styles.css'), 'utf8') });
    }
    if (url.pathname === '/api/module' && req.method === 'POST') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { question } = JSON.parse(body || '{}');
      const t = await buildModule(question || 'Teach me something interesting.');
      console.log(`[module] "${question}" -> ${t.metrics.beats} beats, ${t.metrics.wallMs}ms, ${t.metrics.repairs} repair(s), $${t.metrics.costUsd}`);
      return send(res, 200, t);
    }
    const file = url.pathname.startsWith('/worlds/')
      ? join(ROOT, url.pathname)
      : join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    return send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  } catch (err) {
    return send(res, url.pathname.startsWith('/api') ? 500 : 404, { error: String(err.message ?? err) });
  }
}).listen(4173, () => {
  console.log(`\n  Alexandria spike — world "${world.name}"`);
  console.log(`  http://localhost:4173\n`);
});
