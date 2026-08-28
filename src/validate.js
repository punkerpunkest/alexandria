// Semantic validation. The schema guarantees SHAPE; this checks MEANING.
// Everything here is a rule the schema cannot express or does not enforce.
//
// No world's vocabulary appears in this file. Length caps, closed-set membership
// and channel restrictions all come from the manifest, so a world that renames a
// channel or changes an enum value stays validated instead of silently failing open.

import { SHAPES, plot } from '../public/plot.js';

// A diagram spec is the first channel value that is an object, so its rules are
// structural rather than about length or set membership. Everything here is something
// the JSON Schema cannot state: per-shape coefficient counts, an ordered domain, marks
// that actually land inside it.
//
// The last check DRAWS THE FIGURE. That is not belt and braces — it is the only check
// that cannot drift, because it asks the real plotter whether it can really draw this
// rather than asking a second implementation of the same rules. The plotter is pure, so
// running it here costs nothing and breaks no invariant.
function diagramFailures(v) {
  const out = [];
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return ['is not a diagram spec object'];

  const shape = SHAPES[v.shape];
  if (!shape) return [`shape "${v.shape}" is not one of ${Object.keys(SHAPES).join(', ')}`];

  const c = v.coefficients;
  const [lo, hi] = shape.arity;
  if (!Array.isArray(c) || !c.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    out.push('coefficients must all be finite numbers');
  } else if (c.length < lo || c.length > hi) {
    out.push(lo === hi
      ? `${v.shape} takes exactly ${lo} coefficients, got ${c.length}`
      : `${v.shape} takes ${lo} to ${hi} coefficients, got ${c.length}`);
  }


  // A shape that derives its direction from two points needs those points to be at two
  // different x values, or the derivation divides by zero. Declared beside the shape.
  const [i, j] = shape.distinct ?? [];
  if (i != null && Array.isArray(c) && c[i] === c[j]) {
    out.push(`${v.shape} needs coefficients ${i} and ${j} to differ, both are ${c[i]}`);
  }
  // THE SHAPE'S NAME IS A CLAIM, and the numbers have to keep it. `turning` promises a
  // curve that turns; two points at the same height derive a curvature of zero and draw
  // a flat line, which is not a turning curve wearing bad coefficients — it is a
  // different curve entirely. Measured: asked for y = x^2 the model gave the turning
  // point (0,0) correctly and then (1,0) as its second point, where the real curve is at
  // (1,1), and the figure rendered as a horizontal line. Checkable without knowing any
  // subject, because it only asks whether the drawing does what its own shape says.
  const [p, q] = shape.varies ?? [];
  if (p != null && Array.isArray(c) && c[p] === c[q]) {
    out.push(`${v.shape} draws a curve that turns, but coefficients ${p} and ${q} are both ` +
             `${c[p]}, which flattens it to a straight line. The second point must be a value ` +
             `the curve actually reaches somewhere other than its turning point.`);
  }

  const d = v.domain;
  if (!Array.isArray(d) || d.length !== 2 || !d.every(Number.isFinite)) {
    out.push('domain must be two finite numbers');
  } else if (!(d[1] > d[0])) {
    out.push(`domain [${d[0]}, ${d[1]}] is empty or reversed; min must be smaller than max`);
  } else {
    for (const m of Array.isArray(v.marks) ? v.marks : []) {
      if (typeof m !== 'number' || m < d[0] || m > d[1]) {
        out.push(`mark ${m} is outside the domain [${d[0]}, ${d[1]}]`);
      }
    }
  }

  if (out.length) return out;
  try { plot(v); } catch (err) { out.push(String(err.message ?? err).replace(/^plot: /, '')); }
  return out;
}

export function validate(world, out) {
  const failures = [];
  const beats = out?.beats;
  if (!Array.isArray(beats) || beats.length === 0) {
    return [{ scope: 'module', reason: 'no beats returned' }];
  }

  const channels = Object.entries(world.channels);

  beats.forEach((b, i) => {
    for (const [name, ch] of channels) {
      const v = b[name];

      // BACKSTOP ONLY — and currently unreachable. `maxLength` goes into the JSON
      // Schema handed to the adapter, and the structured-output layer ENFORCES it:
      // set the cap below what the model needs and generation fails outright with
      // `error_max_structured_output_retries` rather than returning something long.
      // So over-cap text never arrives here. Kept in case an adapter is ever swapped
      // in that only steers. Do not read a zero repair count as good model behaviour.
      if (ch.kind === 'text' && typeof v === 'string' && ch.maxLength && v.length > ch.maxLength) {
        failures.push({ beat: i, field: name, reason: `${v.length} chars, cap is ${ch.maxLength}` });
      }

      // A value outside the world's declared set would resolve to a missing asset.
      if ((ch.kind === 'enum' || ch.kind === 'asset') && v != null) {
        const allowed = ch.values ?? Object.keys(world.assets[ch.set] ?? {});
        // An empty allowed list means the manifest is broken, not that everything is
        // permitted. Guarding with `allowed.length &&` made this fail OPEN on precisely
        // the values the check exists to reject: a channel whose `set` names a group
        // missing from `world.assets` accepted anything, and every one of those values
        // resolves to a 404. Until the manifest validator exists this is where it surfaces.
        if (!allowed.length) {
          failures.push({ beat: i, field: name,
            reason: `channel declares set "${ch.set}", which is empty or absent from world.assets` });
        } else if (!allowed.includes(v)) {
          failures.push({ beat: i, field: name, reason: `"${v}" is not one of ${allowed.join(', ')}` });
        }
      }

      // An optional channel is allowed to be absent; present, it is held to every rule.
      if (ch.kind === 'diagram' && v != null) {
        for (const reason of diagramFailures(v)) failures.push({ beat: i, field: name, reason });
      }

      // Manifest-declared restrictions: { "considering": "misconception" }.
      const kindFor = ch.restrict?.[v];
      if (kindFor && b.kind !== kindFor) {
        failures.push({ beat: i, field: name, reason: `"${v}" is only allowed on a ${kindFor} beat` });
      }
    }

    // Declared per channel, so no channel name appears in this file.
    for (const [name, ch] of channels) {
      if (ch.mustBeClaim && typeof b[name] === 'string' && b[name].trim().endsWith('?')) {
        failures.push({ beat: i, field: name, reason: 'is a question; it must be a claim' });
      }
    }
  });

  // `hold` channels: declared per channel, so no channel name appears here either.
  // The schema stays per-beat; consistency is a semantic rule, which is this file's job.
  // Beat 0 is the reference, so repair rewrites the strays rather than the whole module.
  for (const [name, ch] of channels) {
    if (ch.hold !== 'module') continue;
    const ref = beats[0]?.[name];
    if (ref == null) continue;
    beats.forEach((b, i) => {
      if (i > 0 && b[name] !== ref) {
        failures.push({
          beat: i, field: name,
          reason: `"${b[name]}" but ${name} is held for the module; it must stay "${ref}"`,
        });
      }
    });
  }

  // MODULE-LEVEL CHANNELS. Same rules, different scope: these sit beside `beats`
  // rather than inside one, so they are checked against `out` rather than a beat.
  for (const [name, ch] of Object.entries(world.module?.channels ?? {})) {
    const v = out[name];
    if (v == null || (typeof v === 'string' && !v.trim())) {
      failures.push({ scope: 'module', reason: `${name} is missing` });
      continue;
    }
    if (ch.kind === 'text' && ch.maxLength && v.length > ch.maxLength) {
      failures.push({ scope: 'module', reason: `${name} is ${v.length} chars, cap is ${ch.maxLength}` });
    }
    // The mirror of mustBeClaim. The ask line's whole job is to hand the turn back
    // to the student, and a statement does not do that.
    if (ch.mustAsk && typeof v === 'string' && !v.trim().endsWith('?')) {
      failures.push({ scope: 'module', reason: `${name} must end in a question` });
    }
  }

  // Coverage: the world declares beat kinds it must always receive.
  for (const need of world.beats.require ?? []) {
    if (!beats.some((b) => b.kind === need)) {
      failures.push({ scope: 'module', reason: `no ${need} beat in the module` });
    }
  }

  return failures;
}

export function repairPrompt(failures) {
  return [
    'That module did not pass validation. Fix exactly these and return the whole array again, changing nothing else:',
    ...failures.map((f) =>
      f.scope === 'module' ? `- module: ${f.reason}` : `- beat ${f.beat}, field ${f.field}: ${f.reason}`),
  ].join('\n');
}
