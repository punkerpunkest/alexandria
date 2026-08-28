// Archetypes are RUNTIME knowledge. The archetype decides which controls and
// readouts exist; the world decides where they sit and what they look like, by
// declaring data-slot="controls" / data-readout="<name>" in its template.
// A world may place any subset. It may never add to the set, and it may never
// omit one marked required.
//
// THIS TABLE USED TO LIVE IN `public/app.js`, and it moved for one reason: the manifest
// validator has to answer two questions from Node — is this archetype one the runtime
// knows (rule A9), and is this readout one it publishes (rule E9) — and `public/app.js`
// is browser code with a top-level `fetch`, so Node cannot import it. Restating the table
// in `src/` would be two lists that drift; moving it is one list that cannot. The
// projector imports it over `/src/archetypes.js`, exactly the way it already imports
// `/src/assets.js`, and nothing about what an archetype MEANS changed in the move.
//
// Pure: no DOM, no import, so both halves read the same file.
export const ARCHETYPES = {
  paginated: {
    controls: {
      // `hidden` and `disabled` belong here rather than in syncControls: they are
      // this archetype's semantics. Scene-sequential has no free back at all, and
      // continuous has neither control — those are its business, not the projector's.
      back: { required: false, label: '', aria: 'Back', step: -1,
              hidden:   (at) => at === 0 },
      next: { required: true, label: 'Continue', aria: 'Continue', step: +1,
              disabled: (at, count) => at >= count - 1 },
    },
    readouts: ['progress'],
  },
  // Forward only. No back control exists at all -- not hidden, not disabled, absent.
  // A world that wants an arrow inside its dialogue box places data-slot="controls"
  // there and dresses [data-control="next"]; placement was never the archetype's business.
  'scene-sequential': {
    controls: {
      next: { required: true, label: 'Continue', aria: 'Continue', step: +1,
              disabled: (at, count) => at >= count - 1 },
    },
    readouts: ['progress'],
  },
  // ONE SCROLL, NO CONTROLS AT ALL. Every screen is co-resident in the scroller and
  // scrolling is what advances, so there is nothing to put in `controls` -- and the
  // World Spec rule that an advance control can never be optional is satisfied
  // vacuously rather than broken, because this archetype has no advance control to
  // make optional. `scrolls` is the flag the projector branches on; it is the only
  // archetype property that is not a control or a readout, and it earns that by
  // changing the render MODE rather than the control set.
  continuous: {
    controls: {},
    readouts: ['progress'],
    scrolls: true,
  },
};

// Named in the one error a world author sees when they invent an archetype, so the
// message lists what is actually available rather than a list someone typed once.
export const archetypeNames = () => Object.keys(ARCHETYPES);
