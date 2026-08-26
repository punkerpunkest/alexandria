# The golden fixture

Frozen input, blessed output. This is the shared interface the deterministic
components are built against, and the reason six agents can work in parallel without
agreeing with each other first: every dependency between them is a file in here.

```
npm run check-fixture     # verify the code still produces this. milliseconds, no model
npm run capture-fixture   # re-capture after a DELIBERATE change, then read the diff
```

## The rules

**Agents may not edit anything in this directory.** If a fixture looks wrong, say so;
do not change it. A fixture edited to make a test pass is a test that measures nothing.

**Never regenerate the beats.** `fixtures/beats/*.json` came out of a model once,
were curated by hand, and were blessed. If a test called a model, red would mean
"the model phrased it differently" as often as it meant "something broke", and a
suite you cannot trust when it is red is a suite nobody reads.

**Re-blessing is deliberate.** Run `capture-fixture`, read the diff, decide whether it
is a bug or an improvement, and say which in the commit message.

## What is in here

| Path | What |
|---|---|
| `beats/{world}.{max,min}.json` | The frozen input. One module at each declared beat bound |
| `{world}/schema.json` | `buildSchema(world)` — what the model is constrained to |
| `{world}/system-prompt.txt` | `buildSystemPrompt(world)` |
| `{world}/screens.{max,min}.json` | `paginate(world, beats, module)`, including the beatless closing screen |
| `{world}/reading-time.json` | `readingTimeMs(world, beats)` |
| `hostile/cases.json` | One case per failure site, with its exact message |
| `_raw/` | Provenance: what the model actually produced, before curation |

## Why the beats look like that

They are a **coverage artefact, not a sample of typical output.** Three deliberate
choices:

- **Two worlds, same two questions.** Cartoon and the visual novel are structurally
  dissimilar — paginated against scene-sequential, a pinned artboard against an aspect
  range, one enum channel against split sprites with a composed asset key. Running one
  input through both is what *detects* a component that is secretly Cartoon-shaped. It
  does not prove genericity; it falsifies the lack of it.
- **Both beat bounds.** A `.max` module at the declared maximum and a `.min` at the
  minimum, so an off-by-one in pagination has somewhere to show up.
- **Text pinned to the caps.** In the `.max` modules, `mascot_line` is exactly 80,
  `body` exactly 300, the visual novel's `line` exactly 180, and both `ask_line`s at
  their caps. That is not padding for its own sake: `viewport._measured` in each
  manifest calibrated panel clearance *at the caps*, and the projector's overflow check
  exists to catch exactly that case. A fixture of comfortable 250-character bodies would
  never reach it.

Two subjects rather than one, for the same reason: a fixture written entirely from
computer science bakes a subject shape into the reference every future agent reads.

## DOM snapshots

`dom/{world}.{variant}/` holds the rendered output: every screen at `settled`, plus an
`entering` snapshot in each direction the archetype allows. These pin the published
attributes — `data-phase`, `data-nav`, `data-kind`, `data-changed` — and `data-persist`
hoisting, which is the subtle one, since persisted elements are lifted out of the screen
and a snapshot of the screen alone would miss them.

They cannot be checked by `npm run check-fixture`, because verifying them requires
rendering. Procedure and normalisation rules are in `tools/capture-dom.md`; the check is
that a re-run leaves `git diff fixtures/dom` empty.

`?fixture=<variant>` runs the app from these beats with **no model call**, which is also
how to work on the chrome without spending quota.

## Still unpinned

The unknown-archetype throw in `public/app.js`, recorded under `_browserSide` in
`hostile/cases.json`. It needs a world with a bad manifest and a page load to reach.
