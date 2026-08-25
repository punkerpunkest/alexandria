// Semantic validation. The schema guarantees SHAPE; this checks MEANING.
// Everything here is a rule the schema cannot express or does not enforce.
//
// No world's vocabulary appears in this file. Length caps, closed-set membership
// and channel restrictions all come from the manifest, so a world that renames a
// channel or changes an enum value stays validated instead of silently failing open.

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
        if (allowed.length && !allowed.includes(v)) {
          failures.push({ beat: i, field: name, reason: `"${v}" is not one of ${allowed.join(', ')}` });
        }
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
