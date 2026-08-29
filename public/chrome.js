// THE CHROME'S BEHAVIOUR. The frame outside every world: the symbol, the strip's
// readouts, and the settings surface. See the vault note `Alexandria - Design`.
//
// This file exists so `public/index.html` and `public/app.css` are not the chrome's
// only home while `public/app.js` — the projector, another lane's file per CONTRACT.md
// — stays untouched. The seam between them is seven DOM hooks, listed in index.html,
// and nothing here writes to any of them.
//
// It loads BEFORE app.js on purpose: every hook the projector reads at module scope is
// static markup, so nothing here needs to have run for the projector to work, and
// nothing the projector does can be missed by the observer below.

import { host, isApp } from '/host.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ── The symbol ────────────────────────────────────────────────────────────────────
//
// The whole of the chrome's navigation. One control, two destinations: in a session it
// opens settings, in settings it returns you to the world you were in. The world is
// never unmounted — settings shares the stage's grid cell and paints over it — so
// "resuming where you left off" is literal rather than a restore.

function setSettings(open) {
  document.body.classList.toggle('settings-open', open);
  $('#symbol').setAttribute('aria-label', open ? 'Back to the world' : 'Settings');
}
const settingsOpen = () => document.body.classList.contains('settings-open');

$('#symbol').addEventListener('click', () => setSettings(!settingsOpen()));
$$('[data-action="settings"]').forEach((b) => b.addEventListener('click', () => setSettings(true)));

// Escape leaves settings the same way the symbol does. Nothing else is dismissible, so
// this is the whole keyboard surface.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOpen()) setSettings(false);
});

// ── The strip's readouts ──────────────────────────────────────────────────────────
//
// Readouts, never controls — the same category the World Spec established for progress.
// They report and they click through to nothing. A readout with nothing to report does
// not draw: an empty value would be furniture pretending to be information.

// Quota. `--orange` exists for exactly one state and this is it. NOTHING COMPUTES A
// QUOTA FRACTION YET — server.js tracks cost per call, not a fraction of a limit — so
// this stays hidden in a real session and is reachable with `?quota=0.62` for design
// verification. The thresholds are here so the pressure state has a home the moment a
// real number does.
export function setQuota(fraction) {
  const el = $('#quota');
  if (fraction == null || Number.isNaN(fraction)) { el.hidden = true; return; }
  const pct = Math.round(fraction * 100);
  el.hidden = false;
  $('#quotatext').textContent = `${pct}% quota`;
  $('#quotadot').className = 'dot ' + (pct >= 90 ? 'orange' : pct >= 75 ? 'warn' : 'ok');
}

// What is owed. Student-facing wording is "due back"; "owed" is the ledger's word and
// stays on our side of the glass. THE LEDGER DOES NOT EXIST IN CODE — no arena, no
// bank, no skip — so this is likewise driven by `?due=2` until it does.
export function setDue(count) {
  const el = $('#due');
  if (!count) { el.hidden = true; return; }
  el.hidden = false;
  $('#duecount').textContent = `${count} due back`;
}

const params = new URLSearchParams(location.search);
setQuota(params.has('quota') ? Number(params.get('quota')) : null);
setDue(params.has('due') ? Number(params.get('due')) : 0);

// ── Settings: the world section ───────────────────────────────────────────────────
//
// The dropdown is the whole of world switching for the PoC — no picker, no storefront.
//
// IT IS NOW WIRED. This block used to say "the world loader does not exist yet" and mirror
// `#worldname` into a one-option list, so the only world you could pick was the one you were
// already in and selecting it did nothing. The loader landed with `multi-world` on 28 Aug and
// nothing came back to connect this; Jordan found it by looking for the control and not
// finding one. `app.js` owns `switchWorld`, so it drives these two functions rather than this
// file reaching across for the list.
const picker = $('#worldpicker');
let onPick = null;

/** Called by `app.js` with `/api/worlds` and the mounted id. */
export function showWorlds(worlds, activeId) {
  const any = worlds.length > 0;
  $('#worlds-present').hidden = !any;
  $('#worlds-absent').hidden = any;
  if (!any) return;
  picker.replaceChildren(...worlds.map((w) => {
    const o = document.createElement('option');
    o.value = w.id ?? w;
    // A BROKEN PACKAGE IS SHOWN AND DISABLED, not hidden. `docs/contracts/world-loader.md`
    // keeps a package that fails validation in the registry precisely so the student can see
    // that the thing they installed is there and why it will not open.
    o.textContent = (w.name ?? w) + (w.ok === false ? ' · unavailable' : '');
    o.disabled = w.ok === false;
    o.selected = (w.id ?? w) === activeId;
    return o;
  }));
}

export function onWorldChange(fn) { onPick = fn; }
picker.addEventListener('change', () => onPick?.(picker.value));

// `?worlds=` previews the installed and the empty state without a loader behind either.
if (params.has('worlds')) {
  const list = params.get('worlds').split(',').filter(Boolean);
  showWorlds(list, list[0]);
}

// ── Settings: motion and model ────────────────────────────────────────────────────

const speed = $('#speed');
const paintSpeed = () => {
  const pct = ((speed.value - speed.min) / (speed.max - speed.min)) * 100;
  speed.style.setProperty('--fill', `${pct}%`);
  $('#speedvalue').textContent = `${Number(speed.value).toFixed(1)}×`;
};
speed.addEventListener('input', paintSpeed);
paintSpeed();

// The segmented controls record a choice and nothing more. The projector's global speed
// is a constant 1 today and reduced motion is handled by media query — both are noted
// as deliberate debt in the 26 Aug build plan, and wiring them is the projector's lane,
// not the chrome's.
for (const group of $$('.segmented')) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn) return;
    for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
  });
}

// ── The host ──────────────────────────────────────────────────────────────────────
//
// Reveal-in-Finder is an application call. In a browser `host.revealWorlds()` resolves
// to nothing and logs once, so the control is hidden rather than left to do nothing
// visible — the rule in host.js is to hide what the host cannot honour, never to branch
// on behaviour.

for (const b of $$('[data-action="reveal-worlds"]')) {
  if (!isApp) { b.hidden = true; continue; }
  b.addEventListener('click', () => host.revealWorlds());
}

// Fullscreen reclaims the strip's left inset. The 92px exists only to clear the macOS
// traffic lights, and macOS hides them in fullscreen, so the symbol shifts back to the
// window padding and the strip stops carrying a gap for something that is not there.
//
// The windowed inset stays the default when no signal ever arrives, which is what the
// browser dev path gets — it has no native window, so it keeps matching the Figma
// boards rather than inventing a third layout nobody designed.
host.onFullscreen((on) => document.body.classList.toggle('fullscreen', on));
