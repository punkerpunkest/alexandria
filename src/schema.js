// Pure function: world manifest -> the JSON Schema handed to Claude.
// Asset descriptions are folded into the enum's description, because the
// schema IS part of the prompt.
//
// Nothing in here names a channel. Every property is derived from the manifest,
// so a world that renames or drops a channel needs no change on this side.

// The diagram grammar is DEFINED in the plotter and imported here, never restated. If
// the enum the model is offered and the shapes the plotter can actually draw were two
// lists, they would drift, and the symptom would be a valid-looking spec that throws at
// draw time. The import direction is unusual — `src/` reaching into `public/` — and it
// is deliberate: the plotter is browser-delivered runtime code, and one definition
// beats two copies. It stays pure, so Node imports it exactly as the browser does.
import { SHAPES } from '../public/plot.js';

const describeSet = (job, set) =>
  job + ' Options: ' + Object.entries(set).map(([k, v]) => `${k} = ${v}`).join('; ');

// A diagram is the first channel whose value is an OBJECT rather than a string. The
// model picks a shape and supplies numbers; it never writes a drawing instruction. The
// y range is deliberately absent — the plotter derives it from the function, so a range
// that does not contain its own curve is not a mistake the model is able to make.
function diagramProperty(ch) {
  const arities = Object.entries(SHAPES).map(([k, s]) => `${k}: ${s.describe}`).join(' ');
  const [min] = Object.values(SHAPES).reduce(
    ([lo, hi], s) => [Math.min(lo, s.arity[0]), Math.max(hi, s.arity[1])], [Infinity, 0]);
  const max = Object.values(SHAPES).reduce((hi, s) => Math.max(hi, s.arity[1]), 0);
  return {
    type: 'object',
    additionalProperties: false,
    description: ch.job,
    properties: {
      shape: { type: 'string', enum: Object.keys(SHAPES), description: `The family of function to draw. ${arities}` },
      coefficients: {
        type: 'array', items: { type: 'number' }, minItems: min, maxItems: max,
        description: 'The coefficients for the chosen shape, in the order its description gives. The count must match that shape exactly. Before settling on them, check two things: that the curve they produce really has the shape the caption claims, and that its values are plausible in the unit named by y_label.',
      },
      domain: {
        type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2,
        description: 'The x range to draw, as [min, max]. min must be smaller than max. Choose a range where the interesting behaviour is visible.',
      },
      x_label: { type: 'string', maxLength: 40, description: 'What the horizontal axis measures, with its unit.' },
      y_label: { type: 'string', maxLength: 40, description: 'What the vertical axis measures, with its unit.' },
      caption: { type: 'string', maxLength: ch.captionMaxLength ?? 120, description: 'One sentence saying what the diagram shows. Not a restatement of the axis labels.' },
      marks: {
        type: 'array', items: { type: 'number' }, maxItems: 3,
        description: 'x positions worth pointing at, inside the domain. The runtime labels each with the coordinate the function actually has there, so do not describe them. Usually empty or one.',
      },
    },
    required: ['shape', 'coefficients', 'domain', 'x_label', 'y_label', 'caption', 'marks'],
  };
}

// One channel -> one JSON Schema property. Shared by beat channels and module
// channels, so a world that moves a channel between the two needs no change here.
function property(world, name, ch) {
  const set = ch.set ? world.assets[ch.set] : null;
  if (ch.kind === 'text') return { type: 'string', maxLength: ch.maxLength, description: ch.job };
  if (ch.kind === 'diagram') return diagramProperty(ch);
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
    // An OPTIONAL channel is one whose absence is meaningful rather than a failure to
    // answer. Longform's figure is the case: most beats are prose, and requiring one
    // per beat would force the model to invent a graph for a paragraph that does not
    // want one. No existing channel declares it, so both shipped schemas are unchanged.
    if (!ch.optional) required.push(name);
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
