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

Flat, because the projector resolves `/worlds/{id}/assets/{set}-{name}.{ext}` and has no
path convention. That is why the face value carries the character (`mei-smug`) rather than
living in a per-character folder — and why `speaker_face` declares `prefixedBy:
"speaker_body"`, so the validator rejects Hana's face on Mei's body.

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

```css
.vn-stage  { position: relative; overflow: hidden; }
.vn-sprite {
  position: absolute;
  bottom: 0;                       /* never head-anchor: see below */
  left: 50%;
  transform: translateX(-50%);
  height: 90%;                     /* of stage height; width follows the 1011:1145 aspect */
  width: auto;
}
```

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

## Format note

Sprites are **lossless** WebP. Lossy WebP blew out the alpha edges on flat line art
(max channel error 255 at the silhouette). Backgrounds are lossy q82 — correct for
painted art, and 6× smaller.

## Open contract question

`cast_faces` resolves to `assets/cast/{speaker_body}/face-{value}.webp` — the face
asset path depends on **another channel's current value**. The projector's asset
resolver has to support cross-channel references, or the face channel needs to carry
the character in its own value (`mei-smug`). Worth settling before the world is built.
