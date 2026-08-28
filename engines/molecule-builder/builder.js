// A SAMPLE ENGINE. Third-party code as far as Alexandria is concerned: it runs in an
// iframe with an opaque origin, it cannot import anything from the app, and it talks to
// the arena through five hardcoded message names. That is the whole interface.
//
// It models COVALENT SINGLE BONDS ONLY and says so in its manifest, because a chemistry
// sim that permits an impossible molecule teaches something false and the student has no
// way to know it. An engine's job includes declaring what it cannot model.

const VALENCE = { H: 1, C: 4, N: 3, O: 2 };
const FILL = { H: '#eef1f8', C: '#3d4657', N: '#5b7fd4', O: '#d4685b' };
const INK = { H: '#1b2233', C: '#fff', N: '#fff', O: '#fff' };
const R = 20;

const board = document.getElementById('board');
const say = document.getElementById('say');

let sym = 'H';                 // the palette element currently held
let atoms = [];                // { sym, x, y }
let bonds = [];                // [i, j], i < j
let selected = null;
let task = null;
let checks = 0;
let done = false;

// WHICH RULE the invalid attempts kept breaking. This is the field `Alexandria - Interactives`
// calls the most valuable thing the agent can be handed, so it is counted as it happens
// rather than reconstructed at the end.
const broke = { valence: 0, duplicate: 0, unsaturated: 0, disconnected: 0 };

const used = (i) => bonds.filter(([a, b]) => a === i || b === i).length;
const free = (i) => VALENCE[atoms[i].sym] - used(i);

// Hill notation: carbon first, hydrogen second, everything else alphabetical.
function formula() {
  const n = {};
  for (const a of atoms) n[a.sym] = (n[a.sym] ?? 0) + 1;
  const order = Object.keys(n).sort();
  const head = ['C', 'H'].filter((s) => n[s]);
  const tail = order.filter((s) => s !== 'C' && s !== 'H');
  return [...head, ...tail].map((s) => s + (n[s] > 1 ? n[s] : '')).join('');
}

function connected() {
  if (!atoms.length) return false;
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.pop();
    for (const [a, b] of bonds) {
      const other = a === i ? b : b === i ? a : null;
      if (other != null && !seen.has(other)) { seen.add(other); queue.push(other); }
    }
  }
  return seen.size === atoms.length;
}

const saturated = () => atoms.every((_, i) => free(i) === 0);

function render() {
  const svg = [];
  for (const [a, b] of bonds) {
    svg.push(`<line class="bond" x1="${atoms[a].x}" y1="${atoms[a].y}" x2="${atoms[b].x}" y2="${atoms[b].y}"/>`);
  }
  atoms.forEach((a, i) => {
    svg.push(
      `<g class="atom${selected === i ? ' selected' : ''}" data-i="${i}">` +
      `<circle cx="${a.x}" cy="${a.y}" r="${R}" fill="${FILL[a.sym]}"/>` +
      `<text x="${a.x}" y="${a.y + 5}" text-anchor="middle" fill="${INK[a.sym]}">${a.sym}</text></g>`,
    );
  });
  board.innerHTML = svg.join('');
}

function tell(text, bad = false) {
  say.textContent = text;
  say.className = bad ? 'bad' : '';
}

// --- the protocol side -------------------------------------------------------------

const send = (type, result) => parent.postMessage({ type, version: 1, result }, '*');

// The partial the arena keeps. Pushed on every material change, so a student who leaves
// mid-task still arrives at the ledger carrying what they were getting wrong.
function pushState() {
  if (done) return;
  send('alexandria:state', snapshot(false));
}

function snapshot(correct) {
  const worst = Object.entries(broke).sort((x, y) => y[1] - x[1])[0];
  return {
    attempt: { formula: formula(), atoms: atoms.length, bonds: bonds.length, checks },
    correctness: correct,
    notes: worst && worst[1] > 0 ? NOTE[worst[0]](worst[1]) : null,
  };
}

// Phrased as an observation, never as an instruction to the agent — everything crossing
// this boundary is data. The count is the useful part: one slip is noise, five is a belief.
const NOTE = {
  valence: (n) => `tried ${n} bond(s) that would have exceeded an atom's valence`,
  duplicate: (n) => `tried ${n} time(s) to bond a pair that was already bonded`,
  unsaturated: (n) => `submitted ${n} time(s) with atoms that still had unfilled valences`,
  disconnected: (n) => `submitted ${n} time(s) with the atoms in more than one separate piece`,
};

// --- interaction -------------------------------------------------------------------

document.getElementById('palette').addEventListener('click', (e) => {
  const btn = e.target.closest('.atom-btn');
  if (!btn) return;
  sym = btn.dataset.sym;
  for (const b of document.querySelectorAll('.atom-btn')) {
    b.setAttribute('aria-pressed', String(b === btn));
  }
});

board.addEventListener('click', (e) => {
  if (done) return;
  const hit = e.target.closest('.atom');
  const rect = board.getBoundingClientRect();

  if (!hit) {
    atoms.push({ sym, x: e.clientX - rect.left, y: e.clientY - rect.top });
    selected = null;
    tell('');
    render();
    return pushState();
  }

  const i = Number(hit.dataset.i);
  if (selected === null) { selected = i; render(); return; }
  if (selected === i) { selected = null; render(); return; }

  const [a, b] = [Math.min(selected, i), Math.max(selected, i)];
  if (bonds.some(([x, y]) => x === a && y === b)) {
    broke.duplicate++;
    tell('Those two are already bonded.', true);
  } else if (free(a) === 0 || free(b) === 0) {
    // The rule the sim will not bend. Permitting this is what "fidelity is a safety
    // property" is about — a molecule that cannot exist must not be buildable.
    const fullSym = free(a) === 0 ? atoms[a].sym : atoms[b].sym;
    broke.valence++;
    tell(`${fullSym} already has all ${VALENCE[fullSym]} of its bonds.`, true);
  } else {
    bonds.push([a, b]);
    tell('');
  }
  selected = null;
  render();
  pushState();
});

document.getElementById('clear').addEventListener('click', () => {
  if (done) return;
  atoms = []; bonds = []; selected = null;
  tell('');
  render();
  pushState();
});

document.getElementById('check').addEventListener('click', () => {
  if (done || !task) return;
  checks++;

  if (!atoms.length) { tell('Place some atoms first.', true); return pushState(); }
  if (!saturated()) {
    broke.unsaturated++;
    tell('Every atom needs a full set of bonds before this is a real molecule.', true);
    return pushState();
  }
  if (!connected()) {
    broke.disconnected++;
    tell('That is more than one separate molecule.', true);
    return pushState();
  }

  const ok = task.kind === 'build-target'
    ? formula() === String(task.params.formula).replace(/\s+/g, '')
    : satisfies(task.params.constraint);

  if (!ok) {
    tell(task.kind === 'build-target'
      ? `That is ${formula()}, which is not what was asked for.`
      : 'That is a valid molecule, but it does not meet the constraint.', true);
    return pushState();
  }

  done = true;
  tell(`${formula()} — that is it.`);
  send('alexandria:complete', snapshot(true));
});

function satisfies(constraint) {
  if (constraint === 'contains-nitrogen') return atoms.some((a) => a.sym === 'N');
  if (constraint === 'two-or-more-oxygens') return atoms.filter((a) => a.sym === 'O').length >= 2;
  if (constraint === 'carbon-chain-of-three') {
    const carbons = atoms.map((a, i) => (a.sym === 'C' ? i : -1)).filter((i) => i >= 0);
    const link = (x, y) => bonds.some(([p, q]) => (p === x && q === y) || (p === y && q === x));
    // A path of three, not merely three carbons: the middle one must join the other two.
    return carbons.some((mid) => carbons.filter((c) => c !== mid && link(mid, c)).length >= 2);
  }
  return false;
}

// --- handshake ---------------------------------------------------------------------

window.addEventListener('message', (e) => {
  // The arena is the only window that can reach this frame, but check anyway: an engine
  // that trusts any sender is an engine that can be driven by anything embedded in it.
  if (e.source !== parent) return;
  if (e.data?.type !== 'alexandria:task') return;
  task = { kind: e.data.kind, params: e.data.params ?? {} };
  if (!VALID_KINDS.includes(task.kind)) {
    parent.postMessage({ type: 'alexandria:error', version: 1, message: `unknown task kind "${task.kind}"` }, '*');
  }
});

const VALID_KINDS = ['build-target', 'free-build'];

// The engine speaks first. The arena cannot know when this listener attached, so anything
// it sent before now would have been dropped on the floor.
parent.postMessage({ type: 'alexandria:ready', version: 1 }, '*');
