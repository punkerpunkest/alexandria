# Contract: the validator

`src/validate.js` — `validate(world, out)` and `repairPrompt(failures)`.
Written against `CONTRACT.md` v0.1 and the vault note `Alexandria - Glossary`.

## Purpose

The validator checks **meaning**. The JSON Schema built by `src/schema.js` and handed to
the adapter already guarantees **shape** — which properties exist, their types, their
enums, their length caps, how many beats — and the structured-output layer refuses to
return anything that breaks it. What shape cannot express is intent: a claim that is
actually a question, a pose reserved for one beat kind, a background that drifts
mid-module, a beat kind the world says it must always receive. Per the glossary,
*schema conformance is not correctness*: a perfectly valid object can be useless.
`validate` names every such violation as a record; `repairPrompt` turns those records
into the one corrective turn the server sends back to the model.

The validator decides nothing. It returns a list and the caller (`server.js:45-52`)
chooses: repair at most twice, then set `degraded` and hand the session to the plain
world.

## Preconditions

1. `world` is a **loaded, well-formed manifest**. `validate` reads `world.channels`,
   `world.assets`, `world.beats.require` and `world.module.channels` without guarding
   the first two: a manifest missing `channels` or `beats` throws a `TypeError` out of
   this function. Manifest validation is the world loader's lane, and as of 28 Aug it is
   **enforced**: `src/manifest.js` runs 36 rules at boot and a package that fails them is
   kept out of the session rather than handed here. This precondition used to be a hope.
   The failure policy — *a broken world should fail at load, not mid-session* — is what
   makes it the loader's problem and not this file's.
2. `out` is whatever the adapter returned, and may be `null`, `undefined` or malformed.
   This is the one input the validator does defend against, at line 10.
3. The world and the module were generated against **the same manifest**. Every rule
   below is read from `world` at call time, so validating a module against a manifest
   it was not generated from produces true-but-useless failures.

## Postconditions

1. Returns an `Array`. Empty means clean. Never `null`, never a boolean.
2. Two record shapes, and only two:
   - beat scope — `{ beat: <index>, field: <channel name>, reason: <string> }`
   - module scope — `{ scope: 'module', reason: <string> }`
3. **Pure.** No clock, no randomness, no I/O. Neither `world` nor `out` is mutated;
   same input, byte-identical output, every run.
4. **Total.** For any `out`, the function returns rather than throws (given a valid
   `world`). Nothing here throws into the session.
5. **Ordered, and the order is part of the contract**, because `check-fixture` compares
   the returned array byte-for-byte and `repairPrompt` preserves it:
   1. per beat, in beat order — for each channel in manifest declaration order:
      over-cap, then closed-set membership, then `restrict`;
   2. per beat, a second pass for `mustBeClaim`, so a claim violation always sorts
      after every channel-level failure on the same beat;
   3. `hold` drift, per held channel, across all beats;
   4. module channels, in declaration order — missing, then over-cap, then `mustAsk`;
   5. `beats.require`, in declared order.
6. `repairPrompt(failures)` is a pure string builder over that array. Its first line is
   fixed; each failure becomes one line, `- module: <reason>` or
   `- beat <i>, field <name>: <reason>`.

## Invariants owned

Of the six in `CONTRACT.md`:

| # | Invariant | Owned here? |
|---|---|---|
| 1 | Coverage | No — the paginator's. |
| 2 | Order | No — the paginator's. |
| 3 | **Purity** | **Yes.** A pure function of two arguments; no clock, no randomness, no network, no subprocess. |
| 4 | **Genericity** | **Yes, and verified by grep below.** Every rule is read from the manifest at call time. |
| 5 | Containment | Partly, and only upstream of it. The closed-set check is the reason a chosen asset key is always one the world declared, so path resolution has something real to resolve. The path itself is composed and resolved by the projector, not here — and note that `speaker_face`'s `keyedBy` composition (`{speaker_body}-{value}`) is invisible to this file: it validates the component, never the composed key. |
| 6 | **Degradation** | **Yes, the half that matters.** An invalid beat produces a record, never a throw, so the caller can fall back to the plain world. The validator supplies `remainingFailures`; `server.js` supplies the fallback. |

Invariant 4 is stated as a grep, so it was run rather than assumed. Every `id`, `name`,
`archetype`, channel name, module-channel name, screen type, asset set name, asset key
and beat kind declared by either shipped world — 44 tokens — was matched against
`src/validate.js`. **No executable line matches any of them.** Four tokens appear, all
of them in prose:

- line 39, the comment `{ "considering": "misconception" }` names Cartoon's enum value
  and a beat kind as an illustration of the `restrict` shape;
- line 82, the comment "The ask line's whole job…" collides with `ask` (a screen type in
  both worlds) and `line` (a visual-novel channel).

`module` matches on eleven lines, in code, but as the core noun and the manifest key
`world.module.channels` — Cartoon happens to name a *screen type* `module` too. That is
a collision in Cartoon's manifest, not a leak in this file. Read literally, invariant 4
says *source*, and comments are source, so lines 39 and 82 should be reworded to keep
the grep clean for whoever runs it next.

## The rules it enforces

DECLARED is always the manifest — that is the point, and it is why a world can rename a
channel without touching this file. STEERED means `buildSystemPrompt(world)` in
`src/schema.js` tells the model the rule in words. Where the schema itself carries the
rule, the structured-output layer does not steer at all, it *refuses*, which is a
stronger thing and changes what a clean run proves.

| Rule | Declared | Steered | Enforced | Reachable? |
|---|---|---|---|---|
| `maxLength`, beat text | `channels.<c>.maxLength` | Not specifically. `buildSystemPrompt` says only "Respect every length limit in the schema"; the cap itself goes into the JSON Schema via `property()` (`schema.js:15`) where the structured-output layer **enforces** it | `validate.js:27-29` | **No. Backstop only** — see below |
| `maxLength`, module text | `module.channels.<c>.maxLength` | Same, same `property()` | `validate.js:79-81` | **No** — identical argument, and the code does not say so |
| Closed-set membership, `enum` | `channels.<c>.values` | Descriptions steer *which* value; membership is the schema's `enum` (`schema.js:18`) and is refused, not steered | `validate.js:32-37` | **No, effectively.** Cartoon's own `_naming_note` is the evidence: `"emphasising"` failed *every* generation with `error_max_structured_output_retries` because it was not in the enum. Out-of-set values do not arrive, they abort |
| Closed-set membership, `asset` | keys of `assets[<set>]` | As above | `validate.js:32-37`, right-hand branch of `allowed` | **No, effectively** — and see the coverage gap below |
| `restrict` | `channels.<c>.restrict` | **Yes** — `schema.js:60-62` emits `- expression may only be "considering" on a misconception beat.` | `validate.js:40-43` | **Yes.** The schema has no conditional, so nothing refuses it |
| `mustBeClaim` | `channels.<c>.mustBeClaim` | **No.** `buildSystemPrompt` never mentions it. The only steering is the world author's own `job` prose ("A claim, never a question"), which reaches the model as the schema description | `validate.js:48-50` | **Yes** |
| `mustAsk` | `module.channels.<c>.mustAsk` | **No.** Same — Cartoon's `job` says "It must end in a question", but the platform never says it | `validate.js:84-86` | **Yes** |
| `hold: "module"` | `channels.<c>.hold` | **Yes** — `schema.js:67-69` emits the "chosen once for the whole module" line | `validate.js:57-69` | **Yes.** The schema stays per-beat by design, so consistency is semantic |
| `beats.require` | `beats.require` | **No, nowhere.** Not in the prompt, not in the schema. The schema constrains `kind` to the declared *vocabulary* and never demands a member of it | `validate.js:90-94` | **Yes** |
| Module channel present and non-empty | `module.channels` keys | Presence is `required` in the schema (`schema.js:47-48`); **non-emptiness is steered nowhere** and no `minLength` is emitted | `validate.js:73-78` | **Yes, for the empty-string half.** `null` is refused by the schema; `""` is not |
| Adapter returned nothing usable | `beats.min` becomes `minItems` | n/a | `validate.js:11-13` | **Yes** — this guards a `null`/non-array `out`, not a short array |

### Enforced but not steered

Four, and each one costs a repair round trip every time the model gets it wrong:

1. **`beats.require`** — the worst of them. Nothing anywhere tells the model the kind is
   mandatory, so the first attempt is uninformed and the *repair* prompt is where the
   requirement is stated for the first time. Neither shipped world declares it, so the
   cost is latent rather than paid, but it is one manifest line away.
2. **`mustBeClaim`** and **`mustAsk`** — steered only if the world author happens to
   write the rule into the channel's `job`. Both shipped worlds do, which hides the gap:
   a world that declares `mustBeClaim: true` and writes a `job` that does not mention
   questions gets zero steering and full enforcement. `restrict` and `hold` show the
   right pattern — declared once, steered from the declaration, enforced from the same
   declaration — and these two should follow it.
3. **Non-empty module channels** — the schema requires the key, not the content.

### The `maxLength` branch is unreachable, and a zero repair rate is not evidence

The long comment at `validate.js:21-26` is correct and it matters more than it looks.
`maxLength` reaches the model as a JSON Schema constraint, and the structured-output
layer *enforces* rather than steers it: set the cap below what the model needs and the
generation fails outright with `error_max_structured_output_retries` instead of
returning long text. Over-cap text therefore never arrives, and the branch exists purely
in case an adapter is swapped in that only steers.

Two consequences the code does not currently state:

- The **module-level** cap check at `validate.js:79-81` is unreachable for exactly the
  same reason — `property()` is shared between beat and module channels, so the cap
  lands in the schema either way. Only the beat-level branch carries the warning.
- **Closed-set membership is in the same category.** The enum is in the schema, and
  Cartoon's `_naming_note` records a generation aborting rather than returning an
  out-of-set value. So of the four rules the hostile fixture exercises against a
  *beat*, two are backstops.

This is why `README.md`'s gate table — "Schema | Beat arrays come back valid, 0 repairs
across every run so far" — must not be read as a finding about model behaviour. For
caps and closed sets the zero is tautological: those runs could not have produced a
repair. The zero is real evidence only for the meaning-only rules — `restrict`,
`mustBeClaim`, `mustAsk`, `hold`, `beats.require`, empty module channels — and it should
be quoted with that scope attached.

### Single-world coverage

Which world keeps which branch alive:

| Rule | Cartoon | Visual novel |
|---|---|---|
| `maxLength` (beat + module) | yes | yes |
| membership, `enum` kind | **only** | no |
| membership, `asset` kind | no | **only** |
| `restrict` | **only** | no |
| `mustBeClaim` | **only** | no |
| `mustAsk` | yes | yes |
| `hold: "module"` | no | **only** |
| `beats.require` | no | no — fixture patch only |

**`restrict` is exercised only by Cartoon.** If Cartoon ever drops the
`{"considering": "misconception"}` declaration, `validate.js:40-43` and the
`restrictions` block of `buildSystemPrompt` lose their only live coverage in the whole
repo, and the hostile case `restrict-violated` starts returning `[]`. That last part is
the saving grace: the loss is loud, because `check-fixture` goes red on the case even
though the completeness count stays at 15. The same is true of `hold` and the visual
novel, and of `mustBeClaim` and Cartoon. `beats.require` has *no* live declaration at
all today — its only existence is the hostile patch.

## Fixtures it is judged against

| Path | Role |
|---|---|
| `fixtures/beats/cartoon.max.json` | Clean module, 6 beats, Cartoon. Also the default base module for every hostile case naming `cartoon` |
| `fixtures/beats/cartoon.min.json` | Clean module, 3 beats, Cartoon |
| `fixtures/beats/visual-novel.max.json` | Clean module, 6 beats. Base module for `hold-drifts` |
| `fixtures/beats/visual-novel.min.json` | Clean module, 3 beats |
| `fixtures/hostile/cases.json` | Ten cases with `site: "validate.js"`, each asserting the exact `failures` array, in order |
| `worlds/cartoon/world.json` | The manifest under test. Hostile `patch` is deep-merged over it |
| `worlds/visual-novel/world.json` | Same |
| `fixtures/cartoon/schema.json`, `fixtures/visual-novel/schema.json` | Not inputs to `validate`, but the evidence for every "shape, not meaning" claim above: the caps and enums visibly live there |
| `fixtures/cartoon/system-prompt.txt`, `fixtures/visual-novel/system-prompt.txt` | The evidence for every STEERED column: `restrict` appears in Cartoon's, `hold` in the visual novel's, and neither file mentions `mustBeClaim`, `mustAsk` or `beats.require` |
| `tools/check-fixture.mjs` | The runner. 30 checks, offline, milliseconds |

Fixtures are read-only for this lane. If one looks wrong, say so and stop.

## Failure modes

Exact strings as produced today, in emission order. Reason strings are contract surface:
they are asserted byte-for-byte by `check-fixture` and they are the text the model reads
in the repair turn.

| # | Site | Record | Exact reason (example) | Hostile case |
|---|---|---|---|---|
| 1 | `validate.js:12` | `{ scope: 'module' }` | `no beats returned` | `no-beats` |
| 2 | `validate.js:28` | `{ beat, field }` | `100 chars, cap is 80` | `text-over-cap` |
| 3 | `validate.js:35` | `{ beat, field }` | `"emphasising" is not one of explaining, considering, highlighting, cautioning, encouraging` | `enum-outside-set` |
| 4 | `validate.js:42` | `{ beat, field }` | `"considering" is only allowed on a misconception beat` | `restrict-violated` |
| 5 | `validate.js:49` | `{ beat, field }` | `is a question; it must be a claim` | `mustbeclaim-violated` |
| 6 | `validate.js:63-66` | `{ beat, field }` | `"classroom-day" but background is held for the module; it must stay "library"` | `hold-drifts` |
| 7 | `validate.js:76` | `{ scope: 'module' }` | `ask_line is missing` | `module-channel-missing` |
| 8 | `validate.js:80` | `{ scope: 'module' }` | `ask_line is 130 chars, cap is 90` | `module-channel-over-cap` |
| 9 | `validate.js:85` | `{ scope: 'module' }` | `ask_line must end in a question` | `mustask-violated` |
| 10 | `validate.js:92` | `{ scope: 'module' }` | `no worked-step beat in the module` | `required-kind-missing` |

`repairPrompt` emits, verbatim:

```
That module did not pass validation. Fix exactly these and return the whole array again, changing nothing else:
- beat 0, field mascot_line: 100 chars, cap is 80
- module: ask_line must end in a question
```

Notes on individual modes:

- **#1 is not "the array was short."** `minItems` in the schema handles short arrays.
  This fires when `out` is `null` or not an object with an array `beats` — a dead
  adapter, a parse failure, a swapped CLI. It returns *immediately*, so it is the one
  failure that is never accompanied by another.
- **#6 treats beat 0 as the reference** (`validate.js:59`), deliberately, so repair
  rewrites the strays rather than the module. The consequence is asymmetric: if the
  single wrong value is on beat 0, every other beat is reported and the repair prompt
  asks the model to change the majority to match the outlier. Documented here because it
  is a real behaviour, not because it is wrong — a majority vote would make the failure
  list depend on counts, which is harder to read in a repair prompt.
- **#7 fires on `""` and on whitespace**, not only on absence. Absence cannot occur —
  the key is `required` in the schema.
- **Fail-open path, no case.** At `validate.js:34` the membership check is guarded by
  `allowed.length &&`. An `asset` channel naming a set that does not exist in
  `world.assets` yields `allowed = []`, and then *every* value passes — including the
  ones that will resolve to a missing asset, which is the exact thing the check exists
  to prevent. This belongs to the loader's missing manifest validation, but it is worth
  recording where it bites.
- **No emptiness check on beat channels.** #7's mirror does not exist per beat: a beat
  with `mascot_line: ""` validates clean and renders an empty card. The schema requires
  the key and declares no `minLength`.

## BDD scenarios

Every scenario loads a fixture by path. None constructs a module inline. Where a
scenario names a hostile case, the input is built the way `tools/check-fixture.mjs`
builds it: load `worlds/<world>/world.json`, deep-merge `patch`, load
`fixtures/beats/<world>.max.json` unless the case supplies `module`, apply
`modulePatch`/`beatPatch`.

### Clean modules

**1. Cartoon at the maximum bound validates clean**
Given the manifest at `worlds/cartoon/world.json`
And the module at `fixtures/beats/cartoon.max.json` (6 beats, `mascot_line` at 80,
`body` at 300, `ask_line` at 90 — every cap touched)
When `validate(world, module)` runs
Then it returns `[]`.

**2. Cartoon at the minimum bound validates clean**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.min.json` (3 beats)
When `validate(world, module)` runs
Then it returns `[]`.

**3. The visual novel at the maximum bound validates clean**
Given `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.max.json`
(6 beats, `line` at 180, `ask_line` at 110, `background` `"library"` on all six)
When `validate(world, module)` runs
Then it returns `[]`.

**4. The visual novel at the minimum bound validates clean**
Given `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.min.json`
When `validate(world, module)` runs
Then it returns `[]`.

**5. Validation is pure and non-mutating**
Given `fixtures/beats/cartoon.max.json` and `fixtures/beats/visual-novel.max.json`
When `validate` runs twice on each, with a deep clone of each input captured first
Then both runs return byte-identical arrays
And `world` and `out` deep-equal their clones afterwards.

### Beat-scope rules

**6. A dead adapter is reported as a module failure, not a crash**
Given `worlds/cartoon/world.json`
And the module supplied inline by case `no-beats` in `fixtures/hostile/cases.json`
When `validate` runs
Then it returns exactly `[{ scope: 'module', reason: 'no beats returned' }]`
And nothing was thrown.

**7. Over-cap beat text is caught by the backstop**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `text-over-cap` replacing beat 0's `mascot_line` with 100 characters
When `validate` runs
Then it returns exactly `[{ beat: 0, field: 'mascot_line', reason: '100 chars, cap is 80' }]`
And this input could not have come from the adapter: `fixtures/cartoon/schema.json`
carries `maxLength: 80` on that property, so the structured-output layer would have
failed generation instead of returning it.

**8. A value outside a declared enum is caught**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `enum-outside-set` setting beat 0's `expression` to `"emphasising"`
When `validate` runs
Then the single failure's reason is
`"emphasising" is not one of explaining, considering, highlighting, cautioning, encouraging`
And the allowed list came from `channels.expression.values` in the manifest, in
declaration order — not from anything in `src/validate.js`.

**9. A value outside a declared asset set is caught — NO COVERAGE TODAY**
Given `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.max.json`
When a beat's `speaker_face` is set to a key absent from `assets.face`
Then the reason should be `"<value>" is not one of normal, smile, pleased, laugh, delighted, shocked, sad, angry, smug, annoyed, sleepy`
And **no hostile case asserts this.** The `ch.values ?? Object.keys(world.assets[ch.set])`
right-hand branch runs on the clean visual-novel fixtures and passes, but its *failing*
side is never asserted; the failure site counts as covered because Cartoon's `enum`
channel reaches the same `failures.push`. Adding the case is the fixture owner's call,
not this lane's.

**10. A restricted value on the wrong beat kind is caught**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `restrict-violated` setting beat 0's `expression` to `"considering"` while
beat 0's `kind` stays `"concept"`
When `validate` runs
Then the single failure's reason is `"considering" is only allowed on a misconception beat`
And beat 3 of the unpatched fixture holds the same value on a `misconception` beat and
does not fail, so the rule is conditional and not a ban.

**11. Tripwire: `restrict` has exactly one live declaration**
Given case `restrict-violated` is the only assertion of `validate.js:40-43`
And `worlds/cartoon/world.json` is the only manifest declaring `restrict`
When Cartoon drops the declaration
Then `validate` returns `[]` for that case and `npm run check-fixture` goes red
And the completeness count stays at 15, so the count check would not have caught it —
the per-case assertion is what does.

**12. A claim channel that asks is caught**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `mustbeclaim-violated` replacing beat 0's `mascot_line` with a question
When `validate` runs
Then the single failure is
`{ beat: 0, field: 'mascot_line', reason: 'is a question; it must be a claim' }`.

**13. The same text passes in a world that does not declare `mustBeClaim`**
Given `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.max.json`
And beats 3 and 4 of that fixture end in `?` ("…does my range fit entirely inside
yours?", "Wait, so it does not visit every leaf…?")
When `validate` runs
Then it returns `[]`, because the visual novel declares no `mustBeClaim` on `line`
And this is the direct evidence that the rule is read from the manifest rather than
attached to any channel by name.

**14. A held channel that drifts is caught, against beat 0**
Given `worlds/visual-novel/world.json` and `fixtures/beats/visual-novel.max.json`
And case `hold-drifts` setting beat 1's `background` to `"classroom-day"` while beat 0
stays `"library"`
When `validate` runs
Then the single failure is `{ beat: 1, field: 'background', reason: '"classroom-day" but background is held for the module; it must stay "library"' }`
And beats 2 to 5 still match beat 0 and are not reported.

**15. A world with no held channel skips the pass entirely**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
When `validate` runs
Then no `hold` failure is produced for any beat, because no Cartoon channel declares
`hold` — the loop at `validate.js:57` `continue`s on every channel.

### Module-scope rules

**16. An empty module channel is reported as missing**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `module-channel-missing` setting `ask_line` to `""`
When `validate` runs
Then it returns exactly `[{ scope: 'module', reason: 'ask_line is missing' }]`
And no `mustAsk` failure is added, because the missing branch `continue`s.

**17. An over-cap module channel is caught by the same backstop**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `module-channel-over-cap` setting `ask_line` to 130 characters
When `validate` runs
Then the reason is `ask_line is 130 chars, cap is 90`
And, as with scenario 7, this input could not have come from the adapter:
`fixtures/cartoon/schema.json` carries `maxLength: 90` on the top-level `ask_line`.

**18. A closing line that does not ask is caught**
Given `worlds/cartoon/world.json` and `fixtures/beats/cartoon.max.json`
And case `mustask-violated` setting `ask_line` to `"Tell me where you want to go next."`
When `validate` runs
Then it returns exactly `[{ scope: 'module', reason: 'ask_line must end in a question' }]`.

**19. `mustAsk` is satisfied at the cap in both worlds**
Given `fixtures/beats/cartoon.max.json` (`ask_line` 90 chars, cap 90) with
`worlds/cartoon/world.json`
And `fixtures/beats/visual-novel.max.json` (`ask_line` 110 chars, cap 110) with
`worlds/visual-novel/world.json`
When `validate` runs on each
Then both return `[]` — the same rule, two different caps, one code path.

**20. A required beat kind that never appears is caught**
Given `worlds/cartoon/world.json` patched by case `required-kind-missing` to declare
`beats.require: ["worked-step"]`
And `fixtures/beats/cartoon.max.json`, whose beats are all `concept` or `misconception`
When `validate` runs
Then it returns exactly `[{ scope: 'module', reason: 'no worked-step beat in the module' }]`
And note the requirement was never steered: neither
`fixtures/cartoon/system-prompt.txt` nor `fixtures/cartoon/schema.json` mentions it, so
in production the first the model hears of it is the repair prompt.

**21. No shipped world declares `beats.require`**
Given `worlds/cartoon/world.json` and `worlds/visual-novel/world.json`
When `validate` runs on their clean fixtures
Then the loop at `validate.js:90` iterates zero times in both cases
And the branch's only coverage in the repo is the patch in scenario 20.

### `repairPrompt`

**22. A beat failure becomes one addressed line**
Given the blessed `failures` array of case `text-over-cap` in `fixtures/hostile/cases.json`
When `repairPrompt(failures)` runs
Then the output is the fixed header followed by
`- beat 0, field mascot_line: 100 chars, cap is 80`.

**23. A module failure becomes a module-scoped line**
Given the blessed `failures` array of case `mustask-violated`
When `repairPrompt(failures)` runs
Then the second line is `- module: ask_line must end in a question`
And no beat index or field name appears on it.

**24. Multiple failures keep validation order — NO COVERAGE TODAY**
Given a module failing more than one rule at once
When `repairPrompt` runs
Then the lines should follow the emission order in the postconditions above
And **no hostile case produces more than one failure**, so the documented ordering is
asserted nowhere. `check-fixture` compares arrays byte-for-byte and would catch a
reordering the instant such a case existed. Proposing one is the fixture owner's call.

### Contract-level

**25. Genericity, as a grep**
Given `src/validate.js`
And every `id`, `name`, `archetype`, channel name, module-channel name, screen type,
asset set name, asset key and beat kind declared in `worlds/cartoon/world.json` and
`worlds/visual-novel/world.json`
When each token is matched against the file
Then no executable line matches
And the only matches are the comment on line 39 (`considering`, `misconception`), the
comment on line 82 (`ask`, `line`), and the core noun `module`.

**26. Degradation: nothing here throws into the session**
Given every case in `fixtures/hostile/cases.json` with `site: "validate.js"`
When each is built and passed to `validate`
Then each returns an array
And no call throws
And `server.js` can therefore always reach its `degraded` branch rather than losing the
session.

## Verification run

`npm run check-fixture` → **30 checks passed**, unchanged by this document, which adds
no code and no fixture.
