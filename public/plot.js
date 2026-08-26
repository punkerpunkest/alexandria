// THE PLOTTER: a diagram spec becomes SVG. Pure, in the same sense `src/paginate.js`
// is pure — same spec in, byte-identical string out, no clock, no randomness, no DOM.
// That is what lets it be frozen in the golden fixture and imported from Node.
//
// WHY THIS IS NOT WORLD CODE. A world ships no JavaScript, so it cannot draw. It could
// not draw even if it wanted to. The plotter is RUNTIME knowledge, in exactly the same
// category as the archetype map in `app.js`: the world declares that a slot holds a
// figure, and the runtime knows what a figure is. See `Alexandria - PoC Flow`, the
// Longform section: "the model outputs a diagram spec from a closed grammar and the
// plotter draws it deterministically. It never emits SVG, markup, or drawing
// instructions." This file is the second half of that sentence.
//
// WHY A SHAPE ENUM RATHER THAN AN EXPRESSION STRING. An expression needs a parser, and
// a parser has syntax errors, which means a whole class of generation failure that has
// to be caught after the model has already made it. A shape drawn from a closed set plus
// an array of numbers cannot be malformed. This is the same trade the visual novel's
// `keyedBy` made over `prefixedBy` — an invalid combination that cannot be expressed
// beats one that has to be validated.

// The shapes, their arity, and what the coefficients mean. `describe` is what the
// model reads in the schema, so it is the whole of the grammar's documentation and it
// lives beside the implementation rather than in the manifest, where it would drift.
export const SHAPES = {
  // TWO POINTS RATHER THAN A DIRECTION. Every step here was forced by measurement, on
  // one question ("why does ice float") whose figure is water density against
  // temperature — a curve that peaks at 4 C.
  //   1. Raw coefficients: `polynomial [1, -0.3, 0.075]` — a dip at x = 2 reaching
  //      37 g/cm3 at the edge, captioned as a peak at 4.
  //   2. Vertex form `a*(x-h)^2 + k`: h = 4 and k = 1000 correct, units plausible,
  //      a = +0.002 — still a dip, still captioned as a maximum.
  //   3. Direction moved into the shape NAME (`peak` / `valley`): still chose `valley`.
  //      Sonnet chose `valley` too, so this is not a small-model problem.
  // Four attempts, two model tiers, and h and k were right EVERY time. Only the
  // direction was ever wrong. That fits the schema-order trap in `Alexandria - World
  // Spec`: constrained fields are emitted before free text, so the direction is chosen
  // before the caption that explains the figure has been written.
  // So the direction is no longer asked for. The model gives two points it is reliably
  // good at -- the turning point, and one real value from elsewhere -- and the curve
  // through them decides. Same move as deriving the y range and the mark labels: when a
  // value can be computed from what the model is good at, never ask for it.
  turning:     { arity: [4, 4], distinct: [0, 2], describe: 'A curve with exactly one turning point. Exactly 4: h, k, xr, yr. The turning point is at x = h, where y = k. The curve also passes through (xr, yr), a second real value from elsewhere in the range, and xr must not equal h. Whether the curve peaks or dips is WORKED OUT from those two points — there is no direction to choose. Use this whenever the figure is about where something is highest or lowest.' },
  polynomial:  { arity: [2, 6], describe: 'c0 + c1*x + c2*x^2 + ... — 2 to 6 coefficients, lowest power first. Straight lines and general curves. If the figure is about a maximum or a minimum, use quadratic instead.' },
  exponential: { arity: [3, 3], describe: 'a*e^(b*x) + c — exactly 3: a, b, c. Growth and decay.' },
  logarithmic: { arity: [3, 3], describe: 'a*ln(b*x) + c — exactly 3: a, b, c. Only defined where b*x > 0.' },
  sinusoidal:  { arity: [4, 4], describe: 'a*sin(b*x + c) + d — exactly 4: a, b, c, d. Waves and oscillation.' },
  power:       { arity: [3, 3], describe: 'a*x^b + c — exactly 3: a, b, c. Square laws, inverse squares.' },
  reciprocal:  { arity: [3, 3], describe: 'a/(b*x) + c — exactly 3: a, b, c. Undefined at x = 0.' },
};

// Evaluate at one x. Returns a non-finite number outside the function's real domain --
// log of a non-positive number, a division by zero, a fractional power of a negative --
// and every caller treats non-finite as "no point here" rather than as an error. A
// curve that leaves its own domain should break, not throw.
export function evaluate(shape, c, x) {
  switch (shape) {
    // a is derived from the second point, so direction is a consequence rather than an input.
    case 'turning':     return c[1] + ((c[3] - c[1]) / (c[2] - c[0]) ** 2) * (x - c[0]) ** 2;
    case 'polynomial':  return c.reduce((sum, k, i) => sum + k * x ** i, 0);
    case 'exponential': return c[0] * Math.exp(c[1] * x) + c[2];
    case 'logarithmic': return c[0] * Math.log(c[1] * x) + c[2];
    case 'sinusoidal':  return c[0] * Math.sin(c[1] * x + c[2]) + c[3];
    case 'power':       return c[0] * x ** c[1] + c[2];
    case 'reciprocal':  return c[0] / (c[1] * x) + c[2];
    default: throw new Error(`plot: unknown shape "${shape}". Known: ${Object.keys(SHAPES).join(', ')}`);
  }
}

// The artboard. Fixed, because the SVG scales to whatever box the world gives it and a
// viewBox that changed with the data would make stroke widths and type sizes drift
// between two figures on the same page.
const W = 640, H = 400;
// `left` is a FLOOR, not a fixed value: tick labels vary in width now that precision
// adapts to the axis, and a fixed gutter that fits "0.9999" does not fit "0.99997123".
// The floor is what keeps an ordinary plot pixel-identical to before.
const PAD = { top: 18, right: 20, bottom: 54, left: 72 };
const SAMPLES = 240;         // one sample per ~2.4 device px at the artboard width
const TICK_CHAR_PX = 6.4;    // mean advance of the 12px sans tick face, measured
const Y_LABEL_BAND = 34;     // the rotated y-axis label plus its gap

// Model text reaching a markup string is the one genuinely dangerous moment in this
// file. Escape it, every time, with no exceptions for "this field is just a label".
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// PRECISION COMES FROM THE AXIS, not from a constant. A fixed 2dp was the original
// choice and it silently destroyed real data: water's density varies from 0.99968 to
// 1.0 across the interesting range, so every y tick rendered as "1" and the mark that
// makes the whole point rendered as "(4, 1)".
//
// The rule is to label to the finest distinction the axis can actually SHOW — its span
// divided by its length in artboard px. Because trailing zeros are trimmed afterwards,
// over-precision costs nothing on screen, so one rule serves both ticks and marks and
// no significant digit can ever be dropped. Deriving it from the span instead was tried
// and rejected: it renders a tick sitting at 0.25 as "0.3", a label that does not name
// its own gridline.
//
// `toFixed` rather than `toPrecision` so ordinary values cannot slip into exponential
// notation, and never `toLocaleString`, which would put a comma in the fixture on one
// machine and a period on another. Determinism is a fixture requirement, not a taste.
function decimalsFor(resolution) {
  // A degenerate resolution means the caller has no scale to offer; 2dp is the old
  // behaviour and a safe floor. Guarding here keeps every caller from having to.
  if (!(resolution > 0) || !Number.isFinite(resolution)) return 2;
  return Math.min(12, Math.max(0, Math.ceil(-Math.log10(resolution))));
}

function num(v, resolution) {
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v) >= 1e5) return v.toExponential(1).replace('e+', 'e');
  const dp = decimalsFor(resolution);
  // Only reach for exponent form when fixed notation would round the value away to
  // nothing. A blanket small-number threshold sent 0.00004 to "4.0e-5" on an axis that
  // was perfectly capable of writing it out.
  if (v !== 0 && Math.abs(v) < 0.5 * 10 ** -dp) return v.toExponential(1).replace('e+', 'e');
  const s = v.toFixed(dp);
  // Trim ONLY when there is a decimal point to trim. Without the guard, "100" at dp 0
  // matches the trailing-zero pattern and becomes "1".
  return s.includes('.') ? (s.replace(/\.?0+$/, '') || '0') : s;
}
// SVG coordinates. 1dp is below what any display resolves and it keeps the frozen
// string short enough to read in a diff.
const co = (v) => (Math.round(v * 10) / 10).toString();

// A "nice" tick step: 1, 2, 2.5 or 5 times a power of ten. The standard choice, and the
// reason axis labels read 0, 25, 50 rather than 0, 23.7, 47.4.
function ticks(lo, hi, target = 6) {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out = [];
  // Epsilon guard on the end: floating point makes the last tick land at 99.99999
  // instead of 100 often enough that the axis visibly loses its final label.
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) {
    out.push(Math.abs(t) < step * 1e-9 ? 0 : t);       // snap a floating -0 to 0
  }
  return out;
}

export function plot(spec) {
  const shape = spec?.shape;
  if (!SHAPES[shape]) {
    throw new Error(`plot: unknown shape "${shape}". Known: ${Object.keys(SHAPES).join(', ')}`);
  }
  const coefficients = Array.isArray(spec.coefficients) ? spec.coefficients : [];
  const [x0, x1] = Array.isArray(spec.domain) ? spec.domain : [0, 1];
  if (!(x1 > x0)) throw new Error(`plot: domain [${x0}, ${x1}] is empty or reversed`);

  // SAMPLE FIRST, SCALE SECOND. The y range is derived from the function rather than
  // declared in the spec, which deletes an entire failure mode: a model-supplied y range
  // that does not actually contain the curve it is meant to frame. The model cannot get
  // this wrong because it is never asked.
  const pts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / SAMPLES;
    pts.push([x, evaluate(shape, coefficients, x)]);
  }
  const ys = pts.map(([, y]) => y).filter(Number.isFinite);
  if (!ys.length) {
    throw new Error(`plot: ${shape} is undefined across the whole domain [${x0}, ${x1}]`);
  }
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  // A constant function has no range at all, and a zero-height scale divides by zero.
  if (y1 - y0 < 1e-12) { y0 -= 1; y1 += 1; }
  else { const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad; }

  // The y scale depends only on the top and bottom pads, so the tick labels can be
  // resolved before the left gutter they determine. Widen the gutter to fit the widest
  // of them, never narrower than the floor.
  const plotH = H - PAD.top - PAD.bottom;
  const rawTicks = ticks(y0, y1, 5);
  let yRes = (y1 - y0) / plotH;
  let yTicks = rawTicks.map((t) => [t, num(t, yRes)]);
  // A LABEL MUST DISTINGUISH ITS OWN TICK. Pixel resolution is the right default, but on
  // data that varies far below it -- a curve whose whole range is in the ninth
  // significant figure -- every tick collapses to the same string, which is the original
  // "1 | 1 | 1" defect wearing a smaller number. Ask for finer resolution until they
  // separate. Bounded, and it stops either way at the decimal cap inside `num`.
  for (let i = 0; i < 6 && new Set(yTicks.map(([, l]) => l)).size < yTicks.length; i++) {
    yRes /= 10;
    yTicks = rawTicks.map((t) => [t, num(t, yRes)]);
  }
  const widest = yTicks.reduce((n, [, label]) => Math.max(n, label.length), 0);
  const PLOT = {
    x: Math.max(PAD.left, Math.ceil(Y_LABEL_BAND + widest * TICK_CHAR_PX)),
    y: PAD.top, h: plotH,
    get w() { return W - this.x - PAD.right; },
  };

  const sx = (x) => PLOT.x + ((x - x0) / (x1 - x0)) * PLOT.w;
  const sy = (y) => PLOT.y + PLOT.h - ((y - y0) / (y1 - y0)) * PLOT.h;

  // Break the path wherever the function left its real domain, rather than drawing a
  // straight line across the gap — a reciprocal through x = 0 would otherwise gain a
  // near-vertical stroke that looks like part of the curve.
  let d = '', pen = false;
  for (const [x, y] of pts) {
    if (!Number.isFinite(y)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${co(sx(x))} ${co(sy(y))}`;
    pen = true;
  }

  const parts = [];
  const gridline = (x1_, y1_, x2_, y2_) =>
    `<line x1="${co(x1_)}" y1="${co(y1_)}" x2="${co(x2_)}" y2="${co(y2_)}" class="alx-plot-grid"/>`;

  const xRes = (x1 - x0) / PLOT.w;

  for (const t of ticks(x0, x1)) {
    const x = sx(t);
    parts.push(gridline(x, PLOT.y, x, PLOT.y + PLOT.h));
    parts.push(`<text x="${co(x)}" y="${co(PLOT.y + PLOT.h + 20)}" class="alx-plot-tick" text-anchor="middle">${esc(num(t, xRes))}</text>`);
  }
  for (const [t, label] of yTicks) {
    const y = sy(t);
    parts.push(gridline(PLOT.x, y, PLOT.x + PLOT.w, y));
    parts.push(`<text x="${co(PLOT.x - 10)}" y="${co(y + 4)}" class="alx-plot-tick" text-anchor="end">${esc(label)}</text>`);
  }

  // The axes themselves, drawn after the grid so they sit on top of it.
  parts.push(`<line x1="${co(PLOT.x)}" y1="${co(PLOT.y)}" x2="${co(PLOT.x)}" y2="${co(PLOT.y + PLOT.h)}" class="alx-plot-axis"/>`);
  parts.push(`<line x1="${co(PLOT.x)}" y1="${co(PLOT.y + PLOT.h)}" x2="${co(PLOT.x + PLOT.w)}" y2="${co(PLOT.y + PLOT.h)}" class="alx-plot-axis"/>`);
  parts.push(`<path d="${d}" class="alx-plot-curve" fill="none"/>`);

  // MARKS. The spec carries only an x position; the label is the coordinate the
  // function actually has there, computed here. A model cannot mislabel a point it
  // never writes the label for, which is the same principle as deriving the y range.
  for (const at of (Array.isArray(spec.marks) ? spec.marks : []).slice(0, 3)) {
    if (typeof at !== 'number' || at < x0 || at > x1) continue;
    const y = evaluate(shape, coefficients, at);
    if (!Number.isFinite(y)) continue;
    const px = sx(at), py = sy(y);
    // Flip the label inboard near the right edge so it cannot run off the artboard.
    const right = px > PLOT.x + PLOT.w - 90;
    parts.push(`<circle cx="${co(px)}" cy="${co(py)}" r="4.5" class="alx-plot-mark"/>`);
    parts.push(
      `<text x="${co(px + (right ? -9 : 9))}" y="${co(py - 9)}" class="alx-plot-marklabel" ` +
      `text-anchor="${right ? 'end' : 'start'}">(${esc(num(at, xRes))}, ${esc(num(y, yRes))})</text>`);
  }

  const xl = esc(spec.x_label), yl = esc(spec.y_label);
  if (xl) parts.push(`<text x="${co(PLOT.x + PLOT.w / 2)}" y="${co(H - 12)}" class="alx-plot-axislabel" text-anchor="middle">${xl}</text>`);
  // The y label is rotated about its own anchor, which keeps the transform independent
  // of the artboard size.
  if (yl) parts.push(`<text x="0" y="0" class="alx-plot-axislabel" text-anchor="middle" transform="translate(18 ${co(PLOT.y + PLOT.h / 2)}) rotate(-90)">${yl}</text>`);

  // `role="img"` plus a title is what a screen reader reads instead of a wall of
  // coordinates. The caption doubles as the accessible name, so a figure is never
  // silent even when the caption is styled away.
  const caption = esc(spec.caption);
  const svg =
    `<svg viewBox="0 0 ${W} ${H}" class="alx-plot" role="img"${caption ? ` aria-label="${caption}"` : ''}>` +
    parts.join('') +
    `</svg>`;

  return caption ? `${svg}<figcaption class="alx-plot-caption">${caption}</figcaption>` : svg;
}
