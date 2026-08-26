# Contract: the projector

Owns `public/app.js` and `public/presets.css`. Written against `CONTRACT.md`, which is
given and is not edited here. Vocabulary is fixed in the vault note
`Alexandria - Glossary`; the motion design is `Alexandria - Rendering`, especially
"How a screen transition actually runs".

## Purpose

The projector executes a world package. It takes `{ world, screens, css }` from
`/api/world`, an array of screens from the paginator, and turns navigation into DOM.

It publishes state onto the DOM and the world's CSS reacts. It never plays an
animation and never reads an animation name from a manifest. `world.json` declares a
duration and nothing else about motion; every animation *name* lives in the world's
own stylesheet.

The division, in one line:

> **The projector owns WHEN things change. The world owns what that looks like. The
> archetype owns what controls exist.**

Each third is enforceable. "When" is `data-phase` / `data-nav` / `data-changed` and
the moment they flip. "What it looks like" is the world's stylesheet, cascading over
`presets.css`, with no resolution logic anywhere in between — the browser's cascade is
the resolver. "What controls exist" is the `ARCHETYPES` map at `app.js:19-42`, which a
world may place and dress but may not extend.

## Preconditions

Checked or relied on, in the order they are reached.

| # | Precondition | Where | On violation |
|---|---|---|---|
| P1 | `/api/world` returns `{ world, screens, css }`; `world.name` is a string | `app.js:57-60` | unhandled rejection, nothing paints |
| P2 | `world.archetype` is a key of `ARCHETYPES` | `app.js:62-63` | **throws** `unknown archetype "<x>"` at module load |
| P3 | `templates[t]` exists for every screen type the paginator emits | `app.js:394` | paginate already rejects an undeclared type, so unreachable from a valid load |
| P4 | `world.pagination.closeWith` names a declared template, for stage 0 only | `app.js:526-527` | returns `false`, status line, **no world painted at all** |
| P5 | every channel appearing on the opening frame declares `opening` | `app.js:530-533` | slot is simply never filled; an asset slot renders `src=""` |
| P6 | `screen.fill` is an object, and slot names are own keys of it | `app.js:392-393`, `238-243` | see "What the projector relies on `fill` for" below |
| P7 | a channel with `set` has an `assetFormat` entry for that set | `app.js:189` | **silently** falls back to `.svg` and 404s |
| P8 | `#stage`, `#worldname`, `#progress`, `#back`, `#next`, `#metrics` exist in the chrome | `app.js:11-12, 413-415, 519, 548-553` | `TypeError` on the first render |

P2 and P4 are the two load-time failures, and both are correct per the failure policy:
a broken world fails at load rather than mid-session. P7 is the one precondition that
fails **silently**, which contradicts "Named, never silent" — recorded under bugs.

## Postconditions

After `render(nav)` returns, for `screens[at]`:

1. `stack` has at most two `[data-phase]` children: exactly one `entering`, and at
   most one `leaving`. Never two of either.
2. The entering node is the last `[data-phase]` child, and every `[data-persist]`
   element precedes every `[data-phase]` element in DOM order.
3. The entering node carries `data-phase="entering"`, `data-nav` equal to the
   navigation direction, and `data-kind` iff `fill.kind` is truthy.
4. `stack.style` carries `--motion-duration` in `ms`, clamped and scaled.
5. Every `[data-slot]` in scope whose key is present in `fill` and differs from the
   previous screen's `fill` carries `data-changed`; every other in-scope slot has had
   any stale `data-changed` removed.
6. Every control the archetype declares exists exactly once per `[data-slot="controls"]`
   element, with `hidden` / `disabled` synced to `at` and `screens.length`.
7. Every `[data-readout="progress"]` in scope carries `--progress`.
8. Three self-checks have run and warned or stayed silent.

Later, asynchronously: the entering node becomes `settled` when its subtree's
animations finish or at `MOTION_CEILING_MS * 3`, whichever is first; the leaving node
is removed when its animations finish or at `MOTION_CEILING_MS`, whichever is first.

### Which of the six invariants the projector owns

| Invariant | Owned? | How it discharges here |
|---|---|---|
| 1. Coverage | Downstream half | Renders `screens[at]` by index, never filters or merges. Every index `0..n-1` is reachable: `back` is hidden only at `0`, `next` disabled only at `n-1` |
| 2. Order | Downstream half | `go(delta)` moves `at` by ±1 within bounds and nothing else reorders. Screen order *is* array order |
| 3. Purity | **No — and correctly not** | The contract scopes purity to `src/`. This is browser code and legitimately uses `matchMedia`, `ResizeObserver`, `requestAnimationFrame`, timers, `getAnimations` and `performance.now`. Its analogue is *capture determinism*: same fixture, same window, byte-identical `fixtures/dom` — verified across two runs on 26 Aug |
| 4. Genericity | **Owned, and most at risk here** | See below |
| 5. Containment | Owned for assets, half-owned for CSS | `assetUrl` composes `/worlds/{world.id}/assets/{set}-{key}.{ext}` (`app.js:187-191`), so an asset path is package-relative by construction and a world cannot express one that is not. `packageRelative` (`app.js:80-83`) rewrites relative `url()` in the world stylesheet into the package and leaves `data:`, `http(s):`, `//` and `/` alone — it *contains* but does not yet *reject*, which the comment says is where the rejection will live |
| 6. Degradation | Half-owned, half missing | Nothing about a bad beat throws: an unmentioned slot keeps its value (`app.js:240`), a slot naming no channel falls through to `textContent`, a failed generation sets a status line and leaves the world painted (`app.js:504`). But "falls back to the plain world" has no implementation — `data.degraded` only prints a sentence (`app.js:515`) and no plain world exists in `worlds/`. Recorded as a gap, not a defect of this lane |

### Invariant 4, verified rather than claimed

The check is: no world's channel name, asset name, screen type or id appears in the
projector's source. Run as a literal grep it is unusable, because Cartoon named its
screen types `module` and `ask` — both of which are platform words that the projector
uses for its own concepts. So the check was run as a program, not a `grep -F`:

- extract every world-owned identifier from both manifests — `id`, `name`, channel
  names, module-channel names, asset set names, asset value names, `assetFormat` keys,
  screen type names, `screenFor` values, `closeWith`, beat kinds, enum values. **42
  distinct terms.**
- match each as a whole word (no identifier or hyphen character on either side)
  against `public/app.js` and `public/presets.css`.
- run it twice: once over the raw files, once with `//` and `/* */` comments stripped,
  so prose that *names* a world for the reader is separated from code that *depends*
  on one.

Raw files: 11 file-level hits, all but three of them inside comments — `Cartoon`,
`cartoon`, `background`, `face`, `line`, `smile`, `speaker_body` appear only in
explanatory prose (`app.js:183-185`, `194`, `216`, `349`, `523`; `presets.css:42`,
`44`). Comments naming a world as an example are documentation, not coupling.

Executable lines: **three hits, all homonyms, zero couplings.**

| Term | Executable occurrences | Verdict |
|---|---|---|
| `ask` | `app.js:236, 252, 257, 262, 337, 540` | The runtime's own slot name `data-slot="ask"` and the `data-ask` attributes it builds. Both worlds *also* named a screen type `ask`, but the projector never resolves a screen type by literal: it reads `world.pagination.closeWith` and indexes `templates[screen.type]`. Homonym |
| `body` | `app.js:67, 68, 499` | `document.body` and the `body:` key of a `fetch` init. Cartoon has a `body` channel and the visual novel a `body` asset set; neither is referenced. Homonym |
| `module` | `app.js:179, 490, 497, 531` | `world.module.channels` (a platform manifest key), the `/api/module` route, and a status string. Cartoon also named a screen type `module`. Homonym |

**Behaviour is generic.** The two worlds are structurally dissimilar — paginated
against scene-sequential, a pinned artboard against an aspect range, one enum channel
against split sprites with a `keyedBy` composed key, controls hoisted onto the stack
against controls living inside the screen, a progress readout against none — and both
render through the same code path with no branch keyed on either. Per
`fixtures/README.md`, that does not *prove* genericity; it falsifies the lack of it.

Two reserved names are the standing hazard, and they are not in `CONTRACT.md`: a world
that names a **channel** `ask` or `controls` will never see that slot filled, because
`fill` and the `data-changed` pass both skip those two keys unconditionally
(`app.js:236`, `app.js:337`). The collision is currently harmless only because neither
world does it.

## The published vocabulary

`CONTRACT.md` fixes this list, and it is the entire language a world can speak. Where
each value is set:

| Published on | What | Values | Set at |
|---|---|---|---|
| the screen | `data-phase` | `entering` | `app.js:319` (`publish`) |
| | | `settled` | `app.js:352`, in the `settleWhenDone` continuation |
| | | `leaving` | `app.js:378` (`retire`) |
| the screen | `data-nav` | `forward`, `back` | `app.js:320` for the entering node, `app.js:379` for the leaving one — both get the *same* direction, which is why an exit can be directional |
| the screen | `data-kind` | the beat's kind, verbatim | `app.js:321`; deleted when `fill.kind` is falsy, which is exactly the beatless closing screen |
| the stack | `--motion-duration` | clamped, scaled ms | `app.js:325`, value from `motionMs()` at `app.js:70-74` |
| any `[data-slot]` | `data-changed` | present / absent | cleared `app.js:331`, set `app.js:342` |
| any `[data-readout]` | a custom property | `--progress` | `app.js:304`, value `(at+1)/screens.length` at `app.js:302`, or `0` when no screen has beats |

`data-persist="<key>"` is declared by the world and honoured at `app.js:209-231`.

### Four things the projector publishes that the table does not list

Reported, not resolved — `CONTRACT.md` is given.

- **`data-layer="controls"`** on a hoisted element carrying the controls slot
  (`app.js:224`). `presets.css:54` keys on it. It is load-bearing: it is the fix for
  the regression where a transparent full-cell screen swallowed every click.
- **`data-busy`** on the stack during generation (`app.js:494`, cleared `app.js:503`).
  Cartoon's stylesheet keys on it (`styles.css:391-392`) to dim the ask input, so it is
  already part of the language two worlds speak.
- **`data-control="<name>"`** on each built button (`app.js:285`), plus the native
  `hidden` and `disabled` attributes. Both worlds style `[data-control=…]`. The
  archetype and its control set appear nowhere in `CONTRACT.md` at all.
- **`data-built="1"`** on a slot the projector has already populated (`app.js:253`,
  `281`). Internal bookkeeping, but it is in the DOM and therefore in every blessed
  snapshot, so it is pinned whether or not it was meant to be.

A world can and does react to these. Either the table grows or these move behind
something private; both are changes to `CONTRACT.md`, so neither is made here.

### What the projector relies on `fill` for

The paginator sets `fill` to the beat on a beat screen and to **the entire module
object** on the beatless closing screen — which carries `beats`, `_world`, `_question`,
`_model` and `_curation` alongside `ask_line`. The projector reads it in exactly four
ways and never enumerates it:

1. `values.kind` (`app.js:321`) — for `data-kind`.
2. `key in values` (`app.js:240`, `app.js:338`) — the presence test that makes an
   unmentioned slot keep its current value.
3. `values[key]` (`app.js:242-243`) — the value for a slot named `key`.
4. `values[ch.keyedBy]` (`app.js:188`) — one channel's value used to compose another's
   asset key.

So the reliance is: **`fill` is an object whose own keys include every slot name that
should be painted on this screen, and whose `kind` is present only on a beat screen.**
Nothing reads the extra keys, and nothing iterates them.

That makes narrowing `fill` on the closing screen to just the module's declared
channels **safe**, and it would remove a latent hazard: today, a world that declared a
channel named `beats` would have that slot filled with `String(Array)` on the ask
screen. It would also not move a single blessed byte, because the extra keys — `beats`,
`_world`, `_question`, `_model`, `_curation` — are not slot names in either world, so
neither the fill pass nor the `data-changed` comparison against `prev` touches them.
Narrowing is the paginator's call, not this lane's; this section exists so that call
can be made without re-deriving the reliance.

## `data-persist` hoisting

`hoist(node)` runs at `app.js:396`, **before the fresh screen node is ever in the DOM**.
For each element in the new template carrying `data-persist`:

- it is removed from the screen unconditionally — it never belongs to a screen;
- if the key is already live, the fresh copy is discarded and the live node is kept;
- otherwise the fresh node is inserted before the first `[data-phase]` child of the
  stack, or appended if there is none, which is what keeps persisted elements ahead of
  screens in DOM order forever;
- if it carries or contains `data-slot="controls"`, it is stamped `data-layer="controls"`;
- any key the incoming screen no longer declares is removed from the stack and forgotten.

Two consequences worth writing down. First, a persisted element's **identity is its
key and its markup is whichever template introduced it first** — if two templates
declare the same key with different attributes, the second one's attributes never
apply. Second, the persisted elements are filled *before* the outgoing screen is marked
`leaving`, so during the overlap the persisted teacher already shows the **new** pose
while the old screen still shows the old text. This is visible in every
`*-entering-forward.html` and it is why `Alexandria - Rendering` says to animate
opacity on new nodes and transform on persisted ones: there is no outgoing image to
blend against.

### Why the snapshot subject is the stack and not the screen

Because after hoisting, the interesting state is on the **siblings** of the screen, not
inside it. In Cartoon, the teacher, the progress readout and the entire control bar are
all persisted, so a serialised `.screen` is `<section class="screen module">` wrapping a
text column and nothing else. Missing from it: `data-persist` itself, `data-layer`,
`--progress`, the resolved `mascot-*.webp` src, `data-changed` on the pose, and the
whole archetype control set with its `hidden` / `disabled` state.

The regression a screen-level snapshot would fail to catch is **loss of element
identity**. If the projector kept removing persisted elements from the screen but
rebuilt them as fresh nodes on every navigation, the screen's own serialisation would be
byte-for-byte identical — the screen never contains them in either case — and the
snapshot would stay green while:

- the progress bar's `transition: width` stops firing, because a fresh node has no
  previous width to interpolate from. `worlds/cartoon/REFACTOR.md` records that this
  transition "had never once fired" before hoisting existed;
- the teacher's `cartoon-pop` on `data-changed` stops being a pose change and becomes a
  full redraw, and she visibly slides 26px with the text on every Continue;
- any idle loop restarts from frame zero on every screen.

A second regression it would miss entirely: the archetype contract. Cartoon's controls
are hoisted, so back-hidden-at-zero and next-disabled-at-the-end are **not present in
the screen at all** and could not be pinned by a screen snapshot at any index.

A third: the two-node overlap. A screen-level snapshot holds one screen by
construction, so the leaving/entering pair that the whole motion design rests on has
nowhere to appear.

### Hoisting and container units

`presets.css:30-35` makes `.stack` `display: grid`, `height: 100%`, `container-type: size`,
with `.stack > * { grid-area: 1/1 }`. That is deliberate and it is a hoisting
consequence, not a layout preference: moving an element out of `.screen` changes what
`cqw`/`cqh` and absolute offsets resolve against. Putting `container-type` on `.screen`
would give a hoisted element a different rectangle from an unhoisted one and silently
break every measurement in a world's stylesheet. Neither world sets `container-type`;
both comment on it. **`.stack` is the one projector-owned box a world may style**, and
the capture normalises its inline `width`, `height`, `transform` and `transformOrigin`
out precisely because those are a fit to whatever window was open — while keeping
`--motion-duration`, which is published state.

## The two-node overlap

The old screen must still exist for an exit to be visible. `render` (`app.js:391-419`)
does, in order:

1. `hoist(node)` — before the node is attached.
2. fill, controls, ask, readouts over `scopes = [node, ...persisted.values()]`.
3. if a `leaving` node exists, **remove it synchronously**.
4. `retire(current)` — the old node becomes `leaving` with this navigation's `data-nav`.
5. `stack.append(node)`.
6. `publish(node, …)` — the new node becomes `entering`.
7. `current = node`, `syncControls`, `prev = values`.

Removal of the leaving node is whichever of these lands first:

- every animation and transition in its subtree finishing, discovered by
  `node.getAnimations({ subtree: true })` inside a `requestAnimationFrame` so styles
  have resolved (`app.js:360-372`);
- a `setTimeout` at `MOTION_CEILING_MS` (600ms).

The rAF is what lets the animations exist to be found; the timer is what stops a
backgrounded tab — where rAF never fires — from stranding a dead screen over a live one.

**The interruption rule.** Interruption is always the runtime's, never the world's.

> A second navigation, at any time, hard-removes whatever is currently `leaving`
> without waiting for its exit, then retires the current screen in its place. At most
> one screen is ever leaving. A world cannot survive an interruption and cannot opt out
> of one.

Three mechanisms hold it: `leaving` is a single reference, not a list, so there is
nowhere for a second dying node to go; `retire`'s continuation checks `leaving !== node`
and no-ops if a newer navigation took the slot (`app.js:385`); and `publish`'s
continuation checks `node.isConnected && node.dataset.phase === 'entering'`
(`app.js:352`), so a node that was retired or removed before it settled is never
flipped to `settled` behind the runtime's back. `presets.css:58` completes it:
`[data-phase='leaving'] { pointer-events: none }`, so a fast second Continue cannot
land on the dying screen's button.

Note the asymmetry in the caps, because it is a real bound and not an oversight:
`retire` caps at `MOTION_CEILING_MS` (600ms) while `publish` caps at
`MOTION_CEILING_MS * 3` (1800ms). The entering cap is longer because the runtime cannot
know a world's delays — Cartoon staggers its card 60% of the duration behind its
bubble — and a phase that ends on the next frame **cancels** the animation it triggered,
since the rule that started it selects on `[data-phase="entering"]`. See "disagreements"
for what that does to the ceiling as a guarantee.

## The archetype map

`ARCHETYPES` at `app.js:19-42` is runtime knowledge. It decides which controls and
readouts exist; the world decides where they sit and what they look like.

| Archetype | Controls | Predicates | Readouts |
|---|---|---|---|
| `paginated` | `back` (`required: false`, `step: -1`), `next` (`required: true`, `step: +1`) | `back.hidden = at === 0`; `next.disabled = at >= count - 1` | `['progress']` |
| `scene-sequential` | `next` only (`required: true`, `step: +1`) | `next.disabled = at >= count - 1` | `['progress']` |

The predicates live in the map rather than in `syncControls` because they are
*archetype semantics*, not sync mechanics. And the difference between the two rows is
the point: **scene-sequential has no back control at all — not hidden, not disabled,
absent.** Four separate places make that true, because three of them were once wrong:

- `renderControls` builds only from `Object.entries(archetype.controls)` (`app.js:282`);
- the chrome's fallback button is hidden by `!archetype.controls.back` (`app.js:553`);
- its click handler is guarded by the same test (`app.js:549`);
- the `ArrowLeft` key binding is guarded too (`app.js:560`).

`worlds/cartoon/REFACTOR.md` records why: `app.css` only hid the footer *button*, and
the handler and the key binding both survived that — so a world whose entire contract
is "forward only" could still be walked backwards.

### What a world may and may not do with controls

**May.** Place `data-slot="controls"` anywhere in any template, including inside its
own dialogue box — the visual novel does exactly that while Cartoon persists a control
bar on the stack. Place it on a persisted element, in which case the buttons are built
once and hover and `:active` survive navigation. Place none at all, in which case the
chrome's fallback footer buttons stay visible via the `world-controls` body class
(`app.js:67`). Style `[data-control="back"]`, `[data-control="next"]`, `[hidden]` and
`:disabled` freely; give a control any label, any glyph, any size. Hide one with CSS —
Cartoon hides `next` on the closing screen with `display: none`, which the self-checks
tolerate because a `display: none` element has a zero rect and is skipped.

**May not.** Add a control the archetype does not declare: a hand-written
`<button data-control="skip">` in a template gets no click handler (handlers are bound
only in `renderControls`) and no state sync (`syncControls` looks up
`archetype.controls[name]` and `continue`s on a miss, `app.js:311`), so it is inert
furniture. Change a control's step, predicate or meaning. Reorder them relative to the
map — `replaceChildren` writes them in `Object.entries` order every time. Rely on a
control existing that its archetype does not declare, which is the whole reason
scene-sequential's absence is absence rather than `hidden`.

**Documented but not enforced.** `required: true` on `next` is read by nobody. Nothing
verifies that a world which declares a controls slot actually renders the required
control, and nothing verifies `readouts` either — `renderReadouts` hardcodes the string
`'progress'` (`app.js:304`) and never consults `archetype.readouts`. The "student can
always press Continue" guarantee is therefore delivered by the chrome fallback, not by
a check. Recorded under bugs.

## Motion clamping

```
MOTION_CEILING_MS = 600      app.js:47
MOTION_FLOOR_MS   = 80       app.js:48
SPEED             = 1        app.js:49
reduced = matchMedia('(prefers-reduced-motion: reduce)')   app.js:50
```

```js
function motionMs() {
  if (reduced.matches) return 0;
  const declared = world.motion?.duration ?? 240;
  return Math.min(Math.max(Math.round(declared * SPEED), MOTION_FLOOR_MS), MOTION_CEILING_MS);
}
```

Read outward: the world declares, the speed setting scales, the clamp lands **last** so
the ceiling is a real ceiling. Motion is never allowed to be the reason a beat was slow
to arrive. Reduced motion short-circuits to `0` *before* the floor, so the floor cannot
resurrect 80ms of animation for someone who asked for none.

| Input | `--motion-duration` |
|---|---|
| Cartoon, `motion.duration: 280` | `280ms` — blessed in every `fixtures/dom/cartoon.*` root |
| Visual novel, `motion.duration: 260` | `260ms` — blessed in every `fixtures/dom/visual-novel.*` root |
| a world declaring nothing | `240ms` |
| a world declaring `1200` | `600ms` |
| a world declaring `40` | `80ms` |
| any world, reduced motion | `0ms` |

The value is set on **`.stack`, not the screen** (`app.js:325`), so hoisted siblings
inherit it as well as screens. A persisted element that is not inside any screen still
needs the duration; if it were published on the screen it would not have one.

Reduced motion has a second belt in `presets.css:77-82`, which forces every animation
and transition in the shadow root to 1ms with `!important`. Two belts because a world
should not have to remember to write the first one, and because a world's own keyframes
would otherwise run at their authored duration regardless of `--motion-duration`.

**`SPEED` is a constant `1`, and that is deliberate debt, not a gap.** The scaling term
is in the formula, applied in the right place, and clamped afterwards, so wiring a
user-facing speed control is a one-line change with no design left to do.
`Alexandria - Rendering` lists a global speed control as a runtime feature for
accessibility and for "a student in deadline mode who will resent 400ms on every beat";
what is missing is a chrome surface to set it, and the chrome is not this lane's file.
Do not report the constant as an unfinished clamp.

## The self-checks

Three, all running after every render, all `console.warn` and never a throw — a
diagnostic that blocked a session would violate invariant 6.

### 1. A slot overflows the panel — `assertLayoutFits`, `app.js:440-446`

For every filled `[data-slot]` other than the controls slot, with a non-zero rect: warn
if `r.bottom > panel.bottom + 1`, `r.top < panel.top - 1`, or `r.right > panel.right + 1`,
where `panel` is `stack.getBoundingClientRect()`. The message reports the overflow in
pixels, the panel height, and the world's declared `minHeight`, so the reader can tell
"this world was given a box it never verified in" apart from "this text does not fit in
the box it declared".

It exists because a world declares `viewport` as a box it was designed against and the
runtime's job is to satisfy it. The fixture is built to reach this check: the `.max`
modules pin their text to the exact channel caps, because each manifest's
`viewport._measured` calibrated panel clearance *at the caps*.

### 2. A slot overlaps a control — `assertLayoutFits`, `app.js:447-454`

Rect intersection between each filled slot and each **live** control (not `hidden`, not
`disabled`). This is the failure that actually broke Cartoon's layout: a body card
growing until it met the Continue pill, content and controls occupying the same pixels.
It is world-agnostic and checkable, and it caught a genuine collision on real generated
content the first time it ran, before any synthetic test existed.

### 3. A control is not clickable — `assertControlsReachable`, `app.js:463-476`

For each live control with a non-zero rect, `root.elementFromPoint` at the centre pixel;
warn unless the result is the control or a descendant of it, naming the covering
element.

**Why `element.click()` cannot detect occlusion.** `.click()` synthesises an event and
dispatches it directly at the target, invoking the handler. It performs no hit testing
at all. A control that renders perfectly and is permanently unclickable is therefore
*indistinguishable from a working one* under programmatic clicking — which is exactly
how a full-cell transparent screen was allowed to cover the whole control bar
unnoticed: hit testing ignores backgrounds, so a transparent `<section>` swallowed every
click while the entire verification suite stayed green. The fix was the layering
contract in `presets.css:46-54`; this check is the guard that stops the bug class
returning quietly. Note it uses the **shadow root's** `elementFromPoint`, not the
document's — the document's would return the host element for every point.

## Failure modes

| Failure | Behaviour | Named? |
|---|---|---|
| Unknown archetype | `throw new Error('unknown archetype "<x>"')` at module top level (`app.js:63`). Module evaluation aborts, so nothing renders at all — including stage 0 | Yes, at load |
| No `closeWith`, or it names an undeclared template | `openingFrame()` returns `false`; status reads `world declares no ask screen; nothing to paint at stage 0`; the stage stays empty until a module arrives | Yes |
| `/api/module` fails or returns no `screens` | `setStatus('generation failed: …')`; `data-busy` cleared; **the world stays painted**. Blanking the stage to a spinner would discard cold-start stage 0 at exactly the moment it matters | Yes |
| Validation still failing after repairs | Renders the degraded screens and appends `DEGRADED: … the plain world would take over` to the status | Named, but the fallback does not exist |
| A slot names no channel | Falls through to `textContent = values[key] ?? ''` and never marks `data-changed` (`app.js:337`) | **No — silent** |
| A channel has `set` but no `assetFormat` entry | `?? 'svg'` and a 404 image | **No — silent** |
| Second navigation mid-transition | Leaving node hard-removed, no warning. This is the interruption rule working, not a failure | n/a |
| Second ask while generating | `busy` guard returns silently (`app.js:488`) | No, and harmless |

The unknown-archetype throw is the one failure site in this component that cannot be
reached from Node, because the projector is browser code that runs at module load with
a live `fetch` and a shadow root. It is therefore recorded under `_browserSide` in
`fixtures/hostile/cases.json` rather than in `cases`, which is why
`check-fixture`'s completeness rule — every `throw new Error` in `src/` and every
`failures.push` in `validate.js` has a case — stays at 30 and stays honest. Reaching it
needs a world with a bad manifest and a page load.

## What can be checked where

The DOM snapshots cannot be verified from Node, because producing them requires
rendering. That gives every scenario below one of two homes, and the distinction is not
a formality:

- **Node.** Reads blessed artefacts — `fixtures/dom/**/*.html` as text,
  `fixtures/{world}/screens.{variant}.json`, `worlds/{id}/world.json` — and asserts the
  contract holds over them. Offline, milliseconds, no model, no browser, no spawn.
  What it catches: a blessed snapshot that was re-captured into a state the contract
  forbids. What it does **not** catch: the projector drifting away from the snapshot.
- **Browser.** Needs a rendered page. The procedure is `tools/capture-dom.md`:
  `SNAPSHOT=1 PORT=4173 WORLD=cartoon npm start` and `PORT=4180 WORLD=visual-novel`,
  then open each of `4173/?fixture=max`, `4173/?fixture=min`, `4180/?fixture=max`,
  `4180/?fixture=min` and run the capture from the console. **The check is that
  `git diff fixtures/dom` is empty afterwards.** Verified byte-identical across two runs
  on 26 Aug; if a run ever differs, suspect the settle step before suspecting the
  projector.

`?fixture=<variant>` is how every scenario drives the app: the module comes from
`fixtures/beats/` and **no model call happens at all**, so the whole suite runs on zero
quota against a stable subject.

## BDD scenarios

Twenty-two. Every one is judged against a blessed artefact by path; none constructs
input inline. **Fourteen run in Node, eight need a browser.**

Each `[Node]` scenario may additionally be re-derived by the browser suite; the tag
records the *minimum* it needs.

---

### Settled state, both worlds, both beat bounds

**S1 — a paginated beat screen settles with the beat's kind. [Node]**
GIVEN `fixtures/dom/cartoon.min/00-settled.html`
AND `fixtures/cartoon/screens.min.json[0]`
WHEN the snapshot's single `[data-phase]` element is read
THEN it is `section.screen.module` with `data-phase="settled"`, `data-nav="forward"`,
`data-kind="concept"`
AND `[data-slot="mascot_line"]` and `[data-slot="body"]` hold that screen's `fill` text
verbatim
AND `[data-slot="expression"]` resolves to `/worlds/cartoon/assets/mascot-explaining.webp`
from `fill.expression` and the manifest's `assetFormat.mascot`.

**S2 — the same, at the maximum beat bound. [Node]**
GIVEN `fixtures/dom/cartoon.max/05-settled.html` and `fixtures/cartoon/screens.max.json[5]`
WHEN the snapshot is read
THEN it settles identically, with `--progress: 0.8571428571428571` = `(5+1)/7`
AND the directory holds exactly seven `NN-settled.html` files, `00` to `06`, matching
the seven entries of `screens.max.json` — six beats at the declared `beats.max` plus the
closing screen.

**S3 — a scene-sequential beat screen settles, same code path. [Node]**
GIVEN `fixtures/dom/visual-novel.min/00-settled.html` and
`fixtures/visual-novel/screens.min.json[0]`
WHEN the snapshot is read
THEN it is `section.screen.scene`, `data-phase="settled"`, `data-kind="concept"`
AND `[data-slot="speaker_body"]` is `body-hana.webp`, `[data-slot="background"]` is
`background-classroom-day.webp`
AND `[data-slot="speaker_face"]` is `face-hana-normal.webp` — the `keyedBy` composition
`{speaker_body}-{value}`, resolved from the manifest with no world name in the projector.

**S4 — the visual novel at its maximum bound. [Node]**
GIVEN `fixtures/dom/visual-novel.max/` and `fixtures/visual-novel/screens.max.json`
WHEN the directory is listed
THEN it holds `00-settled.html` to `06-settled.html`, seven screens for six beats plus
the close, the same arithmetic as S2 in a structurally dissimilar world.

**S5 — the beatless closing screen carries no `data-kind`. [Node]**
GIVEN `fixtures/dom/cartoon.min/03-settled.html` and `fixtures/dom/visual-novel.max/06-settled.html`
AND the corresponding `screens.{variant}.json` last entries, whose `fill` has no `kind`
WHEN each snapshot's screen element is read
THEN it is `section.screen.ask` with `data-phase="settled"` and `data-nav="forward"`
AND it has **no** `data-kind` attribute at all
AND it contains the runtime-built ask: `[data-slot="ask"][data-built="1"]` wrapping a
`form` with `input[data-ask="input"][aria-label="What do you want next?"]` and
`button[data-ask="submit"]`
AND `[data-slot="ask_line"]` holds the module channel's value.

**S6 — a slot the fill does not mention keeps its value. [Node]**
GIVEN `fixtures/dom/cartoon.min/02-settled.html` and `03-settled.html`
AND `screens.min.json[3].fill`, which has no `expression` key
WHEN the persisted teacher is compared across the two
THEN both read `mascot-highlighting.webp`
AND on `03-settled.html` she carries no `data-changed`
AND therefore the closing screen inherited the pose rather than blanking to
`mascot-undefined.webp`. The same holds for the visual novel's background across
`visual-novel.min/02-settled.html` and `03-settled.html`.

---

### Transitions

**S7 — an `entering` transition forward, paginated. [Node]**
GIVEN `fixtures/dom/cartoon.min/01-entering-forward.html`
WHEN the stack's children are read
THEN there are exactly two `[data-phase]` elements
AND the first is `data-phase="leaving" data-nav="forward" data-kind="concept"` holding
beat 0's text
AND the second is `data-phase="entering" data-nav="forward" data-kind="misconception"`
holding beat 1's text
AND both `data-nav` values are `forward` — the exit is directional because it is told
the direction
AND each `data-persist` key appears exactly once, before both screens.

**S8 — an `entering` transition forward, scene-sequential. [Node]**
GIVEN `fixtures/dom/visual-novel.min/01-entering-forward.html`
WHEN the stack's children are read
THEN the same two-node overlap holds with `scene` templates
AND the persisted `bg` and `sprite` are single nodes preceding both screens
AND the persisted sprite already shows the **incoming** speaker, `body-mei.webp`, while
the leaving screen still holds Hana's line — persisted state is not double-buffered,
which is the structural reason a persisted element may not be cross-faded.

**S9 — an `entering` transition backward, paginated only. [Node]**
GIVEN `fixtures/dom/cartoon.min/02-entering-back.html` and
`fixtures/dom/cartoon.max/05-entering-back.html`
WHEN each is read
THEN both hold two `[data-phase]` elements, both stamped `data-nav="back"`
AND the leaving one is the `ask` screen and the entering one is the destination index
AND `--progress` is the destination's `(at+1)/n`, `0.75` and `0.8571428571428571`.

**S10 — scene-sequential produces no backward snapshot, by contract. [Node]**
GIVEN `fixtures/dom/visual-novel.min/` and `fixtures/dom/visual-novel.max/`
WHEN both directories are listed
THEN neither contains any `*-entering-back.html`
AND no snapshot under either contains `data-control="back"` — verified across all
thirteen files
AND the absence is the archetype contract pinned in the file system, not an omission in
the capture.

**S11 — a second navigation hard-removes the dying screen. [Browser]**
GIVEN a browser at `4173/?fixture=max`
WHEN `next` is pressed twice within one `--motion-duration`
THEN `stack.querySelectorAll('[data-phase]').length` is 2, never 3
AND exactly one is `entering` and one is `leaving`
AND no `data-persist` key resolves to more than one node
AND the discarded screen's `settleWhenDone` continuation does not later remove the new
`leaving` node, because it fails the `leaving !== node` guard.
No blessed artefact exists for this; it is asserted live and it is the reason the
overlap can never grow past two.

---

### The archetype

**S12 — paginated renders back and next, with both predicates. [Node]**
GIVEN `fixtures/dom/cartoon.min/00-settled.html`, `01-settled.html` and `03-settled.html`
WHEN the control bar is read in each
THEN all three hold exactly `[data-control="back"]` then `[data-control="next"]`, in
that order, each with its archetype `aria-label`
AND on `00` back carries `hidden` (`at === 0`) while next does not carry `disabled`
AND on `01` back has lost `hidden`
AND on `03`, the last screen, next carries `disabled` (`at >= n-1`) and back does not
carry `hidden`.

**S13 — scene-sequential renders next only, with no back node. [Node]**
GIVEN every file under `fixtures/dom/visual-novel.min/` and `fixtures/dom/visual-novel.max/`
WHEN each control bar is read
THEN it holds exactly one button, `[data-control="next"][aria-label="Continue"]`
AND `data-control="back"` occurs zero times in all thirteen files
AND on `03-settled.html` / `06-settled.html` that next carries `disabled`
AND there is no hidden back, no disabled back, and no back at all.

**S14 — the world places the archetype's controls; it does not choose them. [Node]**
GIVEN `fixtures/dom/cartoon.max/00-settled.html` and `fixtures/dom/visual-novel.max/00-settled.html`
WHEN the position of the controls slot is compared
THEN Cartoon's is a stack sibling — `nav.controls[data-persist="controls"][data-slot="controls"][data-layer="controls"]`,
hoisted, stamped, built once
AND the visual novel's is inside `div.box` inside the screen element, rebuilt per screen
AND both nonetheless contain the same archetype-issued button markup
AND no snapshot in either world contains a `[data-control]` whose name is absent from
that world's archetype row.

---

### Persistence

**S15 — persistence survives a screen change. [Node]**
GIVEN every `NN-settled.html` under `fixtures/dom/cartoon.min/`
WHEN each is read
THEN each of `progress`, `teacher` and `controls` appears exactly once per file, as a
direct child of `div.stack`, never inside a `[data-phase]` element
AND the controls bar carries `data-built="1"` on every screen including the first,
which is only possible if the *same element* was carried forward rather than rebuilt
AND the same holds for `bg` and `sprite` across `fixtures/dom/visual-novel.max/`.

**S16 — persisted nodes are the same objects, not lookalikes. [Browser]**
GIVEN a browser at `4180/?fixture=min`
WHEN a reference to the persisted `[data-persist="sprite"]` node is taken, `next` is
pressed, and the transition settles
THEN `stack.querySelector('[data-persist="sprite"]')` is `===` the held reference
AND its `[data-slot="speaker_face"]` `src` has changed in place.
This is the regression a screen-level snapshot cannot see, per "Why the snapshot subject
is the stack": the serialised screen is identical whether the node persisted or was
rebuilt.

**S17 — the snapshot subject is the stack. [Node]**
GIVEN every file under `fixtures/dom/`
WHEN the first line of each is read
THEN it is `<div class="stack" style="--motion-duration: …">` in all 28 files
AND no file is rooted at a `[data-phase]` element
AND the stack's inline `width`, `height`, `transform` and `transformOrigin` are absent,
per the two normalisations in `tools/capture-dom.md`, while `--motion-duration` is
present because it is published state.

---

### `data-changed`

**S18 — `data-changed` appears only on slots whose value actually moved. [Node]**
GIVEN `fixtures/dom/cartoon.max/01-settled.html` and `fixtures/cartoon/screens.max.json`
AND that `fill.expression` is `explaining` on both screen 0 and screen 1, while both
text channels differ
WHEN the snapshot is read
THEN `[data-slot="mascot_line"]` and `[data-slot="body"]` carry `data-changed`
AND the persisted `[data-slot="expression"]` carries **none**, despite being re-marked
on every other screen in the module
AND the file contains exactly two `data-changed` occurrences.
The visual novel witnesses the same rule on a held channel:
`fixtures/dom/visual-novel.max/01-settled.html` marks `speaker_body`, `speaker_face` and
`line`, and leaves `background` unmarked because `hold: "module"` pins it to `library`
for all six beats.

**S19 — the first screen after a mount marks nothing. [Node]**
GIVEN `fixtures/dom/cartoon.max/00-settled.html` and `fixtures/dom/visual-novel.min/00-settled.html`
WHEN each is read
THEN neither contains any `data-changed`
AND this is `prev === null` after `mount()`, not an absence of differences — every slot
is being filled for the first time and "changed from nothing" is not a change.

**S20 — the known false positive on the way back off the closing screen. [Node]**
GIVEN `fixtures/dom/cartoon.min/02-entering-back.html`, and `03-settled.html` before it
WHEN the persisted teacher is compared across the two
THEN both read `mascot-highlighting.webp` — the rendered value did not move
AND yet the entering snapshot carries `data-changed` on her, because `prev` is the
closing screen's `fill`, which has no `expression` key, so `undefined !== "highlighting"`
AND Cartoon's `.teacher[data-changed]` therefore fires `cartoon-pop` on a byte-identical
image.
This scenario pins current behaviour so it cannot change silently. It is a divergence
between "differs from the previous screen's value" and "differs from what is on screen";
see bug B1. The same is blessed at `fixtures/dom/cartoon.max/05-entering-back.html`.

---

### Motion and stage 0

**S21 — the opening frame is painted at stage 0 with no model call. [Browser]**
GIVEN `http://localhost:4173/` with **no** `?fixture` parameter
WHEN the page finishes loading and nothing is submitted
THEN one screen exists, of type `world.pagination.closeWith` (`ask`)
AND `[data-slot="ask_line"]` reads `What do you want to learn today?` — from
`world.json` `module.channels.ask_line.opening`, not from any model
AND `[data-slot="expression"]` reads `mascot-explaining.webp` — from
`channels.expression.opening`
AND `--progress` is `0`, because the opening frame is not inside a module and a full bar
for a module that has not been written yet would be a lie
AND `back` is `hidden` and `next` is `disabled`, since `screens.length === 1`
AND the server logs no `[module]` line and `metrics` shows no generation.
Its structure is the same template blessed at `fixtures/dom/cartoon.min/03-settled.html`,
differing only in the enumerated values above. **There is no blessed artefact for stage 0
itself** — the capture drives `?fixture=…`, which replaces the opening frame before the
first snapshot — so this is the one moment in the projector's life with nothing frozen
behind it. See gap G1.

**S22 — the declared duration is clamped, scaled and published on the stack. [Node]**
GIVEN `fixtures/dom/cartoon.*/` and `fixtures/dom/visual-novel.*/`, and both manifests
WHEN each snapshot root is read
THEN Cartoon's every root carries `--motion-duration: 280ms`, matching
`motion.duration: 280` under `clamp(round(280 × 1), 80, 600)`
AND the visual novel's every root carries `260ms`
AND the property is on `div.stack`, never on a `[data-phase]` element, so hoisted
siblings inherit it
AND no snapshot carries a per-screen duration.
The ceiling, the floor and reduced motion are **[Browser]**: they need a rendered page
with a patched manifest or an emulated `prefers-reduced-motion`, and no blessed artefact
covers them.

---

### Failure

**S23 — an unknown archetype fails at load, not mid-session. [Browser]**
GIVEN a world whose manifest declares `"archetype": "x"`
WHEN the page is loaded
THEN `app.js` throws `unknown archetype "x"` during module evaluation
AND nothing renders — not even stage 0, because the throw precedes `openingFrame()`
AND no navigation, no fetch to `/api/module` and no partial world is left on screen.
Recorded at `fixtures/hostile/cases.json` → `_browserSide[0]` rather than in `cases`,
because it is unreachable from Node: the projector is browser code that runs at module
load against a live `fetch` and a shadow root. This is why `check-fixture`'s completeness
count stays at 30 and stays honest.

**S24 — the three self-checks fire on the conditions they name, and only those. [Browser]**
GIVEN a browser at `4173/?fixture=max`, whose text is pinned to the exact channel caps
WHEN the panel is resized below the world's declared `minWidth`/`minHeight`
THEN the world is still handed its declared box and the result is scaled down, so no
check fires
AND WHEN the world's `viewport` floor is patched away so the layout is genuinely
squeezed
THEN `assertLayoutFits` warns `slot "body" overflows the panel by Npx` or
`slot "body" overlaps control "next"`, naming the slot and the declared `minHeight`
AND WHEN `presets.css`'s `.stack > [data-layer='controls'] { z-index: 2 }` is removed
THEN `assertControlsReachable` warns
`control "back" is not clickable — section.screen module is on top of it`
AND with all three healthy the console is clean across every screen of both fixtures
AND in no case does anything throw, and in no case is navigation blocked.
Verified adversarially rather than by construction, because `element.click()` cannot
distinguish the third condition from health.

---

### Scenario tally

| Home | Count | Scenarios |
|---|---|---|
| Node — reads blessed files offline | 14 | S1–S10, S12–S15, S17–S20, S22 partial |
| Browser — needs rendering | 8 | S11, S16, S21, S22 (ceiling/floor/reduced), S23, S24 |

Counting S22 once against Node and its clamp-boundary half against Browser: **22
scenarios, 14 Node, 8 Browser.**

The Node half is free and runs with `check-fixture`'s constraints — offline,
milliseconds, no model, no spawn. It defends the contract against a careless
re-blessing. It cannot defend the snapshots against the projector; only re-running
`tools/capture-dom.md` and finding `git diff fixtures/dom` empty does that.

## Traps this component has already paid for

Recorded in `worlds/cartoon/REFACTOR.md`, folded in here so they are not rediscovered.

1. **A phase cannot end on the next frame.** The first draft flipped `entering` to
   `settled` inside a `requestAnimationFrame`. Because the animations come from
   selectors containing `[data-phase="entering"]`, changing the attribute makes the rule
   stop matching, `animation-name` reverts to `none`, and the half-played animation is
   **cancelled**. The runtime cannot know a world's delays, so it asks the browser via
   `getAnimations({ subtree: true })` and caps with a timer. Do not replace
   `settleWhenDone` with a fixed number.
2. **Centring must happen after scaling.** Flex alignment positions the *unscaled* box,
   so centring a 772px layout inside a 572px host puts its top at −100, and
   `transform-origin: top` then scales from that offset: the panel renders above the
   stage and its top strip is clipped away. `fitPanel` computes the post-scale free
   space and applies an explicit `translateY` with `align-items: flex-start`
   (`app.js:133-140`). Related: a flex item's default shrink silently undid the computed
   width, which is why `flexShrink = '0'` is set explicitly — and that bug invalidated a
   measurement sweep by producing identical numbers at three widths.
3. **Cross-fading two texts in one grid cell is a legible double exposure.** Measured at
   the crossover: both paragraphs at ~50%, both fully readable, reading straight through
   each other. Opaque card backgrounds do not save it. Cartoon sequences instead
   (`--enter-lag` equals `--exit-dur`, zero overlap), and that only reads well *because*
   persistence keeps the teacher, the bar and the button on screen — the frame is never
   empty, so a hard handoff does not stutter. Overlap and persistence pay for each
   other; a world with one and not the other looks worse than one with neither. This is
   a world-level lesson, but the projector's job is to make both available.
4. **The stack, not the screen, is the size container.** Hoisting changes what `cqw`/`cqh`
   resolve against. `.stack` is the projector's own element and the one projector-owned
   box a world may style. Do not put `container-type` back on `.screen`.
5. **Verifying motion in a backgrounded tab is worthless.** Chrome does not fire rAF,
   throttles timers to ~1s, freezes main-thread transitions and eventually the tab.
   Every early "finding" of that session was that, not a defect. Inspect the animations
   the browser actually constructed and drive `currentTime` by hand.

## Disagreements between the code and `CONTRACT.md`

`CONTRACT.md` is given and is not edited. These are reported for whoever owns it.

**D1 — the published vocabulary table is smaller than what is actually published.**
`data-layer`, `data-busy`, `data-control` (with `hidden`/`disabled`) and `data-built`
all reach the DOM and are all keyed on by shipped CSS. The table lists six rows and the
real surface is ten. Since the table is described as "the entire language a world can
speak", either it grows or those four move behind something a world cannot see.

**D2 — the archetype is absent from the contract entirely.** `CONTRACT.md` never
mentions archetypes, controls or readouts, yet the difference between `paginated` and
`scene-sequential` is a hard behavioural contract that the fixture pins in the file
system (S10, S13). The most load-bearing thing this component publishes has no line in
the shared document.

**D3 — the clamp bounds the duration, not the phase.** `Alexandria - Rendering` lists
"exceed the clamped duration" among the things a world can never do. `--motion-duration`
is indeed clamped to 600ms, but `entering` is held open until the browser reports the
subtree idle, capped at `MOTION_CEILING_MS * 3` = 1800ms. A world chaining delays can
therefore hold a screen `entering` for up to three ceilings. This is deliberate — trap 1
above is why — but "the runtime caps them" is true of the property and not of the phase,
and the two are easy to conflate.

**D4 — invariant 6 names a fallback that does not exist.** "An invalid beat falls back
to the plain world." The projector never throws into the session, which is the
important half. But there is no plain world in `worlds/`, and `degraded` only appends a
sentence to the metrics line. The invariant is currently half-implemented and the
missing half is nobody's file.

**D5 — "Named, never silent" has two silent sites here.** A slot naming no channel
(`app.js:337, 243`) and a channel with a `set` but no `assetFormat` entry
(`app.js:189`) both degrade quietly. Both belong to the manifest-validation gap the
world-loader lane owns, but they surface in this component.

## Bugs and gaps

**B1 — `data-changed` compares fills, not rendered values.** `prev` is the previous
screen's `fill` object (`app.js:411`), while `fill()` deliberately leaves unmentioned
slots untouched (`app.js:240`). On the beatless closing screen the two diverge: the
teacher keeps her pose but `prev` has no `expression` key, so navigating back off that
screen marks her changed and fires the world's pose animation on an identical image.
Blessed at `fixtures/dom/cartoon.min/02-entering-back.html` and
`cartoon.max/05-entering-back.html`, pinned by S20. The fix is to track the last
*applied* value per slot key rather than the last fill object; it would change those two
snapshots, so it is a deliberate re-blessing, not a quiet edit.

**B2 — `assertLayoutFits` never checks the left edge.** `app.js:440` tests `bottom`,
`top` and `right` but not `panel.left`. A slot escaping to the left is invisible to the
overflow check and to the message's `Math.max`. Either an oversight or an unstated RTL
decision; one term restores the symmetry.

**B3 — `archetype.readouts` is declared and never read.** Both archetypes list
`readouts: ['progress']`; `renderReadouts` hardcodes the string and consults the map
nowhere (`app.js:298-306`). Adding a readout to an archetype would have no effect, and
a world declaring `data-readout="anything-else"` silently receives no value.

**B4 — `required: true` is declared and never enforced.** The comment above `ARCHETYPES`
says a world "may never omit one marked required", and nothing checks it. What actually
delivers the guarantee is the chrome fallback: a world declaring no controls slot leaves
the footer buttons visible. A world that declares the slot and then hides the required
control with CSS defeats both. The check is cheap and does not exist.

**B5 — `ask` and `controls` are reserved slot names with no announcement.** A world
naming a *channel* either of those gets a slot that is never filled and never marked
changed, silently (`app.js:236`, `app.js:337`). It is the one live genericity hazard the
invariant-4 sweep surfaced.

**B6 — the self-checks warn into a console nobody asserts on.** All three are
`console.warn`, which is right for degradation, but the capture harness does not record
console output, so a self-check firing during a capture leaves the fixture green.
S24 has to be driven by hand for that reason. A machine-readable channel — an event, or
a counter on the stack — would let the browser suite assert silence.

**G1 — stage 0 has no blessed artefact.** `openingFrame()` paints, and then
`?fixture=<variant>` immediately replaces it, so nothing under `fixtures/dom/` records
the opening frame. It is the only rendered state of the projector with nothing frozen
behind it, and it is the state that `Alexandria - Cold Start` cares most about — painted
locally, never blocking, no model call. A `fixtures/dom/{world}.opening/00-settled.html`
captured by loading the page with no query parameter would close it, and it would cost
one more capture step per world. Flagged, not created: `fixtures/**` is shared and this
lane does not add to it unasked.

## Verification run for this document

```
$ npm run check-fixture
30 checks passed
```

Unchanged, as expected: nothing in this lane touches `src/`, `fixtures/` or any world,
and `check-fixture` does not read the projector.
