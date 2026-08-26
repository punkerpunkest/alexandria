# Paginator — design by contract

Owns `src/paginate.js`. Exports `paginate(world, beats, module = {})` and
`readingTimeMs(world, beats)`. Terms are fixed in the vault note `Alexandria - Glossary`;
the invariants numbered below are the six in `CONTRACT.md`, which this document does not
restate and may not amend.

## Purpose

The paginator turns a flat, ordered list of beats into the ordered list of screens a world
will actually show, following the mapping that world's manifest declares — never a mapping
the paginator picked. It then appends the one screen that is not derived from a beat: the
boundary screen named by `pagination.closeWith`, whose values come from the module rather
than from any beat. It is a pure function of `(world, beats, module)` and the only component
that decides how many screens a module becomes.

## Preconditions

### It may assume

| Assumption | Whose job it is |
|---|---|
| `world` is a parsed manifest object | World loader / `server.js`, which reads `world.json` once at start |
| `beats` is an iterable of beat objects | Caller. `server.js` passes `res.data?.beats ?? []`; `check-fixture` passes `mod.beats` |
| Each beat carries a `kind`, and channel values under the world's declared channel names | The schema. `buildSchema` puts `kind` in `required` and pins the beat count with `minItems: world.beats.min` / `maxItems: world.beats.max` |
| Beat content is semantically valid, or the caller has decided to degrade anyway | `validate.js`. The paginator is called on both paths |
| `module` is the whole decoded module object, module channels included | Caller. `server.js` passes `res.data`; `check-fixture` passes `mod` |

### It must not assume

- **A beat count.** Zero beats is legal and produces exactly the closing screen. The declared
  `beats.min` / `beats.max` bounds are enforced by the schema at generation, never here, and
  the paginator must not re-derive them.
- **That `kind` is in `world.beats.kinds`.** An unrecognised `kind` falls through to
  `screenFor.default` and is paginated normally. Vocabulary is the schema's business.
- **A channel name, screen type, asset name or world id.** Everything read is read by
  manifest key: `pagination.policy`, `pagination.screenFor`, `pagination.closeWith`,
  `world.screens`, and for reading time `world.channels[*].kind === 'text'`.
- **That beat values are strings, or present at all.** `paginate` inspects exactly one field
  of a beat — `kind` — and copies the rest nowhere. `readingTimeMs` coerces a missing text
  channel to `''`.
- **That it may mutate.** Beats and the module are passed through by reference and must be
  left as they were found.
- **That it runs at load.** It does not, today. See *Where the code and the contract
  disagree*.

## Postconditions

Write `close = world.pagination.closeWith`, `S = paginate(world, beats, module)`.

| # | Guarantee | Checkable as |
|---|---|---|
| P1 | Screen count | `S.length === beats.length + (close ? 1 : 0)` |
| P2 | One beat per beat-screen | for `i < beats.length`: `S[i].beats.length === 1` |
| P3 | Identity, not a copy | `S[i].beats[0] === beats[i]` and `S[i].fill === beats[i]`, by reference |
| P4 | Type comes from the manifest | `S[i].type === (screenFor[beats[i].kind] ?? screenFor.default)`, and `S[i].type in world.screens` |
| P5 | The closing screen is beatless | `S[S.length - 1].beats.length === 0` when `close` is set |
| P6 | The closing screen is filled from the module | `S[S.length - 1].fill === module`, by reference; `.type === close`; `close in world.screens` |
| P7 | Key order | every screen serialises as `type`, `beats`, `fill` in that order. Load-bearing: `check-fixture` compares `JSON.stringify(got, null, 2)` against the blessed file byte for byte |
| P8 | Total on beat content | no beat value other than `kind` is read, so no beat content can change the shape of the output or raise |
| P9 | Nothing is mutated | `beats`, each beat, and `module` are identical before and after |
| P10 | Reading time | `readingTimeMs(world, beats) === Math.round(words / 200 * 60000)` where `words` is the whitespace-separated token count of every channel with `kind === 'text'`, joined across every beat. Beats only — module channels are not counted |

`screens[].beats` is an **array** although the policy is strictly 1:1. That is a door left
open, not an accident: several beats on one screen is deferred rather than rejected, so the
field that would carry them already exists and the projector's `screen.beats[0]` read is the
contract rather than an unstated assumption. Settled 24 Aug; see `Alexandria - Build Plan`.

`screens[].fill` is what the projector reads slots from, and it is unified deliberately: the
beat for a beat screen, the module's own values for the beatless closing screen. The
projector never has to ask which kind of screen it is holding.

### The six invariants

| Invariant | Owned? | How it manifests here |
|---|---|---|
| **1. Coverage** | **Owned outright.** | The loop is `for (const beat of beats)` with exactly one `screens.push` per iteration and no `continue`, no filter, no dedup. P2 and P3 together are the check: each input beat is `=== screens[i].beats[0]` for exactly one `i`, and no beat appears twice because the closing screen's `beats` is `[]` |
| **2. Order** | **Owned outright.** | Index-preserving. `screens[i]` derives from `beats[i]` for every `i < beats.length`, and the closing screen is appended after the loop, never spliced |
| **3. Purity** | **Owned outright.** | `src/paginate.js` has zero imports, no `Date`, no `Math.random`, no `fetch`, no `process`. Every value in the output is either a manifest string or a reference to an input object. Same input, byte-identical output |
| **4. Genericity** | **Owned in behaviour. The grep is noisy — see below.** | No world's vocabulary is *read or written* by any executable line. The four error messages interpolate `world.id` and manifest values rather than hardcoding them, which is why the same code emits `"module"` for Cartoon and `"scene"` for the visual novel without branching. What a literal grep finds is in the next section |
| **5. Containment** | **Not owned in any executable sense.** | The paginator resolves no asset path and constructs no path of any kind. `world.screens[type]` is tested for *key presence* only — the template path it maps to is never read, opened, or joined. Beat channel values, asset keys included, pass through opaquely by reference. Recorded rather than skipped because a future N:1 policy that composed anything would acquire this invariant on the spot |
| **6. Degradation** | **Owned for beats. Contested for manifests.** | For beats it holds by construction, via P8: no beat content is inspected, so no invalid beat can make the paginator throw. `server.js` calls it on the degraded path too, with whatever survived repair, and it returns screens. For manifests it does **not** hold — four `throw new Error` sites fire on a broken manifest — and the four are justified by the failure policy's "a broken world should fail at load", except that nothing calls the paginator at load. See below |

## Fixtures it is judged against

| Path | What it pins |
|---|---|
| `fixtures/beats/cartoon.max.json` | Frozen input, 6 beats — Cartoon at `beats.max` |
| `fixtures/beats/cartoon.min.json` | Frozen input, 3 beats — Cartoon at `beats.min` |
| `fixtures/beats/visual-novel.max.json` | Frozen input, 6 beats |
| `fixtures/beats/visual-novel.min.json` | Frozen input, 3 beats |
| `fixtures/cartoon/screens.max.json` | Blessed output, 7 screens |
| `fixtures/cartoon/screens.min.json` | Blessed output, 4 screens |
| `fixtures/visual-novel/screens.max.json` | Blessed output, 7 screens |
| `fixtures/visual-novel/screens.min.json` | Blessed output, 4 screens |
| `fixtures/cartoon/reading-time.json` | `{ "max": 103500, "min": 50700 }` |
| `fixtures/visual-novel/reading-time.json` | `{ "max": 33600, "min": 15600 }` |
| `fixtures/hostile/cases.json` | The four `site: "paginate.js"` cases and their exact messages |
| `worlds/cartoon/world.json` | The manifest under test: `pagination`, `screens`, `channels` |
| `worlds/visual-novel/world.json` | The second manifest, structurally dissimilar |

The two worlds declare different screen types for the same input — Cartoon `module`, the
visual novel `scene` — and both declare `closeWith: "ask"`. Running one input through both is
what *detects* a paginator that is secretly Cartoon-shaped.

Not judged here: `fixtures/dom/**` belongs to the projector, and `fixtures/*/schema.json` and
`system-prompt.txt` to the world loader.

## The genericity grep, run and reported

Invariant 4 is a grep, so it is run rather than claimed. Grepping `src/paginate.js` for every
id, channel name, screen type and asset name either world declares — `cartoon`,
`visual-novel`, `mascot_line`, `body`, `expression`, `line`, `speaker_body`, `speaker_face`,
`background`, `ask_line`, `module`, `scene`, `ask`, `mei`, `hana` — returns three terms, and
only one of them is a real hit.

| Term | Lines | Verdict |
|---|---|---|
| `body` | 14, a comment | **True hit.** Cartoon's channel name, and only Cartoon's — the visual novel calls its text channel `line`. Harmless, comment-only, but it is what the invariant is looking for |
| `module` | 21 and 63, both executable; 48 and 53, comments | **False positive.** This is the parameter name, and *module* is platform vocabulary in `Alexandria - Glossary` — what the student reads between two interactives. Cartoon happens to have named a screen type after it |
| `ask` | 49 and 54, both comments | **False positive.** Line 49 is the English verb. Line 54 is the *ask* step of the loop, again glossary vocabulary. Both worlds happen to have named their closing screen type after it |

The finding worth carrying: Cartoon named its two screen types `module` and `ask`, which are
also the platform's own words for a unit of teaching and a step of the loop. A literal grep
for invariant 4 cannot distinguish the two senses, so a component may not use the platform
vocabulary in a comment without tripping it. Nothing in the paginator reads either string from
a manifest key or writes either as a literal, which is the behaviour the invariant is actually
protecting.

## Failure modes

Four `throw new Error` sites, in the order they can fire. Each already has a hostile case;
`check-fixture`'s completeness check counts `throw new Error` occurrences in `src/` against
`cases.length`, so adding a fifth site without a case turns that check red.

| Order | Trigger | Exact message | Case id |
|---|---|---|---|
| 1 | `world.pagination.policy` is not a key of the `POLICIES` map. Also fires when `pagination` is absent entirely, or `policy` is, both reported as `"undefined"` | `world "cartoon": unknown pagination policy "two-beats-per-screen". Known policies: one-beat-per-screen` | `policy-unknown` |
| 2 | For the first beat whose `kind` has no entry in `pagination.screenFor` and where `screenFor.default` is absent | `world "cartoon": pagination.screenFor declares no screen type for beat kind "concept", and no default` | `screenfor-no-default` |
| 3 | `screenFor` resolved to a type that is not a key of `world.screens` | `world "cartoon": pagination.screenFor maps to screen type "slide", which is not declared in world.screens` | `screenfor-undeclared` |
| 4 | `pagination.closeWith` names a type that is not a key of `world.screens` | `world "cartoon": pagination.closeWith names screen type "boundary", which is not declared in world.screens` | `closewith-undeclared` |

Precedence is fixed by control flow and worth stating, because a manifest can be broken two
ways at once: the policy check is before the loop, so 1 beats 2, 3 and 4. Sites 2 and 3 are
inside the loop and report the **first** offending beat, so the beat kind named in message 2
is the kind of `beats[0]` in whichever module was passed. Site 4 is after the loop, so a world
broken at both `screenFor` and `closeWith` reports `screenFor`.

Two further behaviours are *not* failures and must not become ones:

- `closeWith` absent or falsy appends no closing screen and raises nothing. Cartoon with
  `closeWith` removed returns 3 screens for the 3-beat module.
- `module` omitted defaults to `{}`, so the closing screen is `{ type, beats: [], fill: {} }`.

### Unnamed failures — a gap

Two inputs raise a raw `TypeError` with no world named, no rule named, and no hostile case.
The failure policy is "Named, never silent. Every rejection states which rule and which beat
or channel", and neither of these does. Recorded, not fixed — fixing either adds a
`throw new Error` site and would require a fifth and sixth hostile case, which is a fixture
edit this lane may not make.

| Input | Actual message today |
|---|---|
| `paginate(world, undefined, module)` — a caller that passed no beats array at all | `beats is not iterable` |
| `readingTimeMs(world, beats)` where the manifest has no `channels` block | `Cannot convert undefined or null to object` |

`readingTimeMs` has no named failure of its own and is not counted by the completeness check,
since that check only counts `throw new Error`.

## BDD scenarios

Twenty-five. Every scenario loads a fixture or a manifest from disk; none constructs an input
inline. Where a scenario needs a broken manifest it takes the `patch` from
`fixtures/hostile/cases.json` and deep-merges it, exactly as `tools/check-fixture.mjs` does,
with `null` meaning *delete this key*.

### A. The blessed outputs

**Scenario 1 — Cartoon at the maximum beat bound**
- **Given** the manifest at `worlds/cartoon/world.json`
- **And** the frozen module at `fixtures/beats/cartoon.max.json`, which holds 6 beats
- **When** `paginate(world, module.beats, module)` runs
- **Then** the result serialises byte-for-byte to `fixtures/cartoon/screens.max.json`
- **And** it holds 7 screens: six of type `module`, then one of type `ask`

**Scenario 2 — Cartoon at the minimum beat bound**
- **Given** `worlds/cartoon/world.json` and `fixtures/beats/cartoon.min.json`, which holds 3 beats
- **When** `paginate(world, module.beats, module)` runs
- **Then** the result serialises byte-for-byte to `fixtures/cartoon/screens.min.json`
- **And** it holds 4 screens, so `screens.length === beats.length + 1` at both bounds and the
  off-by-one the two bounds exist to catch has not happened

**Scenario 3 — Visual Novel at the maximum beat bound**
- **Given** `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.max.json`
- **When** `paginate(world, module.beats, module)` runs
- **Then** the result serialises byte-for-byte to `fixtures/visual-novel/screens.max.json`
- **And** the six beat screens carry type `scene`, not `module`, from the same code path that
  produced `module` in Scenario 1

**Scenario 4 — Visual Novel at the minimum beat bound**
- **Given** `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.min.json`
- **When** `paginate(world, module.beats, module)` runs
- **Then** the result serialises byte-for-byte to `fixtures/visual-novel/screens.min.json`
- **And** it holds 4 screens

### B. The invariants

**Scenario 5 — Coverage (invariant 1)**
- **Given** each of the four modules in `fixtures/beats/` with its matching manifest
- **When** `paginate` runs on each
- **Then** for every input beat there is exactly one `i` with `screens[i].beats[0] === beat`
- **And** the union of every `screens[].beats` array, compared by reference, equals the input
  beats array exactly — no beat dropped, none duplicated, none synthesised

**Scenario 6 — Order (invariant 2)**
- **Given** the same four modules
- **When** `paginate` runs on each
- **Then** `screens[i].beats[0] === beats[i]` for every `i < beats.length`
- **And** the closing screen is last, never interleaved

**Scenario 7 — Purity (invariant 3)**
- **Given** `fixtures/beats/cartoon.max.json` and `worlds/cartoon/world.json`
- **When** `paginate` is called twice with the same arguments in the same process
- **Then** both results serialise to identical bytes, equal to `fixtures/cartoon/screens.max.json`
- **And** the input beats and module deep-equal what was read from disk, so nothing was mutated
- **And** `src/paginate.js` contains no `import`, no `Date`, no `Math.random`, no `fetch` and
  no `process`

**Scenario 8 — Genericity (invariant 4)**
- **Given** both manifests and all four blessed `screens.*.json`
- **When** `paginate` runs on all four without branching on world id
- **Then** every output matches its blessed file, so one code path serves a paginated world
  and a scene-sequential one
- **And** no world's id, channel name, screen type or asset name is read from a literal or
  written as one anywhere in `src/paginate.js`; every such string in the output arrived from
  a manifest key or an input object
- **And** a literal grep for those fifteen terms returns exactly `body` (line 14, comment),
  `module` (21, 63 executable; 48, 53 comments) and `ask` (49, 54 comments), of which only
  `body` is a true hit — see *The genericity grep, run and reported* for why the other two
  are platform vocabulary rather than Cartoon's

**Scenario 9 — Containment (invariant 5)**
- **Given** `fixtures/beats/visual-novel.max.json`, whose beats carry three asset-kind channels
  (`speaker_body`, `speaker_face`, `background`)
- **When** `paginate` runs
- **Then** the output matches `fixtures/visual-novel/screens.max.json`
- **And** no asset key was concatenated, resolved, joined to a directory or read; every asset
  value reached the output only as part of the beat object passed through by reference

**Scenario 10 — Degradation (invariant 6), for beats**
- **Given** `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
- **And** the beat-level `beatPatch` from every `site: "validate.js"` case in
  `fixtures/hostile/cases.json` applied in turn — `text-over-cap`, `enum-outside-set`,
  `restrict-violated`, `mustbeclaim-violated`, and `hold-drifts` against the visual novel
- **When** `paginate(world, module.beats, module)` runs on each patched module
- **Then** it raises nothing in every case
- **And** each result still holds `beats.length + 1` screens, because no beat value other than
  `kind` was read

### C. The closing screen

**Scenario 11 — The closing screen is beatless, in both worlds**
- **Given** `fixtures/cartoon/screens.min.json` and `fixtures/visual-novel/screens.min.json`
- **When** each is compared to the output of `paginate` on its matching frozen module
- **Then** the last screen of each has `beats: []`
- **And** its `type` equals the `pagination.closeWith` its manifest declares
- **And** no earlier screen has an empty `beats` array

**Scenario 12 — The closing screen is filled from the module, by reference**
- **Given** `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.min.json`
- **When** `paginate(world, module.beats, module)` runs
- **Then** `screens.at(-1).fill === module` by reference, so it carries the module's `ask_line`
- **And** the blessed `fixtures/visual-novel/screens.min.json` shows that `fill` as the whole
  module object, `beats` array and `_`-prefixed provenance keys included, which is what the
  code emits and what "the module's own values" means in practice

**Scenario 13 — A world declaring no `closeWith` gets no closing screen**
- **Given** `worlds/cartoon/world.json` with `pagination.closeWith` deleted
- **And** `fixtures/beats/cartoon.min.json`, which holds 3 beats
- **When** `paginate(world, module.beats, module)` runs
- **Then** it returns 3 screens, all of type `module`
- **And** it raises nothing, because `closeWith` is optional and its absence is not a failure

### D. Identity and shape

**Scenario 14 — `fill` and `beats[0]` are the same object as the input beat**
- **Given** `worlds/cartoon/world.json` and `fixtures/beats/cartoon.min.json`
- **When** `paginate(world, module.beats, module)` runs
- **Then** `screens[0].fill === screens[0].beats[0] === module.beats[0]`, all by reference
- **And** the paginator therefore copies nothing, which is why the blessed screens files repeat
  the beat text under both `beats` and `fill` while holding one object in memory

**Scenario 15 — Key order in an emitted screen**
- **Given** the output of `paginate` on `fixtures/beats/cartoon.max.json`
- **When** it is serialised with `JSON.stringify(screens, null, 2) + '\n'`
- **Then** the bytes equal `fixtures/cartoon/screens.max.json`, which requires the key order
  `type`, `beats`, `fill` in every screen object — so reordering the object literal in
  `paginate` is a fixture-breaking change even though the data is unchanged

### E. Reading time

**Scenario 16 — Cartoon reading time at both bounds**
- **Given** `worlds/cartoon/world.json` and both `fixtures/beats/cartoon.{max,min}.json`
- **When** `readingTimeMs(world, module.beats)` runs on each
- **Then** the pair `{ max, min }` equals `fixtures/cartoon/reading-time.json`, that is
  `103500` and `50700` — 345 and 169 words at 200 wpm

**Scenario 17 — Visual Novel reading time at both bounds**
- **Given** `worlds/visual-novel/world.json` and both `fixtures/beats/visual-novel.{max,min}.json`
- **When** `readingTimeMs(world, module.beats)` runs on each
- **Then** the pair equals `fixtures/visual-novel/reading-time.json`, that is `33600` and
  `15600` — 112 and 52 words

**Scenario 18 — Only text channels are counted**
- **Given** `worlds/visual-novel/world.json`, which declares one `text` channel (`line`) and
  three `asset` channels (`speaker_body`, `speaker_face`, `background`)
- **And** `fixtures/beats/visual-novel.max.json`
- **When** `readingTimeMs` runs
- **Then** the result is `33600`, matching `fixtures/visual-novel/reading-time.json`
- **And** the asset keys contribute nothing, which the same function proves generically against
  Cartoon, where `expression` is `enum` and only `mascot_line` and `body` are counted
- **And** the module's own `ask_line` is not counted either, because the signature takes beats
  and never sees the module

### F. Failure modes

**Scenario 19 — Unknown pagination policy** (`policy-unknown`)
- **Given** `worlds/cartoon/world.json` deep-merged with the `patch` from the `policy-unknown`
  case in `fixtures/hostile/cases.json`, which sets `pagination.policy` to `two-beats-per-screen`
- **And** the frozen module at `fixtures/beats/cartoon.max.json`
- **When** `paginate(world, module.beats, module)` runs
- **Then** it throws with message exactly
  `world "cartoon": unknown pagination policy "two-beats-per-screen". Known policies: one-beat-per-screen`
- **And** the message names the world, the offending value and the whole known set, so the
  author can see what was expected without reading the source

**Scenario 20 — `screenFor` declares nothing for a kind and has no default** (`screenfor-no-default`)
- **Given** `worlds/cartoon/world.json` merged with the `screenfor-no-default` patch, which sets
  `pagination.screenFor.default` to `null` and so deletes it
- **And** `fixtures/beats/cartoon.max.json`, whose first beat has `kind: "concept"`
- **When** `paginate` runs
- **Then** it throws with message exactly
  `world "cartoon": pagination.screenFor declares no screen type for beat kind "concept", and no default`
- **And** the kind named is the first offending beat's, not the last

**Scenario 21 — `screenFor` maps to an undeclared screen type** (`screenfor-undeclared`)
- **Given** `worlds/cartoon/world.json` merged with the `screenfor-undeclared` patch, which sets
  `pagination.screenFor.default` to `slide`, a type `world.screens` does not declare
- **And** `fixtures/beats/cartoon.max.json`
- **When** `paginate` runs
- **Then** it throws with message exactly
  `world "cartoon": pagination.screenFor maps to screen type "slide", which is not declared in world.screens`

**Scenario 22 — `closeWith` names an undeclared screen type** (`closewith-undeclared`)
- **Given** `worlds/cartoon/world.json` merged with the `closewith-undeclared` patch, which sets
  `pagination.closeWith` to `boundary`
- **And** `fixtures/beats/cartoon.max.json`
- **When** `paginate` runs
- **Then** it throws with message exactly
  `world "cartoon": pagination.closeWith names screen type "boundary", which is not declared in world.screens`
- **And** it throws only after all six beat screens were built, because the check is after the
  loop — a partially built result is discarded rather than returned

**Scenario 23 — Precedence when a manifest is broken two ways**
- **Given** `worlds/cartoon/world.json` merged with the `policy-unknown` patch **and** the
  `closewith-undeclared` patch, both taken from `fixtures/hostile/cases.json`
- **And** `fixtures/beats/cartoon.max.json`
- **When** `paginate` runs
- **Then** it throws the `policy-unknown` message, because the policy check precedes the loop
- **And** this ordering is control flow rather than a blessed case; the fixture pins each site
  alone, and nothing pins their combination

### G. Unnamed failures

**Scenario 24 — A caller that passes no beats array**
- **Given** `worlds/cartoon/world.json`
- **And** the module at `fixtures/beats/cartoon.max.json`, from which the caller passes
  `module.beat` — a typo — instead of `module.beats`
- **When** `paginate(world, undefined, module)` runs
- **Then** it throws a raw `TypeError` with message `beats is not iterable`
- **And** the message names no world and no rule, which the failure policy in `CONTRACT.md`
  forbids — recorded as a gap, not fixed here

**Scenario 25 — Reading time against a manifest with no channels block**
- **Given** `worlds/cartoon/world.json` with `channels` deleted
- **And** `fixtures/beats/cartoon.max.json`
- **When** `readingTimeMs(world, module.beats)` runs
- **Then** it throws a raw `TypeError` with message
  `Cannot convert undefined or null to object`
- **And** `readingTimeMs` has no named failure of any kind, and no hostile case, because the
  completeness check counts only `throw new Error`

## Open, and not resolved here

**`pagination.policy` overlaps with `archetype`.** Recorded in the NOTE at `src/paginate.js`
lines 29–31: a paginated world cannot sensibly declare continuous scrolling, so whether the
archetype should simply imply the policy is a live design question. Both worlds today declare
`one-beat-per-screen`, Cartoon as `paginated` and the visual novel as `scene-sequential`, so
nothing distinguishes the two axes in any frozen output and the question is not blocking. It
is **not** currently listed in `Alexandria - Open Questions`; the source NOTE is the only place
it lives. This document does not resolve it and no scenario above depends on the answer.

**Whether `kind` becomes a closed core vocabulary.** `CONTRACT.md` marks this open and not this
lane's to resolve. It touches the paginator, so per that instruction: `beat.kind` is used here
as a **lookup key into `pagination.screenFor`**, and nowhere else. If `kind` closes, the keys of
`screenFor` become core-vocabulary tokens rather than world-defined ones, and the
`screenfor-no-default` failure becomes reachable only through a manifest that omits a core kind.
No code change follows either way; the meaning of one manifest map does.

**The per-kind `screenFor` branch is unexercised.** Both worlds declare only `screenFor.default`,
so `p.screenFor?.[beat.kind]` never resolves in any fixture and every blessed screen type came
from the fallback. A world that mapped `misconception` to a different screen type than `concept`
would be the first to exercise it, and no fixture covers that. Recorded as a coverage hole, not
a defect.

## Where the code and the contract disagree

**The four throws fire mid-session, not at load.** The failure policy says "A broken world
should fail at **load**, not mid-session", and the comment at `src/paginate.js` lines 8–10 says
an unrecognised policy "should hear about it at load rather than get silently reassigned". But
nothing calls `paginate` at load. `server.js` calls `buildSchema(world)` at start-up, which is
why `schema.js`'s throw genuinely is a load failure — and calls `paginate` only from
`buildModule`, after generation, and from the `?fixture=` branch. A world with a broken
`pagination` block therefore starts cleanly, serves `/api/world`, spends a model call, and then
returns a 500 from `/api/module` with the paginator's message in the body. Not a bug in this
component, and not this lane's to fix: the gap is that no component validates the manifest at
load, which `CONTRACT.md` already assigns to the world loader lane ("No manifest validation
exists yet — that gap is this lane's").

**`fill` is the module object, not the module's channel values.** `Alexandria - World Spec`
says of `closeWith`: "its `fill` is the module's own channel values". The code assigns
`fill: module`, so the closing screen's `fill` carries the entire decoded module — the `beats`
array and the `_world` / `_question` / `_model` / `_curation` provenance keys included — and the
blessed fixtures show exactly that. It is harmless, because the projector reads slots by name,
but it means every blessed `screens.*.json` duplicates the whole module inside its last screen.
Wording divergence rather than a defect, and changing it would re-bless all four screens files.
