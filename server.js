import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, extname, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Generator } from './src/claude.js';
import { buildSchema, buildSystemPrompt } from './src/schema.js';
import { validate, repairPrompt } from './src/validate.js';
import { paginate, readingTimeMs } from './src/paginate.js';
import { ENGINE_CSP, validateEngine } from './src/engine.js';
import { buildInteractiveSchema, buildInteractivePrompt, readInteractive,
         validateInteractive, offerable } from './src/interactive.js';
import { answeringTimeMs } from './src/micro.js';
import { validateManifest, errorsOnly, reportText } from './src/manifest.js';
import { declaredAssets } from './src/assets.js';
// The impure half, deliberately not in `src/`: `CONTRACT.md` invariant 3 forbids network
// there and `docs/contracts/registry.md` invariant 7 names this import as the reason.
import { installEngine, fetchIndex } from './installer.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WORLDS_ROOT = join(ROOT, 'worlds');
// THE DEFAULT WORLD, not THE world. `WORLD=<id>` still names which package a fresh
// session opens in — every existing invocation, including tools/capture-dom.md, keeps
// working — but it is now one parameter with a default rather than the single binding the
// whole process was built around. Selection travels per request from here on.
const DEFAULT_WORLD = process.env.WORLD ?? 'cartoon';

// WHERE PACKAGES COME FROM. Unset means the app runs entirely on what shipped with it, which
// is every invocation before today and stays the default — a registry is opt-in, not a
// dependency. `REGISTRY=https://…/index.json` points it at one.
const REGISTRY = process.env.REGISTRY ?? '';
const PACKAGES_ROOT = join(ROOT, 'packages');
// Hardcoding this made two worlds impossible to run side by side.
const PORT = Number(process.env.PORT ?? 4173);

// THE PACKAGES DIRECTORY. Every directory under `worlds/` holding a `world.json` is a
// package, discovered rather than named. `Alexandria - Storage` puts the drop target and
// the install location in the same folder, so enumeration is the whole install step: an
// author drags a folder in and it is there on the next boot.
//
// Every package is VALIDATED here, and that is the point of the enumeration. The failure
// policy in CONTRACT.md says a broken world fails at LOAD, not mid-session, and until now
// the only manifest rule enforced anywhere was one channel-kind throw. A package that
// fails is kept in the registry, marked broken with its named reasons, and refused at
// selection — which answers `Alexandria - Storage`'s open question in the direction that
// helps the author who dropped it in: installed-and-broken, with the reasons legible,
// rather than silently absent. What it may never do is take the other worlds down with it.
const worldFiles = async (dir, base = dir) => {
  const out = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...await worldFiles(p, base));
    else out.push({ path: relative(base, p).split(sep).join('/'), bytes: (await stat(p)).size });
  }
  return out;
};

async function loadPackage(id) {
  const dir = join(WORLDS_ROOT, id);
  const pkg = { id, dir, ok: false, world: null, problems: [], bytes: 0, lastUsedAt: null };
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dir, 'world.json'), 'utf8'));
  } catch (err) {
    // Named, never silent — and a package whose manifest will not parse cannot be run
    // through the rules that read it, so this is its own reason rather than thirty.
    pkg.problems = [{ rule: 'A0', where: 'world.json', severity: 'error',
                      reason: `world "${id}": world.json is not readable JSON — ${err.message}` }];
    return pkg;
  }
  pkg.world = manifest;
  const files = await worldFiles(dir);
  pkg.bytes = files.reduce((n, f) => n + f.bytes, 0);
  pkg.files = files.map((f) => f.path);

  // Templates are read here and handed to the validator, so rules E7-E9 and F2 see the
  // same text the projector will. Anything the path rules would reject is not opened:
  // E3 reports it, and reading it first is the traversal that rule exists to stop.
  pkg.templates = {};
  for (const [k, p] of Object.entries(manifest.screens ?? {})) {
    if (typeof p !== 'string' || p.startsWith('/') || /^[a-z]+:/i.test(p) || p.split('/').includes('..')) continue;
    try { pkg.templates[k] = await readFile(join(dir, p), 'utf8'); } catch { /* E3 reports it */ }
  }

  pkg.problems = validateManifest(manifest, { dir: id, files: pkg.files, templates: pkg.templates });
  pkg.ok = errorsOnly(pkg.problems).length === 0;
  return pkg;
}

const worlds = new Map();
for (const d of (await readdir(WORLDS_ROOT, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!d.isDirectory()) continue;
  try { await stat(join(WORLDS_ROOT, d.name, 'world.json')); } catch { continue; }  // not a package
  worlds.set(d.name, await loadPackage(d.name));
}
for (const p of worlds.values()) {
  const warnings = p.problems.filter((r) => r.severity === 'warning');
  console.log(`[world] ${p.id.padEnd(13)} ${p.ok ? 'ok     ' : 'BROKEN '} ` +
    `${(p.bytes / 1024).toFixed(0).padStart(5)}KB` +
    `${p.ok ? '' : `, ${errorsOnly(p.problems).length} error(s)`}` +
    `${warnings.length ? `, ${warnings.length} warning(s)` : ''}`);
  if (p.problems.length) console.log(reportText(p.problems));
}
if (![...worlds.values()].some((p) => p.ok)) {
  throw new Error(`no loadable world in ${WORLDS_ROOT}. Every installed package failed manifest validation.`);
}
if (!worlds.has(DEFAULT_WORLD)) {
  throw new Error(`WORLD="${DEFAULT_WORLD}" is not installed. Installed: ${[...worlds.keys()].join(', ')}`);
}
if (!worlds.get(DEFAULT_WORLD).ok) {
  throw new Error(`WORLD="${DEFAULT_WORLD}" failed manifest validation:\n` +
                  reportText(errorsOnly(worlds.get(DEFAULT_WORLD).problems)));
}

// Selection, resolved per request. `?world=<id>` on a GET, `{ world: "<id>" }` in a POST
// body, and the boot default when neither says. A missing package is a 404 and a broken
// one a 400, both named, so a chrome asking for something it should not get is told which
// of the two happened.
function pick(id) {
  const pkg = worlds.get(id || DEFAULT_WORLD);
  if (!pkg) {
    const e = new Error(`no world "${id}" is installed. Installed: ${[...worlds.keys()].join(', ')}`);
    e.status = 404;
    throw e;
  }
  if (!pkg.ok) {
    const e = new Error(`world "${pkg.id}" failed manifest validation:\n` +
                        reportText(errorsOnly(pkg.problems)));
    e.status = 400;
    throw e;
  }
  pkg.lastUsedAt = Date.now();
  return pkg;
}

// ENGINES ARE LOADED ONCE, AT STARTUP, and a broken package stops the server rather than
// surfacing mid-session. Same discipline as the world manifests above, and the failure
// policy asks for exactly this: a broken package fails at LOAD.
const engines = [];
// TWO ROOTS. `engines/` is what ships with the app, one level and unversioned. `packages/
// engines/<id>/<version>/` is what the installer writes, and `Alexandria - Storage` settles
// that layout: a version directory is written once and an update is a new SIBLING, so two
// versions can sit side by side while different sessions pin different ones.
//
// An installed package WINS over a bundled one with the same id, and the highest version
// wins among installed ones. A bundled engine is a sample; an installed one is a choice.
async function loadEngines() {
  const found = new Map();
  const take = (m, base) => {
    const bad = validateEngine(m);
    // A BUNDLED engine still throws — it ships with the app, so a broken one is our bug and
    // should stop the boot. An INSTALLED one is skipped and reported: the installer already
    // refused everything it could check, and a package that rots on disk afterwards must not
    // take the whole session down with it.
    if (bad.length) return { id: m?.id, bad };
    found.set(m.id, { ...m, _base: base });
    return null;
  };
  const problems = [];
  for (const d of await readdir(join(ROOT, 'engines'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const m = JSON.parse(await readFile(join(ROOT, 'engines', d.name, 'engine.json'), 'utf8'));
    const bad = take(m, `/engines/${d.name}`);
    if (bad) throw new Error(`engine "${d.name}": ${bad.bad.map((f) => `${f.scope}: ${f.reason}`).join('; ')}`);
  }
  const installedRoot = join(ROOT, 'packages', 'engines');
  for (const d of await readdir(installedRoot, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;      // `.staging-*` is not a package
    const versions = (await readdir(join(installedRoot, d.name), { withFileTypes: true }).catch(() => []))
      .filter((v) => v.isDirectory()).map((v) => v.name).sort();
    const version = versions[versions.length - 1];
    if (!version) continue;
    try {
      const m = JSON.parse(await readFile(join(installedRoot, d.name, version, 'engine.json'), 'utf8'));
      const bad = take(m, `/packages/engines/${d.name}/${version}`);
      if (bad) problems.push(`installed engine "${d.name}@${version}": ${bad.bad.map((f) => f.reason).join('; ')}`);
    } catch (err) {
      problems.push(`installed engine "${d.name}@${version}": ${err.message}`);
    }
  }
  for (const p of problems) console.log(`  [engine warning] ${p}`);
  return [...found.values()];
}
engines.push(...await loadEngines());
const catalog = offerable(engines);

// ONE GENERATOR PER WORLD, and lazily, because a generator is a PROCESS. The adapter
// fixes its schema at spawn and a world's schema is compiled from its own manifest, so
// worlds cannot share one. Spawning all of them at boot would multiply a 4.5-13s startup
// by however many packages happen to be installed, for worlds the student may never open;
// spawning per request would put that startup inside the wait it exists to cover. So: the
// boot default starts now, exactly as it did when there was only one, and any other world
// starts the first time it is actually asked for a module. Deterministic mode never
// reaches this at all, which is why `?fixture=` costs nothing on any world.
const generators = new Map();
function generatorFor(pkg) {
  if (!generators.has(pkg.id)) {
    generators.set(pkg.id, new Generator({
      schema: buildSchema(pkg.world),
      model: process.env.MODEL ?? 'claude-haiku-4-5-20251001',
      systemPrompt: buildSystemPrompt(pkg.world),
    }).start());
  }
  return generators.get(pkg.id);
}
generatorFor(worlds.get(DEFAULT_WORLD));

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

async function buildModule(pkg, question) {
  const world = pkg.world;
  const gen = generatorFor(pkg);
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
    // THE BEATS TRAVEL WITH THE MODULE, and they have to. The boundary chooser is handed
    // this object to decide what plays next, and it reads `beats` — which was never here,
    // so every card set was generated from the literal string "(nothing)" and came back
    // asking content-free questions like "what topic did you just learn about?". Screens
    // are the projector's shape; beats are the material.
    beats,
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
    // THE LISTING. What is installed, whether it loads, and what the Settings list in
    // `Alexandria - Storage` needs against each row: size, last used, and the reasons a
    // broken package is broken. Switch / reveal / evict are the chrome's to draw; this is
    // the data behind them, and `reveal` is already a `window.alexandria` call.
    if (url.pathname === '/api/worlds') {
      return send(res, 200, {
        default: DEFAULT_WORLD,
        worlds: [...worlds.values()].map((p) => ({
          id: p.id,
          name: p.world?.name ?? p.id,
          version: p.world?.version ?? null,
          archetype: p.world?.archetype ?? null,
          ok: p.ok,
          bytes: p.bytes,
          // In-process only: there is no ledger yet, so this is "used since this server
          // started" and not a durable fact. Named honestly rather than faked.
          lastUsedAt: p.lastUsedAt,
          problems: p.problems,
        })),
      });
    }
    // WHAT A GALLERY READS. `docs/contracts/registry.md` lists this as one of the three
    // things still blocking the website, and the smallest: worlds already had `/api/worlds`
    // and engines were validated at boot and never exposed, so a page listing engines had
    // nothing to read.
    //
    // `offerable` is NOT applied. This is a catalogue of what is installed, and the test
    // fixtures are installed — hiding them here would make the endpoint disagree with the
    // folder, which is a worse lie than showing a package whose subject starts with `_`.
    // The filter belongs where it already is, on what may be offered to a STUDENT.
    // THE INDEX, FETCHED IN NODE. `registry.md`: the browser never speaks to the registry, so
    // CORS never applies and no engine URL ever names a remote origin — Alexandria downloads
    // the bytes and serves them from its own server.
    if (url.pathname === '/api/registry') {
      if (!REGISTRY) return send(res, 200, { configured: false });
      try {
        return send(res, 200, { configured: true, url: REGISTRY, index: await fetchIndex(REGISTRY) });
      } catch (err) {
        return send(res, 200, { configured: true, url: REGISTRY, error: String(err.message) });
      }
    }
    // An ID AND A VERSION, and nothing else. `registry.md` is explicit that a URL or a path in
    // this slot would put the caller — and through it the model — into the supply chain, so
    // the archive location and the digest are read from the index rather than accepted here.
    if (url.pathname === '/api/install' && req.method === 'POST') {
      if (!REGISTRY) return send(res, 503, { error: 'no registry configured; set REGISTRY=<index url>' });
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { id, version } = JSON.parse(body || '{}');
      const index = await fetchIndex(REGISTRY);
      const out = await installEngine({ id, version }, { index, indexUrl: REGISTRY, packagesRoot: PACKAGES_ROOT });
      if (!out.ok) {
        console.log(`[install] ${id}@${version} refused: ${out.failures.map((f) => f.reason).join('; ')}`);
        return send(res, 400, { ok: false, failures: out.failures });
      }
      // Re-enumerate so the package is servable and listed immediately. It is NOT offerable
      // to the chooser until the interactive generator respawns: the adapter fixes its schema
      // at spawn, so the enum of engine ids that process was started with is the enum it has.
      // Said in the response rather than left for someone to discover.
      engines.length = 0;
      engines.push(...await loadEngines());
      console.log(`[install] ${id}@${version} -> ${out.path.replace(ROOT, '')}${out.already ? ' (already present)' : ''}`);
      return send(res, 200, { ok: true, already: out.already, offerableAfterRestart: true, engines: engines.length });
    }
    if (url.pathname === '/api/engines') {
      return send(res, 200, {
        engines: engines.map((e) => ({
          id: e.id,
          name: e.name,
          subject: e.subject,
          version: e.version ?? null,
          author: e.author ?? null,
          // Author-declared today, which `registry.md` records as open: nothing verifies it
          // and the tier rule that would consume it is not written. Passed through rather
          // than dressed up.
          review: e.review ?? null,
          scored: e.scored ?? null,
          levels: e.levels ?? [],
          kinds: Object.keys(e.taskSpace ?? {}),
          // Every engine here validated at boot — the loader throws rather than serving a
          // broken one — so `ok` is constant true by construction. It is present so the
          // shape matches `/api/worlds`, where a broken package IS kept and reported.
          ok: true,
          offerable: !String(e.subject ?? '').startsWith('_'),
        })),
      });
    }
    if (url.pathname === '/api/world') {
      const pkg = pick(url.searchParams.get('id'));
      const screens = {};
      for (const [k, p] of Object.entries(pkg.world.screens)) screens[k] = await readFile(join(pkg.dir, p), 'utf8');
      return send(res, 200, {
        id: pkg.id,
        world: pkg.world,
        screens,
        // A world without a stylesheet is a world, not an error: `Alexandria - World
        // Spec` says the minimum world is one file plus a folder of images. It gets the
        // presets and nothing else rather than a 500 that blanks the stage.
        css: await readFile(join(pkg.dir, 'styles.css'), 'utf8').catch(() => ''),
        // THE WORKING SET, so the projector can warm it before it mounts. Every URL comes
        // from `src/assets.js`, which is the only place a path is built — the projector
        // preloads a list it was handed rather than composing one, exactly as it renders
        // from a resolver rather than joining a string.
        assets: [...new Set(Object.values(declaredAssets(pkg.world)).flatMap((m) => Object.values(m)))],
      });
    }
    // CAPTURE HARNESS, off unless SNAPSHOT=1. The projector is browser code, so the DOM
    // snapshots in the golden fixture cannot be produced from Node. tools/capture-dom.md
    // documents the run. Never enabled by `npm start`.
    if (url.pathname === '/api/_snapshot' && req.method === 'POST' && process.env.SNAPSHOT === '1') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { variant, snapshots, world: from } = JSON.parse(body);
      // The capture names the world it was taken FROM, so a session that switched worlds
      // cannot write cartoon's stack into the visual novel's directory. Defaults to the
      // boot world, which is how tools/capture-dom.md drives it.
      const id = pick(from).id;
      const dir = join(ROOT, 'fixtures', 'dom', `${id}.${variant}`);
      await mkdir(dir, { recursive: true });
      for (const [name, html] of Object.entries(snapshots)) {
        await writeFile(join(dir, `${name}.html`), indent(html) + '\n');
      }
      console.log(`[snapshot] ${id}.${variant}: ${Object.keys(snapshots).length} files`);
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
      const { question, fixture, world: from } = JSON.parse(body || '{}');
      const pkg = pick(from ?? url.searchParams.get('world'));

      // DETERMINISTIC MODE. `{ fixture: "max" }` renders the blessed module from
      // fixtures/beats/ and never touches the adapter, so the app runs on zero quota.
      // It is what the DOM snapshots capture, and what makes the chrome and projector
      // workable without spending a student's subscription on every reload.
      if (fixture) {
        const mod = JSON.parse(await readFile(join(ROOT, 'fixtures', 'beats', `${pkg.id}.${fixture}.json`), 'utf8'));
        console.log(`[module] ${pkg.id} fixture "${fixture}" -> ${mod.beats.length} beats, no model call`);
        return send(res, 200, {
          screens: paginate(pkg.world, mod.beats, mod),
          beats: mod.beats,
          degraded: false, remainingFailures: [],
          metrics: { fixture, beats: mod.beats.length, readingTimeMs: readingTimeMs(pkg.world, mod.beats, mod),
                     wallMs: 0, repairs: 0, attempts: 0, costUsd: 0,
                     // Reported only if a generator for this world already exists.
                     // Deterministic mode must never be the thing that spawns one.
                     startupMs: generators.get(pkg.id)?.startupMs ?? 0,
                     apiKeySource: generators.get(pkg.id)?.apiKeySource ?? 'none',
                     ttftMs: 0, cacheReadTokens: 0 },
        });
      }

      const gen = generatorFor(pkg);
      if (gen.unavailable) return send(res, 503, { error: gen.unavailable, setup: true });
      const t = await buildModule(pkg, question || 'Teach me something interesting.');
      console.log(`[module] ${pkg.id} "${question}" -> ${t.metrics.beats} beats, ${t.metrics.wallMs}ms, ${t.metrics.repairs} repair(s), $${t.metrics.costUsd}`);
      return send(res, 200, t);
    }
    // ENGINE PACKAGES, served with a CSP that blocks EGRESS. An engine is third-party
    // code, so the iframe's `sandbox` attribute contains the DOM and this header contains
    // the network; neither is sufficient alone. `ENGINE_CSP` names what it blocks rather
    // than what it allows, because `'self'` matches nothing from an opaque origin — the
    // reasoning is written down in `src/engine.js`.
    if (url.pathname.startsWith('/engines/') || url.pathname.startsWith('/packages/engines/')) {
      const f = join(ROOT, url.pathname);
      // Containment, the same invariant a world package has. `new URL()` already collapses
      // `..`, so this catches the encoded forms and anything a future caller invents. Both
      // roots get it: an installed package is community code and has LESS claim to trust
      // than a bundled one, not more.
      const engineRoot = url.pathname.startsWith('/packages/')
        ? join(ROOT, 'packages', 'engines') : join(ROOT, 'engines');
      if (!f.startsWith(engineRoot)) throw new Error('path escapes the engines root');
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
      // `src/archetypes.js` is shared for the third time and for the same reason: the
      // manifest validator has to know from Node which archetypes exist and which
      // readouts each publishes, and the projector has to render them. One table.
      : url.pathname === '/src/archetypes.js'
      ? join(ROOT, 'src', 'archetypes.js')
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
    // `pick()` carries its own status: 404 for a package that is not installed, 400 for
    // one that is installed and broken. The difference is the whole point of keeping a
    // failed package in the registry rather than dropping it.
    const fallback = url.pathname.startsWith('/api') ? 500 : 404;
    return send(res, err.status ?? fallback, { error: String(err.message ?? err) });
  }
}).listen(PORT, () => {
  const list = [...worlds.values()]
    .map((p) => (p.id === DEFAULT_WORLD ? `${p.id}*` : p.ok ? p.id : `${p.id} (broken)`)).join(', ');
  console.log(`\n  Alexandria spike — ${worlds.size} world(s): ${list}`);
  console.log(`  http://localhost:${PORT}\n`);
});
