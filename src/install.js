// THE INSTALL RULES — the half that is pure, so it can be tested without a network.
//
// `CONTRACT.md` invariant 3 forbids network and subprocess in `src/`, and
// `docs/contracts/registry.md` invariant 7 repeats it for exactly this file: "the fetch does
// not live in `src/`". So the decisions live here and `installer.js` beside `server.js` does
// the fetching, staging and renaming. Every rule below has a right answer, which is why the
// whole step is ordinary code rather than something clever.

// ── Containment ───────────────────────────────────────────────────────────────────
//
// `src/engine.js` already carries this rule as a module-private `escapes()`, applied to ONE
// string: the manifest's `entry`. An archive is the same rule against every member, and it
// has to run BEFORE extraction rather than after — a check that runs after the write has
// already lost.
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The safe relative path for an archive member, or the reason it is refused.
 * Refusal is a reason string because invariant 9 says a rejected install must name which
 * rule and which package, and "false" cannot be put in front of an author.
 */
export function memberPath(name) {
  const raw = String(name ?? '');
  if (!raw) return { reason: 'archive member has no name' };
  // A backslash is a separator on the platform the author may have packed on, and a
  // path that means one thing there and another here is exactly the confusion to refuse.
  if (raw.includes('\\')) return { reason: `"${raw}" contains a backslash` };
  if (SCHEME.test(raw)) return { reason: `"${raw}" looks like a URL, not a path` };
  if (raw.startsWith('/')) return { reason: `"${raw}" is absolute` };
  const parts = [];
  for (const seg of raw.split('/')) {
    // Tar writes directories as trailing-slash entries, so an empty segment is normal at
    // the end and meaningless in the middle. Both collapse to "skip".
    if (seg === '' || seg === '.') continue;
    // NOT resolved-then-compared. `..` is refused OUTRIGHT even when it would cancel out,
    // because a member that walks up and back down is describing a path it has no reason to
    // describe, and the cancelling version is the one that survives review.
    if (seg === '..') return { reason: `"${raw}" walks outside the package` };
    parts.push(seg);
  }
  if (!parts.length) return { reason: `"${raw}" resolves to nothing` };
  return { path: parts.join('/') };
}

// ── Caps ──────────────────────────────────────────────────────────────────────────
//
// A DECOMPRESSION-BOMB GUARD, and deliberately not a size budget. `registry.md` warns that
// the budget numbers in `Alexandria - Storage` are design estimates rather than measurements
// and must not be invented here, and that is still true — nothing has measured what an engine
// should be allowed to weigh. This is the other thing: a ceiling far above any real package,
// whose only job is that a small honest header cannot expand into the disk. The two shipped
// engines are 24KB and 64KB, so 32MB is roughly five hundred times the largest real one.
export const CAPS = { bytes: 32 * 1024 * 1024, members: 2000 };

/** Counted as extraction proceeds, never read from a header — that is the whole point. */
export function overCap(bytes, members) {
  if (members > CAPS.members) return `archive has more than ${CAPS.members} members`;
  if (bytes > CAPS.bytes) return `archive expands past ${CAPS.bytes} uncompressed bytes`;
  return null;
}

// ── Identity ──────────────────────────────────────────────────────────────────────
//
// Invariant 5: the installed manifest must agree with the index entry AND with the two path
// segments it sits under. Three sources, and a disagreement between any two is a refusal —
// the package that lands must be the package that was chosen.
export function checkIdentity({ manifest, entry, idSegment, versionSegment }) {
  const f = [];
  const say = (reason) => f.push({ scope: `${entry?.id ?? '?'}@${entry?.version ?? '?'}`, reason });
  if (!manifest || typeof manifest !== 'object') { say('engine.json is missing or unreadable'); return f; }
  if (manifest.id !== entry.id) say(`manifest id "${manifest.id}" is not the index's "${entry.id}"`);
  if (manifest.version !== entry.version) say(`manifest version "${manifest.version}" is not the index's "${entry.version}"`);
  if (manifest.id !== idSegment) say(`manifest id "${manifest.id}" is not the directory "${idSegment}"`);
  if (manifest.version !== versionSegment) say(`manifest version "${manifest.version}" is not the directory "${versionSegment}"`);
  return f;
}

// ── The index entry ───────────────────────────────────────────────────────────────
//
// Checked before anything is fetched. `registry.md`: the chooser's decision is an id and a
// version and NOTHING ELSE — a URL in that slot puts the model in the supply chain — so the
// URL and the digest are read from the index here, and the caller may not supply either.
const ID = /^[a-z0-9][a-z0-9-]*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function checkEntry(entry) {
  const f = [];
  const say = (reason) => f.push({ scope: entry?.id ?? 'entry', reason });
  if (!entry || typeof entry !== 'object') { say('no such package in the index'); return f; }
  if (!ID.test(String(entry.id ?? ''))) say(`id "${entry.id}" is not lowercase letters, digits and hyphens`);
  // Both path segments come from these, so a version that is not a plain triple would be a
  // directory name chosen by a stranger.
  if (!VERSION.test(String(entry.version ?? ''))) say(`version "${entry.version}" is not major.minor.patch`);
  if (!SHA256.test(String(entry.sha256 ?? ''))) say('sha256 is missing or not 64 hex characters');
  const p = memberPath(entry.path);
  if (p.reason) say(`path ${p.reason}`);
  // The publisher applies the same one-line rule as `isTestEngine`, so a future boundary
  // fixture cannot forget to opt out of the registry.
  if (String(entry.subject ?? '').startsWith('_')) say(`subject "${entry.subject}" is a test fixture and must not be published`);
  return f;
}

/** Where a package lands. Two segments, and a version directory is written once. */
export const installPath = (id, version) => `engines/${id}/${version}`;
