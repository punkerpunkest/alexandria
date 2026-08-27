// THE ASSET RESOLVER. The only place in Alexandria where an asset path is constructed.
//
// The projector used to build these itself, which meant three things nobody had written
// down — the `assets/` folder, the hyphen, and the flat single-directory layout — lived
// as string concatenation inside `assetUrl()`. A world author had to match a convention
// no document described, and found out by rendering nothing with no error to read.
//
// Everything that will later change about an asset URL changes HERE and nowhere else:
//   - swapping HTTP for a custom protocol bound to the packages root
//   - the `<id>/<version>/` segment that versioned immutable installs require
//   - any change to the on-disk layout
// See `Alexandria - Storage`, "The asset resolver contract".
//
// Shared deliberately: the loader imports it to check that every declared asset exists on
// disk, and the projector imports it to render. One definition, so the check and the use
// cannot drift apart.

// A channel's asset KEY. Normally the value itself; a channel declaring `keyedBy`
// composes its key from another channel's value first, so the visual novel's eleven
// neutral expressions become `mei-smile` rather than the model choosing from twenty-two
// character-qualified ones. Composing a key is manifest vocabulary; composing a path is
// not, which is why this half stays and the other half moved.
export function assetKey(ch, value, fill = {}) {
  return ch.keyedBy ? `${fill[ch.keyedBy]}-${value}` : value;
}

// The package root a world's files are served from. The one line that becomes
// `alexandria://packages/worlds/<id>/<version>` when stage three of `Alexandria - Packaging`
// lands. Callers never build this themselves.
export function packageBase(world) {
  return `/worlds/${world.id}`;
}

// channel + value -> URL. The projector calls this and never joins a string.
export function resolveAsset(world, ch, value, fill = {}) {
  const ext = world.assetFormat?.[ch.set] ?? 'svg';
  return `${packageBase(world)}/assets/${ch.set}-${assetKey(ch, value, fill)}.${ext}`;
}

// Every asset the manifest declares, as { channelName: { key: url } }. The loader uses
// this to verify the package on disk matches what the manifest promises — section E of
// the manifest validator specified in `docs/contracts/world-loader.md`. Composed keys are
// expanded across every value of the channel they are keyed by, because those are exactly
// the combinations the model is allowed to produce.
export function declaredAssets(world) {
  const out = {};
  const channels = { ...world.channels, ...(world.module?.channels ?? {}) };
  for (const [name, ch] of Object.entries(channels)) {
    if (!ch.set) continue;
    const values = ch.values ?? Object.keys(world.assets?.[ch.set] ?? {});
    const owners = ch.keyedBy
      ? (channels[ch.keyedBy]?.values ?? Object.keys(world.assets?.[channels[ch.keyedBy]?.set] ?? {}))
      : [null];
    out[name] = {};
    for (const owner of owners) {
      for (const v of values) {
        const fill = owner == null ? {} : { [ch.keyedBy]: owner };
        out[name][assetKey(ch, v, fill)] = resolveAsset(world, ch, v, fill);
      }
    }
  }
  return out;
}
