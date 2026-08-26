# Visual Novel — world package

Exported 24 Aug 2026 from `Female Sprite by Sutemo.psd` (free pack, personal + commercial
use, editable) and `~/Downloads/pack1/School/Chosen`.

## Structure

Sprites are split **base + face overlay**, not baked per expression.
This is safe because the PSD draw order is:

    Hair behind → Base Body → Blush → Costume → Hair front → Expression → Accessories

`Expression` sits **above** `Hair front`, so a face overlay is geometrically independent
of hair style, hair colour and costume. Verified: reassembling base + overlay matches a
full PSD composite to a max channel difference of 2/255.

    assets/body-<who>.webp             identity: hair + costume + body. Never changes mid-scene.
    assets/face-<who>-<expr>.webp      the only thing a beat varies.
    assets/background-<slug>.webp

Flat, because the projector resolves `/worlds/{id}/assets/{set}-{key}.{ext}` and has no
path convention. The character therefore has to appear in the filename rather than in a
folder — but *not* in the value the model picks. `speaker_face` declares
`keyedBy: "speaker_body"`, so the model chooses from eleven expressions (`smug`) and the
projector composes the key (`mei-smug`). Hana's face on Mei's body is unrepresentable
rather than rejected after the fact, and the enum handed to the model is half the size.

Accessories draw *above* Expression, so Mei's circle glasses are baked into her face
overlays rather than her base. That is why her overlays are larger than Hana's.

## Cast

| id   | hair             | costume   | accessory      | total  |
|------|------------------|-----------|----------------|--------|
| mei  | Hime Cut / Brown | seifuku 2 | Circle Glasses | 453 KB |
| hana | Twin Tail / Dark | seifuku 1 | none           | 310 KB |

Expressions (11 each): smile, smile-2, laugh, shocked, normal, delighted, sad, angry,
smug, annoyed, sleepy.

## Staging

One speaker on stage at a time, centred and bottom-anchored. There is no `position`
channel - the world pins the sprite in CSS, so the vocabulary stays as small as it can be.

The sprite is a grid child of `.stack`, so it is placed by alignment rather than by
absolute offsets. That matters: it is hoisted out of the screen by `data-persist`, and
an absolutely-positioned element would then resolve against whichever ancestor happened
to be positioned.

```css
.sprite {
  align-self: end;                 /* never head-anchor: see below */
  justify-self: center;
  position: relative;              /* the face overlay resolves against this */
  height: calc(90cqh * var(--sprite-scale));
  aspect-ratio: 1011 / 1145;       /* the PSD canvas */
}
```

**Pin the stack's grid row, or a full-bleed image inflates it.** `.stack` is
`display:grid; height:100%` with one implicit row. An in-flow child with `height:100%`
resolves against a row that is itself auto-sized from content - circular, so the browser
falls back to the image's INTRINSIC height. A 1920x1080 background at 1404 wide produced
a 790px row inside a 665px stack, which pushed the bottom-anchored sprite 123px below the
stage and put the dialogue box across the character's face. Cartoon never hits this
because it ships no full-bleed image. Two guards: `grid-template-rows: minmax(0, 1fr)` on
`.stack`, and `position:absolute; inset:0` on the background so it cannot try.

**Bottom-anchor, always.** A sprite whose bottom edge lands inside the frame reads as a
floating torso, because the cut shows through a translucent textbox. Anchoring to the
stage floor pushes the cut off-screen at any scale.

**90% is not arbitrary.** The expression bbox bottoms out at 660/1145 = 0.577 of the
canvas. Bottom-anchored at scale s, the chin sits at (1 - s) + 0.577s. For that to clear
a textbox whose top edge is at 66%, s >= 0.803. So **80% is the hard floor** and anything
below it puts the box across the character's mouth. 90% clears comfortably without
clipping the top of the head, which is what 102% does.

If the textbox top moves, recompute: `s_min = (1 - box_top) / (1 - 0.577)`.

Two characters can still disagree, which is what the confidence-laundering mechanism
needs; it plays as alternating turns rather than a two-shot. Restoring a two-shot later
means re-adding `position` to the manifest, so it is a contract change, not a CSS change.

## The dialogue box and the ask

Box text is flex-centred rather than top-padded. A beat is one line or three, and the
offsets differ - 65.9px above a two-line beat, 81.6px above a one-liner - so no single
fixed padding is right for both.

The ask slot is a **sibling** of `.box`, not a child, so it floats over the scene the way
a visual novel stages a choice menu rather than sitting inside the panel. It is centred
horizontally and sits at **32%** of stage height, not 50%: the sprite's top is at 10% and
the face begins 31.35% down it, so the face starts at 10 + 0.3135*90 = 38.2%. A bar at
true centre lands across the eyes and reads as a censor bar.

On the opening frame nothing is on stage, so the box drops its background and border and
both elements centre together as one group. That state is detected by the **absence of a
background** (`.stack:not(:has(.bg[src]))`), not by a screen class, because `ask` is also
the module-boundary screen where the box IS wanted. The template puts the ask slot before
the box, so the opening frame restores reading order with `order`.

## Placing the face overlay

Canvas 1011x1145. Overlay rect (321, 359) size 360x301. As percentages of the base:

```css
.vn-sprite { position: relative; }
.vn-sprite img { display: block; width: 100%; }
.vn-sprite .face {
  position: absolute;
  left:  31.751%;
  top:   31.354%;
  width: 35.608%;
  /* height follows from the image's own aspect */
}
```

Percentages, not pixels - the sprite scales with the stage and the overlay tracks it.

## Backgrounds

All five are taller than the 2.06 the chrome currently hands a world, so they are shipped
**uncropped** and CSS covers them. Centred crops were reviewed and all five survive;
none needs a custom `object-position`.

| slug             | px        | source ar | kept at 2.06 |
|------------------|-----------|-----------|--------------|
| classroom-day    | 1920×1080 | 1.78      | 86%          |
| library          | 1280×768  | 1.67      | 81%          |
| school-gate      | 2048×1448 | 1.41      | 69%          |
| basketball-court | 2048×1452 | 1.41      | 68%          |
| corridor-morning | 2048×1452 | 1.41      | 68%          |

## The type is calibrated to a font this package does not ship

`.line` is 26px with a `max-width` of 78cqw, and the `line` cap of 180 characters was
chosen against a **measured 10.33px per character (0.492em)** — at which a capped line
takes three rows and clears the box by about 28px. Below roughly 1100px of stage width
it takes four rows and overflows, which is what `viewport.minWidth` exists to prevent.

**That 10.33px is Hiragino's.** This world has no bundled font and runs on a
platform-exclusive stack (`"Hiragino Sans", "Yu Gothic UI", "Segoe UI", system-ui`), so
it resolves to a different typeface on macOS, Windows and Linux, and the metric moves
with it.

> [!warning] This is the gap that touches the golden fixture
> A fixture freezes **content**, and content length here is governed by a cap calibrated
> against those metrics. A fixture captured on one machine may therefore not reproduce on
> another. Either capture on a pinned machine, or bundle a face first. Bundling was
> deliberately deferred by Jordan on 26 Aug — this note exists so the consequence is not
> rediscovered.

## Generation baseline

13 live generations during the build, **zero repairs on every one**. Each returned 6
beats, 4.3–14.7s wall, $0.006–$0.060. Worth preserving as a baseline: `hold` and
`keyedBy` steer well enough that the repair loop never runs, so a regression in either
shows up as cost and latency rather than as a visibly broken render.

## Format note

Sprites are **lossless** WebP. Lossy WebP blew out the alpha edges on flat line art
(max channel error 255 at the silhouette). Backgrounds are lossy q82 — correct for
painted art, and 6× smaller.

## Open contract question

`cast_faces` resolves to `assets/cast/{speaker_body}/face-{value}.webp` — the face
asset path depends on **another channel's current value**. The projector's asset
resolver has to support cross-channel references, or the face channel needs to carry
the character in its own value (`mei-smug`). Worth settling before the world is built.
