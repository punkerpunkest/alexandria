# Capturing the DOM snapshots

The projector is browser code with a shadow root, so unlike everything else in the
fixture these cannot be produced from Node. That is the only reason this is a written
procedure rather than a script.

## Run

```bash
SNAPSHOT=1 PORT=4173 WORLD=cartoon      npm start
SNAPSHOT=1 PORT=4180 WORLD=visual-novel npm start
SNAPSHOT=1 PORT=4190 WORLD=longform     npm start
```

`SNAPSHOT=1` enables `POST /api/_snapshot`, which writes into `fixtures/dom/`. It is off
under a plain `npm start` and must never be on in anything a student runs.

Then, for each of `4173/?fixture=max`, `4173/?fixture=min`, `4180/?fixture=max`,
`4180/?fixture=min`, open the page and run the capture function from the console. It
walks every screen with the archetype's own next control, so it stops where the
archetype stops rather than where a hardcoded count says it should.

`?fixture=<variant>` is deterministic mode: the module comes from `fixtures/beats/` and
**no model call happens at all**. That is also the way to run the app while working on
the chrome without spending quota.

## What is captured, and what is normalised out

The subject is the **stack**, never the screen. Elements marked `data-persist` are
hoisted out of the screen by the projector and live as siblings of it, so serialising a
screen would miss the teacher, the progress bar and the control bar entirely, and a
regression that stopped hoisting would pass green.

Two normalisations, both deliberate:

- The world's `<style>` elements are dropped. The snapshot pins structure and published
  state; CSS is free to change forever, which is what lets a world be restyled without
  going red.
- The stack's inline `width`, `height`, `transform` and `transformOrigin` are dropped,
  because they are a fit to the window that happened to be open. `--motion-duration`
  is kept, because it is published state.

Everything else stays: `data-phase`, `data-nav`, `data-kind`, `data-changed`,
`data-persist`, `--progress`, resolved asset `src`s, and the control set the archetype
produced.

## Which moments

Every screen at `settled`, plus one `entering` in each direction the archetype allows.
The transition snapshots are the valuable ones: they contain **both** screens at once,
the leaving and the entering, which is the two-node overlap the whole motion design
rests on.

Scene-sequential produces no backward snapshot, because it has no back control at all.
That difference showing up in the files is the archetype contract being pinned.

**Continuous does not walk at all.** It has no controls of any kind and every screen is
already co-resident in the scroller, so a single capture of the stack IS every screen, and
there is no `entering` moment to catch. `fixtures/dom/longform.*` therefore holds one
`00-settled.html` each. Same principle: the shape of what is missing is the contract.

## Verifying

There is no `npm run` for this, because checking requires rendering. Re-run the capture
and confirm `git diff fixtures/dom` is empty. Verified byte-identical across two runs on
26 Aug; if a run ever differs, suspect the settle step before suspecting the projector.
