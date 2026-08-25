// Pure function: world manifest -> the JSON Schema handed to Claude.
// Asset descriptions are folded into the enum's description, because the
// schema IS part of the prompt.
//
// Nothing in here names a channel. Every property is derived from the manifest,
// so a world that renames or drops a channel needs no change on this side.

const describeSet = (job, set) =>
  job + ' Options: ' + Object.entries(set).map(([k, v]) => `${k} = ${v}`).join('; ');

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
    const set = ch.set ? world.assets[ch.set] : null;

    if (ch.kind === 'text') {
      properties[name] = { type: 'string', maxLength: ch.maxLength, description: ch.job };
    } else if (ch.kind === 'enum' || ch.kind === 'asset') {
      const values = ch.values ?? Object.keys(set ?? {});
      properties[name] = {
        type: 'string',
        enum: values,
        description: set ? describeSet(ch.job, set) : ch.job,
      };
    } else {
      throw new Error(`world "${world.id}": channel "${name}" has unknown kind "${ch.kind}"`);
    }
    required.push(name);
  }

  const beat = { type: 'object', additionalProperties: false, properties, required };

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      beats: { type: 'array', minItems: world.beats.min, maxItems: world.beats.max, items: beat },
    },
    required: ['beats'],
  };
}

// The prompt preamble. Identical every turn, so it caches.
export function buildSystemPrompt(world) {
  const v = world.voice;

  // Channel restrictions are declared in the manifest, so they steer the model
  // here and are enforced in the validator from the same source.
  const restrictions = Object.entries(world.channels).flatMap(([name, ch]) =>
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
