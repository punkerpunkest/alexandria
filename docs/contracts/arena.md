# Contract: the arena

Owns `public/arena/**`, `src/engine.js`, `engines/**`, and the `/engines/` route in
`server.js`. Written against `CONTRACT.md`, which is given and is not edited here.
Vocabulary is fixed in the vault note `Alexandria - Glossary`; the design and its
invariants are `Alexandria - Design`, "The arena"; why the return channel is the whole
point is `Alexandria - Interactives`.

## Purpose

The arena hosts a **sandbox** — an engine, which is community code that ships a simulation
— behind an iframe, with a task Alexandria generated. A world declares *where* it sits, so
the arena is not a region of the chrome. It is the set of things a tenant may never
renegotiate, wherever it is mounted.

The main surface has two tenants with **different boundaries**: a world is a shadow root
because it ships no JavaScript, an engine is an iframe because it does. That is why the
arena is a separate module and not a branch inside the projector, and why `arena.js`
imports nothing from `app.js`.

The division, in one line:

> **Alexandria owns the task. The engine owns the simulation. The arena owns everything
> that crosses between them.**

## The message vocabulary

Five messages, and each is forced rather than chosen. An engine hardcodes these strings —
it cannot import `src/engine.js`, because it is third-party code in an opaque origin —
which is why the list has to stay short enough to write down.

| Message | Direction | Why it must exist |
|---|---|---|
| `alexandria:ready` | engine → host | The host cannot know when the engine's listener attached. Sending the task on iframe `load` races the engine's own `<script>` and loses on a cold cache, so the engine speaks first |
| `alexandria:task` | host → engine | The host's answer to `ready`. Parameters Alexandria generated — never a lesson, and never the sentence |
| `alexandria:state` | engine → host | A partial result, pushed on every material change. See below; it looks optional and is not |
| `alexandria:complete` | engine → host | The task was finished. Scored engines only |
| `alexandria:error` | engine → host | The engine cannot run the task it was handed, so the arena degrades rather than sitting on a dead frame |

### Why `state` exists

The exit control is always available, so a student may leave mid-task at any moment — and
**the student who gives up is exactly the one whose `notes` matter most**, because that
field names which rule their attempts kept breaking. Without a pushed partial the arena
would have nothing but a clock for them.

The alternative considered was asking the engine for a result on the way out. That puts a
wait inside an exit the design says is never blocked, and it races teardown. Pushing costs
more messages and has neither problem.

## Isolation, measured rather than asserted

The arena is the trust boundary, so nothing in this section is reasoned from
specification. `engines/hostile-probe/` attempts each escape and reports the outcome
through the return channel, so the result is readable as data rather than as a screenshot.

### The two carriers, and why there must be two

Containment rests on **`sandbox="allow-scripts"` on the iframe** and a **CSP on the engine
document**. The omission that matters in the first is `allow-same-origin`: with both flags
set together the frame can reach out of the sandbox and the boundary is decorative.

> [!danger] The CSP response header was silently not enforced, and this was measured
> Served as a `content-security-policy` **response header**, `connect-src 'none'` had no
> effect: a cross-origin `fetch` with `mode: 'no-cors'` returned `type opaque`, meaning the
> request left the machine, and **zero** `securitypolicyviolation` events fired. The
> identical directive as a `<meta http-equiv>` **inside the document** blocked the same
> fetch, same page, same browser.
>
> A browser extension that rewrites response headers is enough to cause this, and it is the
> likely cause here. What makes it dangerous is that the failure is invisible from outside:
> the header is on the wire and `curl -I` shows it, and the page exfiltrates anyway.
>
> So the server **injects the CSP as a meta tag** into engine HTML as well as sending the
> header. Two independent carriers, neither trusted alone. The meta goes at the very start
> of the document, because a meta CSP only governs content parsed after it.

`ENGINE_CSP` names what it **blocks** rather than what it allows, because `'self'` matches
nothing from an opaque origin and so cannot express "the files this engine shipped".

### An engine may use ES modules, and one header is why

A module script is fetched in CORS mode, and from the frame's opaque origin that request is
cross-origin **even for our own URL**. Without `access-control-allow-origin` on engine
responses, `<script type="module">` fails outright: blank frame, and an error only visible
inside a frame the author cannot open. The header grants nothing — `connect-src 'none'`
already blocks every fetch the engine could make with the permission.

Verified both ways round: without it the module never ran, with it the module ran to
completion.

### The probe result

Every attempt below was observed blocked, with the CSP violations naming their directive.
Before the meta-tag fix, rows 7 and 8 were **open** and no violation fired at all.

| Attempt | Outcome | Stopped by |
|---|---|---|
| `parent.document` | `SecurityError` | sandbox |
| `top.location.href` | `SecurityError` | sandbox |
| `localStorage` | `SecurityError` | sandbox |
| `document.cookie` | `SecurityError` | sandbox |
| navigate the top window | `SecurityError` | sandbox |
| open a popup | returned `null` | sandbox (no `allow-popups`) |
| reach `/api/world` | network error, `connect-src` violation | CSP |
| `fetch` to the internet, `no-cors` | `TypeError`, `connect-src` violation | CSP |
| beacon through an `<img>` | error, `img-src` violation | CSP |

`window.open` returns `null` when blocked rather than throwing, and `xhr.open()` neither
throws nor sends — an earlier draft of the probe read both as open doors. A boundary test
that cannot distinguish *blocked* from *untested* is worse than none.

### Identity, since origin proves nothing

Messages from the frame carry `event.origin === "null"`, because the origin is opaque. The
only usable check is `event.source === frame.contentWindow`; no other document can forge
that reference. The arena never compares origins.

## The return channel

One shape, two producers, per `Alexandria - Interactives`. The split that matters is which
fields the **engine** may fill and which the **arena** stamps.

| Field | Filled by | Why |
|---|---|---|
| `producer` | arena | An engine that could name itself could impersonate a first-party micro card |
| `engine.{id,version,review}` | arena, from the manifest | Same reason. Provenance the tenant can edit is not provenance |
| `time_on_task_ms` | arena, measured | A tenant reporting on its own performance is the world-as-narrator problem again |
| `scored` | arena, from the manifest | Declared once, in the package |
| `completed` | arena | Whether `complete` arrived. Scored engines only |
| `attempt`, `notes`, `confidence`, `correctness` | engine | Bounded on the way in — see below |

Everything the engine sends is **data, never instruction**. Structured clone has already
stripped functions and DOM nodes in transit; `CAPS` bounds what is left. Values over a cap
are truncated rather than rejected, because a returning student losing their result to a
strict parser is worse than a long note being cut.

- `notes` caps at 600 characters. It is the likeliest injection vector, since a hostile
  engine's output flows into the agent's context — it talks to the **model**, not the
  student.
- The depth cap is what terminates a **cyclic** graph. `postMessage` carries one happily.
- A mistyped `correctness` is dropped, not coerced. A silently coerced score is a wrong
  score, and `'definitely'` is truthy.

### Absent, not false

An unscored engine's payload carries **no** `correctness` and **no** `completed` key. There
is no completion event for it to have lacked, and a `false` reads downstream as a failed
attempt. A goal is optional — narrowed 26 Aug — so time on task alone is a complete result.

On a scored engine, `completed: false` is the ledger's **owe** signal, and the payload
still carries whatever the engine last pushed via `state`.

## Two outcomes, not three

`onResult` fires whenever a mount ends normally, and `result.completed` distinguishes
finishing from leaving. `onDegrade` is genuinely different: it substitutes a micro set and
never reaches the ledger. An earlier draft had a third `onSkip` carrying the same payload
as `onResult`, which was two names for one thing.

## Invariants owned

From `Alexandria - Design`, with where each is enforced.

| Invariant | Enforced by |
|---|---|
| The chrome states the task | The engine is sent `params` and never `sentence`. Structural, not a convention |
| Provenance visible for the life of the mount | Rendered into the bar at mount; there is no code path that hides it |
| The exit control is always present and never blocked | No `disabled` path exists on it, and it is the only way out of an unscored engine |
| The return belongs to the chrome | `shapeResult` stamps; the arena draws the outcome, the engine never does |
| Nothing the tenant draws leaves the stage | The fixed stage box and the iframe boundary |
| Nothing spins | `READY_DEADLINE_MS` — an engine that is not warm is replaced, not waited for |
| Containment | `escapes()` rejects `entry` paths that leave the package; the `/engines/` route rejects a resolved path outside the engines root |

## Fixtures it is judged against

Offline, model-free, part of `npm run check-fixture` (86 checks total).

- Every shipped package validates clean, its `id` matches its directory, and its `entry`
  exists on disk. A broken package must fail at **load**.
- A blessed task schema per engine per task kind. A task space is to an engine what a
  channel set is to a world, so it is blessed the same way.
- `fixtures/engines/manifests.json` — fourteen hostile manifests covering all twelve rules
  in `validateEngine`. The rule count is pinned, so adding a rule without a case turns the
  check red.
- The return channel's guarantees, pinned directly: the arena stamps producer, identity and
  clock over an engine's claims; a mistyped `correctness` and an out-of-range `confidence`
  are dropped; `notes` caps at 600; a cyclic `attempt` terminates; an unscored payload has
  neither key.

`never-ready` and `hostile-probe` are **test fixtures, not teaching engines**. Keep them out
of any registry. `never-ready` exists because the degrade is one of only two outcomes, and
an outcome nothing can reach is an outcome nobody has tested.

## Fidelity is a safety property, and it is the engine's to declare

A chemistry sim that permits an impossible molecule teaches something false and the student
has no way to know. Both sample engines declare what they **cannot** model, in the manifest:
`molecule-builder` models single covalent bonds only, so it must never be asked for O₂ or
CO₂, and every task parameter's job line says so. `microscope` declares eight omissions,
of which two matter more than the rest — the specimen is always centred, so losing it out of
a narrowed field cannot happen there, and the depth-of-field figures are inflated tenfold so
that focus is findable with a mouse.

`microscope` also declares the subtlest kind of omission there is: a mechanism it **refuses
rather than models**. Coarse focus at 40x is blocked, where a real stand permits it and the
slide cracks. The engine cannot inflict the consequence, so it counts the attempt instead —
and says in the manifest that it does, because a student must not conclude the instrument
protects them. The retired `optical-bench` had the same shape of declaration for a different
reason: its three-ray construction was **exact for the model** and was not a picture of every
ray that leaves the object, so a student who concluded light travels along three paths had
been misled by the diagram rather than by the arithmetic.

Four defects found by running these rather than by reading them, all of the same family —
the maths was right and the thing on screen was wrong. The first three are recorded from the
optical bench, which is no longer shipped; the lessons outlived it:

| Defect | Why it mattered |
|---|---|
| The bench put the lens at x=600, leaving too little image space | Object between F and 2F — the projector case, one of the three every course teaches — computed a correct image that fell off the right edge and drew nothing at all |
| The ray through the near focus was drawn even when it met the lens plane 1205 units off-axis | A real lens has a finite aperture and does not intercept that ray. Drawn anyway it dives off the bottom of the bench, which reads as a bug and is also false |
| `releasePointerCapture` ran before the state push | It throws on a pointer the browser is not tracking, which swallowed the message carrying the student's misconception. Pointer capture is a convenience and must never be load-bearing |
| The microscope drew the illumination above the slide as a cone opening out to the full width of the stage aperture | At 4x the objective sits twelve millimetres clear, so that cone became the largest object in the drawing while claiming something false: the objective's field and its front lens are within a millimetre of each other, and what it collects is a column |

> [!warning] Tuning is part of fidelity, and a stochastic model cannot be checked by running it once
> Recorded from a peppered-moth sim built and then replaced. Its first parameters ran the
> story **backwards**: rising soot drove the dark morph extinct. The model was right and the
> numbers were wrong — selection against dark on clean bark killed the rare allele by
> generation six, and soot only starts favouring dark above 0.5, so the environment that
> should have rescued it arrived after it was already gone.
>
> Measured across 400 trials: the original tuning showed the correct outcome **5%** of the
> time and drove the allele extinct **74%** of the time. One run would have shown either.

## Open, and not resolved here

- **Nothing generates a task yet.** `buildTaskSchema` produces the schema Alexandria would
  hand the model, mirroring `buildSchema` for worlds, but no caller fills it from a beat and
  no prompt exists. The bench uses hand-written fixture tasks.
- **There is no ledger**, so no payload has a destination. `Alexandria - Build Plan` has this
  at highest priority and calls the return channel the only scoring surface in the design.
- **The degrade has nothing to substitute.** Micro card sets are first-party and unbuilt, so
  `onDegrade` draws the notice and reports a named reason, and the caller supplies nothing.
- **Nothing declares where the arena mounts.** The design says the world declares it; no
  world does, and Cartoon's manifest explicitly disclaims interactives. Integration will
  touch `public/app.js`, which is another lane's file.
- **The matcher, the registry, the specificity tree.** All post-PoC; engines load from a
  local folder.

## Verification run

- `npm run check-fixture` — 86 checks, offline, no model, milliseconds.
- `npm run capture-fixture` — idempotent; re-running produces no diff.
- The arena driven live in Chrome through `public/arena/bench.html` on 27 Aug: scored
  completion, mid-task exit, unscored exit, degrade on deadline, and the exit control's two
  states at identical width. The hostile probe's nine escape attempts all blocked.

> [!note] One thing that could not be verified by looking
> A sandboxed opaque-origin iframe's content does not composite into the automation's
> screenshots — the frame reads as blank white while `innerText` inside it returns the full
> rendered text. Every visual claim about engine content in this document was checked
> through the DOM or the return channel, not from a picture.
