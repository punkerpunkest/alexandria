# Contract: the registry

Owns nothing in this repository. It is written **ahead of** two things that do not exist —
a static site that publishes Alexandria's community packages, and the installer that
consumes it — because the decisions behind both were settled in conversation on 27–28 Aug
and would otherwise be re-derived, or invented, by whoever builds them.

Written against `CONTRACT.md`, which is given and is not edited here. Vocabulary is fixed
in the vault note `Alexandria - Glossary`. The catalog's shape and what breaks as it grows
are `Alexandria - Discovery and Scale`; the on-disk layout is `Alexandria - Storage`; the
three stages of container work are `Alexandria - Packaging`; why an engine is an engine
rather than an activity is `Alexandria - Interactives`. The trust boundary the installed
bytes eventually run behind is `docs/contracts/arena.md`, and this document is upstream of
it: the arena's guarantees begin at the moment the package is already on disk.

Everything below is recorded as **settled** unless it is under "Open, and not resolved
here". Where a decision has a measured reason rather than an argued one, the measurement is
given, because a security boundary reasoned from specification is the failure this codebase
has already had once.

## Purpose

One website hosts both kinds of community package. It serves **two different jobs**, and
the whole contract falls out of not confusing them:

> A student **browses** worlds. The system **matches** engines. The same host serves both
> and they are not one product surface.

## Two distribution paths, deliberately different

From `Alexandria - Discovery and Scale`, and Jordan has confirmed both paths are kept.

| | Worlds | Engines |
|---|---|---|
| Chosen how often | Once, and rarely changed | When one exists for the topic; otherwise the floor answers |
| Chosen by | The **student**, on taste | The **system**, on fit |
| Right interaction | Browsing a store | Automatic matching |
| Catalog size | Small — tens, maybe hundreds | Large — the long tail of every topic |
| Package weight | Heavy: assets, audio | Light: mostly logic |
| What the site owes it | Screenshots, and a demo lesson rendered live inside the world | A compact index a machine reads |

Nobody wants a system picking their aesthetic, and a student who reads visual novels
already knows they want the visual novel — so *Find Skills*-style matching is scoped to
engines only. That is the large-catalog, high-frequency, genuinely hard half.

> [!danger] One host, two surfaces, and they must not share a design
> The temptation is a single "packages" gallery with a filter chip. It fails both jobs at
> once: a world needs screenshots and a live demo above the fold, and an engine needs to
> be *findable by a program* and is never browsed at all. The engine listings exist on the
> site for two reasons only — a human wants to see what is in the catalog, and the bytes
> have to be hosted somewhere Alexandria can fetch them from.
>
> The **index is the engine product surface.** The gallery is the world product surface.
> Build them as two things that share a host and a hash format, and nothing else.

Micro interactives are in neither path. They are first-party, ship inside the application
bundle, and never appear under `packages/` at all — so the most-travelled path in the
product carries no third-party code and enters no supply chain. Scoped as a PoC decision
in `Alexandria - Discovery and Scale`, 24 Aug, not a permanent architectural claim.

## Alexandria downloads and serves the bytes itself

The load-bearing decision. **The installer fetches a package, writes it under the packages
root, and Alexandria's own server serves every byte of it.** No iframe is ever pointed at a
remote origin, not for a CDN, not for a demo, not for a "just link it for now".

The reason is measured rather than argued.

> [!danger] The CSP response header was silently not enforced, and this was measured
> Served as a `content-security-policy` **response header**, `connect-src 'none'` had no
> effect: a cross-origin `fetch` with `mode: 'no-cors'` returned `type opaque`, meaning the
> request left the machine, and **zero** `securitypolicyviolation` events fired. The
> identical directive as a `<meta http-equiv>` **inside the document** blocked the same
> fetch, same page, same browser. A browser extension that rewrites response headers is
> enough to cause this and is the likely cause here.
>
> What makes it dangerous is that the failure is invisible from outside. The header is on
> the wire, `curl -I` shows it, and the page exfiltrates anyway.
>
> `server.js` therefore carries the policy **both ways**: the header on every `/engines/`
> response, and the identical directive injected as a `<meta>` at the very start of every
> engine HTML document, because a meta CSP only governs content parsed after it.
> Full detail in `docs/contracts/arena.md` and in the `/engines/` route.

**You can only inject into bytes you serve.** That is the whole argument. Pointing the
frame at `https://registry.example/engines/foo/index.html` silently discards the one
carrier that was measured to work and leaves the containment resting on the carrier that
was measured to fail. Three further things go with it:

- **Offline.** A local-first product that fetches its simulation at mount time is not one.
- **Version pinning.** A remote URL is whatever the host serves today. Pinning per session
  requires bytes that cannot change underneath the student — see the hash, below.
- **Telemetry.** Every mount would tell the registry what a student is studying. The whole
  point of a dumb index synced once and searched locally is that it never has to.

> [!done] The registry is a static file host, and that is a requirement rather than a
> convenience
> `Alexandria - Discovery and Scale`: the registry publishes a compact index, instances
> sync it and search it **locally**, and the whole thing can sit on a CDN — which matters
> when an open source project is paying for it. It has no query endpoint, no per-query
> telemetry, and no dynamic behaviour to reason about. A registry that answers questions is
> a registry that learns what a student is studying.

## The model chooses; deterministic code installs

There is never an agent with filesystem or network tools in the supply chain.

`Alexandria - Discovery and Scale` calls auto-install a supply chain, and that framing is
the reason: a matcher pulling community code into a session holding a student's coursework
is a distribution channel for whatever is in the catalog. The split:

| Step | Who | Why it sits on that side |
|---|---|---|
| Decide *which* engine | The model | Judgment about fit is the one thing code cannot do |
| Return the decision | The model, as **structured data** — an id and a version | A URL, a path or a command in that slot puts the model in the supply chain |
| Resolve the id in the index | Code | A lookup, not a judgment |
| Fetch, hash, extract, validate | Code | Every one of these is a rule with a right answer |
| Mount | Code, behind the arena | `docs/contracts/arena.md` owns everything past this point |

This mirrors a rule the repo already holds: **no test may call a model**, and nothing in a
test path may import `src/claude.js` or spawn anything. The install path takes the same
prohibition for the same reason — it must be reproducible, offline-checkable, and identical
every run.

> [!danger] The prompt-injection edge runs backwards through here too
> A hostile engine's `notes` field flows into the agent's context, which is why `CAPS`
> bounds it at 600 characters and the arena treats everything the tenant sends as data,
> never instruction. An installer that let a model name a path would open the same edge one
> layer earlier and with far more authority: a matcher whose shortlist came from
> author-written description text would be choosing what to download from adversarial
> input. Structured facets do the culling; the model only ever sees a shortlist.

## The fetch happens in Node, so CORS never applies

The browser never talks to the registry. It talks to `localhost`, and `localhost` talks to
the registry.

This is worth stating because it removes a whole configuration surface the website agent
would otherwise have to get right: **the registry needs no `access-control-allow-origin`,
no preflight handling, and no origin allowlist.** A Node `fetch` is not subject to the same-
origin policy; only a browser is.

The one CORS header that *does* exist in this codebase is unrelated and must not be
generalised from: `server.js` sends `access-control-allow-origin: *` on `/engines/`
responses because a `<script type="module">` is fetched in CORS mode, and from the engine
frame's **opaque** origin that request is cross-origin even for our own URL. It grants
nothing — `connect-src 'none'` already blocks every fetch the engine could make with the
permission. It is a fact about opaque origins, not about the registry.

## Versioned install paths

`Alexandria - Storage` settles the layout, and this contract adopts it for engines:

```
packages/
  worlds/<id>/<version>/
  engines/<id>/<version>/
```

A version directory is written once and never edited. An update is a **new sibling**, not a
mutation, which is what lets two versions sit side by side while different sessions pin
different ones. A version becomes collectable when no live session names it — a reference
count, not a policy, so nothing has to remember to run.

Today the repo serves `engines/<id>/`, one level, no version segment.

> [!done] `enginePackageBase()` is the only place an engine URL is constructed
> ```js
> export function enginePackageBase(engine) {
>   return `/engines/${engine.id}`;
> }
> ```
> `src/engine.js` says so in its header comment and means it: `entryUrl()` builds on it, the
> arena calls it, and nothing else joins a string. Adding the version segment is a change to
> that one return value. `src/assets.js` holds the exact twin for worlds — `packageBase()`,
> with the same comment naming the version segment and the custom protocol as the two things
> that will change there. Both seams already exist, which is the part `Alexandria - Storage`
> asked for before the fan-out opened.

> [!warning] It is the only **URL** site, not the only change site
> `server.js` enumerates engines at startup with a one-level `readdir` over `engines/` and
> reads `engines/<dir>/engine.json`. Under `<id>/<version>/` that loop looks for
> `engines/<id>/engine.json`, finds nothing, and dies at boot. The enumeration is a second
> edit, in a shared file. Do not plan the migration as a one-liner on the strength of the
> `enginePackageBase()` claim — that claim is about URLs and it is exactly true about URLs.

The directory name must equal the manifest `id`: `server.js` composes the on-disk path from
`url.pathname`, `enginePackageBase()` composes the URL from `engine.id`, and the fixture
suite pins that a package's id matches its directory. Under the versioned layout the same
rule extends to the version segment — see invariant 5.

## The hash stays even when everything is vetted

Keep the digest even in a future where every package in the catalog is human-reviewed and
every author is known.

**It is not about trusting the author.** It is about the bytes not changing underneath a
student mid-topic, which is precisely what version pinning means. `Alexandria - Storage`
records that two independently written rules land on this same requirement from opposite
directions: `Alexandria - Discovery and Scale` wants pinning so a package cannot change
under a student mid-topic, and `Alexandria - World Spec` wants it so a package cannot
restage material a student is part-way through. Supply chain and determinism want the same
disk layout, and they want the same digest.

A version number is an author's claim about identity. A hash is a fact about bytes. `0.1.0`
re-published with one line changed is still `0.1.0`, and a session that pinned it has no way
to notice — unless the digest is what it pinned.

Second-order, and worth having: it makes an install **idempotent and cheap to verify**. Two
sessions asking for the same version get the same directory, and re-running an install is a
comparison rather than a download.

## Install-time safety

Three details that need care rather than cleverness. Each is a rule with a right answer,
which is why the whole step is ordinary code.

| Hazard | The rule | Why it is not obvious |
|---|---|---|
| **Zip slip** | Every archive member's resolved path must land inside the target version directory. Reject absolute paths, any `..` segment, anything with a URL scheme, and **symlinks** | `src/engine.js` already has exactly this rule as `escapes()` — but it is module-private and applied to **one string, `entry`**. The installer needs it applied to every member of the archive, before extraction, not after. `Alexandria - Storage` adds the symlink half: resolve symlinks **at install time**, so a link pointing out of the package is a rejected install rather than a live escape hatch |
| **Verify before you write** | Hash the fetched archive and compare it to the index entry **before a single byte reaches the packages root** | Hashing after extraction means the failure path is a cleanup, and a cleanup that runs on a hostile input is the least trustworthy code in the system. Nothing has to be undone if nothing was done |
| **Size** | Cap total **uncompressed** bytes and member count, enforced as extraction proceeds | A declared size is author-supplied and a compressed size says nothing: the whole point of a decompression bomb is that the header is small and honest. The cap has to be counted, not read |

> [!warning] The cap's actual number is not decided, and must not be invented here
> `Alexandria - Storage` gives install-size and working-set budgets — and marks every one of
> them a **design estimate, not a measurement**, existing so the first conformance run has
> something concrete to fail against. They are also world-side figures; engines are the
> "light, mostly logic" half and have no budget written down at all. Pick a number when
> something has measured one.

A fourth rule is layout rather than safety, and it comes from `Alexandria - Storage`:
extract into a temporary directory and **move it into place with an atomic rename**, so a
version directory either does not exist or is whole. This is not premature care. Since the
spine's removal every lookup is live, so a download starts inside a window that is going to
close — the interactive it was covering ends, the student moves on, and the fetch is
abandoned part-written. **Abandonment is the normal case, not the crash case.** A loader
that enumerates directories will meet abandoned ones routinely.

## The index format

One JSON file, fetched whole, parsed in Node, searched locally. A worked entry, with the
two shipped teaching engines as the source of truth for every field:

```json
{
  "index": 1,
  "generated": "2026-08-28T04:11:00Z",
  "engines": [
    {
      "id": "molecule-builder",
      "version": "0.1.0",
      "name": "Molecule Builder",
      "author": "Alexandria samples",
      "review": "unreviewed",
      "subject": "chemistry",
      "levels": ["lower-secondary", "upper-secondary"],
      "scored": true,
      "pitch": "Build molecules and check valence, from individual atoms — single covalent bonds only, so no O2, CO2 or N2.",
      "taskKinds": ["build-target", "free-build"],
      "topic": ["science/chemistry/bonding/covalent"],
      "archive": "packages/engines/molecule-builder/0.1.0.tar.gz",
      "hash": "sha256-K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=",
      "bytes": 41216
    },
    {
      "id": "microscope",
      "version": "0.1.0",
      "name": "Compound Microscope",
      "author": "Alexandria samples",
      "review": "unreviewed",
      "subject": "biology",
      "levels": ["lower-secondary", "upper-secondary"],
      "scored": true,
      "pitch": "Focus a slide on a compound microscope and count the procedural mistakes made getting there.",
      "taskKinds": ["focus-specimen", "power-series"],
      "topic": ["science/biology/microscopy"],
      "archive": "packages/engines/microscope/0.1.0.tar.gz",
      "hash": "sha256-3f8dcbFhKSK9BsE1NnO0hRCF3+Sd0mDYc1lNBOBLxTA=",
      "bytes": 63488
    }
  ]
}
```

Notes on the shape, each with its reason:

- `index: 1` is a **format** version, mirroring `PROTOCOL = 1` in `src/engine.js`. An
  installer that meets a number it does not know must refuse the whole file rather than
  best-effort a subset it may be misreading.
- `archive` is **relative to the index's own URL**, so the host can move — or be mirrored —
  without rewriting every entry. It is a path in the index, never a path handed to the
  filesystem: the installer joins it to the registry base and passes the result to `fetch`,
  and the local path is composed from `id` and `version` alone.
- `hash` is written in the Subresource Integrity form, `<algorithm>-<base64>`, so the
  algorithm travels with the digest and a future migration is not a flag day. The digest
  covers the **archive**, one fetch and one comparison. A per-file list would need per-file
  digests plus a digest over the list, which is the same guarantee with more moving parts —
  and extraction is already in the pipeline, which is why zip slip is on the hazard list at
  all.
- `bytes` is the archive's size, and it is a **hint for the UI, never the cap**. The cap
  counts uncompressed bytes during extraction, per the table above.
- The two digests above are **illustrative placeholders**. Nothing has been packaged, so
  no real archive of either engine exists to have hashed.

### Which fields are duplicated, and which are new

The distinction matters because a duplicated field can **disagree** with the package it
describes, and the resolution has to be written down rather than discovered.

| Index field | Origin |
|---|---|
| `id`, `version`, `name`, `author`, `review`, `subject`, `scored` | **Verbatim** from `engine.json`. All seven are in `REQUIRED` in `validateEngine` |
| `levels` | **Verbatim** from `engine.json`. All four shipped manifests declare it — and no rule in `validateEngine` requires or checks it. See the warning below |
| `taskKinds` | **Derived**: `Object.keys(manifest.taskSpace)`. `validateEngine` already guarantees this is non-empty, and that every kind has a `job` line and at least one parameter |
| `pitch` | **Derived**: the manifest's `pitch` if present, else the fallback `src/interactive.js` already applies, `` `${name}, for ${subject}` ``. This is the matcher-facing one-liner and it is folded into the schema's enum description, so it talks to the model |
| `archive`, `hash`, `bytes` | **New.** Nothing in a manifest describes where its own bytes live or what they weigh |
| `topic` | **New**, and the address the specificity tree walks. An array because topics are a graph, not a tree — see open items |
| `index`, `generated` | **New.** Properties of the file, not of any package |

`entry` is deliberately **not** in the index. It is needed only after install, it is already
containment-checked by `validateEngine` against the package's own manifest, and a second
copy of a path that a security rule depends on is a second thing to keep in agreement.

The full `taskSpace` is **not** in the index either. The matcher shortlists on `taskKinds`
and `levels`; the parameter schemas are only ever needed by `buildTaskSchema`, which runs
against an **installed** engine. Carrying them would multiply the index's size by the
longest `job` line in the catalog — `microscope`'s task space alone is longer than every
other field of its entry combined — for data no lookup reads. The index is a search
surface; the installed manifest is the runtime one.

> [!danger] The index is a search surface. The installed manifest is authoritative
> After extraction the installer re-reads the package's own `engine.json`, runs
> `validateEngine`, and **rejects the install** if `id` or `version` disagree with the index
> entry it fetched or with the directory it is being written into. Everything the runtime
> reads comes from the manifest on disk. Nothing downstream ever consults the index again.
>
> Without this the index becomes a second, editable copy of the package's identity — and
> `docs/contracts/arena.md` already holds the general form of that rule: *provenance the
> tenant can edit is not provenance.*

> [!warning] `review` is author-declared today, and the tier rule that would consume it is open
> `validateEngine` checks `review` against `['unreviewed', 'community', 'verified']` and
> nothing else. It is a value the author typed in their own manifest. The arena stamps it
> into the ledger payload as provenance, and the proposed tiering rule — verified may
> auto-install silently, unverified needs a deliberate yes — would make it a **permission**.
>
> A permission a package grants itself is not a permission. So either the registry owns the
> field and the installer overwrites the manifest's copy, or the tier lives in the index
> beside the hash and the manifest's `review` becomes decorative. **This is not decided**,
> and both the tiering rule and the field's ownership are recorded as open below.

### The world half of the index

Specified here so the site has one format, and marked plainly: **it cannot be consumed
yet.** See the next section.

A world entry carries `id`, `version`, `name`, `author`, `archetype` and `viewport` from
`world.json` — the last two because they decide whether a world can stage what a student
is about to read, and `viewport` is what the runtime letterboxes to. Plus the storefront
fields that have no manifest origin at all: screenshots, a demo module, and the install
size `Alexandria - Storage` says the chrome lists beside every installed world.

`Alexandria - World Spec` adds three numbers the **conformance run** should measure and the
registry should publish: generation time, repair rate and asset weight — because a world
that repairs thirty percent of the time is a slow world, and that should be visible before
installing rather than discovered mid-lesson. `Alexandria - Storage` sharpens the third:
asset weight is three numbers, not one — install size, decoded working set, per-screen
delta — because only the last of them is ever visible mid-lesson. No conformance run exists,
so all four are index fields with nothing to fill them.

## Preconditions the installer holds

| Precondition | Why |
|---|---|
| The index has been fetched and parsed **in Node** | The browser never speaks to the registry, so CORS never applies |
| The chooser's decision is an `id` and a `version`, and nothing else | A URL, a path or a command in that slot puts the model in the supply chain |
| The packages root is writable and is **not** inside the `.app` bundle | Writing into a signed bundle invalidates its signature, and an update replaces the bundle wholesale — every installed package disappears on upgrade, silently. `Alexandria - Storage` |
| The staging directory is on the **same filesystem** as the packages root | An atomic rename across filesystems is a copy, and a copy is observable half-done |
| `packages/engines/<id>/<version>/` does not already exist | Version directories are write-once. An existing one is a hit, not a conflict |
| The uncompressed-size cap is known before the first byte is written | A cap checked after the download has already spent the disk |
| The entry's `subject` does not start with `_` | `isTestEngine` in `src/interactive.js`. `hostile-probe` and `never-ready` are boundary fixtures, and `docs/contracts/arena.md` says keep them out of any registry — the publisher applies the same one-line rule so a future fixture cannot forget to opt out |

## Invariants owned

Mechanically checkable, in the spirit of `CONTRACT.md`. Where an invariant is a grep, it
says so, because a grep should be run rather than claimed.

| Invariant | Enforced by |
|---|---|
| 1. **Atomic install.** A version directory either does not exist or is whole, hashed and validated | Staging directory plus a single rename |
| 2. **Containment.** Every archive member resolves inside its own version directory, and no member is a symlink | The `escapes()` rule applied per member, before extraction |
| 3. **Hash before write.** No byte reaches the packages root until the digest matches the index entry | Ordering in the installer |
| 4. **Immutability.** A version directory is never written to after it lands | An update is a new sibling |
| 5. **Identity agreement.** The installed `engine.json` passes `validateEngine`, and its `id` and `version` equal both the index entry and the two path segments it sits under | Re-read and compare after extraction |
| 6. **Local serving.** No engine URL names a remote origin. Every byte the browser sees came from Alexandria's own server, with the CSP header **and** the injected `<meta>` | `enginePackageBase()` is the only construction site — this is a grep |
| 7. **Purity preserved.** The fetch does not live in `src/` | `CONTRACT.md` invariant 3 forbids network there. Also a grep |
| 8. **No model in the install path.** Nothing between the decision and the mount imports `src/claude.js` or spawns a process | The same rule the test path already holds. Also a grep |
| 9. **Failure is named.** A rejected install says which rule and which package, in the shape `validateEngine` already returns | `CONTRACT.md` failure policy |

Invariant 9 has a consequence the site inherits: **the index cannot be the only place a
rejection is explained.** An author whose package is refused at install time is not looking
at the registry's logs.

## What is blocked: worlds have no install target

The world half of this contract can be **specified** and cannot be **consumed**. Stated
plainly rather than papered over, because a website agent building a world storefront
against it will otherwise assume there is something on the other end.

Measured against the repository as it stands:

| What an install needs | What exists |
|---|---|
| A packages directory | None. `worlds/` and `engines/` sit at the repo root, unversioned |
| Enumerate and validate what is in it | Only for **engines**: `server.js` reads every directory under `engines/`, runs `validateEngine`, and throws at boot on a bad one. Worlds get no equivalent |
| More than one world resolvable at a time | `const WORLD_ID = process.env.WORLD ?? 'cartoon'` — read **once**, at module scope, before the server listens. `worldDir` and the parsed manifest are module-level constants |
| A projector that can unmount one world and mount another | Nothing. `grep -rn "unmount\|remount\|switchWorld\|mountWorld" public/ src/` returns nothing at all |
| A manifest validator to run at install | **None for worlds.** `docs/contracts/world-loader.md` §6 documents this in full: `server.js` does a bare `JSON.parse` and the only manifest rule enforced anywhere is one line about one channel's `kind`. Its table lists sixteen ways a world manifest breaks, and the "never" rows are worlds that install clean and misbehave in front of a student |

`Alexandria - Packaging` puts this work first of its three stages, calls it the bulk of them,
and says it is what "actually closes the one-world-chosen-by-an-env-var shortcut". It is
unbuilt. So:

> [!danger] Do not build a world storefront that implies an install button works
> The install half of the world path has no destination, and — worse — no validator, so a
> package accepted from a stranger today would be trusted wholesale. The engine half is
> genuinely ready for a registry in a way the world half is not, and the asymmetry is not
> visible from the outside: both are "community packages" on the same site.
>
> The honest surface until `Alexandria - Packaging` stage 1 lands is a **browse-and-download**
> world gallery — the folder a student drags into their worlds directory by hand, which is
> the drop `Alexandria - Storage` calls the feature rather than an implementation detail.

One thing on the world side is **not** blocked and is worth recording because
`Alexandria - Storage` flagged it as a pre-fan-out deadline: the asset resolver contract
landed. `src/assets.js` owns `packageBase()` and `resolveAsset()`, the projector never joins
a string, and the header comment names the version segment and the custom protocol as the
two things that change there. The world half lacks a loader, not a seam.

## The scaling ceiling

Recorded accurately, because it is the thing the registry exists to eventually fix and it is
also the thing that is fine today.

`src/interactive.js` builds **one** schema containing every installed engine: the picker's
enum lists every id with its pitch line, and the object carries one optional parameter block
per engine per task kind. That is one call, filled by one long-lived generator, and it is
forced rather than tidy — the adapter fixes its schema at spawn, so a schema per purpose
would mean a **process** per purpose, and process startup is 4.5–13s against a window of
8–22s. Spawning to decide what fills the wait would cost more than the wait.

The file names its own ceiling in a comment: putting the catalog in the model's context is
how *Find Skills* works and, per `Alexandria - Discovery and Scale`, exactly what stops
working at scale. Descriptions become adversarial the moment authors realise a matcher is
reading them, and semantic search alone degrades as a catalog fills with near-duplicates.

**At PoC size, catalog-in-context IS exact matching** rather than an approximation of it.
Two teaching engines fit in a prompt with room to spare, and the model sees the whole truth.
Nothing is wrong yet.

> [!done] `pickEngine` is the named seam
> ```js
> export function pickEngine(engines, chosen) {
>   return engines.find((e) => e.id === chosen) ?? null;
> }
> ```
> A specificity-tree walk replaces the **body** of that function and nothing else — no
> caller learns anything new, and nothing outside `src/interactive.js` names an engine. The
> tree's cost is O(depth), not O(catalog): walk the path deterministically and locally with
> no tokens, rank siblings only when a node holds several, and involve the model only when
> several siblings are genuinely plausible. A catalog of two hundred thousand entries costs
> the same lookup as one of two hundred.

The seam is the reason the ceiling is not urgent. It is also the reason the index carries
`topic` and `levels` as first-class fields from day one: those are the two axes the walk
uses, and `Alexandria - Discovery and Scale` is explicit that level is a **second axis, not
more depth** — a lattice builder for a fifteen-year-old and one for a second-year
undergraduate sit at the same topic and differ completely.

## Open, and not resolved here

Every item below is a real decision that has not been made. None is resolved in this
document, and an implementer meeting one should record what they did and why rather than
treat this list as permission.

- **What minimum must be true before auto-install ships.** `Alexandria - Open Questions`
  poses it as one of the ways to guarantee the project fails: *"Auto-install unsigned
  community code, chosen by a matcher, into a session holding a student's coursework… Both
  are currently in the design. What is the minimum that has to be true before auto-install
  ships?"* Unanswered. Everything in this contract is necessary for it and none of it is
  claimed to be sufficient.
- **The tiering rule is a bullet, not a specification.** "Verified packages may auto-install
  silently; unverified ones require a deliberate yes" is one line in
  `Alexandria - Discovery and Scale`. What a deliberate yes looks like, what a student is
  shown, whether the answer is remembered per package or per session, and what happens
  mid-lesson when the answer is no, are all unwritten.
- **Who owns `review`.** Author-declared in the manifest today; a permission under the
  tiering rule. Registry-owned, installer-overwritten, or index-side beside the hash —
  undecided. See the danger callout above.
- **Signing.** `Alexandria - Discovery and Scale` calls for a *signed* index and for
  "signing and provenance in the index, visible to the student". No scheme, no key
  distribution and no trust root is decided. The index format above leaves room for a
  signature and does not specify one.
- **Is the matcher first-party or swappable?** Open in `Alexandria - Discovery and Scale`:
  it is the thing quality depends on most, which argues first-party, but hardcoding it
  forecloses better ones later.
- **Who owns the topic taxonomy.** Facets only work if they mean something. Free tags rot,
  a fixed tree ages badly, and curricula are carved differently in every country. Wiki-style
  maintenance, derivation from a standard, and emergent tags with periodic consolidation are
  the three options and none is clean. Related and equally open: topics are a **graph**, not
  a tree — multi-parent registration with one canonical path is probably unavoidable, which
  is why `topic` is an array above and why nothing here says what a canonical path is.
- **The level vocabulary.** `levels` is declared by every shipped manifest and checked by no
  rule in `validateEngine`. The two values in use are `lower-secondary` and
  `upper-secondary`. Whether that list is closed, who owns it, and whether it is the same
  authority as the topic taxonomy, are open.
- **Placement is gameable, and the check on it is unspecified.** Registering shallow gets
  more traffic. `Alexandria - Discovery and Scale`: whatever check exists on this is doing
  real work — and none exists.
- **Depth is not quality.** Selection should be the deepest candidate that clears a quality
  bar, not the deepest candidate. No bar is defined.
- **Precomputed embeddings.** Named as part of the index. Not needed until sibling ranking
  exists, which is not until a node holds several candidates. The format above does not
  carry them.
- **Cold start.** Does an instance ship with a starter index or sync on first run?
- **The size cap's value**, per the warning above — no measured engine budget exists.
- **Whether `~/Alexandria/` holds all of `packages/` or only worlds**, with engines staying
  hidden because nobody hand-installs one. `Alexandria - Storage`, unresolved.
- **What the loader does with a package that is whole but fails validation** — refuse it
  silently, or surface it as installed-and-broken so the author who dragged it in learns
  why. `Alexandria - Storage`, unresolved, and it is the same question invariant 9 raises
  from the installer's side.
- **Bootstrapping the catalog.** `Alexandria - Interactives` asks whether permissively
  licensed simulation catalogs — PhET and similar — could seed the registry through an
  adapter, turning cold start into an integration problem. Licences unchecked.

## What this document is not

It is not a design for the site's pages, and it does not scaffold one. It fixes the
**format** the site publishes and the **rules** the installer holds, so that the two can be
built in either order by different people and still meet.

Nothing in this contract has been executed. Every claim about the repository above was read
out of the files named — `src/engine.js`, `src/interactive.js`, `src/assets.js`, `server.js`,
the four shipped `engine.json` manifests, and `docs/contracts/world-loader.md` §6 — and every
claim about a decision was read out of the vault note cited beside it. The CSP measurement is
quoted from `docs/contracts/arena.md`, which recorded it from a live run; it was not
re-measured here.
