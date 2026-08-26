# Longform — the continuous world

The third world. Cartoon is `paginated`, the visual novel is `scene-sequential`, this one
is `continuous`: every section is on the page at once and scrolling is the only movement.
No cast, no shipped art, and the only media in it is generated.

Read `Projects/Alexandria/Alexandria - World Spec.md` for the authoring surface and
`Alexandria - PoC Flow.md` for what this world exists to prove. Terms are fixed in
`Alexandria - Glossary.md`.

## What it proves that the other two could not

| | Cartoon | Visual novel | Longform |
|---|---|---|---|
| Archetype | paginated | scene-sequential | **continuous** |
| Controls | next, back | next | **none at all** |
| Cast | one mascot | two characters | **none** |
| Media | shipped art | shipped art | **generated, per beat** |
| Viewport | pinned aspect | aspect range | **none declared** |
| Overflow | splits | splits | **scrolls** |

The right-hand column is the point. Each row is a place the runtime could have been
secretly shaped like the first world, and three of them only became visible here.

## Read this before changing the plotter

> **The plotter guarantees the drawing is faithful to the spec. Nothing guarantees the
> spec is faithful to reality.**

This is the sharpest thing the world surfaced. Asked to draw water's density against
temperature — a curve that peaks at 4 °C — the model got the figure wrong five times
running, across two model tiers, in five different grammars:

| Attempt | Grammar offered | What came back |
|---|---|---|
| 1 | raw polynomial coefficients | a dip at x = 2 reaching 37 g/cm³, captioned as a peak at 4 |
| 2 | vertex form `a(x-h)² + k` | h = 4 and k = 1000 correct, units plausible, `a` positive — still a dip |
| 3 | direction in the shape's NAME (`peak` / `valley`) | chose `valley` |
| 4 | same, on Sonnet rather than Haiku | chose `valley` |
| 5 | direction DERIVED from two points, no direction to choose | avoided the shape entirely and picked `exponential`, which has no turning point at all |

All five ran with the reasoning budget at zero, which turned out to be the actual cause.

Every restructuring fixed something real, and each is worth keeping — implausible
magnitudes, hidden turning points and unrepresentable directions are all gone. None of
them fixed the direction being wrong.

### The cause was the reasoning budget, not the grammar

`src/claude.js` sets `MAX_THINKING_TOKENS: '0'`, justified by a measurement: with thinking
on a module took 138s, with it off ~15s at a quarter the cost, because "a channel-filling
call is not a reasoning task". That is true of prose and of an enum. It is **false of a
diagram spec**, which requires recalling the physics and then converting it into a sign
convention. Thinking was switched off for the one channel in the project that needs it.

Ten runs on the same question, scored by finding where the drawn curve actually attains
its maximum and asking whether that is 4 °C:

| Thinking | Runs | Correct | Wall | Cost |
|---|---|---|---|---|
| off (default) | 5, incl. one on Sonnet | **0** | 11–24s | $0.012–0.060 |
| on (`THINKING=6000 EFFORT=medium`) | 5, independent processes | **5** | 35–133s | $0.024–0.153 |

Every thinking-on run chose `turning` and peaked at exactly x = 4.

> **It is not a flag flip, because the setting is per process rather than per channel.**
> Buying a correct figure buys the prose the same latency, and the slowest run took 133s
> against a module whose own reading time is 129s — which breaks the no-dead-time
> guarantee that Gate 3 exists to protect. A world that is 90% prose pays a reasoning
> budget it does not need on every beat.
>
> The obvious resolutions are per-channel effort, or generating the figure in a second
> pass while the reader is already reading. Both are design decisions rather than fixes,
> so the default is left fast and `EFFORT` / `THINKING` are now env-overridable so the
> question can be measured rather than argued.

The residual risk is still real and still unclosed: nothing in the validator can check a
spec against physics, so a wrong figure that is internally consistent will always render
happily. Thinking moves the failure rate, it does not make the check exist. This remains
the sharpest instance of the confidence-laundering risk from `Alexandria - Open Questions`.

The figure in the golden fixture is **curated**: the prose, notes and ask line are
verbatim from one generation, and the figure was replaced by hand. `fixtures/beats/
longform.*.json` says so in its `_curated` field. It was blessed before the thinking
finding; regenerating it with thinking on would very likely need no hand correction.

## The grammar, and why it is shaped this way

The model emits a spec from a closed grammar; `public/plot.js` draws it deterministically.
The model never emits SVG, markup, or drawing instructions.

Three values in a figure are **derived rather than asked for**, and the reasoning is the
same each time — when a value can be computed from something the model is reliably good
at, asking for it only creates a way to be wrong:

- **The y range** comes from sampling the function, so a range that does not contain its
  own curve is not expressible.
- **A mark's label** is the coordinate the function actually has at that x, so a mark
  cannot be mislabelled.
- **A turning point's direction** comes from two points the model supplies, so a curve
  cannot contradict the direction it claims.

`SHAPES` in `public/plot.js` is the whole grammar, and `src/schema.js` imports it rather
than restating it. Adding a shape means an entry there and an arm in `evaluate`, and the
schema, the prompt and the validator all follow automatically.

## Three additions to the world-authoring surface

All three are declared per channel, steered from the manifest, and enforced from the same
declaration, which is the pattern `restrict` and `hold` already established.

- **`kind: "diagram"`** — the first channel whose value is an object rather than a string.
- **`optional: true`** — absence is meaningful rather than a failure to answer. The schema
  drops it from `required`, the validator skips it when absent, and the projector *clears*
  the slot rather than inheriting the previous screen's value. That last part matters: the
  normal rule is that an unmentioned slot keeps what it had, which for a figure would mean
  showing a graph of something the section is not discussing.
- **`atLeastOnce: true`** — measured, not theoretical. `figure` was optional and the first
  generation omitted it from all four beats, on a question whose entire subject is one
  quantity varying with another. An optional channel the model never uses is a channel
  that does not exist.

## Layout notes

- The scroller is **not** implemented in the projector. The presets sheet says a world may
  style `.stack`, so this world overrides it to `display: block; overflow-y: auto`. The
  projector's only job is that every screen exists at once.
- `:empty` on `.note` and `.figure` is load-bearing, not tidying — it is what keeps an
  omitted optional channel from leaving a hole. **The templates must therefore contain no
  whitespace inside those elements**: one space is a text node and `:empty` stops matching.
- The margin column is declared even when empty, so the measure never changes between one
  paragraph and the next.
- The rail is `data-persist`, so it is hoisted onto the stack and sticks above a scroller
  full of sections. It needs an explicit `z-index`, because the presets put persisted
  elements *below* screens and the article would otherwise scroll over the top of it.
- **No `viewport` is declared, deliberately.** Overflow is the archetype here rather than a
  failure, so a `minHeight` would scale a scroller down to fit content it is meant to
  scroll, and an aspect would letterbox an article. The measure is held by the column in
  `em`/`ch` instead. This world is the reason that block is optional.

> **Unlike the visual novel, this world's measure is font-independent.** The VN caps its
> line at 180 characters calibrated against a font it does not ship. Here the column is
> `34em` and the margin `13em`, both relative to whatever serif actually resolves, so the
> line length is correct in any font. Same problem, solved structurally rather than by
> bundling.

## Running it

```bash
WORLD=longform PORT=4190 npm start          # then open /?fixture=max
```

`?fixture=max` and `?fixture=min` render the blessed modules with no model call at all.

DOM snapshots live in `fixtures/dom/longform.{max,min,opening}`. A continuous world has no
next control, so the walk in `tools/capture-dom.md` does not apply: every screen is already
on the page, so one capture is the whole thing. **The absence of any `entering` file is
this archetype's contract**, in the same way the visual novel's missing backward snapshot
is its own.
