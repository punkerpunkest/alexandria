# Contract: the world loader

Owner: `src/schema.js`. Two exported pure functions.

```js
buildSchema(world)        // manifest -> the JSON Schema handed to the model
buildSystemPrompt(world)  // manifest -> the prompt preamble
```

Terms are fixed in the vault note `Alexandria - Glossary`. The shared contract is
`CONTRACT.md` and it is given, not proposed.

---

## 1. Purpose

The loader is the only component that talks to the model, and it does not talk to it in
prose. It compiles a world author's manifest into the two artefacts a generation call is
made of: the JSON Schema that constrains the response, and the system preamble that sits
above it.

**The schema IS part of the prompt.** This is the design claim the whole component rests
on, and it is not a stylistic preference. A property name, a `description` string and a
folded-in asset description are read by the model in the same pass as any sentence of the
preamble, but they arrive attached to the exact field they govern, and the
structured-output layer enforces the shape around them. So:

- A field named `mascot_line` with the description *"The one sentence worth remembering. A
  claim, never a question."* instructs better than a preamble paragraph explaining that the
  first field is a flashcard sentence, because there is no indirection to resolve. The
  instruction is where the value goes.
- `describeSet` folds every asset description into the enum's own `description`
  (`explaining = open-handed, mid-explanation, warm. The everyday pose.; considering = hand
  to chin, ...`). The model chooses a pose while reading what each pose looks like, in the
  field where the pose is chosen. The alternative — a cast sheet in the preamble and a bare
  enum in the schema — asks it to hold a mapping in working memory across the whole
  response.
- Anything the schema can express is not written as prose at all. `maxLength` is not a
  sentence, `enum` is not a list of allowed words, `required` is not a plea. The preamble
  carries only what has no schema expression: the voice block, the four standing rules, and
  the two channel declarations (`restrict`, `hold`) that constrain a *relationship between
  fields* rather than a field.

The consequence for a world author: **the `job` string is the prompt.** It is the only
per-channel prose the model ever sees, and it is delivered at the point of use. A world
improves its output by editing `job`, not by asking for a preamble section.

Second-order consequence, recorded in the World Spec: field order in the schema is not the
order the model generates in. The structured-output layer emits constrained enum fields
ahead of free text, so `expression` is chosen before a word of `mascot_line` is written.
The pose is a plan, not a label. The loader does not control this and must not be assumed
to; it is stated here because a world author reading this document will otherwise assume
declaration order is generation order.

---

## 2. Preconditions

The loader is a pure function of a manifest, so every precondition is a property of
`world.json`. **None of them is checked. That is section 5.**

`buildSchema(world)` dereferences, unguarded:

| Expression | Required for | Failure today if absent or wrong |
|---|---|---|
| `world.beats.kinds` | the beat's `kind` enum | `TypeError` if `beats` is missing; a `kind` property with **no enum at all** if `kinds` is |
| `world.beats.min` / `.max` | `minItems` / `maxItems` | silently dropped from the schema — an unbounded beat array |
| `world.channels` | every beat property | `TypeError: Cannot convert undefined or null to object` |
| `world.assets[ch.set]` | enum values and folded descriptions | an **empty enum**, silently |
| `world.module.channels` | the module-level properties | optional; `?? {}` is guarded |
| `world.id` | the text of the one error it throws | `undefined` inside the message |

`buildSystemPrompt(world)` dereferences, unguarded:

| Expression | Required for | Failure today if absent or wrong |
|---|---|---|
| `world.voice.person`, `.register` | the VOICE block | `TypeError: Cannot read properties of undefined (reading 'person')` |
| `world.voice.forbidden` | the `Never:` line | `TypeError: v.forbidden.join is not a function` |
| `world.voice.samples` | the sample lines | `TypeError: v.samples.map is not a function` |
| `world.channels`, `world.module.channels` | `restrict` and `hold` lines | `TypeError` if `channels` is missing |

A `TypeError` is not a named failure. The failure policy in `CONTRACT.md` says *named,
never silent*, and every row above currently produces either a bare `TypeError` or nothing
at all.

---

## 3. Postconditions

For any manifest satisfying the preconditions:

1. `buildSchema` returns a JSON Schema object whose top level is
   `{ type: 'object', additionalProperties: false, properties, required }`, where
   `properties.beats` is an array of beat objects and every module channel is a sibling of
   `beats`, never a property inside a beat.
2. Every declared beat channel appears exactly once as a property of the beat object **and**
   once in the beat's `required` array. Same for module channels at the top level. Nothing
   is optional: a world declares a channel or it does not have one.
3. `additionalProperties: false` at both levels. The model cannot add a slot. This is the
   schema half of *the package decides structure*.
4. Every enum-bearing property carries a closed `enum`, drawn from `ch.values` when
   declared and from `Object.keys(world.assets[ch.set])` otherwise. The values are the
   world author's, in the author's order; the platform fixes only that the list is closed.
5. `buildSystemPrompt` returns a string, no trailing newline, whose last lines are the
   `restrict` lines (beat channels then module channels) followed by the `hold` lines.
6. Both are byte-identical across runs for the same manifest. The blessed serialisations
   are `JSON.stringify(schema, null, 2) + '\n'` and `buildSystemPrompt(world) + '\n'`.
7. Neither output contains a filesystem path, a filename, an extension, or a world
   directory name. The model is never handed anything it could return as a path.

---

## 4. Invariants owned

Of the six in `CONTRACT.md`:

**3. Purity — owned outright.** Both functions read only their argument. No clock, no
randomness, no network, no subprocess, no filesystem. `npm run check-fixture` asserts it by
byte-comparing both outputs for both worlds against blessed files, offline, in
milliseconds.

**4. Genericity — owned outright, and the strongest claim in the component.** No world's
channel name, asset name, screen type or id appears in the executable source. Verified by
grep rather than claimed:

```
grep -nE "mascot|speaker_|ask_line|cartoon|visual-novel|explaining|mei|hana" src/schema.js
  43:  // `mascot_line` declares mustBeClaim — which a question fails by definition.
```

One hit, in a comment, explaining why module channels exist. No executable line names a
world. The functional test of this is stronger than the grep: two structurally dissimilar
worlds — one enum channel with a `set` against three asset channels with a composed key and
a held value — go through the same twenty lines and produce correct, different schemas.

**5. Containment — owned as a precondition, not as a check.** The loader emits no path, so
it cannot emit one that escapes. It establishes containment *by construction*: the enum is
generated from the manifest's asset map, so the model can only ever return a name the
package declared. But nothing verifies that the declared map matches the files actually
shipped, so containment currently holds only as far as the author's typing. Closing that is
rule **E1** below.

**Not owned: 1 (Coverage), 2 (Order)** — the paginator's, and the loader never sees a beat.

**Not owned: 6 (Degradation)** — degradation is about an invalid *beat*. `buildSchema`
throws on an unknown channel `kind`, which is an invalid *world*, and in `server.js` that
throw happens at module evaluation, before the server listens. A world that cannot be
compiled has no session to degrade into. This is the correct behaviour and is consistent
with the failure policy: *a broken world should fail at load, not mid-session.*

---

## 5. The manifest surface, exhaustively

Every key either produces something in the schema, something in the prompt, or neither.
"Neither" is not a criticism — most of these are read by the projector or the validator, and
that separation is `Alexandria - World Spec`'s *who reads what* holding.

### Beats

| Key | In the schema | In the prompt | Notes |
|---|---|---|---|
| `beats.kinds` | `properties.beats.items.properties.kind.enum` | nothing | The one description the loader hardcodes: *"concept teaches, misconception names the wrong turn most people take."* Both worlds declare exactly `["concept","misconception"]`, so this sentence is currently true of both. It is written in `src/schema.js`, not in either manifest — see the disagreement in section 8. |
| `beats.min` | `properties.beats.minItems` | nothing | |
| `beats.max` | `properties.beats.maxItems` | nothing | |
| `beats.require` | nothing | nothing | Read only by `src/validate.js` (coverage). Not the loader's. |

### Channels — `world.channels` and `world.module.channels`

Both go through the same `property()` function; only their scope in the output differs.
A beat channel becomes a property of the beat object, a module channel a sibling of `beats`.
A world moving a channel between the two needs no change on this side, which is deliberate.

| Key | In the schema | In the prompt | Read by |
|---|---|---|---|
| `kind` | dispatches the whole property. `text` → `{type:'string', maxLength, description}`. `enum` and `asset` → `{type:'string', enum, description}`. Anything else throws. | nothing | the loader (dispatch), the validator (which rules apply), the projector (`ch.set` decides `src` vs `textContent`) |
| `maxLength` | `maxLength` on a text property | nothing | the loader; the validator holds a backstop that is currently unreachable, because the structured-output layer enforces the cap upstream |
| `set` | names the `world.assets` group. Supplies the enum values when `values` is absent, and always supplies the folded descriptions | nothing | the loader, the validator (fallback value list), the projector (path segment: `assets/{set}-{key}.{ext}`) |
| `values` | the `enum` array, winning over the set's keys | nothing | the loader, the validator |
| `job` | the property's `description`, verbatim, or the stem of the folded `describeSet` string | nothing | the loader only. **This is the channel's entire prose surface.** |
| `restrict` | nothing | one line per entry: `- <name> may only be "<value>" on a <kind> beat.` | the loader (steering), the validator (enforcement), from the same declaration |
| `hold` | nothing — the channel stays per-beat, so the model emits one every beat | one line, only when the value is exactly `"module"` and only for a **beat** channel: `- <name> is chosen once for the whole module. …` | the loader (steering), the validator (enforcement) |
| `keyedBy` | **nothing** | **nothing** | the projector only. Discussed below. |
| `mustBeClaim` | nothing | nothing | the validator only |
| `mustAsk` | nothing | nothing | the validator only |
| `opening` | nothing | nothing | the projector only, at cold-start stage 0 |

### Elsewhere in the manifest

| Key | In the schema | In the prompt | Read by |
|---|---|---|---|
| `assets` | via `ch.set`: the enum values, and every description folded into it | nothing | the loader, the validator, the projector |
| `assetFormat` | nothing | nothing | the projector only: `world.assetFormat?.[ch.set] ?? 'svg'` |
| `voice.person` | nothing | `Person: …` | the loader only |
| `voice.register` | nothing | `Register: …` | the loader only |
| `voice.forbidden` | nothing | `Never: …` joined with `; ` | the loader only |
| `voice.samples` | nothing | one indented quoted line each | the loader only |
| `id` | nothing | nothing | the loader's error text; the projector's asset URL |
| `archetype`, `viewport`, `motion`, `screens`, `pagination`, `name`, `version` | nothing | nothing | the projector, the paginator, the chrome |

### `keyedBy`: the prompt says nothing about it, and should not

The visual novel's `speaker_face` declares `keyedBy: "speaker_body"`. The schema it produces
offers eleven character-neutral expressions (`normal`, `smile`, `smug`, …) with
character-neutral descriptions (*"one brow up, a small knowing smile"*). Neither
`buildSchema` nor `buildSystemPrompt` mentions the composition. **Nothing needs to.**

The projector composes `{speaker_body}-{value}` at render, so a face belonging to the wrong
character is *unrepresentable*, not caught afterwards. There is no failure mode for the
prompt to steer away from. Adding a sentence would cost tokens on a cached preamble to
forbid something the enum already cannot express, and worse, it would leak the path
convention (`face-mei-smug.webp`) into text the model reads — directly against *nothing the
model emits is ever used as a path*.

Two things follow that a reader should not miss:

- `keyedBy` has **no field-ordering dependency**, unlike `restrict`. `restrict` works only
  because `kind` happens to precede the channel it constrains in the layer's own emission
  order; `keyedBy` is resolved after the whole response arrives, so it is indifferent to it.
- The cost of the composition is pushed into the *asset descriptions*, which must stay
  character-neutral for the fold to make sense. That is a prose property, and no validator
  can check it — see G4.

### Two asymmetries worth naming

**`mustBeClaim` and `mustAsk` are enforced but never steered.** `restrict` and `hold` are
declared once and turned into prompt lines automatically. `mustBeClaim` and `mustAsk` are
declared once and turned into nothing; the model only learns about them because both worlds'
authors happened to write it into `job` by hand (*"A claim, never a question"*, *"It must end
in a question."*). A world that declares `mustBeClaim` without repeating it in prose gets a
validator failure and a repair round trip on every module, forever, with no signal saying
why. See section 8.

**`hold` and `restrict` are scoped inconsistently across the two channel groups.** The
`hold` loop reads `world.channels` only, so `hold` on a module channel is a silent no-op —
correct, since a module channel has one value by definition, but silent. The `restrict` loop
reads both, so `restrict` on a module channel emits a sentence about *a beat* for a value
that is not on a beat, and the validator never enforces it. Both confirmed by execution.

---

## 6. THE GAP, CLOSED — kept because it is still the specification

> [!done] Built 28 Aug; this section was written before it and describes the hole it filled
> `src/manifest.js` exists: **36 rules**, run in Node at boot against every package under
> `worlds/`, with `validateManifest` and a `reportText`. `server.js` no longer trusts a
> manifest — it validates each package, keeps a broken one in the registry with its
> `problems` rather than crashing, and `/api/worlds` reports `ok` per package. The check
> suite asserts in both directions that every rule has a hostile case and every case names
> a real rule, so the two cannot drift.
>
> Everything below stays, because it is **why** each rule exists and what it costs when the
> rule is absent — which no rule ID can carry. Read it as the specification the validator was
> built from, not as a description of the repository. The paragraph that used to open it —
> "`server.js` loads a world with a bare `JSON.parse`", "the only manifest rule enforced
> anywhere is this one line" — was true on 27 Aug and is false now.
>
> Corrected 29 Aug after `registry.md` cited this section as live evidence that worlds could
> not be installed safely, and a website agent was about to build against it.

`Alexandria - Rendering` lists the projector's seven parts and gives the first as
*"Manifest loader + its own schema — a broken world fails at install, not mid-session."*
The manifest loader exists. Its own schema does not. There is no install step in the spike —
a world is a local folder and `npm start` is the install — so "at install" reads today as
"before the server listens", and later as "before the registry accepts the package".

### What fails today, and when

Measured by execution against the two shipped manifests, not reasoned about:

| Broken manifest | When it is noticed | What the author sees |
|---|---|---|
| channel `kind: "markdown"` | **at load** — `buildSchema` runs at `server.js` module evaluation | the correct named error, then the process dies. This is the one that works. |
| `pagination.policy` unknown | first `/api/module` request | HTTP 500, named message, mid-session |
| `screenFor` with no mapping and no default | first request | HTTP 500, named message, mid-session |
| `screenFor` naming an undeclared screen | first request | HTTP 500, named message, mid-session |
| `closeWith` naming an undeclared screen | stage 0 degrades silently to *"world declares no ask screen"*, then HTTP 500 at first request | two different symptoms for one typo |
| `screens` naming a file not on disk | first `/api/world` fetch | server returns 500 `{error}`, the browser's `res.world` is `undefined`, `world.name` throws a `TypeError`, blank stage, nothing in the UI |
| `archetype` unknown | browser module load | `throw new Error('unknown archetype "x"')` into a blank page. Recorded as unreachable-from-Node in `fixtures/hostile/cases.json._browserSide` |
| `set` naming a group not in `assets` | never | `enum: []`. Unsatisfiable schema; every generation burns retries and returns `error_max_structured_output_retries`. The validator's membership check is guarded by `allowed.length &&`, so it fails **open** too. |
| `keyedBy` naming a channel that does not exist | never, until an image is requested | `/worlds/visual-novel/assets/face-undefined-smug.webp` — a 404 mid-session, and the literal string `undefined` in a path |
| `keyedBy` naming a *text* channel | never | `/worlds/visual-novel/assets/face-So the tree stores a range-smug.webp` |
| `assetFormat` missing an entry for a used set | never | falls back to `.svg`, 404s every asset in that set |
| `beats.min` above `beats.max` | never | `minItems: 9, maxItems: 6`. Unsatisfiable. Same misleading retry error. |
| a beat channel named `kind` | never | overwrites the beat's kind enum with the channel's own property, and pushes `"kind"` into `required` **twice** |
| a module channel named `beats` | never | replaces the entire beats array with a string property |
| the same name in `channels` and `module.channels` | never | the prompt's restriction loop spreads module channels over beat channels, so the beat channel's `restrict` line **disappears from the preamble** while the validator keeps enforcing it |
| `world.id` ≠ the package directory name | never | the world loads, renders text, and shows zero images |

Every "never" row is a world that installs clean and misbehaves in front of a student.

### The rules a manifest validator must check

Grouped. Each rule states the error it produces. Error text follows the shape already in
use — `world "<id>": <subject> "<name>" <what is wrong>` — so that a manifest failure reads
like the one manifest failure that already exists.

Rules are marked **(pure)** if they are a function of the manifest alone, **(fs)** if they
need the package's file list, **(tpl)** if they need the declared templates' text. Keeping
the three separable matters: the pure set can live in `src/` without touching invariant 3,
and the other two should take an injected file list rather than importing `node:fs`, so that
the whole validator stays a pure function of `(manifest, files, templates)`.

#### A. Structural presence — the fields the loader dereferences unguarded

| # | Rule | Error |
|---|---|---|
| A1 | `id` is a non-empty string **and equals the package directory name** (pure + fs) | `world "<id>": manifest id does not match its directory "<dir>"; every asset URL is composed from the id` |
| A2 | `beats` is an object (pure) | `world "<id>": no beats block` |
| A3 | `beats.kinds` is a non-empty array of unique non-empty strings (pure) | `world "<id>": beats.kinds must be a non-empty list of beat kinds` |
| A4 | `beats.min` and `beats.max` are integers with `1 <= min <= max` (pure) | `world "<id>": beats.min 9 is greater than beats.max 6; no response can satisfy the schema` |
| A5 | every entry of `beats.require` appears in `beats.kinds` (pure) | `world "<id>": beats.require names kind "worked-step", which is not in beats.kinds` |
| A6 | `channels` is a non-empty object (pure) | `world "<id>": no channels declared` |
| A7 | `voice.person` and `voice.register` are non-empty strings; `voice.forbidden` and `voice.samples` are arrays of non-empty strings (pure) | `world "<id>": voice.forbidden must be a list of strings` |
| A8 | `assets` is an object whenever any channel declares `set` (pure) | `world "<id>": channel "expression" declares set "mascot" but the manifest has no assets block` |
| A9 | `archetype` is one the runtime knows (pure) | `world "<id>": unknown archetype "storybook". Known archetypes: paginated, scene-sequential` — this is the `_browserSide` case in `fixtures/hostile/cases.json`, moved from the browser to load time, where it can be reached from Node |

#### B. Reserved and colliding names

| # | Rule | Error |
|---|---|---|
| B1 | no beat channel is named `kind` (pure) | `world "<id>": channel "kind" collides with the beat's own kind field` |
| B2 | no module channel is named `beats` (pure) | `world "<id>": module channel "beats" collides with the beats array` |
| B3 | no name appears in both `channels` and `module.channels` (pure) | `world "<id>": "expression" is declared as both a beat channel and a module channel` |

B1 and B2 are the two silent catastrophes. B3 is the one that silently deletes a prompt line.

#### C. Per-channel well-formedness

| # | Rule | Error |
|---|---|---|
| C1 | `kind` is `text`, `enum` or `asset` (pure) | **already exists**, in `buildSchema`. Keep the message and the throw exactly as they are; the fixture pins them. The validator catches it first with the same wording. |
| C2 | a `text` channel declares an integer `maxLength >= 1` (pure) | `world "<id>": channel "body" is text and declares no maxLength; the panel has no defence against a long value` |
| C3 | an `enum` or `asset` channel resolves to a **non-empty** value list (pure) | `world "<id>": channel "expression" resolves to an empty enum; no response can satisfy the schema` |
| C4 | `set`, when declared, names a key of `world.assets` whose value is a non-empty object of non-empty string descriptions (pure) | `world "<id>": channel "expression" declares set "mascots", which is not in world.assets` |
| C5 | `values`, when declared beside `set`, is a **subset** of that set's keys, and a warning when it is a proper subset (pure) | `world "<id>": channel "expression" lists value "emphasizing", which is not a key of asset set "mascot"` / warning: `… set "mascot" describes 5 options but only 2 are selectable; the extra descriptions are still folded into the prompt` |
| C6 | `job` is a non-empty string on every channel (pure) | `world "<id>": channel "body" declares no job; the model is handed a field with no instruction` |
| C7 | no channel carries a key the runtime never reads — `maxLength` on an enum, `values` on a text channel, `mustAsk` on an asset (pure) | `world "<id>": channel "expression" declares maxLength, which is only read on a text channel` |

C7 is the typo detector, and it is the cheapest of the lot. A manifest is hand-written JSON
with no editor support; `maxlength`, `restricts`, `keyBy` and `holds` are all currently
accepted in perfect silence.

#### D. Cross-channel declarations

| # | Rule | Error |
|---|---|---|
| D1 | every key of `restrict` is in that channel's own value list, and every value of `restrict` is in `beats.kinds` (pure) | `world "<id>": channel "expression" restricts value "emphasising", which is not one of its own values` / `… restricts to kind "worked-step", which is not in beats.kinds` |
| D2 | `restrict` appears only on a beat channel (pure) | `world "<id>": module channel "ask_line" declares restrict, which only applies to a beat` |
| D3 | `hold`, when present, is exactly `"module"` and appears only on a beat channel (pure) | `world "<id>": channel "background" declares hold "session"; the only supported value is "module"` |
| D4 | `keyedBy` names a different **beat** channel that exists and is `enum` or `asset` (pure) | `world "<id>": channel "speaker_face" is keyed by "speaker", which is not a declared channel` / `… keyed by "line", which is a text channel; its value would be composed into an asset path` |
| D5 | `mustBeClaim` and `mustAsk` are booleans, appear only on text channels, and never both on one channel (pure) | `world "<id>": channel "mascot_line" declares both mustBeClaim and mustAsk, which cannot both hold` |

D1's first half is the *silent* one: a `restrict` naming a value outside the enum produces a
perfectly well-formed preamble line about a value the model can never pick. Confirmed by
execution — `- expression may only be "emphasising" on a worked-step beat.` appears in the
prompt with no complaint from anything.

D4 is the rule that stops `face-undefined-smug.webp`.

#### E. The package on disk

| # | Rule | Error |
|---|---|---|
| E1 | every declared asset key has a file at `assets/{set}-{key}.{ext}`, and for a `keyedBy` channel the **full cross product** of the keying channel's values and this channel's values (fs) | `world "<id>": asset set "face" declares "smug" but assets/face-hana-smug.webp is not in the package` — this is invariant 5 becoming checkable. Cartoon expects 5 files; the visual novel expects 29, being 2 bodies, 22 composed faces and 5 backgrounds. Both are complete today. |
| E2 | every set used by a channel has an `assetFormat` entry (fs, or pure with a warning) | `world "<id>": asset set "face" declares no assetFormat; the projector will request .svg` |
| E3 | every value of `screens` is a package-relative path with no leading `/` and no `..` segment, and the file exists (fs) | `world "<id>": screen "module" points outside the package: "../../CONTRACT.md"` / `world "<id>": screen "module" names screens/module.html, which is not in the package`. The first half is invariant 5 applied to templates: `server.js` does `join(worldDir, p)` with no normalisation, so `../../CONTRACT.md` resolves to a real file and is served as a template. |
| E4 | `pagination.policy` is a policy the paginator knows (pure) | already thrown by `paginate`, but at first request. Same message, moved to load. |
| E5 | every kind in `beats.kinds` maps, through an explicit `screenFor` entry or `screenFor.default`, to a name in `screens` (pure) | already thrown by `paginate`, per beat, at first request. At load it can be checked exhaustively across all declared kinds instead of only the kinds a particular module happened to contain — which is the real gain: today a world with a broken mapping for `misconception` runs fine until the first module that has one. |
| E6 | `pagination.closeWith`, when declared, names a screen in `screens` (pure) | already thrown by `paginate` at first request, and separately degrades stage 0 to a status line. One rule, one message, at load. |
| E7 | every `data-slot` in every declared template is a declared channel name or one of the runtime-owned slots `controls` and `ask` (tpl) | `world "<id>": screen "module" fills slot "mascot_lin", which is not a declared channel`. Today the projector's `if (!(key in values)) continue` makes a mistyped slot render empty forever with no error. |
| E8 | every declared channel has at least one `data-slot` somewhere (tpl, warning) | `world "<id>": channel "body" is generated on every beat and appears in no template`. A warning, not an error: it costs output tokens on every module for nothing. |
| E9 | every `data-readout` is in the archetype's readout set, and every control the archetype marks required is placeable (tpl) | `world "<id>": screen "module" declares readout "streak", which archetype "paginated" does not publish`. The required-control half is `Alexandria - World Spec`'s *at least one advance control must be required*, and it is a warning rather than an error, because the runtime already substitutes the chrome's default placement. |

#### F. The opening frame

| # | Rule | Error |
|---|---|---|
| F1 | an `opening` value satisfies its own channel's declared rules: within the enum for `enum`/`asset`, within `maxLength` for text, ending in `?` when `mustAsk` (pure) | `world "<id>": channel "expression" declares opening "emphasizing", which is not one of its own values`. This one matters more than it looks: `opening` is rendered through the same slot as a generated value but **never passes through `validate()`**, which only ever sees model output. It is the only unvalidated value in the whole render path, and it is on the very first frame the student sees. Both worlds pass: Cartoon's `explaining` is in its enum and on disk; both `ask_line.opening` strings are 32 and 33 characters against caps of 90 and 110, and both end in `?`. |
| F2 | *advisory only* — a channel with a slot on the `closeWith` template and no `opening` (tpl, warning) | `world "<id>": screen "ask" fills slot "background" from channel "background", which declares no opening; it will be blank at stage 0`. **This must stay a warning, and the visual novel is why.** Its `ask.html` carries `background`, `speaker_body` and `speaker_face` slots and none of the three declares `opening` — deliberately: `worlds/visual-novel/README.md` documents the empty stage as a designed state, detected in CSS by `.stack:not(:has(.bg[src]))`. Cartoon takes the other route and declares `expression.opening`. Both are correct, so any rule here that errors would break a shipped world. It is worth surfacing because the World Spec's sentence *"Any channel appearing on the opening frame must declare one"* reads as a hard rule and is not one. |

### What a manifest validator cannot check

**G1. That an enum value is a token the model reliably produces.** Cartoon's
`_naming_note` records the expensive version: `emphasising` failed *every* generation with
`error_max_structured_output_retries`, because the model insists on `emphasizing`. Bisected
both ways — two values pass, five with `emphasising` fail, the same five with `emphasizing`
pass.

No manifest validator can catch this, and the reason is not that it is hard. The property is
not a property of the manifest at all. It is a property of a particular model's output
distribution, observable only by running a generation, and it moves when the adapter is
swapped — which the adapter exists to make cheap. A validator that ran a generation would
break the no-model-in-a-test-path rule and the purity invariant in the same line.

Worse, it is invisible from the failure: `error_max_structured_output_retries` names nothing
about enums, and is the *identical* symptom of a `maxLength` set too tight. Two different
manifest mistakes, one error string, neither mentioned in it.

The most a validator can honestly do is a **lint**: flag an enum value carrying a known
spelling-variant suffix (`-ise`/`-ize`, `-our`/`-or`), a hyphen where a space is plausible, or
a plural that could drift, and say *this class of value has failed before*. It will be
incomplete by construction and it must never be an error. The authoring rule is worth more
than the lint, and belongs in the world author's documentation: **treat a total generation
failure after an enum change as a value-name suspect before touching caps.**

**G2. That a declared cap fits the declared layout.** Only the author wrote the stylesheet.
`Alexandria - World Spec` settles it: the runtime cannot compute a cap and should not try.
The failure is asymmetric and the bad direction is the quiet one — too loose overlaps
something visible, too tight means the module does not generate at all. This is a
conformance-run property, needing a real render at the declared viewport floor, not a
manifest property.

**G3. That the `job` prose says what the declaration enforces.** A channel declaring
`mustBeClaim` whose `job` never mentions it produces a validator failure and a repair round
trip on every single module. Both shipped worlds avoid it by hand. No validator can read the
prose and decide whether it covers the rule. The structural fix is not a validator rule at
all: it is for `buildSystemPrompt` to emit lines for `mustBeClaim` and `mustAsk` the way it
already does for `restrict` and `hold`. That would change both blessed `system-prompt.txt`
fixtures, so it is a deliberate re-blessing and not this document's to make.

**G4. That an asset description is neutral enough to compose.** A `keyedBy` set's
descriptions are read once and applied to every keying value — the visual novel's eleven
faces have to read correctly for both Mei and Hana. A description mentioning glasses would
be wrong half the time, and no check can tell.

### What implementing this would cost

- `src/manifest.js`, one export, taking `(world, { dir, files, templates })` and returning an
  ordered list of `{ rule, where, reason }` rather than throwing on the first — an author
  should see every problem in one run. **Groups A–D and E4–E6: roughly 180–220 lines**,
  all pure, no imports. **Groups E1–E3, E7–E9 and F: roughly 60 lines**, given an injected
  file list and the templates the loader already reads. The template rules need only a regex
  over `data-slot="…"` — `public/app.js` already does exactly this kind of scan with
  `t.includes(attr)`, so no HTML parser is involved.
- `fixtures/manifest/cases.json`, one case per rule, reusing the `patch` convention that
  `fixtures/hostile/cases.json` already establishes — a deep merge over a real world manifest,
  with `null` deleting a key. **Roughly 30 cases, 150 lines of JSON.** This is the bulk of the
  work and it is the part worth doing carefully, because the existing hostile fixture's
  completeness check is what stops a rule from being added without a case.
- `tools/check-fixture.mjs`, a fourth section plus an extension to the completeness sum in
  section 3. **Roughly 25 lines.** Note the sum currently counts `throw new Error` in
  `paginate.js` and `schema.js` and `failures.push` in `validate.js`; a new file is invisible
  to it, so the extension must be explicit or the completeness rule quietly stops covering the
  new component. The 30 existing checks are unaffected either way.
- `server.js`, three lines: run the validator after `JSON.parse` and before `buildSchema`,
  and exit with the joined report. `server.js` is shared, so this is flagged rather than done.

Half a day, most of it in the fixture. Nothing here needs a model, a network call or a
render, which is why it is a good agent lane.

---

## 7. The fixtures it is judged against

| Path | What it pins |
|---|---|
| `fixtures/cartoon/schema.json` | `buildSchema(cartoon)`, serialised `JSON.stringify(schema, null, 2) + '\n'` |
| `fixtures/cartoon/system-prompt.txt` | `buildSystemPrompt(cartoon) + '\n'` |
| `fixtures/visual-novel/schema.json` | `buildSchema(visual-novel)`, same serialisation |
| `fixtures/visual-novel/system-prompt.txt` | `buildSystemPrompt(visual-novel) + '\n'` |
| `fixtures/hostile/cases.json` | the case `channel-kind-unknown`, with its exact thrown message, plus the completeness rule that counts every `throw new Error` in `src/schema.js` |
| `worlds/cartoon/world.json` | the input. Not in `fixtures/`, but it is the frozen input for this component the way `fixtures/beats/` is for the paginator |
| `worlds/visual-novel/world.json` | the second input, chosen to be structurally dissimilar |

`fixtures/beats/*.json`, `fixtures/*/screens.*.json`, `fixtures/*/reading-time.json` and
`fixtures/dom/**` belong to other lanes. The loader never sees a beat.

Agents may not edit anything under `fixtures/`. If a fixture looks wrong, say so and stop.

---

## 8. Disagreements and open items

Recorded rather than resolved.

**The `kind` description is hardcoded in the loader.** `buildSchema` writes
*"concept teaches, misconception names the wrong turn most people take."* into the schema
regardless of what `beats.kinds` contains. It is the only sentence in the component that is
not derived from the manifest, and it names two specific kinds. It does not violate
invariant 4 as written — those are beat kinds, not a *world's* channel, asset, screen or id
— and both worlds declare exactly those two kinds, so it is true today. But a third world
declaring a different subset would receive a description of kinds it does not have. This
sits directly on `CONTRACT.md`'s open question about whether `kind` becomes a closed core
vocabulary; if it does, this sentence belongs to the core and is correct where it is, and if
it does not, it belongs in the manifest. **Not resolved here, per the contract.**

**`CONTRACT.md` says the unknown-`kind` throw happens at request time.** In `server.js` it
does not: `buildSchema(world)` is called at module evaluation, so the process dies before the
server listens. The four `paginate` throws *are* request-time. The distinction is worth
keeping because it is the difference between the one manifest error that behaves correctly
and the four that do not.

**Invariant 4 is a grep, and `src/schema.js:43` names `mascot_line` in a comment.** No
executable line names a world. `src/validate.js:39` and `public/app.js:183`/`:239` do the
same in comments. If the invariant is meant literally, all four are hits; if it is meant
about executable source, all four are fine. Flagging rather than editing.

---

## 9. Scenarios

Given/When/Then. Every scenario loads a file by path. None constructs a manifest inline;
where a scenario needs a broken manifest it deep-merges a `patch` over a real one, which is
the convention `fixtures/hostile/cases.json` already uses and `tools/check-fixture.mjs`
already implements.

Scenarios **S1–S18** describe behaviour that holds today; `npm run check-fixture` covers
S1–S6 and S18 directly. Scenarios **S19–S41** describe the manifest validator specified in
section 6 and **every one of them fails today**, because there is nothing to fail.

### Part A — the blessed outputs

**S1. Cartoon's schema is byte-identical.**
Given the manifest at `worlds/cartoon/world.json`
When `buildSchema` is called on it and serialised as `JSON.stringify(schema, null, 2) + '\n'`
Then the result equals the bytes of `fixtures/cartoon/schema.json`.

**S2. Cartoon's preamble is byte-identical.**
Given the manifest at `worlds/cartoon/world.json`
When `buildSystemPrompt` is called on it and a trailing newline appended
Then the result equals the bytes of `fixtures/cartoon/system-prompt.txt`.

**S3. The visual novel's schema is byte-identical.**
Given the manifest at `worlds/visual-novel/world.json`
When `buildSchema` is called on it and serialised the same way
Then the result equals the bytes of `fixtures/visual-novel/schema.json`.

**S4. The visual novel's preamble is byte-identical.**
Given the manifest at `worlds/visual-novel/world.json`
When `buildSystemPrompt` is called on it and a trailing newline appended
Then the result equals the bytes of `fixtures/visual-novel/system-prompt.txt`.

**S5. Purity — repetition changes nothing.**
Given the manifests at `worlds/cartoon/world.json` and `worlds/visual-novel/world.json`
When each is compiled twice in the same process and once in a fresh process
Then all three serialisations are byte-identical, and no call reads the clock, a random
source, the network or the filesystem.

**S6. Genericity — the source names no world.**
Given `src/schema.js` and the channel, asset, screen and id names declared in both
`worlds/*/world.json`
When every one of those names is grepped for in the file
Then the only hit is `mascot_line` inside the comment on line 43, and no executable line
matches.

**S7. Structurally dissimilar worlds go through the same code.**
Given both manifests
When both are compiled
Then Cartoon produces two text properties and one enum property with five values, the
visual novel produces one text property and three enum properties with two, eleven and five
values, and neither result required a branch naming either world.

**S8. Asset descriptions are folded into the enum, not left in the preamble.**
Given `worlds/cartoon/world.json`, whose `assets.mascot` carries five descriptions
When the schema is built
Then `beats.items.properties.expression.description` begins with the channel's `job` and
continues `Options: explaining = …; considering = …` covering all five, exactly as
`fixtures/cartoon/schema.json` holds it
And `fixtures/cartoon/system-prompt.txt` contains none of those five descriptions.

**S9. The same fold happens for an `asset` channel with no `values`.**
Given `worlds/visual-novel/world.json`, whose `speaker_face` declares `set: "face"` and no
`values`
When the schema is built
Then the enum is the eleven keys of `assets.face` in manifest order and the description
folds all eleven, matching `fixtures/visual-novel/schema.json`.

**S10. `values` wins over the set's keys.**
Given `worlds/cartoon/world.json`, where `expression` declares both `values` and
`set: "mascot"`
When the schema is built
Then the enum is `ch.values`
And the description is still folded from the whole of `assets.mascot`.

**S11. Module channels sit beside `beats`, never inside a beat.**
Given both manifests, each declaring exactly one module channel `ask_line`
When each schema is built
Then `ask_line` is a top-level property and appears in the top-level `required`
And it is absent from `beats.items.properties` and from the beat's `required`
And this matches both `fixtures/*/schema.json`.

**S12. `restrict` becomes a preamble line, for the world that declares one.**
Given `worlds/cartoon/world.json`, whose `expression` declares
`restrict: { considering: "misconception" }`
When the preamble is built
Then its final line is
`- expression may only be "considering" on a misconception beat.`
matching `fixtures/cartoon/system-prompt.txt`
And `fixtures/visual-novel/system-prompt.txt`, whose world declares no `restrict`, contains
no line of that shape.

**S13. `hold` becomes a preamble line, for the world that declares one.**
Given `worlds/visual-novel/world.json`, whose `background` declares `hold: "module"`
When the preamble is built
Then its final line is the chosen-once-for-the-whole-module sentence naming `background`,
matching `fixtures/visual-novel/system-prompt.txt`
And the channel still appears on the **per-beat** schema in
`fixtures/visual-novel/schema.json`, because the model emits one every beat
And `fixtures/cartoon/system-prompt.txt` contains no line of that shape.

**S14. `keyedBy` leaves no trace in either output.**
Given `worlds/visual-novel/world.json`, whose `speaker_face` declares
`keyedBy: "speaker_body"`
When both artefacts are built
Then neither `fixtures/visual-novel/schema.json` nor
`fixtures/visual-novel/system-prompt.txt` contains the string `keyedBy`, the string
`speaker_body` inside the `speaker_face` property, a hyphenated composed key, a filename, an
extension or a path
And the eleven enum values are the same character-neutral expressions Hana and Mei share.

**S15. Projector-only and validator-only keys leave no trace either.**
Given both manifests, which between them declare `opening`, `mustBeClaim`, `mustAsk`,
`assetFormat`, `viewport`, `motion`, `archetype`, `screens` and `pagination`
When both artefacts are built for both worlds
Then none of those key names, and none of their values, appears in any of the four blessed
fixture files — except where a value is independently part of a `job` string the author
wrote.

**S16. The beat bounds reach the schema.**
Given both manifests, each declaring `beats.min = 3` and `beats.max = 6`
When each schema is built
Then `properties.beats.minItems` is 3 and `maxItems` is 6 in both
`fixtures/*/schema.json`.

**S17. Nothing is optional.**
Given both manifests
When each schema is built
Then every declared beat channel appears in the beat's `required`, every declared module
channel appears in the top-level `required`, and `additionalProperties` is `false` at both
levels, in both `fixtures/*/schema.json`.

**S18. The one manifest rule that exists throws with its blessed message.**
Given `worlds/cartoon/world.json` deep-merged with the `patch` from the case
`channel-kind-unknown` in `fixtures/hostile/cases.json`
When `buildSchema` is called on the merged manifest
Then it throws exactly
`world "cartoon": channel "body" has unknown kind "markdown"`
And the completeness check in `tools/check-fixture.mjs` still counts one `throw new Error`
in `src/schema.js` with one case covering it.

### Part B — the manifest validator (every one of these fails today)

Each loads a real manifest by path and deep-merges a patch. `null` in a patch deletes a key.

**S19. A channel set that does not exist is caught at load, not never.**
Given `worlds/cartoon/world.json` patched with
`{ channels: { expression: { set: "mascots", values: null } } }`
When the manifest is checked
Then rule C4 reports
`world "cartoon": channel "expression" declares set "mascots", which is not in world.assets`
And no generation is attempted.
*Today:* the schema is built with `enum: []`, every generation returns
`error_max_structured_output_retries`, and the validator's membership check is guarded by
`allowed.length &&` so it fails open as well.

**S20. An enum channel with neither `values` nor `set` is caught.**
Given `worlds/cartoon/world.json` patched with
`{ channels: { expression: { set: null, values: null } } }`
When the manifest is checked
Then rule C3 reports
`world "cartoon": channel "expression" resolves to an empty enum; no response can satisfy the schema`.

**S21. A `keyedBy` naming a channel that does not exist is caught.**
Given `worlds/visual-novel/world.json` patched with
`{ channels: { speaker_face: { keyedBy: "speaker" } } }`
When the manifest is checked
Then rule D4 reports
`world "visual-novel": channel "speaker_face" is keyed by "speaker", which is not a declared channel`.
*Today:* the projector composes
`/worlds/visual-novel/assets/face-undefined-smug.webp` — the literal string `undefined` in a
path — and 404s mid-session. Verified by executing the projector's `assetUrl` against the
patched manifest.

**S22. A `keyedBy` naming a text channel is caught.**
Given `worlds/visual-novel/world.json` patched with
`{ channels: { speaker_face: { keyedBy: "line" } } }`
When the manifest is checked
Then rule D4 reports that `line` is a text channel and its value would be composed into an
asset path.
*Today:* the projector composes
`/worlds/visual-novel/assets/face-So the tree stores a range-smug.webp`, putting a generated
sentence into a URL — which is the one thing *nothing the model emits is ever used as a path*
exists to prevent.

**S23. A declared asset with no file is caught, for the simple world.**
Given `worlds/cartoon/world.json` and the file list of `worlds/cartoon/assets/`
When the manifest is checked
Then rule E1 passes with 5 expected files and 0 missing
And when the manifest is patched with
`{ assets: { mascot: { pointing: "one finger out" } } }`
Then rule E1 reports
`world "cartoon": asset set "mascot" declares "pointing" but assets/mascot-pointing.webp is not in the package`.

**S24. A declared asset with no file is caught across a composed key.**
Given `worlds/visual-novel/world.json` and the file list of `worlds/visual-novel/assets/`
When the manifest is checked
Then rule E1 expands `speaker_face` over the two values of `speaker_body` and expects 29
files in total — 2 bodies, 22 composed faces, 5 backgrounds — and finds 0 missing
And when the manifest is patched with
`{ assets: { face: { wink: "one eye closed" } } }`
Then rule E1 reports **both** `face-mei-wink.webp` and `face-hana-wink.webp` as missing,
because a keyed set is a cross product and half a cross product is a world that breaks only
when one particular character makes one particular face.

**S25. A missing `assetFormat` entry is caught.**
Given `worlds/visual-novel/world.json` patched with `{ assetFormat: { face: null } }`
When the manifest is checked
Then rule E2 reports
`world "visual-novel": asset set "face" declares no assetFormat; the projector will request .svg`.
*Today:* the projector silently falls back to `.svg` and 404s all 22 faces.

**S26. A manifest id that disagrees with its directory is caught.**
Given `worlds/cartoon/world.json` patched with `{ id: "streak" }`, in the directory
`worlds/cartoon`
When the manifest is checked
Then rule A1 reports the mismatch and names the asset URL as the reason.
*Today:* the world loads, renders all its text, and shows no images at all, because the
projector composes `/worlds/streak/assets/…`. The rename from Streak to Cartoon is exactly
the change that would have produced this.

**S27. An unsatisfiable beat range is caught.**
Given `worlds/cartoon/world.json` patched with `{ beats: { min: 9 } }`
When the manifest is checked
Then rule A4 reports
`world "cartoon": beats.min 9 is greater than beats.max 6; no response can satisfy the schema`.
*Today:* the schema is emitted with `minItems: 9, maxItems: 6` and every generation returns
`error_max_structured_output_retries` — the same opaque error as a too-tight cap and as the
`emphasising` trap.

**S28. A missing beat range is caught.**
Given `worlds/visual-novel/world.json` patched with `{ beats: { min: null, max: null } }`
When the manifest is checked
Then rule A4 reports that both bounds are required.
*Today:* `minItems` and `maxItems` are `undefined`, `JSON.stringify` drops them, and the
model is handed an unbounded beat array — so a module's length stops being a world property,
which is what resume and progress depend on.

**S29. A channel named `kind` is caught.**
Given `worlds/cartoon/world.json` patched with
`{ channels: { kind: { kind: "text", maxLength: 10, job: "hi" } } }`
When the manifest is checked
Then rule B1 reports
`world "cartoon": channel "kind" collides with the beat's own kind field`.
*Today:* the beat's kind enum is silently replaced by a 10-character text property and the
beat's `required` array reads `["kind","mascot_line","body","expression","kind"]`. Verified
by execution.

**S30. A module channel named `beats` is caught.**
Given `worlds/cartoon/world.json` patched with
`{ module: { channels: { beats: { kind: "text", maxLength: 5, job: "x" } } } }`
When the manifest is checked
Then rule B2 reports the collision with the beats array.
*Today:* `properties.beats` is replaced by a 5-character string property, so the schema asks
the model for no beats at all. Verified by execution.

**S31. A name declared in both scopes is caught.**
Given `worlds/cartoon/world.json` patched with
`{ module: { channels: { expression: { kind: "text", maxLength: 5, job: "m" } } } }`
When the manifest is checked
Then rule B3 reports
`world "cartoon": "expression" is declared as both a beat channel and a module channel`.
*Today:* the schema gains a top-level `expression` beside the beat one, and the preamble's
`- expression may only be "considering" on a misconception beat.` line **vanishes**, because
the restriction loop spreads module channels over beat channels and the module one carries no
`restrict`. The validator goes on enforcing a rule the model is no longer told. Verified by
execution.

**S32. A `restrict` naming a value outside the channel's own enum is caught.**
Given `worlds/cartoon/world.json` patched with
`{ channels: { expression: { restrict: { emphasising: "misconception" } } } }`
When the manifest is checked
Then rule D1 reports
`world "cartoon": channel "expression" restricts value "emphasising", which is not one of its own values`.
*Today:* the preamble carries a well-formed sentence about a value the model can never pick,
on every cached request, forever. Verified by execution.

**S33. A `restrict` naming a kind outside `beats.kinds` is caught.**
Given `worlds/cartoon/world.json` patched with
`{ channels: { expression: { restrict: { considering: "worked-step" } } } }`
When the manifest is checked
Then rule D1 reports the unknown kind.
*Today:* the preamble tells the model to use `considering` only on a beat kind that does not
exist, and `src/validate.js` fails every beat that uses it — a module that can never pass, on
a world that installed clean.

**S34. A `restrict` on a module channel is caught.**
Given `worlds/cartoon/world.json` patched with
`{ module: { channels: { ask_line: { restrict: { foo: "concept" } } } } }`
When the manifest is checked
Then rule D2 reports that `restrict` only applies to a beat.
*Today:* the preamble emits `- ask_line may only be "foo" on a concept beat.`, which is
nonsense — `ask_line` is not on a beat — and nothing enforces it. Verified by execution.

**S35. A `hold` with an unsupported value is caught.**
Given `worlds/visual-novel/world.json` patched with
`{ channels: { background: { hold: "session" } } }`
When the manifest is checked
Then rule D3 reports
`world "visual-novel": channel "background" declares hold "session"; the only supported value is "module"`.
*Today:* both the preamble builder and the validator test `hold === 'module'` and skip, so
the declaration is a silent no-op and the background is free to change on every beat — the
one thing the channel exists to prevent. Verified by execution.

**S36. An `opening` outside the channel's own enum is caught.**
Given `worlds/cartoon/world.json` patched with
`{ channels: { expression: { opening: "emphasizing" } } }`
When the manifest is checked
Then rule F1 reports
`world "cartoon": channel "expression" declares opening "emphasizing", which is not one of its own values`.
*Today:* stage 0 requests `/worlds/cartoon/assets/mascot-emphasizing.webp` and 404s on the
very first frame of the session, because `validate()` only ever inspects model output and an
`opening` never passes through it.

**S37. An `opening` that breaks its own channel's text rules is caught.**
Given `worlds/visual-novel/world.json` patched with
`{ module: { channels: { ask_line: { opening: "Right, let us begin." } } } }`
When the manifest is checked
Then rule F1 reports that the channel declares `mustAsk` and the opening does not end in a
question
And unpatched, both worlds pass: 32 characters against a cap of 90 and 33 against 110, both
ending in `?`.

**S38. A screen template that is not on disk is caught at load.**
Given `worlds/cartoon/world.json` patched with
`{ screens: { module: "screens/teach.html" } }` and the file list of `worlds/cartoon/`
When the manifest is checked
Then rule E3 reports
`world "cartoon": screen "module" names screens/teach.html, which is not in the package`.
*Today:* `/api/world` throws inside `readFile`, the server returns 500 `{error}`, the browser's
`res.world` is `undefined`, and `world.name` throws a `TypeError` into a blank stage. The
student sees nothing and the author is told nothing.

**S39. A screen path escaping the package is caught.**
Given `worlds/cartoon/world.json` patched with
`{ screens: { module: "../../CONTRACT.md" } }`
When the manifest is checked
Then rule E3 reports
`world "cartoon": screen "module" points outside the package: "../../CONTRACT.md"`.
*Today:* `server.js` does `join(worldDir, p)` with no normalisation, so the path resolves to a
real file outside the world and is served to the browser as a template. This is invariant 5 —
containment — and it is not currently enforced anywhere.

**S40. A pagination mapping is checked exhaustively at load rather than per beat at request.**
Given `worlds/cartoon/world.json` patched with
`{ pagination: { screenFor: { misconception: "correction" } } }`
When the manifest is checked
Then rule E5 reports
`world "cartoon": pagination.screenFor maps to screen type "correction", which is not declared in world.screens`
even though no beat has been generated.
*Today:* `paginate` throws the same message, but only on the first module that actually
contains a `misconception` beat — so the world runs correctly for an arbitrary number of
sessions and then fails in front of a student. This is the clearest single argument for
moving the check to load.

**S41. A mistyped slot is caught against the templates.**
Given `worlds/cartoon/world.json` and its two templates, with `screens/module.html` patched
in memory so `data-slot="mascot_line"` reads `data-slot="mascot_lin"`
When the manifest is checked
Then rule E7 reports
`world "cartoon": screen "module" fills slot "mascot_lin", which is not a declared channel`
And unpatched, both worlds pass, every `data-slot` in all four templates resolving to a
declared channel or to the runtime-owned `controls` and `ask`.
*Today:* the projector's `if (!(key in values)) continue` makes the slot render empty on every
screen, forever, with no error anywhere.

---

## 10. Verification run

```
$ npm run check-fixture
30 checks passed
```

Unchanged. This document adds no code and edits no source, fixture, world or shared file.
