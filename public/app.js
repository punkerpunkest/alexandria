// The PROJECTOR: the component that executes a world package. Owns WHEN things
// change; the world owns what that looks like. Vocabulary is fixed in the vault
// note `Alexandria - Glossary` — read it before renaming anything in here.
//
// MOTION MODEL (see `Alexandria - Rendering`): this file never plays an
// animation and never reads one from the manifest. It PUBLISHES STATE onto the
// DOM and the world's CSS reacts. Worlds ship no JavaScript, so a reactive
// language is the only kind they can speak. Growing the published vocabulary is
// a change to this file, which is why it is designed against the visual novel
// rather than against whichever world happens to exist.
import { resolveAsset } from '/src/assets.js';
import { playSet } from '/micro-card.js';
// The plotter is runtime knowledge, in the same category as the archetype map below:
// a world declares that a slot holds a figure, and the runtime knows what a figure is.
// It lives in `public/` because the browser is where it draws, and `src/schema.js` and
// `src/validate.js` import the grammar FROM here rather than restating it, so the
// enum the model is given and the shapes the plotter can draw cannot drift apart.
import { plot } from '/plot.js';
// `public/host.js` is the chrome-to-host surface. It is deliberately NOT imported here:
// the projector never talks to the application, and this file already uses `host` for the
// shadow host, which is the older meaning and therefore the one that keeps the word.

const $ = (s) => document.querySelector(s);
const stage = $('#stage');

// The archetype table MOVED to `src/archetypes.js`, unchanged. It had to become
// Node-readable so the manifest validator can reject an unknown archetype at LOAD
// (rule A9) and check a world's readouts against the ones its archetype publishes
// (rule E9) — and this file cannot be imported from Node. One table, two readers,
// no drift. What an archetype means is still entirely runtime knowledge.
import { ARCHETYPES } from '/src/archetypes.js';

// The world declares a duration, the runtime clamps and scales it. The clamp is
// last so the ceiling is a real ceiling: motion is never allowed to be the
// reason a beat was slow to arrive. SPEED becomes a user setting later.
const MOTION_CEILING_MS = 600;
const MOTION_FLOOR_MS = 80;
const SPEED = 1;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

// EVERYTHING BELOW THAT NAMES A WORLD IS NOW PER-MOUNT, not per-session. `world`,
// `templates`, `worldCss` and `archetype` used to be bound once at module evaluation,
// which is the browser half of the same "one world, chosen by an env var" shortcut the
// server had. They are rebound by `adopt()` on every mount, and `unmount()` is what
// guarantees nothing from the previous one is still reachable when that happens.
// `presetCss` is Alexandria's own sheet and is deliberately NOT in that set: it is
// fetched once and reused, because it belongs to the runtime rather than to a world.
let world, worldId, templates, worldCss, archetype, presetCss, host, root, stack;
let screens = [], at = 0, prev = null;
// What each slot is actually SHOWING. Not the same as the previous screen's fill: a
// slot the fill does not mention keeps its value, so the two diverge the moment a
// beatless screen has no opinion about a persisted slot.
let rendered = new Map();
let current = null, leaving = null, panelWatcher = null, busy = false;
let persisted = new Map();          // data-persist key -> the one live node

// Alexandria's own presets, fetched once. The world's sheet is fetched per world, with
// the world, and lives in `worldCss`.
presetCss = await fetch('/presets.css').then((r) => r.text());

function motionMs() {
  if (reduced.matches) return 0;
  const declared = world.motion?.duration ?? 240;
  return Math.min(Math.max(Math.round(declared * SPEED), MOTION_FLOOR_MS), MOTION_CEILING_MS);
}

// A world's stylesheet is written package-relative. It gets injected into a shadow
// root, where relative URLs would otherwise resolve against the document. Rewrite
// them to the package, and leave data: and absolute URLs alone. This is also where
// the off-package URL rejection from `Alexandria - Rendering` will live.
// `id` is a parameter rather than a read of the module-level world, because the preloader
// rewrites the INCOMING world's sheet while the outgoing one is still mounted.
function packageRelative(css, id = world.id) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, quote, url) =>
    /^(data:|https?:|\/\/|\/)/i.test(url) ? whole : `url(${quote}/worlds/${id}/${url}${quote})`);
}

// THE PANEL CONTRACT.
// A world declares `viewport` as a box it was designed against, and the runtime's
// job is to SATISFY it, never to hand the world something it was never verified
// in. Above the floor the world simply gets the real box and scales fluidly.
// Below it, the world is still given its declared box — so its own container
// units resolve exactly as its author verified — and the whole result is scaled
// down to fit. Type shrinking then means "the window is smaller than this world
// supports", which is a different situation from text failing to fit, and is the
// only reason `Alexandria - World Spec`'s no-shrinking-type rule is not violated.
function fitPanel() {
  if (!stack) return;
  const vp = world.viewport ?? {};
  const box = stage.getBoundingClientRect();
  if (!box.height || !box.width) return;                 // not laid out yet

  let w = box.width, h = box.height, scale = 1;

  // BOTH axes matter. Type is fixed in px while a world's columns are usually a
  // proportion of the panel, so a narrower panel wraps the same text into more
  // lines and grows the block that holds it. A height-only floor passes at one
  // width and collides at another — measured, see world.json `_measured`.
  const need = Math.max(
    vp.minWidth ? vp.minWidth / box.width : 0,
    vp.minHeight ? vp.minHeight / box.height : 0,
    1);
  if (need > 1) {
    scale = 1 / need;
    w = Math.max(box.width * need, vp.minWidth ?? 0);
    h = Math.max(box.height * need, vp.minHeight ?? 0);
  }
  if (vp.aspect) {
    // A declared aspect is authored art: preserve the shape and letterbox.
    const [lo, hi] = Array.isArray(vp.aspect) ? vp.aspect : [vp.aspect, vp.aspect];
    const have = w / h;
    if (have > hi) w = h * hi;                           // too wide  -> pillarbox
    else if (have < lo) h = w / lo;                      // too tall  -> letterbox
  }

  stack.style.width = `${w}px`;
  stack.style.height = `${h}px`;
  // The host is a flex container (below), and a flex item's default shrink would
  // pull the stack straight back to the container width — silently undoing the
  // width computed above whenever the world is scaled up past the real box.
  stack.style.flexShrink = '0';
  // Centre AFTER scaling, never before. Flex alignment positions the UNSCALED box,
  // so centring a 772px-tall layout inside a 572px host puts its top at -100 and
  // `transform-origin: top` then scales from that offset — the panel ends up above
  // the stage and its top strip (here, the progress bar) is clipped away.
  const freeY = Math.max(0, box.height - h * scale);
  stack.style.transformOrigin = 'top center';
  stack.style.transform =
    scale === 1 && !freeY ? '' : `translateY(${(freeY / 2).toFixed(2)}px) scale(${scale})`;

  host.style.display = 'flex';
  host.style.justifyContent = 'center';     // horizontal centring is safe: origin is centred too
  host.style.alignItems = 'flex-start';
}

function mount() {
  host = document.createElement('div');
  host.style.height = '100%';
  root = host.attachShadow({ mode: 'open' });          // isolation: world CSS cannot reach the chrome

  // Presets FIRST, the world SECOND. Cascade order is the override mechanism;
  // there is no resolution logic to test because the browser is the resolver.
  const presets = document.createElement('style');
  presets.textContent = presetCss;
  const style = document.createElement('style');
  style.textContent = packageRelative(worldCss);
  root.append(presets, style);

  // The projector owns the box that screens and persisted elements share.
  stack = document.createElement('div');
  stack.className = 'stack';
  root.append(stack);

  current = null; leaving = null; persisted = new Map();
  stage.replaceChildren(host);

  // After attachment, so the stage has a real box to measure. The observer also
  // fires once on observe(), which covers the first layout.
  fitPanel();
  panelWatcher?.disconnect();
  panelWatcher = new ResizeObserver(() => fitPanel());
  panelWatcher.observe(stage);
}

// THE OTHER HALF OF MOUNT, and it did not exist while there was only ever one world.
// `mount()` is called once per module and replaces the stack; this is called once per
// WORLD and has to leave nothing of the previous one reachable at all.
//
// The reason it is short is structural rather than lucky: every single thing a world puts
// on the page — its presets sheet, its own stylesheet, the stack, the screens, and the
// nodes the projector hoisted out of screens because the world marked them
// `data-persist` — lives under one shadow host. So the teardown is one removal plus the
// bookkeeping that outlives the DOM. The bookkeeping is the part worth being explicit
// about: `persisted` holds live references to hoisted nodes, and `hoist` consults that map
// BEFORE it looks at the DOM, so a stale entry would hand the next world an element from
// the last one and never notice.
function unmount() {
  // Timers and observers first, so nothing can reach into a tree that is about to go.
  panelWatcher?.disconnect();
  panelWatcher = null;
  // A screen still playing its exit is holding a `settleWhenDone` promise; both of its
  // resolutions are guarded (`leaving !== node`, `node.isConnected`), so dropping the
  // references here is enough to make them no-ops.
  current = null;
  leaving = null;

  host?.remove();
  stage.replaceChildren();
  host = root = stack = null;

  persisted = new Map();
  rendered.clear();
  screens = []; at = 0; prev = null;

  // The bank was written for the OUTGOING world's module — it is that module's follow-on
  // interactive. Carrying it across would put one world's boundary inside another's
  // session, which is the one thing `Alexandria - Rendering` rules out outright: two
  // worlds are never composited, and swapping happens at a boundary.
  banked = null;
  bankRun = null;

  // Chrome state that was derived from the world's templates, not from the world.
  document.body.classList.remove('world-controls', 'world-progress');
  $('#worldname').textContent = '—';
  $('#progress').textContent = '';
}

// Bind a fetched package. Everything here is a function of the payload and nothing of it
// survives the next `unmount()`.
function adopt(payload) {
  worldId = payload.id;
  world = payload.world;
  templates = payload.screens;
  worldCss = payload.css;

  archetype = ARCHETYPES[world.archetype];
  // Still thrown here, and it is now the SECOND line of defence rather than the first:
  // manifest rule A9 rejects an unknown archetype at load, in Node, where a person can
  // read the error. This one catches a projector and a validator that have drifted apart.
  if (!archetype) throw new Error(`unknown archetype "${world.archetype}"`);

  $('#worldname').textContent = world.name;

  // Does this world dress its own controls, or fall back to the chrome's?
  const declares = (attr) => Object.values(templates).some((t) => t.includes(attr));
  document.body.classList.toggle('world-controls', declares('data-slot="controls"'));
  document.body.classList.toggle('world-progress', declares('data-readout="progress"'));

  // A control's EXISTENCE is an archetype fact, so it is re-derived per world rather than
  // toggled. Switching from `paginated` to `scene-sequential` has to remove Back, not hide
  // it — the click handler and the ArrowLeft binding both consult `archetype` live, which
  // is what makes the removal real rather than cosmetic.
  $('#back').hidden = !archetype.controls.back;
  $('#next').hidden = !archetype.controls.next;
}

// PRELOAD BEFORE MOUNT. `Alexandria - Storage`: switching world is a BOUNDARY EVENT, the
// new world preloads before it mounts, and the student never watches a loading state.
// Both halves of that are load-bearing here.
//
// It runs while the OUTGOING world is still on screen, which is what makes the wait
// invisible — the same trick as everywhere else in this codebase, hiding a cost behind
// something the student is already looking at. And it is BOUNDED: `degrade, never wait`
// means a slow package mounts with cold assets rather than holding the boundary open
// indefinitely, so the deadline is a real deadline and not a timeout that never fires.
//
// Decoding matters as much as fetching. An image that has been fetched but not decoded
// still costs a decode at first paint, and that is the sprite pop-in mid-scene that
// `Alexandria - Rendering` names as the only realistic source of in-session lag. `decode()`
// is what turns the render into a lookup.
const PRELOAD_DEADLINE_MS = 4000;
function preload(payload) {
  const images = payload.assets ?? [];
  // Fonts and any other `url()` in the world's stylesheet. They are not in `assets` —
  // that list is the manifest's declared asset sets — but they are fetched the instant the
  // sheet is attached, so warming the HTTP cache here is the difference between text
  // appearing in the world's face and text appearing in a fallback first.
  const inCss = [...packageRelative(payload.css ?? '', payload.id)
    .matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]).filter((u) => !/^data:/i.test(u));

  const total = images.length + inCss.length;
  if (!total) return Promise.resolve({ warmed: 0, total: 0, timedOut: false });

  let warmed = 0;
  const image = (url) => new Promise((done) => {
    const img = new Image();
    // A miss is not the boundary's problem to report: manifest rule E1 checks every
    // declared asset against the package at LOAD, so anything 404ing here was already
    // named there. Degrade past it rather than stalling the switch.
    img.onerror = () => done();
    img.onload = () => {
      warmed++;
      done();
      // DECODE IS FIRED AND NEVER AWAITED, which cost a measurement to learn. `decode()`
      // is the call that turns first paint into a lookup, but it runs on the rendering
      // pipeline, and in a HIDDEN tab that pipeline is throttled: measured on 28 Aug, an
      // asset loads in 15ms and its `decode()` promise is still unsettled two and a half
      // seconds later. Awaiting it meant a switch made with the window occluded burned
      // the whole deadline and mounted 0/29 warm — the preloader defeating itself in
      // exactly the case it was meant to cover. Bytes in cache is the guarantee; a warm
      // decode is the bonus, and it lands on its own whenever the tab is visible.
      img.decode?.().catch(() => {});
    };
    img.src = url;
  });
  const other = (url) => fetch(url).then(() => { warmed++; }).catch(() => {});

  let timedOut = true;
  return Promise.race([
    Promise.all([...images.map(image), ...inCss.map(other)]).then(() => { timedOut = false; }),
    new Promise((r) => setTimeout(r, PRELOAD_DEADLINE_MS)),
  ]).then(() => ({ warmed, total, timedOut }));
}

async function fetchWorld(id) {
  const r = await fetch('/api/world' + (id ? `?id=${encodeURIComponent(id)}` : ''));
  const payload = await r.json().catch(() => ({}));
  // A package that failed manifest validation answers 400 with every named reason. It has
  // already been refused at load; this is the browser being told why rather than being
  // handed an `undefined` world and throwing a TypeError into a blank stage.
  if (!r.ok) throw new Error(payload.error ?? `/api/world -> HTTP ${r.status}`);
  return payload;
}

// Fetch, warm, tear down, mount. In that order for a SWITCH, and the order is the whole
// design: the outgoing world is not removed until the incoming one is ready to take the
// screen, so the warm-up happens behind a world the student is still looking at.
//
// THE FIRST MOUNT IS THE EXCEPTION, and it has to be. There is no outgoing world to hide
// behind, and `Alexandria - Cold Start` stage 0 is "painted locally with no model call at
// all" and "never blocks" — so waiting on a working set before the first frame trades the
// one guarantee stage 0 exists to make for a warmth nothing has asked for yet.
//
// It is also a measured deadlock rather than a principle applied for its own sake. This
// module's top-level `await` runs during document load, and a `new Image()` started there
// is low priority: the browser defers it until loading settles, and loading cannot settle
// while this await is outstanding. The visual novel's 29 assets warmed 0/29 in 4s that
// way, against 29/29 in 578ms as a switch from an already-painted page. So the first world
// paints and then warms, and every switch after it warms and then paints.
async function openWorld(id) {
  const t0 = performance.now();
  const payload = await fetchWorld(id);
  const isSwitch = !!host;
  const warm = isSwitch ? await preload(payload) : null;

  unmount();
  adopt(payload);
  if (!openingFrame()) setStatus('world declares no ask screen; nothing to paint at stage 0');

  console.log(`[world] mounted "${payload.id}" — ` +
    (warm ? `${warm.warmed}/${warm.total} asset(s) warm${warm.timedOut ? ' (deadline hit, mounted anyway)' : ''}, `
          : 'first mount, warming behind stage 0, ') +
    `${Math.round(performance.now() - t0)}ms`);

  // Not awaited, deliberately: the frame is already on screen and this is stage 5's
  // "streams in the background" applied to the world the session started in.
  if (!isSwitch) {
    preload(payload).then((w) =>
      console.log(`[world] "${payload.id}" working set warm: ${w.warmed}/${w.total}`));
  }
  return payload;
}

// A switch is a boundary, and a boundary is not a moment mid-generation. Refusing while a
// module is in flight is the same rule as "applied at a boundary, never mid-scene": the
// alternative is a module written against one world's channels rendering into another's
// templates, which is the exact leak the shadow root cannot catch.
let switching = false;
async function switchWorld(id) {
  if (switching || busy || id === worldId) return false;
  switching = true;
  try {
    await openWorld(id);
    const sel = document.getElementById('dev-world');   // dev only; absent by default
    if (sel) sel.value = worldId;
    // Deterministic mode is sticky per session, so a switch inside it renders the new
    // world's blessed module rather than stranding the student on stage 0.
    if (stickyFixture) await askFor(null, stickyFixture);
    return true;
  } catch (err) {
    setStatus(`could not switch world: ${err.message}`);
    return false;
  } finally {
    switching = false;
  }
}

// DEV ONLY, and gated on `?dev=1` so it is absent from the chrome by default.
//
// The Settings list of installed worlds — size, last used, and switch / reveal / evict
// against each — is a CHROME surface in the chrome's voice (`Alexandria - Storage`), and
// the chrome is another lane's. This is deliberately NOT that: it is a bare `<select>`
// that exercises the switching mechanism so it can be driven and screenshotted without
// pre-empting a design this lane has no business making. `/api/worlds` is the surface the
// real list will be built on; this is the smallest possible consumer of it.
async function devWorldSwitcher() {
  const { worlds } = await fetch('/api/worlds').then((r) => r.json());
  const sel = document.createElement('select');
  sel.id = 'dev-world';
  sel.title = 'dev only — switch world';
  sel.style.cssText = 'margin-left:.75rem;font:inherit;font-size:.75rem';
  for (const w of worlds) {
    const o = document.createElement('option');
    o.value = w.id;
    o.textContent = `${w.name} · ${(w.bytes / 1024 / 1024).toFixed(1)}MB${w.ok ? '' : ' · BROKEN'}`;
    o.disabled = !w.ok;
    o.selected = w.id === worldId;
    sel.append(o);
  }
  sel.addEventListener('change', () => switchWorld(sel.value));
  document.querySelector('header').append(sel);
  // Same reasoning, for anything driving the app programmatically.
  globalThis.__alexandriaDev = { switchWorld, openWorld, worlds };
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Beat channels and module channels are both channels; only their scope differs.
const channelFor = (key) => world.channels[key] ?? world.module?.channels?.[key];

// Asset URLs are the loader's business, not the projector's. This file no longer knows
// about the `assets/` folder, the hyphen, the flat layout, the scheme, or the version
// segment that versioned installs will add. See `Alexandria - Storage`.
const assetUrl = (ch, name, values) => resolveAsset(world, ch, name, values);

// Attribute lookups are root-INCLUSIVE: a persisted element is frequently the
// slot itself (Cartoon's teacher is one <img> carrying both data-persist and
// data-slot), so querySelectorAll alone would miss it.
function marked(el, attr) {
  const out = el.hasAttribute(attr) ? [el] : [];
  out.push(...el.querySelectorAll(`[${attr}]`));
  return out;
}
const across = (scopes, attr) => scopes.flatMap((s) => marked(s, attr));

// PERSISTENCE. The world declares data-persist="<key>" on an element that should
// outlive a screen change; the projector hoists it out of the per-screen
// lifecycle into the shared stack. Without this an element is a fresh node on
// every navigation, and a browser can only animate between two states of ONE
// element — so no crossfade, and any idle loop restarts from frame zero.
// Never a rule about a particular world: the key is whatever the world chose.
// `prune` exists for the continuous archetype, which hoists from EVERY screen before
// any of them is filled. Pruning per node would then delete a key the first screen
// declared the moment a later screen did not, so that path hoists with prune off and
// prunes once at the end. The default keeps the one-screen-at-a-time path unchanged.
function hoist(node, prune = true) {
  const declared = new Set();
  for (const fresh of marked(node, 'data-persist')) {
    const key = fresh.dataset.persist;
    declared.add(key);
    fresh.remove();                       // it never belongs to a screen
    if (persisted.has(key)) continue;     // the live one is already on the stack
    // Persisted elements sit BEHIND screens: a visual novel's background and
    // standing sprite both want that, and nothing so far wants the reverse.
    const firstScreen = stack.querySelector('[data-phase]');
    if (firstScreen) stack.insertBefore(fresh, firstScreen); else stack.append(fresh);
    // Controls must stay reachable no matter where a world put them. Screens are
    // appended after persisted elements and fill the whole cell, so a hoisted
    // control bar would otherwise sit UNDER a transparent screen and receive
    // nothing. The presets sheet lifts anything stamped here above the screens.
    if (marked(fresh, 'data-slot').some((n) => n.dataset.slot === 'controls')) fresh.dataset.layer = 'controls';
    persisted.set(key, fresh);
  }
  // A key the incoming screen no longer declares has left the stage.
  if (prune) prunePersisted(declared);
  return declared;
}

function prunePersisted(declared) {
  for (const [key, node] of persisted) {
    if (!declared.has(key)) { node.remove(); persisted.delete(key); }
  }
}

// Returns the slot keys whose RENDERED value actually moved, which is what
// `data-changed` must be keyed on. Comparing the previous screen's fill instead marked
// a slot changed whenever the previous screen merely had no opinion about it — so
// stepping back off the beatless closing screen animated a byte-identical image.
// A channel's value is normally a primitive, so identity is the right comparison. A
// diagram's value is an object, and two structurally identical specs are never `===`,
// which would mark the slot changed on every screen. Compare those by content.
const sameValue = (a, b) =>
  a === b || (a && b && typeof a === 'object' && typeof b === 'object' &&
              JSON.stringify(a) === JSON.stringify(b));

function fill(scopes, values) {
  const changed = new Set();
  for (const slot of across(scopes, 'data-slot')) {
    const key = slot.dataset.slot;
    if (key === 'controls' || key === 'ask') continue;   // runtime-owned, filled below
    const ch = channelFor(key);
    // A slot the fill does not mention KEEPS its current value. This is what lets a
    // beatless screen inherit the persisted teacher's pose rather than blanking her
    // src to `mascot-undefined.webp`.
    //
    // An OPTIONAL channel is the exception, and it has to be: "absent" is a meaningful
    // state for one, not an absence of opinion. A beat with no figure that inherited
    // the previous beat's figure would be showing a graph of something it is not
    // talking about, which is worse than showing nothing.
    if (!(key in values)) {
      if (ch?.optional && rendered.has(key)) { clear(slot, ch); rendered.delete(key); changed.add(key); }
      continue;
    }
    if (!sameValue(rendered.get(key), values[key])) changed.add(key);
    rendered.set(key, values[key]);
    // The spec travels as DATA all the way here and becomes markup only at the last
    // step, drawn by our own pure function. The model never emits markup, which is the
    // rule that makes injecting this safe -- see `Alexandria - PoC Flow`, Longform.
    if (ch?.kind === 'diagram') slot.innerHTML = values[key] == null ? '' : plot(values[key]);
    else if (ch?.set) slot.src = assetUrl(ch, values[key], values);
    else slot.textContent = values[key] ?? '';
  }
  return changed;
}

function clear(slot, ch) {
  if (ch.kind === 'diagram') slot.innerHTML = '';
  else if (ch.set) slot.removeAttribute('src');
  else slot.textContent = '';
}

// The ask. The runtime owns the input, focus and submit — forced, since a world ships
// no JavaScript and cannot implement one. The world owns only where it appears and
// what it is. See `Alexandria - Design`, "The ask — a world slot, not chrome furniture".
function renderAsk(scopes) {
  for (const slot of across(scopes, 'data-slot')) {
    if (slot.dataset.slot !== 'ask' || slot.dataset.built) continue;
    slot.dataset.built = '1';
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.ask = 'input';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'What do you want next?');
    const go = document.createElement('button');
    go.type = 'submit';
    go.dataset.ask = 'submit';
    go.textContent = 'Go';
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (q) askFor(q);
    });
    slot.replaceChildren(form);
    requestAnimationFrame(() => input.focus());
  }
}

// The archetype's control set, rendered into whatever slot the world provided.
// Built once per slot ELEMENT: a persisted control bar keeps its nodes across
// navigations, so hover and :active survive and only state is re-synced.
function renderControls(scopes) {
  for (const slot of across(scopes, 'data-slot')) {
    if (slot.dataset.slot !== 'controls' || slot.dataset.built) continue;
    slot.dataset.built = '1';
    slot.replaceChildren(...Object.entries(archetype.controls).map(([name, def]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.control = name;               // the hook a world's stylesheet targets
      b.textContent = def.label;
      b.setAttribute('aria-label', def.aria);
      b.addEventListener('click', () => go(def.step));
      return b;
    }));
  }
}

// Runtime state a world may display. The value arrives as a custom property so
// the world's CSS decides whether it is a bar, a dot row, or nothing at all.
// Persisting the element is what lets a world TRANSITION the value rather than
// jump it — on a fresh node there is no previous value to interpolate from.
function renderReadouts(scopes) {
  // Progress is position through a module. The opening frame is not in one, so it
  // reads zero rather than a full bar for a module that has not been written yet.
  const hasModule = screens.some((s) => s.beats.length);
  const value = hasModule ? (at + 1) / screens.length : 0;
  for (const r of across(scopes, 'data-readout')) {
    if (r.dataset.readout === 'progress') r.style.setProperty('--progress', String(value));
  }
}

function syncControls(scopes) {
  for (const el of across(scopes, 'data-control')) {
    const def = archetype.controls[el.dataset.control];
    if (!def) continue;
    if (def.hidden)   el.hidden   = def.hidden(at, screens.length);
    if (def.disabled) el.disabled = def.disabled(at, screens.length);
  }
}

// Everything the world's CSS is able to hear. Nothing here names a world.
function publish(node, values, nav, scopes, changed) {
  node.dataset.phase = 'entering';
  node.dataset.nav = nav;
  if (values.kind) node.dataset.kind = values.kind; else delete node.dataset.kind;

  // Set on the stack, not the screen, so hoisted SIBLINGS inherit it too;
  // screens inherit it either way.
  stack.style.setProperty('--motion-duration', `${motionMs()}ms`);

  // Clear stale marks and flush layout before re-marking. A persisted element
  // keeps its attributes across navigations, and re-adding an attribute in the
  // same frame it was removed does not restart a CSS animation.
  const slots = across(scopes, 'data-slot');
  for (const s of slots) s.removeAttribute('data-changed');
  void stack.offsetWidth;

  if (prev) {
    for (const s of slots) {
      const key = s.dataset.slot;
      if (key === 'controls' || key === 'ask' || !channelFor(key)) continue;
      if (changed.has(key)) s.setAttribute('data-changed', '');
    }
  }

  // `entering` must OUTLAST the world's entrance, not end on the next frame: the
  // moment the attribute changes the selector stops matching, animation-name
  // reverts to none, and a half-played animation is cancelled. The runtime cannot
  // know a world's delays — Cartoon staggers its card behind its bubble — so ask
  // the browser what is actually running rather than guessing a number.
  settleWhenDone(node, MOTION_CEILING_MS * 3).then(() => {
    if (node.isConnected && node.dataset.phase === 'entering') node.dataset.phase = 'settled';
  });
}

// Resolves when every animation and transition in this subtree has finished, or
// at `cap` — whichever lands first. The rAF is what lets styles resolve so the
// animations exist to be found; the timer is what keeps a backgrounded tab (where
// rAF never fires) from stranding a screen mid-phase.
function settleWhenDone(node, cap) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, cap);
    requestAnimationFrame(() => {
      const running = node.getAnimations({ subtree: true });
      if (!running.length) { clearTimeout(timer); return finish(); }
      Promise.all(running.map((a) => a.finished.catch(() => {})))
        .then(() => { clearTimeout(timer); finish(); });
    });
  });
}

// The outgoing screen has to still exist for an exit to be visible. Remove it on
// its own animationend or the clamped timer, whichever lands first. Interruption
// is always the runtime's: a second navigation hard-removes whatever is dying.
function retire(node, nav) {
  node.dataset.phase = 'leaving';
  node.dataset.nav = nav;
  leaving = node;
  // The world gets exactly as long as its own exit takes, and never longer than
  // the ceiling. That is the whole bargain: the world declares durations, the
  // runtime caps them, and a dead screen can never linger over a live one.
  settleWhenDone(node, MOTION_CEILING_MS).then(() => {
    if (leaving !== node) return;                 // a newer navigation already took it
    node.remove();
    leaving = null;
  });
}

// CONTINUOUS. Every screen is present at once in one scroller, so there is no
// current/leaving pair, no navigation and no `data-changed`: nothing is replacing
// anything, and a comparison against "the previous screen" has no meaning when both
// are on the page together. Every screen is `settled` on arrival, because there is no
// entrance to stage. A world that wants sections to reveal as they scroll into view
// uses a scroll-driven animation, which reads the scroller directly and needs no
// published state at all — see `Alexandria - Rendering`.
//
// The scrolling itself is NOT implemented here. `.stack` is the projector's box and
// the presets sheet says a world may style it, so a continuous world overrides it to
// `display: block; overflow-y: auto` in its own stylesheet. The projector's business
// is that every screen exists at once; what that looks like stays the world's.
function renderScroll() {
  stack.style.setProperty('--motion-duration', `${motionMs()}ms`);

  const declared = new Set();
  const nodes = screens.map((screen) => {
    const node = el(templates[screen.type]);
    for (const key of hoist(node, false)) declared.add(key);   // prune once, after all of them
    return { node, values: screen.fill ?? screen.beats[0] ?? {} };
  });
  prunePersisted(declared);

  const scopes = [...nodes.map((n) => n.node), ...persisted.values()];
  for (const { node, values } of nodes) {
    // Each screen gets its own fresh node, so `rendered` must not carry a value from
    // the section above into the section below: they are siblings, not a succession.
    rendered.clear();
    fill([node, ...persisted.values()], values);
    node.dataset.phase = 'settled';
    if (values.kind) node.dataset.kind = values.kind;
    stack.append(node);
  }

  renderControls(scopes);        // an empty set for this archetype, but never assumed
  renderAsk(scopes);
  trackScroll(scopes);
  current = nodes.at(-1)?.node ?? null;

  $('#progress').textContent = `${screens.length} sections`;
  $('#back').disabled = true;
  $('#next').disabled = true;
  assertControlsReachable(scopes);
}

// Progress in a scrolling world is a position in the scroller, not an index into a
// list of screens. Same published property, same world-side freedom to draw it as a
// bar or a rail or nothing — only the source of the number changes. The listener dies
// with the stack, which `mount()` replaces per module, so there is nothing to clean up.
function trackScroll(scopes) {
  const bars = across(scopes, 'data-readout').filter((r) => r.dataset.readout === 'progress');
  if (!bars.length) return;
  const update = () => {
    const max = stack.scrollHeight - stack.clientHeight;
    const v = max > 0 ? Math.min(1, Math.max(0, stack.scrollTop / max)) : 0;
    for (const r of bars) r.style.setProperty('--progress', String(v));
  };
  stack.addEventListener('scroll', update, { passive: true });
  update();
}

function render(nav = 'forward') {
  if (archetype.scrolls) return renderScroll();
  const screen = screens[at];
  const values = screen.fill ?? screen.beats[0] ?? {};
  const node = el(templates[screen.type]);

  hoist(node);                                  // before the node is ever in the DOM
  const scopes = [node, ...persisted.values()];

  const changed = fill(scopes, values);
  renderControls(scopes);
  renderAsk(scopes);
  renderReadouts(scopes);

  if (leaving) { leaving.remove(); leaving = null; }   // interruption is always the runtime's
  if (current) retire(current, nav);

  stack.append(node);
  publish(node, values, nav, scopes, changed);
  current = node;
  syncControls(scopes);
  prev = values;

  $('#progress').textContent = `${at + 1} / ${screens.length}`;
  $('#back').disabled = at === 0;
  $('#next').disabled = at >= screens.length - 1;

  assertControlsReachable(scopes);
  assertLayoutFits(node, scopes);
}

// The failure that actually broke this layout was a body card growing until it
// met the Continue pill — content and controls occupying the same pixels. That is
// world-agnostic and checkable, so check it, rather than relying on an author
// noticing at the one panel height they happen to develop at.
function assertLayoutFits(node, scopes) {
  // A scrolling world overflows its panel BY DESIGN — that is what the archetype is —
  // so the check that catches a grown card in a fixed panel is meaningless here and
  // would fire once per section below the fold. `Alexandria - World Spec` states the
  // same split for text: a paginated world splits, a scrolling world scrolls.
  if (archetype.scrolls) return;
  const panel = stack.getBoundingClientRect();
  if (!panel.height) return;
  const overlaps = (a, b) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const controls = across(scopes, 'data-control')
    .filter((c) => !c.hidden && !c.disabled)
    .map((c) => [c, c.getBoundingClientRect()]);

  for (const slot of across(scopes, 'data-slot')) {
    if (slot.dataset.slot === 'controls') continue;
    const r = slot.getBoundingClientRect();
    if (!r.width || !r.height) continue;

    if (r.bottom > panel.bottom + 1 || r.top < panel.top - 1 || r.right > panel.right + 1) {
      console.warn(
        `[projector] slot "${slot.dataset.slot}" overflows the panel by ` +
        `${Math.round(Math.max(r.bottom - panel.bottom, panel.top - r.top, r.right - panel.right))}px. ` +
        `Panel is ${Math.round(panel.height)}px tall; world declares minHeight ` +
        `${world.viewport?.minHeight ?? '(none)'}.`, slot);
    }
    for (const [c, cr] of controls) {
      if (overlaps(r, cr)) {
        console.warn(
          `[projector] slot "${slot.dataset.slot}" overlaps control ` +
          `"${c.dataset.control}". Either the cap is too loose for this panel or ` +
          `the declared minHeight is too low.`, { slot, control: c });
      }
    }
  }
}

// A control that renders perfectly but cannot be clicked is indistinguishable
// from a working one in every programmatic test — `.click()` bypasses hit
// testing entirely, which is exactly how a full-cell screen was allowed to
// cover the control bar unnoticed. So ask the browser what is actually on top
// of each live control and say so loudly when it is not the control.
function assertControlsReachable(scopes) {
  for (const el of across(scopes, 'data-control')) {
    if (el.disabled || el.hidden) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;                       // not laid out yet
    const top = root.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    if (top !== el && !el.contains(top)) {
      console.warn(
        `[projector] control "${el.dataset.control}" is not clickable — ` +
        `${top?.tagName.toLowerCase()}.${top?.className || ''} is on top of it. ` +
        `Check stacking of .stack children.`, { control: el, covering: top });
    }
  }
}

function go(delta) {
  const next = at + delta;
  if (next < 0 || next > screens.length - 1) return;
  at = next;
  render(delta < 0 ? 'back' : 'forward');
}

// Every path to a new module goes through here: the world's ask input, and nothing
// else. The chrome no longer hosts an ask — see `Alexandria - Design`.
// THE BANK. What was written ahead and not yet shown, and its entire discipline is that it
// draws nothing until the student acts. Filled during the reading of the module it follows,
// so by the time the student asks their next question it is already there.
let banked = null;
let bankRun = null;
const stickyFixture = new URLSearchParams(location.search).get('fixture');

// Generated DURING READING, which is the only window it can be generated in without putting
// a wait inside the wait. Never awaited by the caller: if it has not landed by the time the
// boundary arrives, the boundary simply has nothing to play, which is today's behaviour.
function bankInteractive(moduleData, fixture) {
  banked = null;
  bankRun = fetch('/api/interactive', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture ? { fixture: 'micro' } : { module: moduleData }),
  }).then((r) => r.json())
    .then((d) => { banked = d?.set?.length ? d : null; return banked; })
    .catch(() => { banked = null; });
  return bankRun;
}

// Play whatever is banked, and resolve when the student is done with it. The module is
// already generating underneath this — that is the whole point, and it is why nothing here
// awaits the network.
function playBanked() {
  return new Promise((resolve) => {
    const set = banked;
    banked = null;
    const results = [];
    playSet($('#stage'), {
      cards: set.set,
      onCard: (r) => results.push(r),
      onDone: ({ skipped, answered }) => resolve({ skipped, answered, results }),
    });
  });
}

async function askFor(question, fixture = null) {
  fixture = fixture ?? stickyFixture;
  if (busy) return;
  busy = true;
  setStatus(fixture ? `rendering fixture "${fixture}"…` : 'writing the module…');
  // The world stays on screen while this runs. `Alexandria - Cold Start` stage 0 is
  // "never blocks" and "painted locally with no model call at all"; blanking the
  // stage to a spinner would throw that away at exactly the moment it matters.
  stack?.setAttribute('data-busy', '');

  const t0 = performance.now();
  // FIRED, NOT AWAITED. The ask lands BEFORE the interactive, so the request is already in
  // flight while the student works — which is what gives the wait somewhere to hide. See
  // `Alexandria - PoC Flow`: the ordering is the whole trick.
  const pending = fetch('/api/module', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // The world travels with the request. It used to be a boot-time constant on the
    // server, so the module and the templates it renders into could not disagree; now
    // they could, and this is what keeps them from it.
    body: JSON.stringify({ world: worldId, ...(fixture ? { fixture } : { question }) }),
  }).then((r) => r.json()).catch((err) => ({ error: String(err) }));

  let played = null;
  if (banked?.set?.length) played = await playBanked();

  const data = await pending;
  busy = false;
  stack?.removeAttribute('data-busy');
  if (!data?.screens) { setStatus(`generation failed: ${data?.error ?? 'unknown'}`); return; }

  screens = data.screens; at = 0; prev = null; rendered.clear();
  mount(); render('forward');

  const m = data.metrics;
  setStatus(
    `startup ${m.startupMs}ms · auth ${m.apiKeySource} · ttft ${m.ttftMs}ms\n` +
    `wall ${m.wallMs}ms · repairs ${m.repairs} · $${m.costUsd} · cache ${m.cacheReadTokens ?? 0}tok\n` +
    `${m.beats} beats · reading ~${Math.round(m.readingTimeMs / 1000)}s vs generation ${Math.round(m.wallMs / 1000)}s` +
    (m.readingTimeMs > m.wallMs ? '  COVERED' : '  NOT COVERED') +
    (data.degraded ? '\nDEGRADED: validation still failing, the plain world would take over' : ''));
  console.log('round trip incl. network', Math.round(performance.now() - t0), 'ms', data);
  if (played) {
    console.log(`micro: ${played.answered} card(s)${played.skipped ? ', skipped' : ''}`, played.results);
  }
  // Bank the NEXT interactive now, while this module is being read. Not awaited: the
  // student is reading, and nothing on screen may wait for it.
  bankInteractive(data, fixture);
}

const setStatus = (t) => { $('#metrics').textContent = t; };

// STAGE 0 of the cold start: the world's opening frame, painted locally with no model
// call at all. It is the same screen type the module closes with — one template, two
// contexts — and its line comes from the manifest rather than the model, because at
// session start there is no module to generate one from.
function openingFrame() {
  const type = world.pagination?.closeWith;
  if (!type || !templates[type]) return false;
  // Any channel that appears on the opening frame must declare what it shows there,
  // because stage 0 paints before a beat exists to take a value from.
  const fill = {};
  for (const ch of [world.channels, world.module?.channels ?? {}])
    for (const [name, def] of Object.entries(ch))
      if (def.opening != null) fill[name] = def.opening;
  screens = [{ type, beats: [], fill }];
  at = 0; prev = null; rendered.clear();
  mount(); render('forward');
  return true;
}

// THE FIRST MOUNT. `?world=<id>` opens a specific package; without it the server's own
// default — `WORLD=<id>` or `cartoon` — decides, which is exactly what happened before
// multiple worlds existed. So every existing invocation opens the same world it always
// did, and selection is now a parameter with a default rather than a boot-time constant.
const params = new URLSearchParams(location.search);
try {
  await openWorld(params.get('world'));
} catch (err) {
  // DEGRADE, NEVER WAIT, applied to the one parameter a person types by hand. An id that
  // is not installed, or one whose package failed manifest validation, used to leave the
  // module dead on an unhandled rejection: blank stage, empty chrome, nothing to read —
  // which is the failure `docs/contracts/world-loader.md` describes and this lane exists
  // to remove. Say what happened and open the default instead, so a typo costs a sentence
  // rather than the session.
  console.warn(`[world] ${err.message}`);
  setStatus(`${err.message}\nopening the default world instead.`);
  await openWorld(null);
}
if (params.get('dev') === '1') devWorldSwitcher();

// DETERMINISTIC MODE. `?fixture=max` renders the blessed module with no model call,
// so the app is runnable on zero quota and the DOM snapshots have a stable subject.
// See fixtures/README.md.
const fixtureParam = params.get('fixture');
// STICKY, so the whole LOOP runs offline rather than only the first module. Without this
// the second ask would reach for the model and the one thing worth watching — a card set
// covering a real generation — would need quota to see.
if (fixtureParam) askFor(null, fixtureParam);

$('#next').onclick = () => { if (archetype.controls.next) go(+1); };
$('#back').onclick = () => { if (archetype.controls.back) go(-1); };
// The chrome's fallback controls are the archetype's too. A world that declares no
// controls slot gets these, so offering Back here would reintroduce the same bug for
// any world that simply did not write a template.
//
// Their `hidden` state moved into `adopt()`, because it is a fact about the MOUNTED
// world rather than about the session: set once here it would have been right for the
// world the session opened in and wrong for every world switched to afterwards.
// The handlers stay, and read `archetype` live for exactly the same reason.
addEventListener('keydown', (e) => {
  // Back is an ARCHETYPE property, not a chrome one. scene-sequential declares no
  // back control at all, and app.css only hides the footer BUTTON — the key binding
  // and the button's handler both survived that, so a world whose whole contract is
  // "forward only, with a history log" could still be walked backwards.
  //
  // NEXT is gated for the same reason, added when `continuous` landed: that archetype
  // declares NEITHER control, and an ungated ArrowRight would have stepped `at`
  // through a list of screens that are all already on the page. Same lesson as before
  // — hiding a control is not removing it — applied to the other half of the pair.
  if (e.key === 'ArrowRight' && archetype.controls.next) go(+1);
  if (e.key === 'ArrowLeft' && archetype.controls.back) go(-1);
});
