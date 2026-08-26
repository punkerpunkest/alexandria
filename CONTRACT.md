# Shared contract, v0.1

The one thing every component agrees on. **Agents may not edit this file.** If something
in it looks wrong, say so and stop; do not change it. A contract an implementer can edit
is not a contract.

Terms are fixed in the vault note `Alexandria - Glossary`. Read it before naming anything.

## The components, and who owns which files

One owner per file. Nobody edits a file they do not own.

| Component | Owns | State |
|---|---|---|
| World loader | `src/schema.js` | Built. No manifest validation exists yet — that gap is this lane's |
| Paginator | `src/paginate.js` | Built |
| Validator | `src/validate.js` | Built |
| Projector | `public/app.js`, `public/presets.css` | Built |
| Chrome | `public/index.html`, `public/app.css`, `electron/` | Jordan's, by hand |
| Worlds | `worlds/**` | Two exist: `cartoon` (paginated), `visual-novel` (scene-sequential) |

Shared, and nobody edits without flagging it: `fixtures/**`, `server.js`, this file.

## What a beat is

```
one `kind`, drawn from the world's declared `beats.kinds`
plus exactly the channels that world's manifest declares
and nothing else
```

Module-level channels sit **beside** `beats`, not inside a beat, because some screens
are not beats: `pagination.closeWith` appends a beatless closing screen whose values come
from the module.

> **Open, and not yours to resolve.** Whether `kind` becomes a closed core vocabulary
> (`concept`, `question`, `worked-step`, `misconception`, with `checkpoint` reserved) with
> worlds declaring a subset, or stays world-defined as it is today. Both worlds currently
> declare exactly `["concept", "misconception"]`. It does not change any frozen output, so
> it is not blocking. Do not decide it; if your work touches it, say so.

## The published vocabulary

The projector publishes state onto the DOM and a world's CSS reacts. This list is the
**entire language** a world can speak, so growing it is a change to the projector and a
change to every world's expectations. Design against the visual novel, not against Cartoon.

| Published on | What | Values |
|---|---|---|
| the screen | `data-phase` | `entering`, `settled`, `leaving` |
| the screen | `data-nav` | `forward`, `back` |
| the screen | `data-kind` | the beat's kind, verbatim |
| the stack | `--motion-duration` | world-declared, runtime-clamped and speed-scaled |
| any `[data-slot]` | `data-changed` | present when the value differs from the previous screen's |
| any `[data-readout]` | a custom property | e.g. `--progress` |

`data-persist="<key>"` is declared by the **world**; the projector hoists that element out
of the per-screen lifecycle so it survives a screen change.

## Invariants

Mechanically checkable, all of them. These are the postconditions worth asserting; a
contract that only checks types will not catch what actually goes wrong here.

1. **Coverage.** Every beat handed to the paginator appears in exactly one screen.
2. **Order.** Screens preserve beat order.
3. **Purity.** Same input, byte-identical output, every run. No clock, no randomness, no
   network, no subprocess in `src/`.
4. **Genericity.** No world's channel name, asset name, screen type or id appears in the
   source of any component. This is a grep, so verify it rather than claiming it.
5. **Containment.** Every asset path resolves inside the world's own package.
6. **Degradation.** An invalid beat falls back to the plain world. It never throws into the
   session and never blocks it.

## Failure policy

Named, never silent. Every rejection states which rule and which beat or channel.
A broken world should fail at **load**, not mid-session.

## Testing rules

- **The fixture is the interface.** Do not wait on another component; read its blessed
  output from `fixtures/`.
- **The beats are input, never output.** `fixtures/beats/*.json` were generated once,
  curated, and blessed. Never regenerate them.
- **No test may call a model.** Nothing in a test path may import `src/claude.js` or spawn
  anything. `npm run check-fixture` is the shape to match: 30 checks, milliseconds, offline.
- **Never edit a fixture to make a test pass.** If the fixture is wrong, say so and stop.
- `npm run capture-fixture` is for a **deliberate** change, followed by reading the diff.
- `?fixture=max` runs the whole app with no model call, on zero quota.

## What "done" is not

Green tests you wrote against inputs you invented. Every scenario loads a fixture.
