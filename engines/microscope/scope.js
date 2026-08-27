// A SAMPLE ENGINE: a compound light microscope, and specifically the PROCEDURE for using
// one. Third-party code as far as Alexandria is concerned — opaque origin, no imports from
// the app, five hardcoded message names, no network of any kind.
//
// The teaching claim is narrow and worth stating, because it decides every design choice
// below. A student can be told "always find it at low power first" and "never touch coarse
// focus on high power" and repeat both back perfectly while having no idea what either
// rule is FOR. Those rules exist because of consequences — a specimen you cannot find, a
// slide you crack, an objective you drive into glass — and the consequences are exactly
// what a classroom cannot afford to let happen. So this engine's job is not to show a
// microscope. It is to make the four standard procedural mistakes VISIBLE and
// CONSEQUENTIAL, and then to carry a count of them out through `notes`.
//
// What it deliberately does NOT model is in `engine.json` under `_fidelity`, and the two
// entries there that matter most are the ones a student could otherwise be misled by: the
// specimen is always centred, so losing it out of a narrowed field cannot happen here; and
// coarse focus at 40x is REFUSED here where a real stand would simply let you break the
// slide. A simulation that quietly omits a mechanism teaches that the mechanism does not
// exist, which is why the refusal is counted rather than merely enforced.

// --- the instrument's constants ------------------------------------------------------
// Real-ish numbers, because a student who reads them off the panel should be reading
// something true. The depth-of-field figures are the exception and are declared as such
// in the manifest: they are inflated about tenfold so focus is findable with a mouse.

const EYEPIECE = 10;                                  // fixed; total mag = EYEPIECE * objective
const OBJECTIVES = [4, 10, 40];                       // no oil immersion, so no 100x
const FIELD_NUMBER_UM = 18000;                        // 18 mm eyepiece field number

// FIELD DIAMETER = FIELD NUMBER / OBJECTIVE magnification, and the objective is the whole
// of it — NOT the total magnification. That distinction is easy to get wrong and getting
// it wrong makes the numbers absurd: it would put a 1.5 mm newsprint letter outside the
// field at 4x, where in a real lab the whole letter sits comfortably inside it.
const fov = (o) => FIELD_NUMBER_UM / o;               // 4500 / 1800 / 450 µm

// The specimen's own height above the stage's zero. Fixed rather than randomised, so the
// engine is reproducible for anyone driving it from a script; the student cannot see it.
const FOCUS_Z = 3120;

// PARFOCALITY, and it is the reason the whole "low power first" procedure pays off. A
// matched objective set is built so that focus barely shifts when you swing one in — a few
// tens of micrometres, well inside the fine focus's reach. Find it at 4x and 40x is a
// couple of fine clicks away. Fail to, and 40x has nothing to start from.
const PARFOCAL = { 4: 0, 10: 14, 40: 33 };

// WORKING DISTANCE, i.e. how far the front lens sits above the coverslip when focused.
// The spread is enormous and it is the physical fact underneath the coarse-focus rule: at
// 4x there are twelve millimetres of air, at 40x there are sixty micrometres. One click of
// the coarse knob is 100 µm. That single comparison — 100 against 60 — is the entire
// justification for locking coarse focus at high power, and the panel shows both numbers.
const CLEARANCE = { 4: 12000, 10: 4200, 40: 60 };

// DEPTH OF FIELD, halved-width, inflated (see the manifest). What matters pedagogically is
// the RATIO: eleven times shallower at 40x than at 4x. That is why the same fine-focus drag
// feels lazy at low power and violent at high power, and the gauge in the strip shows it.
const DOF = { 4: 90, 10: 30, 40: 8 };

// The illumination each objective wants, on a 0..1 scale. Higher powers need more light,
// because the same cone is being spread across a much larger image. Getting this wrong in
// either direction is the fourth counted mistake.
const NEED = { 4: 0.22, 10: 0.38, 40: 0.62 };

const COARSE_MAX = 8000, COARSE_STEP = 100;           // the coarse knob's travel, in µm
const FINE_SPAN = 120;                                // fine focus reaches +/- this, in µm

const SHARP_ENOUGH = 0.75;                            // counts as "in focus"
const LIT_ENOUGH = 0.60;                              // counts as "properly illuminated"
const RESOLVABLE = 0.35;                              // below this, nothing can be seen at all

const focusH = (o) => FOCUS_Z + PARFOCAL[o];          // stage height at which o is sharp
const crashH = (o) => focusH(o) + CLEARANCE[o];       // stage height at which o touches glass
const hCeiling = (o) => Math.min(crashH(o), COARSE_MAX + FINE_SPAN);

const POWER_OBJ = { '40x': 4, '100x': 10, '400x': 40 };
const LADDER = { '100x': [4, 10], '400x': [4, 10, 40] };
const SPECIMENS = ['onion-epidermis', 'newsprint-letter-e'];
const STARTS = {
  'as-found-on-low-power':   { obj: 4,  coarse: 1000, lamp: 45, dia: 45 },
  'as-found-on-high-power':  { obj: 40, coarse: 1000, lamp: 45, dia: 45 },
  'stage-racked-to-the-top': { obj: 4,  coarse: COARSE_MAX, lamp: 45, dia: 45 },
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// --- state ---------------------------------------------------------------------------

let obj = 4;
let coarse = 1000, fine = 0;          // stage height = coarse + fine, in µm
let lamp = 45, dia = 45;              // 0..100 each
let task = null, specimen = 'onion-epidermis', slideLabel = '';
let done = false, confirms = 0;

// Whether the focal plane has ever been crossed at all, at any power. Distinct from having
// FOUND focus: a student can sweep straight past it and never notice, and "swept past it
// but never stopped there" is a different observation from "never got near it".
let crossed = false;

// Every objective the specimen has been brought properly sharp at, in the order it first
// happened. Used for the power-series goal, which scores the SEQUENCE rather than the
// endpoint, and for the "did they work up in order" judgement.
const focusSeq = [];
let wasFocused = false;

// WHICH RULE THE ATTEMPTS KEPT BREAKING. Counted as it happens rather than reconstructed
// at the end, because a student who leaves halfway is exactly the one this field is for
// and there is no end to reconstruct from. Each of these is a real lab rule with a real
// consequence the simulation cannot inflict, so the count stands in for the consequence.
const broke = {
  coarse40: 0,    // reached for the coarse knob with the 40x objective in place
  highFirst: 0,   // hunted at high power, or stepped up, before ever focusing at low power
  racked: 0,      // drove the stage to a mechanical stop with nothing in view
  light: 0,       // worked the focus with the illumination outside the resolvable band
  blurClaim: 0,   // called a view finished while it was still out of focus
  swingIn: 0,     // tried to swing a longer objective in with the stage too high for it
};

// Phrased as observations, never as instructions to the agent — everything crossing this
// boundary is data. The count is the useful half: one slip is noise, five is a belief.
const NOTE = {
  coarse40:  (n) => `reached for the coarse focus with the 40x objective in place ${n} time(s)`,
  highFirst: (n) => `hunted for the specimen at high power before it had ever been focused at low power ${n} time(s)`,
  racked:    (n) => `drove the stage to the end of its travel with nothing in view ${n} time(s)`,
  light:     (n) => `adjusted focus with the illumination outside the range that resolves anything ${n} time(s)`,
  blurClaim: (n) => `confirmed a view that was still out of focus ${n} time(s)`,
  swingIn:   (n) => `tried to swing a longer objective in with the stage too high to clear it ${n} time(s)`,
};

// --- the physics ---------------------------------------------------------------------

const stageH = () => coarse + fine;
const defocus = () => Math.abs(stageH() - focusH(obj));
const sharp = () => clamp01(1 - defocus() / DOF[obj]);

// The lamp sets how much light there is; the diaphragm sets how much of it gets through.
// The floor of 0.30 is the aperture never closing completely, which is true of the iris on
// a real substage condenser.
const light = () => (lamp / 100) * (0.30 + 0.70 * (dia / 100));

// A plateau of full contrast either side of what the objective wants, falling to nothing
// beyond it. Both directions matter and both are reachable: too dim and the field is a
// grey nothing, too bright and the specimen is washed straight out of a white glare.
function contrast() {
  const d = Math.abs(light() - NEED[obj]);
  return clamp01(1 - Math.max(0, d - 0.06) / 0.16);
}

const inFocus = () => sharp() >= SHARP_ENOUGH && contrast() >= LIT_ENOUGH;

// The ladder for `power-series` must appear IN ORDER inside the sequence of powers that
// were focused — as a subsequence, not as an exact match. Exact matching would mean a
// student who focused 10x before 4x could never recover, which punishes an ordering slip
// with an unwinnable task rather than with a note.
function ladderDone(rungs) {
  let i = 0;
  for (const o of focusSeq) if (o === rungs[i]) i++;
  return i === rungs.length;
}

const targetObj = () => (task?.kind === 'power-series'
  ? LADDER[task.params.top_power].at(-1)
  : POWER_OBJ[task?.params?.power]);

// --- DOM ------------------------------------------------------------------------------

const view = document.getElementById('view');
const scope = document.getElementById('scope');
const strip = document.getElementById('strip');
const say = document.getElementById('say');
const coarseEl = document.getElementById('coarse');
const fineEl = document.getElementById('fine');
const lampEl = document.getElementById('lamp');
const diaEl = document.getElementById('dia');
const coarseGrp = document.getElementById('coarseGrp');
const coarseLock = document.getElementById('coarseLock');
const confirmBtn = document.getElementById('confirm');

// The strip is built ONCE and its values are updated by textContent afterwards. Two
// reasons, and the second is the load-bearing one: re-parsing HTML on every pointer move
// is wasteful, and the slide's label is task-supplied text which must never be parsed as
// markup. A text node cannot become an element no matter what arrives in it.
const cells = {};
function buildStrip() {
  for (const [key, label] of [
    ['mag', 'mag'], ['obj', 'objective'], ['fov', 'field ⌀'], ['dof', 'depth'],
    ['h', 'stage'], ['gap', 'gap'], ['slide', 'slide'],
  ]) {
    const wrap = document.createElement('div');
    wrap.className = 'r';
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('b');
    wrap.append(l, v);
    strip.append(wrap);
    cells[key] = v;
  }
  const gauge = document.createElement('div');
  gauge.className = 'gauge';
  const fill = document.createElement('i');
  gauge.append(fill);
  strip.append(gauge);
  cells.gauge = fill;

  for (const key of ['focusTag', 'lightTag']) {
    const t = document.createElement('span');
    t.className = 'tag';
    strip.append(t);
    cells[key] = t;
  }
}
buildStrip();

function msg(text, cls = '') {
  say.textContent = text;
  say.className = cls;
}

// --- the eyepiece view ----------------------------------------------------------------
// A circle of light with the specimen in it. Three things vary and each is a lesson:
// how much of the slide fits inside the circle (the field narrows as power rises), how
// blurred it is (the depth of field collapses as power rises), and how much light and
// contrast there is (both directions ruin it).

const FIELD_R = 148, VCX = 180, VCY = 190;

// The specimen is drawn as a TILED PATTERN rather than as several hundred individual
// cells. At 4x the field is 4.5 mm across and holds well over five hundred onion cells;
// emitting that many nodes on every pointer move is how a simulation becomes unusable at
// exactly the magnification a student spends most of their time at.
function specimenDefs() {
  if (specimen === 'newsprint-letter-e') return '';
  return `<pattern id="cells" patternUnits="userSpaceOnUse" width="340" height="190">
      <rect x="5" y="4" width="330" height="85" rx="24" fill="#f3e6c9" stroke="#8d6b3d" stroke-width="8"/>
      <ellipse cx="170" cy="46" rx="15" ry="11" fill="#8d6ea8" fill-opacity=".75"/>
      <rect x="-165" y="99" width="330" height="85" rx="24" fill="#f3e6c9" stroke="#8d6b3d" stroke-width="8"/>
      <ellipse cx="0" cy="141" rx="15" ry="11" fill="#8d6ea8" fill-opacity=".75"/>
      <rect x="175" y="99" width="330" height="85" rx="24" fill="#f3e6c9" stroke="#8d6b3d" stroke-width="8"/>
      <ellipse cx="340" cy="141" rx="15" ry="11" fill="#8d6ea8" fill-opacity=".75"/>
    </pattern>`;
}

// Drawn in MICROMETRES and then scaled, so the specimen is one fixed physical object and
// the objective decides how much of it fits. That is the honest way round; scaling the
// drawing per objective instead would let the specimen quietly change size.
function specimenBody(halfUm) {
  if (specimen === 'newsprint-letter-e') {
    // A newsprint lowercase e is about 1.5 mm tall — it fits inside the 4.5 mm field at
    // 4x and overflows the 0.45 mm field at 40x, which is exactly what happens in a lab.
    return `<text x="0" y="0" text-anchor="middle" dominant-baseline="central"
      font-family="Georgia, 'Times New Roman', serif" font-size="1500" fill="#191919">e</text>`;
  }
  // Radius 1.4x the field so the pattern's own edge is always outside the visible disc.
  // If it were not, the Gaussian blur would fade that edge into a dark ring inside the
  // field — a halo that is an artefact of the drawing and not of any real optics.
  return `<circle cx="0" cy="0" r="${(halfUm * 1.4).toFixed(0)}" fill="url(#cells)"/>`;
}

function renderView() {
  const half = fov(obj) / 2;
  const k = FIELD_R / half;                        // px per µm inside the field
  const c = contrast();
  const L = light();

  // How bright the field LOOKS, relative to what this objective wants. Normalising against
  // NEED is what makes "correct illumination" look correct at every power instead of the
  // field simply getting dimmer as you magnify.
  const g = Math.round(18 + 234 * clamp01(L / (NEED[obj] * 1.25)));

  // Blur grows with defocus measured in depths of field, so the SAME stage error is a
  // smudge at 4x and total loss at 40x.
  const ratio = defocus() / DOF[obj];
  const blur = Math.max(0.01, Math.min(18, ratio * 2.2));
  // Beyond a few depths of field a real brightfield image is not "very blurry", it is
  // gone — a featureless bright disc with nothing in it. Fading structure out is what
  // makes the side view necessary rather than ornamental.
  const structure = clamp01(1 - (ratio - 4) / 8);
  const opacity = (c * Math.max(0.02, structure)).toFixed(3);

  // The image in a compound microscope arrives inverted AND reversed, which is one
  // rotation of half a turn. It is drawn, not just declared: the letter e is the classic
  // preparation precisely because it is the specimen that makes the rotation impossible
  // to miss.
  const parts = [
    `<defs>${specimenDefs()}
      <clipPath id="fieldClip"><circle cx="${VCX}" cy="${VCY}" r="${FIELD_R}"/></clipPath>
      <filter id="soft" x="-25%" y="-25%" width="150%" height="150%">
        <feGaussianBlur stdDeviation="${blur.toFixed(2)}"/>
      </filter>
    </defs>`,
    `<rect x="0" y="0" width="360" height="400" fill="#14161d"/>`,
    `<g clip-path="url(#fieldClip)">`,
    `<rect x="0" y="0" width="360" height="400" fill="rgb(${g},${g},${Math.max(0, g - 6)})"/>`,
    // The blur filter sits on a group in VIEWBOX units, above the scaling transform. Put it
    // on the scaled group instead and the blur radius is multiplied by the objective, so
    // the same defocus reads differently for reasons that are not optics.
    `<g filter="url(#soft)" opacity="${opacity}">`,
    `<g transform="translate(${VCX},${VCY}) rotate(180) scale(${k.toFixed(5)})">`,
    specimenBody(half),
    `</g></g></g>`,
    // The eyepiece tube. Drawn as a fat ring OVER the clip so the field edge is a hard
    // circle rather than a fading one.
    `<circle cx="${VCX}" cy="${VCY}" r="${FIELD_R + 8}" fill="none" stroke="#0b0d12" stroke-width="16"/>`,
    `<circle cx="${VCX}" cy="${VCY}" r="${FIELD_R + 1}" fill="none" stroke="#2b3040" stroke-width="2"/>`,
  ];

  // A scale bar, which is how the narrowing field becomes a MEASUREMENT rather than an
  // impression. The chosen length is the largest round number that fits comfortably, so
  // it changes with the objective and the number on it is the thing to read.
  const nice = [10, 20, 50, 100, 200, 500, 1000, 2000].filter((n) => n <= fov(obj) / 3).pop() || 10;
  const barPx = nice * k;
  const x0 = VCX - barPx / 2;
  parts.push(
    `<line x1="${x0.toFixed(1)}" y1="368" x2="${(x0 + barPx).toFixed(1)}" y2="368" stroke="#8f9ab8" stroke-width="3"/>`,
    `<line x1="${x0.toFixed(1)}" y1="363" x2="${x0.toFixed(1)}" y2="373" stroke="#8f9ab8" stroke-width="2"/>`,
    `<line x1="${(x0 + barPx).toFixed(1)}" y1="363" x2="${(x0 + barPx).toFixed(1)}" y2="373" stroke="#8f9ab8" stroke-width="2"/>`,
    `<text x="${VCX}" y="387" text-anchor="middle" fill="#8f9ab8" font-size="11" font-family="ui-monospace, monospace">${nice} µm</text>`,
  );
  view.innerHTML = parts.join('');
}

// --- the side elevation ----------------------------------------------------------------
// GEOMETRY THAT MUST HOLD AT EVERY POINT OF EVERY CONTROL'S RANGE, not merely at the
// defaults. The vertical axis is a single linear map — 100 µm per unit — shared by the
// stage, the slide and all three objective tips, which is what makes the drawing an
// argument rather than an illustration:
//
//     tip(o)   = BASE_Y - crashH(o)/S          the tip is fixed; the stage moves under it
//     slide(h) = BASE_Y - h/S
//     gap(h)   = slide(h) - tip(o) = (crashH(o) - h)/S
//
// So the gap is non-negative EXACTLY when h <= crashH(o), and clamping the stage to that
// ceiling is simultaneously the physics (the objective is in the way) and the guarantee
// that the picture never draws glass passing through a lens. Checked at both ends of the
// coarse knob, both ends of the fine knob and all three objectives; the extreme case is
// 4x with the stage fully up, which still leaves 70 units of air.
const S = 100;                          // µm per viewBox unit, vertically
const BASE_Y = 340;                     // where the top of the slide sits at h = 0
const TURRET_Y = 122;                   // underside of the turret disc
const tipY = (o) => BASE_Y - crashH(o) / S;

function renderScope() {
  const h = stageH();
  const slideTop = BASE_Y - h / S;
  const tip = tipY(obj);
  const gapPx = slideTop - tip;
  const gapUm = crashH(obj) - h;
  const L = light();
  const ah = 4 + 22 * (dia / 100);      // half-width of the iris opening, in viewBox units
  const p = [];

  p.push(`<rect x="0" y="0" width="300" height="450" fill="#0f1219"/>`);
  // stand: base and arm. The arm is at x 248..274 and every moving part stops short of it.
  p.push(`<rect x="26" y="424" width="250" height="22" rx="6" fill="#232837"/>`);
  p.push(`<rect x="248" y="34" width="26" height="392" rx="8" fill="#232837"/>`);
  p.push(`<rect x="168" y="46" width="84" height="22" fill="#232837"/>`);

  // eyepiece and body tube
  p.push(`<rect x="124" y="16" width="52" height="30" rx="4" fill="#2c3244"/>`);
  p.push(`<rect x="132" y="46" width="36" height="50" fill="#2c3244"/>`);

  // The two idle objectives, swung off to the sides. Drawn as stubs because they are
  // foreshortened, and short enough that they can never reach the stage: their lowest
  // point is y=147 and the stage's highest is y=259.
  for (const s of [-52, 52]) {
    p.push(`<rect x="143" y="116" width="14" height="46" rx="3" fill="#39415a" transform="rotate(${s} 150 118)"/>`);
  }
  p.push(`<rect x="108" y="96" width="84" height="26" rx="9" fill="#39415a"/>`);

  // The objective in use. A longer barrel means a shorter working distance, which is why
  // the 40x reaches almost to the glass and the 4x stops a centimetre short.
  p.push(`<path d="M 138 ${TURRET_Y} L 162 ${TURRET_Y} L 154 ${tip.toFixed(1)} L 146 ${tip.toFixed(1)} Z" fill="#59647f"/>`);
  p.push(`<rect x="146" y="${(tip - 3).toFixed(1)}" width="8" height="3" fill="#a8c8e8"/>`);

  // light path: lamp to iris, iris to the underside of the stage, then slide to objective.
  const beamOp = (0.08 + 0.55 * L).toFixed(2);
  p.push(`<polygon points="124,406 176,406 ${(150 + ah).toFixed(1)},400 ${(150 - ah).toFixed(1)},400" fill="#ffe08a" opacity="${beamOp}"/>`);
  p.push(`<polygon points="${(150 - ah).toFixed(1)},398 ${(150 + ah).toFixed(1)},398 168,${(slideTop + 24).toFixed(1)} 132,${(slideTop + 24).toFixed(1)}" fill="#ffe08a" opacity="${beamOp}"/>`);
  // Above the slide the beam is drawn as a near-parallel column, not as a cone opening out
  // to the width of the stage aperture. At 4x that gap is fourteen millimetres and a cone
  // over it becomes the largest object in the drawing while claiming something false: the
  // objective's field and its front lens are within a millimetre of each other, so what it
  // actually collects is a column, and it is drawn as one.
  p.push(`<polygon points="143,${slideTop.toFixed(1)} 157,${slideTop.toFixed(1)} 154,${tip.toFixed(1)} 146,${tip.toFixed(1)}" fill="#ffe08a" opacity="${(0.04 + 0.22 * L).toFixed(2)}"/>`);

  // condenser, then the iris blades over it, then the lamp
  p.push(`<polygon points="134,396 166,396 160,372 140,372" fill="#4a5673" opacity=".85"/>`);
  p.push(`<rect x="112" y="397" width="${(38 - ah).toFixed(1)}" height="6" fill="#2c3244"/>`);
  p.push(`<rect x="${(150 + ah).toFixed(1)}" y="397" width="${(38 - ah).toFixed(1)}" height="6" fill="#2c3244"/>`);
  p.push(`<rect x="118" y="406" width="64" height="22" rx="4" fill="#2c3244"/>`);
  p.push(`<rect x="126" y="410" width="48" height="14" rx="3" fill="rgb(${Math.round(40 + 215 * lamp / 100)},${Math.round(36 + 190 * lamp / 100)},${Math.round(28 + 90 * lamp / 100)})"/>`);

  // the stage, the slide, and the slide's paper label
  p.push(`<rect x="54" y="${(slideTop + 10).toFixed(1)}" width="184" height="14" fill="#39415a"/>`);
  p.push(`<rect x="132" y="${(slideTop + 10).toFixed(1)}" width="36" height="14" fill="#0f1219"/>`);
  p.push(`<rect x="62" y="${slideTop.toFixed(1)}" width="154" height="10" fill="#9fd8e8" opacity=".5"/>`);
  // At this scale a paper label IS a small white rectangle; the words on it go in the
  // readout strip, where they are large enough to read. Drawing 24 characters into eight
  // viewBox units would render them at about four device pixels, which is a label that
  // exists in the DOM and nowhere a student can use it.
  p.push(`<rect x="66" y="${(slideTop + 1).toFixed(1)}" width="42" height="8" rx="1" fill="#e8e2cf" opacity=".85"/>`);

  // Labels sit in fixed, separate columns: the stage height on the left at x=6, the gap on
  // the right at x=172. Two labels that share a row read as one corrupted word, and the
  // fix is to keep them apart by construction rather than to hope they miss each other.
  p.push(`<line x1="46" y1="${(slideTop + 5).toFixed(1)}" x2="54" y2="${(slideTop + 5).toFixed(1)}" stroke="#59647f" stroke-width="1.5"/>`);
  p.push(`<text x="6" y="${(slideTop + 8).toFixed(1)}" fill="#8f9ab8" font-size="10" font-family="ui-monospace, monospace">${Math.round(h)} µm</text>`);
  p.push(`<text x="6" y="138" fill="#8f9ab8" font-size="10" font-family="ui-monospace, monospace">${obj}× objective</text>`);

  // THE GAP LABEL, and the one place the drawing has to change shape rather than scale.
  // At 4x the gap is 120 units tall and the number sits comfortably inside it. At 40x the
  // gap is under a unit — the objective is all but touching the glass, which is the point —
  // and a number centred in it would be printed straight through the slide. So below a
  // threshold the label steps outside and grows a leader line to where it is pointing.
  const gapTxt = `${Math.max(0, Math.round(gapUm))} µm`;
  if (gapPx >= 22) {
    p.push(`<line x1="166" y1="${tip.toFixed(1)}" x2="166" y2="${slideTop.toFixed(1)}" stroke="#6fd3c7" stroke-width="1" stroke-dasharray="3 3"/>`);
    p.push(`<text x="172" y="${(tip + gapPx / 2 + 3.5).toFixed(1)}" fill="#6fd3c7" font-size="10" font-family="ui-monospace, monospace">${gapTxt}</text>`);
  } else {
    p.push(`<line x1="170" y1="${(tip - 11).toFixed(1)}" x2="161" y2="${(tip + gapPx / 2).toFixed(1)}" stroke="#6fd3c7" stroke-width="1"/>`);
    p.push(`<text x="172" y="${(tip - 8).toFixed(1)}" fill="#6fd3c7" font-size="10" font-family="ui-monospace, monospace">${gapTxt}</text>`);
  }

  scope.innerHTML = p.join('');
}

// --- the readout strip -------------------------------------------------------------

function renderStrip() {
  const h = stageH();
  const s = sharp(), c = contrast(), L = light();
  cells.mag.textContent = `${obj * EYEPIECE}×`;
  cells.obj.textContent = `${obj}×`;
  cells.fov.textContent = `${fov(obj)} µm`;
  cells.dof.textContent = `± ${DOF[obj]} µm`;
  cells.h.textContent = `${Math.round(h)} µm`;
  cells.gap.textContent = `${Math.max(0, Math.round(crashH(obj) - h))} µm`;
  cells.slide.textContent = slideLabel || '—';
  cells.gauge.style.width = `${(s * 100).toFixed(0)}%`;

  const f = s >= SHARP_ENOUGH ? ['good', 'sharp'] : s > 0 ? ['soft', 'soft'] : ['bad', 'nothing in focus'];
  cells.focusTag.className = `tag ${f[0]}`;
  cells.focusTag.textContent = f[1];

  const l = c >= LIT_ENOUGH ? ['good', 'light usable']
    : L < NEED[obj] ? ['bad', 'too dim'] : ['bad', 'too bright'];
  cells.lightTag.className = `tag ${l[0]}`;
  cells.lightTag.textContent = l[1];
}

// Every render, in one call. Called after the model has already been updated AND after the
// state push, never before it — see `push()`.
function render() {
  if (sharp() > 0) crossed = true;
  const now = inFocus();
  // Consecutive duplicates are dropped: swinging away and back to the same objective is
  // not a second achievement, and an unbounded list would eventually eat the notes cap.
  if (now && !wasFocused && focusSeq.at(-1) !== obj) focusSeq.push(obj);
  wasFocused = now;

  coarseGrp.classList.toggle('locked', obj === 40);
  coarseLock.hidden = obj !== 40;
  renderStrip();
  renderView();
  renderScope();
}

// --- the protocol side ---------------------------------------------------------------

const send = (type, result) => parent.postMessage({ type, version: 1, result }, '*');

// THE PARTIAL THE ARENA KEEPS. Pushed on every material change, which is the only reason
// the message exists: the exit control is always available, a student may leave at any
// moment, and the one who gives up is precisely the one whose `notes` are worth having.
//
// It is called BEFORE `render()` in every handler below, never after. Nothing that can
// throw may sit between a material change and the message reporting it — the optical bench
// lost exactly this signal to a `releasePointerCapture` on an untracked pointer. There is
// no pointer capture here, but `render()` touches three subtrees and the rule is the same:
// send first, draw second.
function push() {
  if (done) return;
  send('alexandria:state', snapshot());
}

function progress() {
  if (!task) return 0;
  if (task.kind === 'power-series') {
    const rungs = LADDER[task.params.top_power];
    let i = 0;
    for (const o of focusSeq) if (o === rungs[i]) i++;
    return i / rungs.length;
  }
  const t = targetObj();
  // Both of the first two terms are gated on having focused SOMEWHERE. Sitting on the
  // target objective is not partial progress when the task handed the instrument over
  // already sitting on it — a task that starts on high power would otherwise report a
  // quarter done before the student has touched anything.
  let v = focusSeq.length ? 0.35 : 0;                 // found it somewhere at all
  if (focusSeq.length && obj === t) v += 0.25;        // and worked up to the right power
  if (obj === t) v += 0.40 * clamp01(sharp()) * (contrast() >= LIT_ENOUGH ? 1 : 0);
  return clamp01(v);
}

function snapshot(complete = false) {
  return {
    attempt: {
      objective: `${obj}x`,
      magnification: `${obj * EYEPIECE}x`,
      stage_height_um: Math.round(stageH()),
      focus_error_um: Math.round(stageH() - focusH(obj)),
      field_diameter_um: fov(obj),
      sharpness: +sharp().toFixed(2),
      contrast: +contrast().toFixed(2),
      powers_focused: focusSeq.map((o) => `${o * EYEPIECE}x`),
      confirms,
    },
    // Numeric throughout rather than boolean, because this goal has a real middle: found
    // at low power but not yet at the target is genuinely half done, and reporting that as
    // `false` throws the distinction away. 1 is reserved for actual completion.
    correctness: complete ? 1 : +progress().toFixed(2),
    notes: noteLine(),
  };
}

// The two rules broken most, with their counts. Two rather than one because these
// mistakes travel in pairs — hunting at high power and racking into the stop are the same
// afternoon — and two rather than all six because a list of six ones is noise.
function noteLine() {
  const ranked = Object.entries(broke).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (ranked.length) return ranked.slice(0, 2).map(([k, n]) => NOTE[k](n)).join('; ');
  if (!crossed) return 'never brought the stage near the focal plane at any power';
  if (!focusSeq.length) return 'crossed the focal plane but never stopped on it, so nothing was ever fully sharp';
  return `focused at ${focusSeq.map((o) => `${o * EYEPIECE}x`).join(', ')} in that order, breaking no procedure rule`;
}

// --- interaction ----------------------------------------------------------------------

// A gesture is one drag or one arrow key: `input` fires throughout it, `change` fires once
// at the end. The counted mistakes are counted per GESTURE, because a student who drags the
// fine focus across its travel has made one mistake, not four hundred.
let gesture = null;
function openGesture() {
  if (!gesture) gesture = { hadFocus: focusSeq.length > 0 };
}

let atStop = false;          // already counted this arrival at a mechanical stop

// The stage stops where the objective is, not where the knob runs out. Whichever knob was
// just turned gives back the excess, so the control and the stage never disagree — a knob
// that keeps turning while the stage refuses to move is a lie about a mechanism.
function setFocus(which, value) {
  if (which === 'coarse') coarse = value; else fine = value;
  const ceiling = hCeiling(obj);
  let over = coarse + fine - ceiling;
  if (over > 0) {
    if (which === 'coarse') coarse -= over; else fine -= over;
  }
  let under = -(coarse + fine);
  if (under > 0) {
    if (which === 'coarse') coarse += under; else fine += under;
  }
  coarseEl.value = String(coarse);
  fineEl.value = String(fine);
}

// Fires at the end of a focus gesture. Everything counted here is counted here rather than
// on `input` so that one drag is one observation.
function endFocusGesture() {
  const hadFocus = gesture ? gesture.hadFocus : focusSeq.length > 0;
  gesture = null;
  let flagged = false;

  // RULE: find it at low power first. Hunting on a high-power objective before the
  // specimen has ever been focused at all is the mistake this counts — the field at 40x is
  // a tenth as wide and the depth of field a tenth as deep, so a student searching there
  // is searching a volume a hundred times smaller with no idea where to start.
  if (obj > 4 && !hadFocus) {
    broke.highFirst++;
    flagged = true;
    msg('Searching at high power: the field here is a fraction of the width, and the depth of field a fraction as deep.', 'bad');
  }

  // RULE: the light is part of focusing. A student turning the focus knob when the field
  // is black or blown out is solving the wrong problem, and will conclude the specimen is
  // not there.
  if (contrast() < RESOLVABLE) {
    broke.light++;
    flagged = true;
    msg(light() < NEED[obj]
      ? 'Nothing is resolvable: at this power there is not enough light reaching the eyepiece.'
      : 'Nothing is resolvable: the field is so bright the specimen is washed out of it.', 'bad');
  }

  // RULE: crossing the focal plane. Reaching a mechanical stop with an empty field means
  // the stage went the wrong way and kept going. Counted once per arrival rather than per
  // click, and cleared as soon as the stage leaves the stop.
  const h = coarse + fine;
  const at = h >= hCeiling(obj) - 0.01 || h <= 0.01;
  if (at && sharp() < 0.2) {
    // The COUNT is once per arrival — pushing a knob that has already stopped is not a
    // second mistake. The MESSAGE is not: the condition is still true, so it still says so,
    // otherwise the complaint disappears while the stage is still jammed against the stop.
    flagged = true;
    if (!atStop) { atStop = true; broke.racked++; }
    msg(h <= 0.01
      ? 'The stage is at the bottom of its travel and the field is empty. The focal plane is not below this.'
      : 'The stage will go no higher and the field is empty. The focal plane is not above this.', 'bad');
  } else {
    atStop = false;
  }
  // A stale complaint about something already fixed is worse than no message: it reads as
  // the instrument still objecting to a state that has since been corrected.
  if (!flagged) msg('');
}

// COARSE FOCUS IS REFUSED AT 40x, and refused rather than disabled. A disabled control
// cannot be reached for, so the mistake would stop being observable — and this mistake is
// the whole reason the engine exists. The arithmetic behind the refusal is on the panel:
// one click of this knob is 100 µm and the 40x objective sits 60 µm above the coverslip,
// so a single click from focus is a broken slide and a damaged front lens.
let coarseFlagged = false;
coarseEl.addEventListener('input', () => {
  if (obj === 40) {
    coarseEl.value = String(coarse);              // the knob will not turn
    if (!coarseFlagged) {
      coarseFlagged = true;
      broke.coarse40++;
      msg(`Coarse focus is locked with the 40× objective in place: one click is ${COARSE_STEP} µm and the objective sits ${CLEARANCE[40]} µm above the slide.`, 'bad');
      push();                                     // signal first, drawing second
      render();
    }
    return;
  }
  openGesture();
  setFocus('coarse', Number(coarseEl.value));
  render();
});
coarseEl.addEventListener('change', () => {
  if (obj === 40) { coarseFlagged = false; return; }
  endFocusGesture();
  push();
  render();
});

fineEl.addEventListener('input', () => {
  openGesture();
  setFocus('fine', Number(fineEl.value));
  render();
});
fineEl.addEventListener('change', () => {
  endFocusGesture();
  push();
  render();
});

for (const [el, set] of [[lampEl, (v) => { lamp = v; }], [diaEl, (v) => { dia = v; }]]) {
  el.addEventListener('input', (e) => { set(Number(e.target.value)); render(); });
  el.addEventListener('change', () => {
    // No count here: a student turning the lamp up is FIXING this rule, not breaking it.
    // The counted case is turning the focus knob while the light is the actual problem.
    if (contrast() >= LIT_ENOUGH) msg('');
    else if (contrast() < RESOLVABLE) {
      msg(light() < NEED[obj]
        ? `Still too dim to resolve anything at ${obj}×.`
        : `Still too bright at ${obj}× — the specimen is washed out of the field.`, 'bad');
    }
    push();
    render();
  });
}

document.getElementById('turret').addEventListener('click', (e) => {
  const btn = e.target.closest('.obj');
  if (!btn) return;
  const next = Number(btn.dataset.obj);
  if (next === obj || !OBJECTIVES.includes(next)) return;

  // RULE: lower the stage before swinging in a longer objective. With the stage high, the
  // 40x barrel physically will not clear the slide — so the turret refuses to turn, which
  // is what a real stand does before it starts breaking things.
  if (stageH() > crashH(next)) {
    broke.swingIn++;
    msg(`The ${next}× objective will not swing in: it is longer, and the stage is ${Math.round(stageH() - crashH(next))} µm too high to clear it.`, 'bad');
    push();
    render();
    return;
  }

  // RULE: step up only from a focused view. Parfocal objectives mean that a sharp image at
  // low power is a couple of fine-focus clicks from a sharp image at high power — and that
  // an unfocused one is nothing to build on.
  if (next > obj && !inFocus()) {
    broke.highFirst++;
    msg(`Stepping up to ${next}× from a view that is not in focus. There is nothing here for the higher power to start from.`, 'bad');
  } else {
    msg('');
  }

  obj = next;
  wasFocused = false;                             // re-evaluated for the new objective
  atStop = false;
  for (const b of document.querySelectorAll('.obj')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.obj) === obj));
  }
  push();
  render();
});

confirmBtn.addEventListener('click', () => {
  if (done || !task) return;
  confirms++;

  if (contrast() < RESOLVABLE) {
    broke.light++;
    msg('There is nothing resolvable in the field to confirm — the illumination is outside the usable range.', 'bad');
    push(); render(); return;
  }
  if (!inFocus()) {
    // Calling a soft image finished is its own misconception, and a common one: the
    // student has stopped at the first thing that looks like a shape.
    broke.blurClaim++;
    msg(sharp() < SHARP_ENOUGH
      ? 'That view is not in focus yet.'
      : 'The image is sharp but too dim to call resolved.', 'bad');
    push(); render(); return;
  }
  if (task.kind === 'power-series') {
    const rungs = LADDER[task.params.top_power];
    if (!ladderDone(rungs)) {
      msg('Sharp — but not every power on the way up has been focused yet.', 'bad');
      push(); render(); return;
    }
  } else if (obj !== targetObj()) {
    // Deliberately does NOT name the magnification being asked for. The chrome states the
    // task; an engine that restated it would be renegotiating an invariant it does not own.
    msg('Sharp, and correctly lit — but not at the magnification this task asked for.', 'bad');
    push(); render(); return;
  }

  msg(`Sharp at ${obj * EYEPIECE}×. That is the view.`, 'good');
  confirmBtn.disabled = true;
  const result = snapshot(true);
  done = true;
  send('alexandria:complete', result);
  render();
});

// --- the handshake ---------------------------------------------------------------------

const fail = (message) => parent.postMessage({ type: 'alexandria:error', version: 1, message }, '*');

window.addEventListener('message', (e) => {
  // The arena is the only window that can reach this frame, but check anyway: an engine
  // that trusts any sender is an engine that can be driven by anything embedded in it.
  // Origin is worthless here — it is the string "null" for an opaque origin — so the
  // window reference is the only identity available.
  if (e.source !== parent) return;
  if (e.data?.type !== 'alexandria:task') return;

  const kind = e.data.kind;
  const params = e.data.params ?? {};
  if (kind !== 'focus-specimen' && kind !== 'power-series') {
    return fail(`unknown task kind "${kind}"`);
  }
  // Enum parameters are checked rather than defaulted. Quietly drawing onion cells when
  // the task named a letter e is a fidelity failure of the worst sort — the student is
  // looking at the wrong specimen and has no way to know. Degrading is the honest outcome.
  if (!SPECIMENS.includes(params.specimen)) {
    return fail(`cannot mount specimen "${params.specimen}"`);
  }
  if (kind === 'focus-specimen' && !POWER_OBJ[params.power]) {
    return fail(`no objective reaches "${params.power}"`);
  }
  if (kind === 'power-series' && !LADDER[params.top_power]) {
    return fail(`no objective ladder reaches "${params.top_power}"`);
  }
  const start = kind === 'focus-specimen' ? params.start : 'as-found-on-low-power';
  if (!STARTS[start]) return fail(`unknown starting state "${start}"`);

  task = { kind, params };
  specimen = params.specimen;
  // Truncated here as well as declared in the manifest: `maxLength` is a job line for the
  // model, not a guarantee about what actually arrives on the wire.
  slideLabel = String(params.slide_label ?? '').slice(0, 24);

  const s = STARTS[start];
  obj = s.obj; coarse = s.coarse; fine = 0; lamp = s.lamp; dia = s.dia;
  coarseEl.value = String(coarse); fineEl.value = '0';
  lampEl.value = String(lamp); diaEl.value = String(dia);
  for (const b of document.querySelectorAll('.obj')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.obj) === obj));
  }

  // A baseline partial, so a student who mounts and leaves immediately still arrives at
  // the ledger with an observation rather than with an empty object and a clock.
  push();
  render();
});

render();

// The engine speaks first. The arena cannot know when this listener attached, so anything
// it sent before now would have been dropped on the floor — and on a cold cache it would
// have been sent before this file finished parsing.
parent.postMessage({ type: 'alexandria:ready', version: 1 }, '*');
