// Pure function: beats -> screens, following the world's declared policy.
// The runtime owns pagination. The model never sees it.
//
// Nothing here names a world's vocabulary. The screen type comes from the
// manifest's `pagination.screenFor`, and an unknown policy or an undeclared
// screen type fails loudly rather than falling through to a default.

// The policies the runtime knows. A world declaring anything else is a typo or a
// misunderstanding; either way it should hear about it at load rather than get
// silently reassigned.
//
// One entry, deliberately: 1:1 is definitional for the PoC (settled 24 Aug). Several
// beats on one screen is deferred, and it is the only case that would need a beat
// count here — one beat across several screens does not, since the `body` cap is
// enforced at generation rather than spilled. `screens[].beats` stays an array so
// that door is left open. See `Alexandria - Build Plan`.
const POLICIES = {
  'one-beat-per-screen': 1,
};

export function paginate(world, beats, module = {}) {
  // Named, never silent. Without this the caller got `beats is not iterable` from the
  // for-of below, which names neither the world nor the argument.
  if (!Array.isArray(beats)) {
    throw new Error(`world "${world.id}": paginate expected an array of beats, got ${typeof beats}`);
  }
  const p = world.pagination ?? {};
  if (!(p.policy in POLICIES)) {
    throw new Error(
      `world "${world.id}": unknown pagination policy "${p.policy}". ` +
      `Known policies: ${Object.keys(POLICIES).join(', ')}`);
  }

  // NOTE: `pagination.policy` and `archetype` overlap — a paginated world cannot
  // sensibly declare continuous scrolling. Whether the archetype should simply
  // imply the policy is an open design question, not resolved here.

  const screens = [];
  for (const beat of beats) {
    const type = p.screenFor?.[beat.kind] ?? p.screenFor?.default;
    if (!type) {
      throw new Error(
        `world "${world.id}": pagination.screenFor declares no screen type for ` +
        `beat kind "${beat.kind}", and no default`);
    }
    if (!world.screens?.[type]) {
      throw new Error(
        `world "${world.id}": pagination.screenFor maps to screen type "${type}", ` +
        `which is not declared in world.screens`);
    }

    // `fill` is what the projector reads slots from. For a beat screen it is the
    // beat; for a beatless screen it is the module's own values. Unifying them here
    // means the projector never has to ask which kind of screen it is holding.
    screens.push({ type, beats: [beat], fill: beat });
  }

  // The boundary screen. Not a beat: it carries the module's own channels, it is
  // where the ask lands, and the loop does not run without it — see
  // `Alexandria - PoC Flow`, "Asking happens at the boundary".
  const close = p.closeWith;
  if (close) {
    if (!world.screens?.[close]) {
      throw new Error(
        `world "${world.id}": pagination.closeWith names screen type "${close}", ` +
        `which is not declared in world.screens`);
    }
    // The closing screen carries the module's DECLARED CHANNELS, not the module object.
    // Passing it wholesale put a copy of every beat and all of the fixture's metadata
    // inside the last screen of every result, and contradicted `Alexandria - World Spec`,
    // which says this fill is the module's own channel values.
    const fill = {};
    for (const name of Object.keys(world.module?.channels ?? {})) {
      if (name in module) fill[name] = module[name];
    }
    screens.push({ type: close, beats: [], fill });
  }
  return screens;
}

// WHICH SCREEN TYPE MAY HOLD SOMETHING THAT IS NOT A BEAT. `Alexandria - World Spec`,
// "Interactives are screens too": an interactive is a slide type in the sequence, it is a
// screen at a slide boundary, and the WORLD declares where it can sit — exactly one, alone
// on the slide. `hosts` carries that declaration, keyed by screen type.
//
// DELIBERATELY A LOOKUP AND NOT ANOTHER `screens.push`, which is the whole reason it sits
// beside `paginate` rather than inside it. The interactive that plays at a boundary was
// banked while the PREVIOUS module was being read, so at the moment a module is paginated
// nobody knows whether there will be one — and a module whose interactive never landed must
// not come out one screen longer than a module whose did. The projector opens this screen
// when it has something to put in it, and the module's sequence is unchanged either way.
export function hostScreen(world, hosted) {
  const found = Object.entries(world?.hosts ?? {})
    .find(([, list]) => Array.isArray(list) && list.includes(hosted));
  return found ? found[0] : null;
}

// Gate 3's measurement: how long would a human spend reading this?
// Counts every text channel the world declares, so it stays right when a world
// renames one or adds another.
export function readingTimeMs(world, beats, module = {}) {
  if (!world?.channels) {
    throw new Error(`world "${world?.id}": readingTimeMs needs a channels block, and this manifest has none`);
  }
  const textOf = (channels) => Object.entries(channels ?? {})
    .filter(([, ch]) => ch.kind === 'text')
    .map(([name]) => name);
  const count = (source, names) =>
    names.map((c) => source[c] ?? '').join(' ').trim().split(/\s+/).filter(Boolean).length;

  const beatWords = beats.reduce((n, b) => n + count(b, textOf(world.channels)), 0);
  // The closing screen is a screen the student reads, and this function is Gate 3's
  // measurement of whether reading covers generation. Counting only beats understated
  // the window by exactly the screen the paginator itself appends.
  const moduleWords = count(module, textOf(world.module?.channels));
  return Math.round(((beatWords + moduleWords) / 200) * 60 * 1000); // 200 wpm
}
