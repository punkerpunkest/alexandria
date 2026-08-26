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
const $ = (s) => document.querySelector(s);
const stage = $('#stage');

// Archetypes are RUNTIME knowledge. The archetype decides which controls and
// readouts exist; the world decides where they sit and what they look like, by
// declaring data-slot="controls" / data-readout="<name>" in its template.
// A world may place any subset. It may never add to the set, and it may never
// omit one marked required.
const ARCHETYPES = {
  paginated: {
    controls: {
      // `hidden` and `disabled` belong here rather than in syncControls: they are
      // this archetype's semantics. Scene-sequential has no free back at all, and
      // continuous has neither control — those are its business, not the projector's.
      back: { required: false, label: '', aria: 'Back', step: -1,
              hidden:   (at) => at === 0 },
      next: { required: true, label: 'Continue', aria: 'Continue', step: +1,
              disabled: (at, count) => at >= count - 1 },
    },
    readouts: ['progress'],
  },
  // Forward only. No back control exists at all -- not hidden, not disabled, absent.
  // A world that wants an arrow inside its dialogue box places data-slot="controls"
  // there and dresses [data-control="next"]; placement was never the archetype's business.
  'scene-sequential': {
    controls: {
      next: { required: true, label: 'Continue', aria: 'Continue', step: +1,
              disabled: (at, count) => at >= count - 1 },
    },
    readouts: ['progress'],
  },
};

// The world declares a duration, the runtime clamps and scales it. The clamp is
// last so the ceiling is a real ceiling: motion is never allowed to be the
// reason a beat was slow to arrive. SPEED becomes a user setting later.
const MOTION_CEILING_MS = 600;
const MOTION_FLOOR_MS = 80;
const SPEED = 1;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

let world, templates, presetCss, host, root, stack;
let screens = [], at = 0, prev = null;
let current = null, leaving = null, panelWatcher = null, busy = false;
let persisted = new Map();          // data-persist key -> the one live node

const res = await fetch('/api/world').then((r) => r.json());
world = res.world; templates = res.screens;
presetCss = await fetch('/presets.css').then((r) => r.text());
$('#worldname').textContent = world.name;

const archetype = ARCHETYPES[world.archetype];
if (!archetype) throw new Error(`unknown archetype "${world.archetype}"`);

// Does this world dress its own controls, or fall back to the chrome's?
const declares = (attr) => Object.values(templates).some((t) => t.includes(attr));
document.body.classList.toggle('world-controls', declares('data-slot="controls"'));
document.body.classList.toggle('world-progress', declares('data-readout="progress"'));

function motionMs() {
  if (reduced.matches) return 0;
  const declared = world.motion?.duration ?? 240;
  return Math.min(Math.max(Math.round(declared * SPEED), MOTION_FLOOR_MS), MOTION_CEILING_MS);
}

// A world's stylesheet is written package-relative. It gets injected into a shadow
// root, where relative URLs would otherwise resolve against the document. Rewrite
// them to the package, and leave data: and absolute URLs alone. This is also where
// the off-package URL rejection from `Alexandria - Rendering` will live.
function packageRelative(css) {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (whole, quote, url) =>
    /^(data:|https?:|\/\/|\/)/i.test(url) ? whole : `url(${quote}/worlds/${world.id}/${url}${quote})`);
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
  style.textContent = packageRelative(res.css);
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

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Beat channels and module channels are both channels; only their scope differs.
const channelFor = (key) => world.channels[key] ?? world.module?.channels?.[key];

// An asset key is normally just the channel's value. A channel declaring `keyedBy`
// composes its key from another channel's value first: the visual novel's faces are
// per-character, so `keyedBy: "speaker_body"` turns "smile" into "mei-smile". The model
// therefore picks from eleven expressions rather than twenty-two character-qualified
// ones, and a face belonging to the wrong character is unrepresentable rather than
// caught after the fact. Nothing here names a world; `keyedBy` comes from the manifest.
function assetUrl(ch, name, values) {
  const key = ch.keyedBy ? `${values[ch.keyedBy]}-${name}` : name;
  const ext = world.assetFormat?.[ch.set] ?? 'svg';
  return `/worlds/${world.id}/assets/${ch.set}-${key}.${ext}`;
}

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
function hoist(node) {
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
  for (const [key, node] of persisted) {
    if (!declared.has(key)) { node.remove(); persisted.delete(key); }
  }
}

function fill(scopes, values) {
  for (const slot of across(scopes, 'data-slot')) {
    const key = slot.dataset.slot;
    if (key === 'controls' || key === 'ask') continue;   // runtime-owned, filled below
    // A slot the fill does not mention KEEPS its current value. This is what lets a
    // beatless screen inherit the persisted teacher's pose rather than blanking her
    // src to `mascot-undefined.webp`.
    if (!(key in values)) continue;
    const ch = channelFor(key);
    if (ch?.set) slot.src = assetUrl(ch, values[key], values);
    else slot.textContent = values[key] ?? '';
  }
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
function publish(node, values, nav, scopes) {
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
      if (!(key in values)) continue;             // unmentioned slots did not change
      // Previous SCREEN's beat vs this screen's. Stays correct if a beat is ever
      // allowed to span several screens: the same beat differs from itself in
      // nothing, so nothing is marked, which is the right answer.
      if (prev[key] !== values[key]) s.setAttribute('data-changed', '');
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

function render(nav = 'forward') {
  const screen = screens[at];
  const values = screen.fill ?? screen.beats[0] ?? {};
  const node = el(templates[screen.type]);

  hoist(node);                                  // before the node is ever in the DOM
  const scopes = [node, ...persisted.values()];

  fill(scopes, values);
  renderControls(scopes);
  renderAsk(scopes);
  renderReadouts(scopes);

  if (leaving) { leaving.remove(); leaving = null; }   // interruption is always the runtime's
  if (current) retire(current, nav);

  stack.append(node);
  publish(node, values, nav, scopes);
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
async function askFor(question, fixture = null) {
  if (busy) return;
  busy = true;
  setStatus(fixture ? `rendering fixture "${fixture}"…` : 'writing the module…');
  // The world stays on screen while this runs. `Alexandria - Cold Start` stage 0 is
  // "never blocks" and "painted locally with no model call at all"; blanking the
  // stage to a spinner would throw that away at exactly the moment it matters.
  stack?.setAttribute('data-busy', '');

  const t0 = performance.now();
  const data = await fetch('/api/module', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture ? { fixture } : { question }),
  }).then((r) => r.json()).catch((err) => ({ error: String(err) }));

  busy = false;
  stack?.removeAttribute('data-busy');
  if (!data?.screens) { setStatus(`generation failed: ${data?.error ?? 'unknown'}`); return; }

  screens = data.screens; at = 0; prev = null;
  mount(); render('forward');

  const m = data.metrics;
  setStatus(
    `startup ${m.startupMs}ms · auth ${m.apiKeySource} · ttft ${m.ttftMs}ms\n` +
    `wall ${m.wallMs}ms · repairs ${m.repairs} · $${m.costUsd} · cache ${m.cacheReadTokens ?? 0}tok\n` +
    `${m.beats} beats · reading ~${Math.round(m.readingTimeMs / 1000)}s vs generation ${Math.round(m.wallMs / 1000)}s` +
    (m.readingTimeMs > m.wallMs ? '  COVERED' : '  NOT COVERED') +
    (data.degraded ? '\nDEGRADED: validation still failing, the plain world would take over' : ''));
  console.log('round trip incl. network', Math.round(performance.now() - t0), 'ms', data);
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
  at = 0; prev = null;
  mount(); render('forward');
  return true;
}

if (!openingFrame()) setStatus('world declares no ask screen; nothing to paint at stage 0');

// DETERMINISTIC MODE. `?fixture=max` renders the blessed module with no model call,
// so the app is runnable on zero quota and the DOM snapshots have a stable subject.
// See fixtures/README.md.
const fixtureParam = new URLSearchParams(location.search).get('fixture');
if (fixtureParam) askFor(null, fixtureParam);

$('#next').onclick = () => go(+1);
$('#back').onclick = () => { if (archetype.controls.back) go(-1); };
// The chrome's fallback controls are the archetype's too. A world that declares no
// controls slot gets these, so offering Back here would reintroduce the same bug for
// any world that simply did not write a template.
$('#back').hidden = !archetype.controls.back;
addEventListener('keydown', (e) => {
  // Back is an ARCHETYPE property, not a chrome one. scene-sequential declares no
  // back control at all, and app.css only hides the footer BUTTON — the key binding
  // and the button's handler both survived that, so a world whose whole contract is
  // "forward only, with a history log" could still be walked backwards.
  if (e.key === 'ArrowRight') go(+1);
  if (e.key === 'ArrowLeft' && archetype.controls.back) go(-1);
});
