# Alexandria — wire spike

The thinnest end-to-end path: a typed question becomes a staged module,
rendered by a world package, with Claude Code as a long-lived child process
spending the student's own subscription.

Names here follow the vault note `Alexandria - Glossary`. In this repo:
`src/claude.js` is the **adapter**, `server.js` is the **runtime**,
`public/app.js` is the **projector**, and `worlds/cartoon` is a **world**.
There is no **arena** and no **bank** yet, because there are no interactives.

```
npm start                                 # dev mode, in a browser
npm i && npx electron electron/main.js    # the app
```

Requires Claude Code installed and logged in. No API key. Dev mode is
dependency-free and serves http://localhost:4173; the app runs that same
server in Electron's main process and loads it in a window it owns. The
projector, the worlds and the chrome are byte-identical either way.

## What it proves

| Gate | Result |
|---|---|
| Auth | Spawns and authenticates off the existing login. `apiKeySource: none` |
| Schema | Beat arrays come back valid, 0 repairs across every run so far |
| Latency | ~13-17s to generate, ~105-115s to read. Covered roughly 7x |
| Teaching | Jordan's call |

## The shape

```
worlds/<id>/world.json      manifest: channels, caps, asset vocabulary, motion
      -> src/manifest.js   the manifest's own schema. Every package under
                           `worlds/` is enumerated and validated at startup, so
                           a broken world fails at LOAD with a named reason
                           rather than mid-session. `WORLD=<id>` picks the
                           default; `?world=<id>` and `/api/worlds` pick and
                           list the rest
      -> src/schema.js     pure function: manifest -> JSON Schema (asset
                           descriptions folded into the enum description,
                           because the schema IS part of the prompt)
      -> src/claude.js     one long-lived `claude -p --input-format stream-json`
                           process, serialised turns, no tools, no MCP
      -> src/validate.js   what the schema cannot enforce: length caps, a
                           mascot line that asks instead of claims, declared
                           beat-kind coverage, corrective faces outside
                           misconceptions
      -> src/paginate.js   beats -> screens, per the world's policy. Runtime
                           owns this
      -> public/app.js     shadow-DOM mount, slot fill, transition driver
```

A world ships a manifest, HTML templates with `data-slot`, one stylesheet and
assets. **No JavaScript.** Motion is a state diff: the driver compares the
previous beat's slot values to the new ones and applies the class the world
declared for that channel changing.

## The one non-obvious setting

`MAX_THINKING_TOKENS=0` in `src/claude.js`.

With thinking on, one module took **138s** (115s of it before the first token)
and cost $0.10. With it off the same module takes **~15s** and costs $0.013.
Filling channels is not a reasoning task, so the thinking budget is pure latency.

## The Electron pin

`electron` is pinned to `^39.8.10` and the caret is doing real work. Both
walls are hard:

- **Below:** macOS 26 will not run Electron 31. The install succeeds and
  verifies against Electron's own SHA-256, then the first launch is SIGKILLed
  and the OS **deletes the 226MB bundle**, which reads as a corrupt download
  and baits you into reinstalling. `spctl -a -t exec` on the untouched bundle
  says `notarization indicates this code has been revoked`. Ad-hoc signing
  stops the deletion and does not make it run. The fix is the version.
- **Above:** electron 40+ needs `node >= 22.12.0`, and its installer
  `require()`s the ESM-only `@electron/get` v5. On Node 20 the install dies
  with `ERR_REQUIRE_ESM` before downloading anything.

39.8.10 is the newest release that still supports Node 20, and it runs with no
signing work at all. Raising the machine to Node 22 removes the ceiling.

`npm audit` reports 2 high severity here. It is `extract-zip`, the unzip
Electron uses at install time to unpack its own binary — it never ships and
never runs at runtime. **Do not run `npm audit fix --force`:** it resolves to
electron 43, which cannot install on Node 20.

## Cut, on purpose

**The checkpoint beat was cut on 23 Aug 2026** and removed from the code the same
week. The interactive is the only scored object, and nothing inside a module gates.
`checkpoint` stays a **reserved** beat-kind name — see `_reserved` in
`worlds/cartoon/world.json` — so it is not recycled and the vocabulary is unchanged
when gating lands. Nothing generates, paginates, renders or gates it today.

## Not built yet

The loop. Right now it is one question, one module. Next: bank an interactive
during the reading, take the ask at the boundary, generate underneath it.
