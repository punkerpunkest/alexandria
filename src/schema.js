// Pure function: world manifest -> the JSON Schema handed to Claude.
// Asset descriptions are folded into the enum's description, because the
// schema IS part of the prompt.
//
// Nothing in here names a channel. Every property is derived from the manifest,
// so a world that renames or drops a channel needs no change on this side.

const describeSet = (job, set) =>
  job + ' Options: ' + Object.entries(set).map(([k, v]) => `${k} = ${v}`).join('; ');

// One channel -> one JSON Schema property. Shared by beat channels and module
// channels, so a world that moves a channel between the two needs no change here.
function property(world, name, ch) {
  const set = ch.set ? world.assets[ch.set] : null;
  if (ch.kind === 'text') return { type: 'string', maxLength: ch.maxLength, description: ch.job };
  if (ch.kind === 'enum' || ch.kind === 'asset') {
    const values = ch.values ?? Object.keys(set ?? {});
    return { type: 'string', enum: values, description: set ? describeSet(ch.job, set) : ch.job };
  }
  throw new Error(`world "${world.id}": channel "${name}" has unknown kind "${ch.kind}"`);
}

export function buildSchema(world) {
  const properties = {
    kind: {
      type: 'string',
      enum: world.beats.kinds,
      description: 'concept teaches, misconception names the wrong turn most people take.',
    },
  };
  const required = ['kind'];

  for (const [name, ch] of Object.entries(world.channels)) {
    properties[name] = property(world, name, ch);
    required.push(name);
  }

  const beat = { type: 'object', additionalProperties: false, properties, required };

  // MODULE-LEVEL CHANNELS sit beside `beats`, not inside a beat. They exist because
  // some screens are not beats: the ask screen carries one line for the whole module,
  // and it could never be a beat, since every beat must satisfy the same schema and
  // `mascot_line` declares mustBeClaim — which a question fails by definition.
  const top = { beats: { type: 'array', minItems: world.beats.min, maxItems: world.beats.max, items: beat } };
  const topRequired = ['beats'];
  for (const [name, ch] of Object.entries(world.module?.channels ?? {})) {
    top[name] = property(world, name, ch);
    topRequired.push(name);
  }

  return { type: 'object', additionalProperties: false, properties: top, required: topRequired };
}

// The prompt preamble. Identical every turn, so it caches.
export function buildSystemPrompt(world) {
  const v = world.voice;

  // Channel restrictions are declared in the manifest, so they steer the model
  // here and are enforced in the validator from the same source.
  const restrictions = Object.entries({ ...world.channels, ...(world.module?.channels ?? {}) }).flatMap(([name, ch]) =>
    Object.entries(ch.restrict ?? {}).map(
      ([value, kind]) => `- ${name} may only be "${value}" on a ${kind} beat.`));

  // `hold` channels stay on the per-beat schema -- the model still emits one every
  // beat -- but the value must not change within the module. Same declare-once
  // pattern as `restrict`: steered here, enforced in the validator from the manifest.
  const held = Object.entries(world.channels)
    .filter(([, ch]) => ch.hold === 'module')
    .map(([name]) => `- ${name} is chosen once for the whole module. Pick it on the first beat and repeat that exact value on every following beat. Never change it mid-module.`);

  return [
    `You write teaching beats for a learning app. A beat is one screen the student reads.`,
    ``,
    `VOICE`,
    `Person: ${v.person}`,
    `Register: ${v.register}`,
    `Never: ${v.forbidden.join('; ')}`,
    `Lines that sound right:`,
    ...v.samples.map((s) => `  "${s}"`),
    ``,
    `RULES`,
    `- A module teaches and never quizzes. Nothing in it asks the student to answer.`,
    `- Teach the thing itself. Do not describe what you are about to teach.`,
    `- Respect every length limit in the schema. Shorter is better than truncated.`,
    ...restrictions,
    ...held,
  ].join('\n');
}
