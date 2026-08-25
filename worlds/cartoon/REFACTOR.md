# Cartoon — build brief

For the session that turns this package from a design into a **running, verified
world**. Renamed from `streak` on 23 Aug 2026. Short on purpose: the concepts live
in the vault, this file holds only what you cannot infer from the code in front of
you.

## Read first

- `Projects/Alexandria/Alexandria - Glossary.md` — the vocabulary. `public/app.js`
  is the **projector**, not the runtime. Cartoon is a **world**. Do not invent synonyms.
- `Projects/Alexandria/Alexandria - World Spec.md` — archetypes, and the
  controls / readouts / slots split settled 23 Aug.
- `Projects/Alexandria/Alexandria - Rendering.md` — what a world may contain.
- `Projects/Alexandria/Alexandria - Design.md` — read it, then see the trap below.

## Where this stands

**Built and verified, 23 Aug 2026.** The module screen renders from real generations
and matches the Figma board (`ZL2pdd34bx6B39C2z4RC7o`).

Measured across five real runs, Haiku, browser-driven:

| | |
|---|---|
| Beats | 3–5 |
| Whole module | 4.2–24s (the 24s run paid a cold process start) |
| Repairs | **0 across every run** |
| Cost | $0.005–$0.027, climbing within a session — generator history still grows unbounded |
| Cover | COVERED on every run; reading 45–80s against generation 4–24s |

Verified in the browser, not asserted: back hidden on the first screen and present
after it, `next` disabled on the last, progress advancing `(at+1)/n`, both poses
reached, `considering` appearing only on a misconception beat, bundled Nunito loading
inside the shadow root, and no collision between the body card and the next control.

Length variance measured at both ends, on three unrelated subjects (hash tables,
quicksort, covalent bonding):

| | Line | Body | Result |
|---|---|---|---|
| Long | 80 chars (the cap) | 298 chars | No clipping, no overflow, **13px clearance** to the next control |
| Short | 22 chars | 46 chars | Boxes hug, tail still lands on her, composition holds |

> [!warning] 13px is a pass, not a margin
> That is the cap fitting *barely*, at one viewport, with a two-line `mascot_line`.
> A three-line line at the same body length would collide. The layout has no
> mechanism to prevent that — the split-to-next-screen rule is still the real fix.

Still designed-only: the **opening** and **boundary** question screens. Both are
screens with no beat behind them, and `src/paginate.js` maps beats to screens one to
one, so they need a beatless screen type first.

## What is settled

| | |
|---|---|
| Identity | `cartoon`. Flat-vector cartoon teacher, white ground, Duolingo-shaped |
| Archetype | `paginated` — control set is exactly **next** and **back** |
| Palette | White `#FFFFFF`, Swan `#E5E5E5` borders, Eel `#4B4B4B` text, Wolf `#777777`, Owl `#58CC02`, Tree Frog `#58A700` underside, Macaw `#1CB0F6`, Iguana `#DDF4FF` |
| Type | **Nunito** (SIL OFL), bundled in the package. Never Feather or din-round — licensed |
| Cast | One teacher, **two poses**, both raster |
| `illustration` | **Cut from the PoC.** Channel, asset set and slot all go |
| Checkpoint | Cut 23 Aug, applied to code, verified by a real run |
| Progress | A **readout**, not a control. Value arrives as `--progress`; the world's CSS decides what it looks like |

## What is still open — every item is pre-fixture

The golden fixture freezes structure *and content*. Everything here changes one or
the other, so all of it must land **before** the fixture is captured.

| Decision | State |
|---|---|
| `expression` values | Two, per Jordan 23 Aug. Implemented as `explaining` and `considering`; the names are still **mine, not confirmed** — renaming is a manifest edit plus two file renames |
| `body` cap | **Settled 24 Aug: keep 300, and it is the world author's to tune.** The cap is enforced by the schema, not merely steering, so overflow is *prevented* rather than handled — there is no overflow system to build. Measured: 80 + 300 needs a stage ~610px tall; the chrome has produced 583 to 720. Lower it to ~270 only if you commit to supporting 583. Nothing to build |
| `beats.min` / `max` | Still 3 / 6, and now means 3–6 **teaching** beats rather than 2–5 plus a quiz |
| Screen types | Only `module` is declared. The opening and boundary **question screens** are designed but undeclared |
| ~~Control + readout slots~~ | **Built and verified 23 Aug.** `data-slot="controls"` and `data-readout="progress"` are in the template, the projector renders the archetype's set into them, and the world's CSS dresses them |

> [!danger] The question screens are an invariant, not a Cartoon feature
> Jordan, 23 Aug: the first question and the last question hold across **every**
> archetype, because they are how the learning experience stays continuous. So they
> are not paginated's business and not this world's invention — they sit underneath
> all four archetypes.
>
> Ownership was settled the same day in `Alexandria - Design.md`: **the ask is a world
> slot, never chrome.** The runtime owns the input itself — focus, submit, and the
> guarantee that every boundary has one — which is forced anyway, since a world ships
> no code. The world owns *where it appears and what it is*: a character asking what
> you want next, a field in the margin, a line at the foot of a slide. A world that
> declares no ask slot gets a runtime-supplied fallback rather than a boundary the
> student cannot answer.
>
> So Cartoon's job is to declare the slot and dress it. It is not to implement an input.

## How the layout is built (24 Aug)

**Geometry is container-relative, type is not.** `.screen` declares
`container-type: size`, and every position and size is in `cqw` / `cqh` — percentages
of the stage the runtime hands the world — so proportions hold at any panel size.
Every number carries the 1368x772 board value it came from in a comment.

Type deliberately stays in pixels. The World Spec forbids shrinking type to make text
fit, so when type and geometry disagree the answer is to reflow or split, never to
scale the words. A mixed px/percentage layout was the earlier bug: horizontal values
matched the board while vertical ones drifted as the stage got shorter.

**Two knobs on `:host`.** `--scale` (0.9) sizes the cast and the controls; `--box`
(0.85) sizes the text cards. `1` on both reproduces the board exactly.

**The column is derived from the teacher, not placed independently:**

```css
left: calc(6.579cqw + 27.778cqw * var(--scale));   /* her left + her width + gutter */
top:  calc(91.192cqh - 70.078cqh * var(--scale));  /* her frame top + 10px          */
```

At `--scale: 1` those evaluate to 470 and 163 — the board's numbers. Which means the
"bubble top lines up with the top of her hair" relationship survives any scale change
instead of being a coincidence that was copied once.

## The `--scale` knob and the teacher's floor

Two things in `styles.css` that are easy to break by accident.

**`--scale` on `:host` sizes the whole composition.** `1` reproduces the Figma board
exactly; it currently sits at `0.9`. It drives the cast, both cards, their type, the
gutter and the next control. It deliberately does **not** drive the outer padding or
the progress readout, so shrinking the content leaves more air around it rather than
zooming the whole screen.

**Her feet sit on the button's floor, and the offset is not a constant.** The board
puts the button's underside 68px above the stage floor and her *frame* bottom at 55px
— the 13px gap is whitespace the asset carries below her shadow. That whitespace is a
fraction of her height, so it shrinks when `--scale` does:

```css
bottom: calc(68px - 1.684% * var(--scale));   /* 13/772 of the stage */
```

A plain percentage here drifts: `bottom: 7.12%` is right at a 772px stage and five
pixels high at 720. If the asset is ever re-cropped tight to her shadow, delete the
`1.684%` term rather than re-tuning it.

She is positioned absolutely for this reason — `align-self: flex-end` cannot reach
below the row, and a negative `margin-bottom` resolves percentages against *width*,
which is the wrong axis.

## The trap

`Alexandria - Design.md` specifies a terminal aesthetic: Tokyo Night Storm, Hack Nerd
Font, translucent surfaces. **That is the chrome, and a world must never inherit it.**
Those tokens are explicitly chrome-only. If Cartoon ends up looking like the platform,
the refactor has failed, because the entire point of a world is that it looks like
itself.

The inverse now also applies: `public/app.css` styles `button` with a bare element
selector in the old purple. Once controls move inside the shadow root that rule stops
reaching them — which is the point — but until then the running app shows a white
cartoon world wrapped in purple furniture.

## Hard constraints

- **A world ships no JavaScript.** Ever. If something needs code it belongs in the
  projector. This is what makes worlds reviewable and safe to install.
- Everything mounts in a shadow root, so `:host` is the styling entry point.
- Motion is declared in `world.json` and named by CSS class. The projector applies the
  class when a slot value changes; the world never animates itself.
- Honour `prefers-reduced-motion`. There is a block for it at the bottom of `styles.css`.
- Text must survive length variance. `mascot_line` can be 20 characters or 80, `body`
  can be 60 or 420. Nothing may overflow, shrink the type, or truncate.
- A world may **place** any subset of its archetype's controls and readouts. It may
  never add to that set, and it may never omit a required control.

> [!warning] Correction — assets are RASTER, not SVG
> An earlier version of this brief said assets are SVG. **That is false and was
> disproven on 23 Aug.** Figma returns an empty `svgAssets` array for this artwork and
> its "SVG" export is a 3.4MB base64-wrapped bitmap. The art is raster everywhere.
>
> The pipeline that works: trim to the alpha bounding box → scale to a common height
> → **anchor horizontally on the feet band (bottom 12%), not on the bounding box** →
> encode WebP q90. Anchoring on the bounding box makes an outstretched arm slide the
> body sideways, so the character visibly jumps when the expression changes mid-`pop`.
> Feet-anchored, 8MB of source becomes ~106KB for four poses.
>
> The file extension is declared per prefix in `world.json` under `assetFormat`, so
> the projector no longer assumes `.svg`.

## Runtime changes made for this world (24 Aug)

These are in `src/` and `public/`, not in the package, but they were made while
building Cartoon and a future session will wonder why.

- **`public/app.js` holds the node it appended** instead of `root.querySelector('.screen')`.
  The old lookup silently required every world to root its template at `class="screen"`;
  any other name and old screens piled up on every navigation.
- **Control `hidden` / `disabled` rules live in the `ARCHETYPES` map**, not in
  `syncControls`. They are archetype semantics — scene-sequential has no free back,
  continuous has neither control.
- **`src/paginate.js` takes the screen type from `pagination.screenFor`** instead of a
  hardcoded `'module'`. The policy is named (`one-beat-per-screen`, the only one since
  25 Aug) and an unknown policy or an undeclared screen type throws with the valid list.
- **`packageRelative()` in the projector** rewrites `url()` in a world's stylesheet to
  the package folder before injecting it into the shadow root. Without it, bundled
  fonts 404 silently — relative URLs in a shadow root resolve against the document.

> [!done] Resolved 25 Aug — the policy is gone, not guarded
> `two-beats-per-screen` used to paginate correctly while the projector rendered only
> the first beat of each screen, so it could silently drop content. It was left unguarded
> deliberately while the beats-per-screen question was open. That question is now settled:
> **1:1 is definitional for the PoC**, so the policy, its NOTE and the unreachable
> grouping branch are out of `src/paginate.js` and an unknown policy throws with the
> valid list. `screens[].beats` stays an array, so several-beats-per-screen remains a
> door rather than a redesign.

## Known leaks — the runtime still knows this world's vocabulary

Three places, same class of bug. None is this brief's job to fix, but do not make any
of them worse, and **do not silently rely on them**.

1. `public/app.js` → `assetUrl()` hardcodes the `mascot-` and `illo-` filename
   prefixes. Renaming an asset breaks rendering silently.
2. `public/app.js` → `render()` branches on literal slot names (`expression`,
   `illustration`). A world that names a slot anything else falls through to
   `textContent`.
3. ~~`src/validate.js` hardcodes the corrective/misconception rule~~ — **fixed 23 Aug.**
   Restrictions are declared per channel in the manifest (`restrict: { considering:
   "misconception" }`), read by both the validator and the system prompt. Proven by a
   unit check: the rule now fires on a wrong-kind beat instead of failing open.

Leaks 1 and 2 are also fixed: `assetUrl()` takes the set name from the channel's
`set`, and `render()` no longer branches on literal slot names. **No world's
vocabulary appears anywhere in `src/` or `server.js`.** The remaining convention is
the `<set>-<value>.<ext>` filename shape, which is now manifest-driven on both halves.

## Done looks like

- `npm start` runs, a **real generated module** renders, and it looks like the Figma
  boards rather than like the boards' ancestor.
- The look survives contact with real output: a 20-char `mascot_line` and an 80-char
  one, a 60-char `body` and one at the cap, across at least three unrelated subjects.
- Latency and repair rate re-measured after the schema change, and written down.
  Cartoon's numbers are not Streak's numbers.
- No JavaScript anywhere under `worlds/cartoon/`.
- No `illustration` remnants — channel, asset set, slot, motion entry, CSS.
- The world looks nothing like the platform chrome.

## Inventory

```
world.json              manifest: voice, channels, assets, motion, screens
screens/module.html     the only declared screen type
styles.css              ~30 lines, all of it replaceable
assets/mascot-*.webp    4 shepherd poses — WRONG CAST, to be replaced
assets/illo-*.svg       7 abstract shapes — being cut with the channel
assets/_retired/        the original placeholder SVG mascots
```

Source art for the real cast lives outside the repo, at
`Second Brain/Projects/Alexandria/Sample World/Cartoon World/Assets/` — two JPGs,
1408×768, near-white background, no alpha. They share an identical content band
(y 62–704), so one shared crop box aligns them without any feet-anchoring maths.

---

## Motion (24 Aug 2026) — built and verified

Option C from the animation discussion: **overlap plus persistence**, both built, because
the visual novel needs them anyway and building them twice was the only alternative.

### The mechanism, in one sentence

The projector **publishes state** onto the DOM and this world's CSS reacts to it. The
projector never plays an animation and never reads an animation name from the manifest.
Worlds ship no JavaScript, so a reactive language is the only kind they can speak.

| Published | Where | Values |
|---|---|---|
| `data-phase` | screen root | `entering` / `settled` / `leaving` |
| `data-nav` | screen root | `forward` / `back` |
| `data-kind` | screen root | the beat's kind, verbatim |
| `--motion-duration` | `.stack`, inherited | world-declared, scaled, then clamped |
| `data-changed` | any `[data-slot]` | present when the value differs from the last screen's beat |
| `--progress` | `[data-readout]` | already live |

`world.json` now declares **only a duration** (280ms). Every animation *name* lives in
`styles.css`. That deletes the whole class of silent name-mismatch bug the old
`motion.screen` / `motion.mascot` keys had.

### Persistence is the reason this looks alive

Three elements carry `data-persist` and are hoisted out of the per-screen lifecycle onto
the stack: **the teacher, the progress bar, and the control bar**. Verified by identity —
after a navigation they are the same DOM nodes, not lookalikes.

This is not cosmetic. A browser can only interpolate between two states of **one**
element, so before hoisting:

- the teacher was destroyed and rebuilt every navigation, so she visibly slid 26px with
  the text on every Continue;
- the progress bar's `transition: width` **had never once fired** — a fresh node has no
  previous width to animate from, so the fill jumped;
- any idle loop would restart from frame zero on every screen.

> [!warning] The stack, not the screen, is the size container
> Hoisting moves an element out of `.screen`, so it can no longer resolve `cqw`/`cqh` or
> absolute offsets against it. `.stack` is the projector's own element, is the size
> container, and is **the one projector-owned box a world may style**. Every measurement
> in `styles.css` still resolves against the same rectangle whether its element sits
> inside a screen or beside one. Do not put `container-type` back on `.screen`.

### Two bugs found by building it

**1. `entering` cannot end on the next frame.** The first draft flipped to `settled` in a
`requestAnimationFrame`. Because the animations come from selectors containing
`[data-phase="entering"]`, changing the attribute makes the rule stop matching,
`animation-name` reverts to `none`, and a half-played animation is **cancelled**. The
phase must also outlast the world's own delays, which the runtime cannot know. Fixed by
asking the browser: `settleWhenDone()` waits on `node.getAnimations({subtree:true})` and
caps with a timer. The same function drives removal of the outgoing screen, so a world
gets exactly as long as its exit takes and never longer than the 600ms ceiling.

**2. Cross-fading two texts in one cell is a double exposure.** Measured at the crossover:
both paragraphs at ~50%, both fully legible, reading straight through each other. Opaque
card backgrounds do not save it, because a 50%-opaque white card masks only half of what
is beneath. Fixed by **sequencing**: `--enter-lag` equals `--exit-dur`, so the old text is
gone before the new one starts and the overlap is exactly zero. Swept the full 380ms of
the transition at 5ms resolution — worst simultaneous legibility is 0.

> [!tip] Why a hard handoff does not stutter
> Normally sequencing reads as a stall. It does not here **because of persistence**: the
> teacher, the bar and the button are all still on screen. Only the text is ever in
> flight, so the frame is never empty. The two features pay for each other.

### What Cartoon's motion actually is

| Moment | What happens |
|---|---|
| Text leaves | bubble and card together, `ease-in`, 45% of the duration, no stagger |
| Text arrives | bubble at 45%, card at 60% — she says the line, the detail lands under it |
| Direction | `forward` slides from the right, `back` from the left |
| Misconception beat | `cartoon-settle` — no sideways travel, it settles into place, so the tricky beat reads different before a word of it is read |
| Pose change | `cartoon-pop` on the teacher, only when `data-changed` says the value actually changed |
| Progress | a real 450ms width transition, working for the first time |

Verified truth table (computed styles, not intent):

```
entering/forward/concept        cartoon-in-right  182ms  lag 126ms  card lag 168ms
entering/*/misconception        cartoon-settle    182ms  lag 126ms  card lag 168ms
entering/back/concept           cartoon-in-left   182ms  lag 126ms
leaving/forward                 cartoon-out-left  126ms  lag 0
leaving/back                    cartoon-out-right 126ms  lag 0
settled                         none
```

Note that `misconception` overrides direction even when navigating back. That is a
deliberate choice — "this one is different" was judged more useful than "you went
backwards" — and it is one line to reverse.

### Presets: Alexandria ships default motion

`public/presets.css` is injected into the shadow root **before** the world's stylesheet.
Both key on the same published state, so a world that writes nothing still cross-fades
acceptably and a world that writes something wins on cascade order. There is no
resolution logic anywhere in the projector — the browser's cascade is the resolver.
Cartoon overrides the default with one line, `.screen[data-phase] { animation-name: none }`,
which is the override story working end to end.

`prefers-reduced-motion` moved out of this world and into the presets, where it belongs:
it is a runtime accessibility feature, not something every world author must remember.
Verified that at zero duration content still lands visible rather than stranded at
opacity 0.

### Also verified

- Interruption: two rapid Continues leave exactly one live screen and one leaving screen,
  with no duplicated persisted elements.
- A `leaving` screen is `pointer-events: none`, so a fast second click cannot land on the
  dying screen's button.
- Stack order is `[persisted…, screens…]`, so persisted elements paint behind screens —
  which is what a visual novel's background and standing sprite will both want.

> [!danger] Verifying motion in a backgrounded tab is worthless
> Chrome does not fire `requestAnimationFrame`, throttles timers to a ~1s floor, freezes
> main-thread transitions, and eventually freezes the tab outright. Every early
> "finding" in this session was that, not a real defect. Verify by inspecting the
> animations the browser actually constructed (`getAnimations`) and by driving
> `currentTime` by hand, which is deterministic and does not care about visibility.

### Regression: persisting the controls made them unclickable (found + fixed 24 Aug pm)

Reported from real use: pressing Continue did nothing. Keyboard arrows and the chrome's
own buttons still worked, which localises it immediately to hit testing rather than to
navigation.

**Cause.** Hoisting moved `.controls` out of `.screen` and onto the stack, where the
projector inserts persisted elements *before* screens. Every stack child was positioned
with `z-index: auto`, so DOM order decided paint order, and the screen — appended last
and filling the whole grid cell — sat on top of the control bar. Hit testing ignores
backgrounds, so a fully transparent `<section>` is enough to swallow every click.

Proven, not inferred: `shadowRoot.elementFromPoint()` at the button's centre pixel
returned `section.screen`, with `button[next]` beneath it in the hit stack.

**Fix.** An explicit layering contract in `presets.css`:

```
.stack > [data-persist]         { z-index: 0; }   /* VN background, sprite, the teacher */
.stack > [data-phase]           { z-index: 1; }   /* screens */
.stack > [data-layer='controls'] { z-index: 2; }  /* always reachable */
```

Screens above persisted elements is the correct default — a visual novel's background and
standing sprite both belong behind the text. Controls are the exception, and deliberately
*not* left to the world: they are runtime-owned, and "the student can always press
Continue" is an invariant no world may break by accident. The projector stamps
`data-layer="controls"` on whichever hoisted element carries the controls slot.

> [!danger] `.click()` cannot detect occlusion — this bug passed every test I wrote
> The whole verification suite dispatched `element.click()`, which invokes the handler
> directly and bypasses hit testing entirely. A control that renders perfectly and is
> permanently unclickable is **indistinguishable from a working one** under programmatic
> clicking. Verify controls with real pointer events at real coordinates, or with
> `elementFromPoint`, and re-check the coordinates after anything that can change the
> viewport — a stale click point produces exactly the same symptom as the bug.

**Guard.** `assertControlsReachable()` now runs after every render: for each live control
it hit-tests the centre pixel and `console.warn`s if something else is on top, naming the
covering element. Verified adversarially — reintroducing the old stacking makes it fire
with `control "back" is not clickable — section.screen module is on top of it`, and it is
silent when healthy. This bug class cannot return quietly.

### The panel contract (25 Aug 2026)

`world.json` now declares `viewport: { minWidth: 1368, minHeight: 772, aspect: 1.772 }` —
the artboard, which is the honest answer, since that is the rectangle every measurement in
`styles.css` was derived from. Above it Cartoon is fluid. Below it the runtime hands the
world the artboard anyway and scales the result, so container units always resolve exactly
as verified. Verified at a 685×574 stage: layout box 1368×772, scale 0.50, letterboxed 94px
top and 93px bottom, no overlap, nothing clipped.

**Both axes matter, and it is counter-intuitive.** Type is fixed in px while `.column` is a
proportion of the panel, so a narrower panel wraps the same text into more lines and grows
the card. Measured with an 80-char line and 300-char body, both at cap — clearance to the
Continue control: `1368×772 → +104px`, `1100×640 → −5px`, `900×640 → −101px`. A height-only
floor would pass at one width and collide at another.

**Cartoon needed an aspect after all.** Declaring none says "I will use whatever shape you
give me". Satisfying two independent floors preserves the *screen's* aspect, not the
world's, so Cartoon received 1368×1145 and left a dead band under the text. Its composition
is anchored to a board, so it declares the board's aspect and is letterboxed.

Three bugs found while building this, all worth remembering:

- The server reads `world.json` once at startup. A manifest edit needs a restart, and the
  symptom is a field that is present on disk and absent in the projector.
- A flex item's default shrink silently undid the computed panel width, so `fitPanel`'s
  width never applied — and it invalidated a measurement sweep, which produced identical
  numbers across three widths and briefly looked like a real finding.
- **Centring must happen after scaling.** Flex alignment positions the *unscaled* box, so
  centring a 772px layout in a 572px host put its top at −100, and `transform-origin: top`
  then scaled from that offset. The panel rendered above the stage and the progress bar was
  clipped off-screen entirely. Fixed with an explicit `translateY` of the post-scale free
  space and `align-items: flex-start`.

`assertLayoutFits()` now runs after every render and warns when a filled slot overlaps a
live control or leaves the panel. It caught a genuine collision on real generated content
the first time it ran, before any synthetic test was written.

### Session memory, and a restriction kept on purpose (25 Aug 2026)

**The `history` array is gone.** `server.js` used to accumulate one headline per module
and inject "the student has already been taught X | Y | Z, do not repeat those beats" into
every later request. It was a lossy duplicate of context the model already had — the
adapter is one long-lived process, so prior modules are simply in the conversation — and
it had lost its scoping three ways at once: it spanned unrelated topics, it grew without
bound, and it recorded only the FIRST beat of each module while forbidding "those beats"
wholesale.

Measured before: a follow-up dropped from 4 beats to 3 and from ~10s to under 4s, because
the model had been told there was less left to say. Measured after: four questions in one
session — three unrelated plus one follow-up — all returned full 5-beat modules, with cache
reads climbing from 0 to ~16k tokens as the conversation was reused.

**Session memory is the conversation, and nothing else.** Verified: a bare "Give me one
more example of that", naming no topic, resolved against a recursion module three questions
earlier and built on it (memoization, when recursion is the wrong call) rather than
re-teaching the basics. That is strictly better than the array managed, because it is the
whole module rather than one headline.

Known limit, accepted for the PoC: the process *is* the session, so context grows without
bound and there is no way to start a fresh one except restarting the server. Session
boundaries are a real design question, deferred.

> [!important] `restrict` stays — the determinism is a DECISION, not a defect
> `expression.restrict` makes `considering` legal only on a misconception beat. Combined
> with the model reliably writing exactly one misconception per module, this makes the pose
> sequence a **deterministic function of the kind sequence**: one thinking sprite, once,
> wherever that beat lands. That was measured after Jordan noticed it, and it is being
> **kept for the proof of concept** (Jordan's call, 25 Aug).
>
> Do not "fix" this. Removing the restriction is a one-line manifest edit and it is
> deliberately not being made. The eventual answer is decision 3 from the expression-name
> options: stance names, three or four values, restricting at most one — which needs art
> and is therefore post-PoC.
>
> Note that the misconception beat no longer *depends* on the pose to read as special:
> `data-kind="misconception"` gives it the `cartoon-settle` entrance instead of a slide, so
> it is visually distinct before the pose registers at all.

### The ask screen (25 Aug 2026)

The boundary now has its own screen, and the same template serves cold-start stage 0.

**Why it is not a beat.** Every beat must satisfy one schema, and `mascot_line` declares
`mustBeClaim` — which a question fails by definition. So the ask line is a **module-level
channel**: it sits beside `beats` in the response rather than inside one. New manifest
concept, `world.module.channels`, mirrored in `schema.js` and `validate.js`. It carries
`mustAsk`, the mirror of `mustBeClaim`.

**Why the opening frame is not generated.** `Alexandria - Cold Start` stage 0 is "painted
locally with no model call at all" and never blocks; stage 2, the first half-module, is
"the only real wait in the product". A generated opening would move stage 0 inside stage 2
and delay first value, breaking the invariant everything else serves. So the session-start
line comes from the manifest (`ask_line.opening`), and any beat channel appearing on that
frame must declare an opening value too — `expression.opening` is `explaining`, because
there is no beat to take a pose from before the first module exists.

**Two contexts, one template.** `screens/ask.html` renders both the module's closing
screen and the opening frame. The only difference is where the line comes from.

Runtime pieces added:

- `pagination.closeWith` names the screen type appended after the last beat, carrying no
  beat and `fill` = the module's own values.
- Screens now carry `fill` — the beat for a beat screen, the module values for a beatless
  one — so the projector never asks which kind it is holding.
- **A slot the fill does not mention keeps its current value.** This is what lets the
  beatless ask screen inherit the persisted teacher's pose instead of blanking her `src`
  to `mascot-undefined.webp`, which is exactly what the first build did.
- `data-slot="ask"` receives a runtime-built input and submit. The world owns only where
  it sits; the runtime owns focus and submit, forced, since a world ships no JavaScript.
- The chrome's ask box is gone. `index.html` has an empty `#stage` — the world wraps the
  ask, per `Alexandria - Design`, and the chrome was contradicting that.
- Generating no longer blanks the stage. The world stays painted and `.stack` gets
  `data-busy`; blanking to a spinner would discard stage 0 at the moment it matters.

**Verified end to end.** Opening frame paints with no model call. A question generates a
4-beat module → 5 screens, progress 0.2 → 1, Continue hidden on the boundary, back kept.
The ask line references what was taught — "Now you know how the microphone erases noise.
What would you like to explore next?" — confirming it is emitted *after* the beats, which
mattered because schema order is not emission order. Submitting from the boundary loops
back to a fresh module, and a clarification request was answered by going back to
fundamentals. 0 repairs throughout, console clean.

> [!warning] Progress is position through a module, not through a session
> The opening frame is not in a module, so it reads zero rather than showing a full bar
> for something not yet written. `renderReadouts` checks whether any screen has beats.

### Five expressions (26 Aug 2026)

`explaining`, `considering`, `highlighting`, `cautioning`, `encouraging`. Three new poses
generated from `mascot-explaining.webp` via nano_banana_2, one movement per prompt, every
one run from the pristine original rather than from a sibling.

**The monotony was never caused by `restrict`.** With two values and `considering` limited
to misconception beats, a concept beat had exactly one legal pose — not a bad choice, no
choice. Adding three unrestricted stances fixed it without touching the restriction, which
stays as decided. Measured after: four distinct poses across five beats, and they land
sensibly — `highlighting` on the constant-time takeaway, `encouraging` on the closer.

**Assets are normalised to the shipped geometry, and this is not optional.** She persists
across screens, so any change in her size or footing between poses is a visible jump. The
content bounding box is the wrong anchor — a raised finger makes the box taller and would
shrink her body to compensate. The anchor used instead is **the top of her hair** (a
pose-invariant dark mass) plus the ground-plane centre of her shadow, scaling to match
*body* height. Caught a real defect: the `encouraging` generation rendered her 6.6% smaller
than the others. All five now land within 1px on hair top, feet and shadow centre.

> [!danger] An enum value must be a token the model reliably PRODUCES
> `emphasising` failed **every** generation with `error_max_structured_output_retries`.
> Bisected and confirmed in both directions: two values pass, five values with
> `emphasising` fail, the same five with `emphasizing` (z) pass. The model insists on the
> American spelling, that string is not in the enum, and the structured-output layer
> retries until it gives up.
>
> The error names nothing about enums, so this reads as a cap problem — the same misleading
> symptom already documented for `maxLength`. Renamed to `highlighting`, which has no
> spelling variant at all: depending on one model's preference is a fragility Alexandria
> cannot afford when the adapter is meant to be swappable.
>
> Generalises: prefer enum values with no common spelling variant, no hyphen/space
> ambiguity, and no plural/singular drift.
