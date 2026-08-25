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
    screens.push({ type: close, beats: [], fill: module });
  }
  return screens;
}

// Gate 3's measurement: how long would a human spend reading this?
// Counts every text channel the world declares, so it stays right when a world
// renames one or adds another.
export function readingTimeMs(world, beats) {
  const textChannels = Object.entries(world.channels)
    .filter(([, ch]) => ch.kind === 'text')
    .map(([name]) => name);
  const words = beats.reduce((n, b) =>
    n + textChannels.map((c) => b[c] ?? '').join(' ')
      .trim().split(/\s+/).filter(Boolean).length, 0);
  return Math.round((words / 200) * 60 * 1000); // 200 wpm
}
