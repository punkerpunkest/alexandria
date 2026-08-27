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
// THE WORLD LOADER DOES NOT EXIST YET: `server.js` still takes one world from the
// `WORLD` env var, so the list below has exactly one entry and changing it does
// nothing. That is the next slice, and this is the surface waiting for it.

const picker = $('#worldpicker');

function showWorlds(names, active) {
  const any = names.length > 0;
  $('#worlds-present').hidden = !any;
  $('#worlds-absent').hidden = any;
  if (!any) return;
  picker.replaceChildren(...names.map((n) => {
    const o = document.createElement('option');
    o.value = o.textContent = n;
    o.selected = n === active;
    return o;
  }));
}

// The projector writes the mounted world's name into #worldname when it mounts. Mirror
// it rather than fetching /api/world a second time, so there is one source of truth for
// which world is live and the chrome cannot disagree with what is on screen.
const worldname = $('#worldname');
const syncWorld = () => {
  const name = worldname.textContent.trim();
  showWorlds(name ? [name] : [], name);
};
new MutationObserver(syncWorld).observe(worldname, { childList: true, characterData: true, subtree: true });
syncWorld();

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
