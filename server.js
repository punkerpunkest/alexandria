import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Generator } from './src/claude.js';
import { buildSchema, buildSystemPrompt } from './src/schema.js';
import { validate, repairPrompt } from './src/validate.js';
import { paginate, readingTimeMs } from './src/paginate.js';
import { ENGINE_CSP, validateEngine } from './src/engine.js';
import { buildInteractiveSchema, buildInteractivePrompt, readInteractive,
         validateInteractive, offerable } from './src/interactive.js';
import { answeringTimeMs } from './src/micro.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORLD_ID = process.env.WORLD ?? 'cartoon';
// Hardcoding this made two worlds impossible to run side by side.
const PORT = Number(process.env.PORT ?? 4173);
const worldDir = join(ROOT, 'worlds', WORLD_ID);
const world = JSON.parse(await readFile(join(worldDir, 'world.json'), 'utf8'));

// A WORLD DECLARES WHERE A NON-BEAT SCREEN SITS, and a declaration naming a screen type the
// package never shipped is a broken package. It fails HERE, at load, for the same reason a
// broken engine manifest does below: the alternative is a student reaching a boundary and
// finding the interactive has nowhere to go. The template itself is served by /api/world
// with every other screen type, so nothing further is needed to honour it.
for (const [type, hosted] of Object.entries(world.hosts ?? {})) {
  if (!world.screens?.[type]) {
    throw new Error(`world "${world.id}": hosts declares screen type "${type}", which is not declared in world.screens`);
  }
  if (!Array.isArray(hosted) || !hosted.length) {
    throw new Error(`world "${world.id}": hosts."${type}" must list what that screen type holds, and it lists nothing`);
  }
}

// ENGINES ARE LOADED ONCE, AT STARTUP, and a broken package stops the server rather than
// surfacing mid-session. Same discipline as the world manifest above, and the failure
// policy asks for exactly this: a broken package fails at LOAD.
const engines = [];
for (const d of await readdir(join(ROOT, 'engines'), { withFileTypes: true })) {
  if (!d.isDirectory()) continue;
  const m = JSON.parse(await readFile(join(ROOT, 'engines', d.name, 'engine.json'), 'utf8'));
  const bad = validateEngine(m);
  if (bad.length) throw new Error(`engine "${d.name}": ${bad.map((f) => `${f.scope}: ${f.reason}`).join('; ')}`);
  engines.push(m);
}
const catalog = offerable(engines);

const schema = buildSchema(world);
const gen = new Generator({
  schema,
  model: process.env.MODEL ?? 'claude-haiku-4-5-20251001',
  systemPrompt: buildSystemPrompt(world),
}).start();

// THE SECOND GENERATOR, and it is a second PROCESS because it must be. The adapter fixes
// its schema at spawn, so one schema per purpose means one process per purpose — and
// startup is 4.5-13s against a window of 8-22s, so spawning per boundary would cost more
// than the wait it is meant to cover. Both start now, in parallel, behind the student
// typing their first question.
//
// Caged on purpose, per `Alexandria - Interactives`: its own process, no tools, no history
// of the session, and it never sees the main generator's conversation.
const interactiveGen = new Generator({
  schema: buildInteractiveSchema(catalog),
  model: process.env.MICRO_MODEL ?? process.env.MODEL ?? 'claude-haiku-4-5-20251001',
  systemPrompt: buildInteractivePrompt(catalog),
}).start();

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

// SESSION MEMORY IS THE CONVERSATION, and nothing else.
// This used to also accumulate a `history` array and inject "the student has
// already been taught X | Y | Z, do not repeat those beats" into every request.
// It was a lossy duplicate of context the model already had — the adapter is one
// long-lived process, so prior modules are simply in the conversation — and it had
// lost its scoping three ways: it spanned unrelated topics, it grew without bound,
// and it only ever recorded the FIRST beat of each module while forbidding "those
// beats" wholesale. Measured effect: a follow-up dropped from 4 beats to 3 and from
// ~10s to under 4s, because the model had been told there was less left to say.
// The module just taught, as the only context the chooser gets. Deliberately not the
// session: this is a side channel and should have a side channel's reach.
function interactivePrompt(taught) {
  const beats = (taught?.beats ?? []).map((b, i) => `${i + 1}. [${b.kind}] ` +
    Object.entries(b).filter(([k]) => k !== 'kind').map(([, v]) => v).join(' | ')).join('\n');
  return `The student has just read this module:\n\n${beats || '(nothing)'}\n\n` +
    `Decide what they do next while the following module is written.`;
}

function askPrompt(question) {
  return `The student asks: "${question}"\nWrite the module that answers it.`;
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

  return {
    screens: paginate(world, beats, res.data ?? {}),
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
      readingTimeMs: readingTimeMs(world, beats, res.data ?? {}),
      beats: beats.length,
    },
  };
}

// One tag per line, nested by depth, so a snapshot diff is readable. Void elements and
// text-bearing elements stay on one line; nothing here needs to be a real HTML parser.
function indent(html) {
  const parts = html.replace(/></g, '>\n<').split('\n');
  let depth = 0;
  return parts.map((line) => {
    if (/^<\//.test(line)) depth--;
    const out = '  '.repeat(Math.max(0, depth)) + line;
    if (/^<[^/!]/.test(line) && !/\/>$/.test(line) && !/<\/[a-z-]+>$/.test(line)
        && !/^<(img|br|hr|input|meta|link|source)\b/i.test(line)) depth++;
    return out;
  }).join('\n');
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
    // CAPTURE HARNESS, off unless SNAPSHOT=1. The projector is browser code, so the DOM
    // snapshots in the golden fixture cannot be produced from Node. tools/capture-dom.md
    // documents the run. Never enabled by `npm start`.
    if (url.pathname === '/api/_snapshot' && req.method === 'POST' && process.env.SNAPSHOT === '1') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { variant, snapshots } = JSON.parse(body);
      const dir = join(ROOT, 'fixtures', 'dom', `${WORLD_ID}.${variant}`);
      await mkdir(dir, { recursive: true });
      for (const [name, html] of Object.entries(snapshots)) {
        await writeFile(join(dir, `${name}.html`), indent(html) + '\n');
      }
      console.log(`[snapshot] ${WORLD_ID}.${variant}: ${Object.keys(snapshots).length} files`);
      return send(res, 200, { written: Object.keys(snapshots).length, dir });
    }
    // WHAT PLAYS AT THIS BOUNDARY. One call decides between a sandbox and a card set and
    // produces both, because the cards are also the substitute if the engine is cold.
    if (url.pathname === '/api/interactive' && req.method === 'POST') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { module: taught, fixture } = JSON.parse(body || '{}');

      if (fixture) {
        const out = JSON.parse(await readFile(join(ROOT, 'fixtures', 'interactive', `${fixture}.json`), 'utf8'));
        const played = readInteractive(catalog, out);
        console.log(`[interactive] fixture "${fixture}" -> ${played.producer}, no model call`);
        return send(res, 200, { ...played, metrics: { fixture, answeringTimeMs: answeringTimeMs(played.set ?? []) } });
      }
      if (interactiveGen.unavailable) return send(res, 503, { error: interactiveGen.unavailable, setup: true });

      const t0 = Date.now();
      let res1 = await interactiveGen.turn(interactivePrompt(taught));
      let failures = validateInteractive(catalog, res1.data);
      let repairs = 0;
      while (failures.length && repairs < 2) {
        repairs++;
        res1 = await interactiveGen.turn(repairPrompt(failures));
        failures = validateInteractive(catalog, res1.data);
      }
      // DEGRADE RATHER THAN THROW. A boundary that cannot decide still has to put something
      // in front of the student, and cards that failed validation are worse than none — so
      // an unrepairable answer plays nothing and says why, and the wait becomes what it
      // already is today.
      if (failures.length) {
        console.log(`[interactive] unrepairable: ${failures.map((f) => f.reason).join('; ')}`);
        return send(res, 200, { producer: 'none', remainingFailures: failures, metrics: { wallMs: Date.now() - t0, repairs } });
      }

      const played = readInteractive(catalog, res1.data);
      console.log(`[interactive] ${played.producer}${played.engine ? ` (${played.engine.id})` : ''}, ` +
        `${played.set.length} card(s), ${Date.now() - t0}ms, ${repairs} repair(s)`);
      return send(res, 200, { ...played, metrics: {
        wallMs: Date.now() - t0, repairs, costUsd: res1.metrics.costUsd,
        answeringTimeMs: answeringTimeMs(played.set),
      } });
    }
    if (url.pathname === '/api/module' && req.method === 'POST') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { question, fixture } = JSON.parse(body || '{}');

      // DETERMINISTIC MODE. `{ fixture: "max" }` renders the blessed module from
      // fixtures/beats/ and never touches the adapter, so the app runs on zero quota.
      // It is what the DOM snapshots capture, and what makes the chrome and projector
      // workable without spending a student's subscription on every reload.
      if (fixture) {
        const mod = JSON.parse(await readFile(join(ROOT, 'fixtures', 'beats', `${WORLD_ID}.${fixture}.json`), 'utf8'));
        console.log(`[module] fixture "${fixture}" -> ${mod.beats.length} beats, no model call`);
        return send(res, 200, {
          screens: paginate(world, mod.beats, mod),
          degraded: false, remainingFailures: [],
          metrics: { fixture, beats: mod.beats.length, readingTimeMs: readingTimeMs(world, mod.beats, mod),
                     wallMs: 0, repairs: 0, attempts: 0, costUsd: 0, startupMs: gen.startupMs,
                     apiKeySource: gen.apiKeySource, ttftMs: 0, cacheReadTokens: 0 },
        });
      }

      if (gen.unavailable) return send(res, 503, { error: gen.unavailable, setup: true });
      const t = await buildModule(question || 'Teach me something interesting.');
      console.log(`[module] "${question}" -> ${t.metrics.beats} beats, ${t.metrics.wallMs}ms, ${t.metrics.repairs} repair(s), $${t.metrics.costUsd}`);
      return send(res, 200, t);
    }
    // ENGINE PACKAGES, served with a CSP that blocks EGRESS. An engine is third-party
    // code, so the iframe's `sandbox` attribute contains the DOM and this header contains
    // the network; neither is sufficient alone. `ENGINE_CSP` names what it blocks rather
    // than what it allows, because `'self'` matches nothing from an opaque origin — the
    // reasoning is written down in `src/engine.js`.
    if (url.pathname.startsWith('/engines/')) {
      const f = join(ROOT, url.pathname);
      // Containment, the same invariant a world package has. `new URL()` already collapses
      // `..`, so this catches the encoded forms and anything a future caller invents.
      if (!f.startsWith(join(ROOT, 'engines'))) throw new Error('path escapes the engines root');
      // THE HEADER IS NOT ENOUGH, and this is measured rather than assumed. Served as a
      // response header, `connect-src 'none'` was silently not enforced — a browser
      // extension rewriting headers is enough to remove it, and the failure is invisible:
      // the header is on the wire, `curl` shows it, and the page exfiltrates anyway. The
      // identical directive as a `<meta>` inside the document WAS enforced, same browser,
      // same page. So Alexandria injects its own containment into the document it is
      // hosting rather than asking the network layer to carry it.
      //
      // It goes at the very start, because a meta CSP only governs content parsed AFTER
      // it. The header stays too: two independent carriers, and neither is trusted alone.
      let payload = await readFile(f);
      if (extname(f) === '.html') {
        const meta = `<meta http-equiv="Content-Security-Policy" content="${ENGINE_CSP}">`;
        const text = payload.toString('utf8');
        const after = /^\s*<!doctype[^>]*>/i.exec(text);
        payload = after
          ? text.slice(0, after[0].length) + '\n' + meta + text.slice(after[0].length)
          : meta + '\n' + text;
      }
      res.writeHead(200, {
        'content-type': MIME[extname(f)] ?? 'application/octet-stream',
        'content-security-policy': ENGINE_CSP,
        // AN ENGINE MAY USE ES MODULES, and this header is the only reason it can. A module
        // script is fetched in CORS mode, and from the frame's OPAQUE origin that request
        // is cross-origin even though the URL is our own — so without this a
        // `<script type="module">` fails with a blank frame and an error only visible
        // inside the frame the author cannot open. Exactly the trap this codebase keeps
        // writing down. It grants nothing: `connect-src 'none'` already blocks every fetch
        // the engine could make with the permission.
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      return res.end(payload);
    }
    // `src/assets.js` is shared by the loader and the projector on purpose — one
    // definition of an asset path, so the on-disk check and the render cannot drift.
    // `src/engine.js` is shared the same way, by the arena and the engine loader.
    // Named explicitly rather than serving src/, which would also expose the adapter.
    const file = url.pathname === '/src/assets.js'
      ? join(ROOT, 'src', 'assets.js')
      : url.pathname === '/src/engine.js'
      ? join(ROOT, 'src', 'engine.js')
      // `src/micro.js` is shared the same way again: the server grades nothing, the card
      // grades locally, and both must agree on what a result looks like.
      : url.pathname === '/src/micro.js'
      ? join(ROOT, 'src', 'micro.js')
      : url.pathname.startsWith('/worlds/')
      ? join(ROOT, url.pathname)
      : join(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    return send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  } catch (err) {
    return send(res, url.pathname.startsWith('/api') ? 500 : 404, { error: String(err.message ?? err) });
  }
}).listen(PORT, () => {
  console.log(`\n  Alexandria spike — world "${world.name}"`);
  console.log(`  http://localhost:${PORT}\n`);
});
