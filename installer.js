// THE FETCH. Everything with a network or a filesystem in it, kept out of `src/` because
// `CONTRACT.md` invariant 3 forbids both there and `docs/contracts/registry.md` invariant 7
// names this file as the reason. The rules it enforces live in `src/install.js` and are
// tested without a network; what is here is ordering and I/O.
//
// THE ORDER IS THE SAFETY. Fetch, hash, and only then write — invariant 3 of the registry
// contract. Hashing after extraction would make the failure path a cleanup, and a cleanup
// running on hostile input is the least trustworthy code in the system. Nothing has to be
// undone if nothing was done.
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, mkdtemp, rename, rm, writeFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { validateEngine } from './src/engine.js';
import { CAPS, overCap, memberPath, checkEntry, checkIdentity, installPath } from './src/install.js';

const fail = (scope, reason) => ({ ok: false, failures: [{ scope, reason }] });

// ── A tar reader, deliberately small ──────────────────────────────────────────────
//
// Written rather than depended on, for two reasons that are both in the contract. Invariant
// 8 forbids spawning a process between the decision and the mount, so shelling out to `tar`
// is not available. And the size rule has to be COUNTED as extraction proceeds rather than
// read from a header — the whole point of a decompression bomb is that the header is small
// and honest — which means the loop has to be ours.
//
// Unhandled type flags are REFUSED BY NAME rather than skipped. A package using an exotic
// tar feature gets told so, which invariant 9 requires; silently ignoring an entry would let
// an archive contain something the installer never looked at.
function readTar(buf) {
  const out = [];
  let bytes = 0;
  for (let off = 0; off + 512 <= buf.length; ) {
    const head = buf.subarray(off, off + 512);
    if (head.every((b) => b === 0)) break;                     // end-of-archive block
    const str = (s, e) => head.subarray(s, e).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(str(124, 136) || '0', 8) || 0;
    const type = String.fromCharCode(head[156]) || '0';
    const name = str(0, 100);
    const prefix = str(345, 500);
    const full = prefix ? `${prefix}/${name}` : name;
    const body = off + 512;
    const stride = 512 + Math.ceil(size / 512) * 512;

    if (type === 'x' || type === 'g') { off += stride; continue; }   // pax metadata, no content
    if (type === '1' || type === '2') {
      // `Alexandria - Storage` adds the symlink half of containment: resolve links AT
      // INSTALL TIME, so a link pointing out of the package is a rejected install rather
      // than a live escape hatch sitting in the packages root.
      return { error: `"${full}" is a link, and a package may not contain one` };
    }
    if (type !== '0' && type !== '\0' && type !== '5') {
      return { error: `"${full}" has unsupported tar type "${type}"` };
    }
    if (type !== '5') {
      const m = memberPath(full);
      if (m.reason) return { error: m.reason };
      bytes += size;
      const over = overCap(bytes, out.length + 1);
      if (over) return { error: over };
      out.push({ path: m.path, data: buf.subarray(body, body + size) });
    }
    off += stride;
  }
  return { members: out };
}

const exists = (p) => access(p).then(() => true, () => false);

/**
 * Install one engine, by id and version and nothing else.
 *
 * `registry.md`: "The chooser's decision is an `id` and a `version`, and nothing else. A URL,
 * a path or a command in that slot puts the model in the supply chain." So the URL and the
 * digest are read from the INDEX here, and no caller may supply either.
 */
export async function installEngine({ id, version }, { index, indexUrl, packagesRoot }) {
  const entry = (index?.engines ?? []).find((e) => e.id === id && e.version === version);
  const bad = checkEntry(entry);
  if (bad.length) return { ok: false, failures: bad };

  const target = join(packagesRoot, installPath(entry.id, entry.version));
  // A version directory is write-once, so an existing one is a HIT rather than a conflict.
  if (await exists(target)) return { ok: true, already: true, path: target, entry };

  let raw;
  try {
    const res = await fetch(new URL(entry.path, indexUrl));
    if (!res.ok) return fail(id, `registry returned ${res.status} for ${entry.path}`);
    raw = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return fail(id, `could not fetch ${entry.path}: ${err.message}`);
  }
  // Capped on the way in as well. A compressed size says nothing about what it expands to,
  // but a download that is already enormous does not need to be expanded to be refused.
  if (raw.length > CAPS.bytes) return fail(id, `download exceeds ${CAPS.bytes} bytes`);

  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== entry.sha256) {
    return fail(id, `sha256 mismatch: index says ${entry.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…`);
  }

  let parsed;
  try {
    parsed = readTar(gunzipSync(raw));
  } catch (err) {
    return fail(id, `not a gzipped tar: ${err.message}`);
  }
  if (parsed.error) return fail(id, parsed.error);
  const members = parsed.members;
  if (!members.length) return fail(id, 'archive is empty');

  // STAGE INSIDE THE PACKAGES ROOT, not in the OS temp dir: a rename across filesystems is a
  // copy, and a copy is observable half-done. Same reason `registry.md` lists it as a
  // precondition rather than a detail.
  await mkdir(packagesRoot, { recursive: true });
  const staging = await mkdtemp(join(packagesRoot, '.staging-'));
  try {
    for (const m of members) {
      const dest = join(staging, m.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, m.data);
    }

    // INVARIANT 5, checked against the bytes that actually landed rather than what the index
    // promised: the installed manifest must agree with the index entry AND with the two path
    // segments it is about to sit under.
    let manifest = null;
    try { manifest = JSON.parse(await readFile(join(staging, 'engine.json'), 'utf8')); } catch { /* named below */ }
    const idFail = checkIdentity({ manifest, entry, idSegment: entry.id, versionSegment: entry.version });
    if (idFail.length) return { ok: false, failures: idFail };
    const engineFail = validateEngine(manifest);
    if (engineFail.length) {
      return { ok: false, failures: engineFail.map((f) => ({ scope: `${entry.id}@${entry.version}`, reason: `${f.scope}: ${f.reason}` })) };
    }

    await mkdir(dirname(target), { recursive: true });
    // THE ATOMIC MOVE. A version directory either does not exist or is whole. This matters
    // more than it looks since the spine's removal: a download starts inside a window that is
    // going to close, so ABANDONMENT IS THE NORMAL CASE, and a loader that enumerates
    // directories will meet half-written ones routinely unless they never exist.
    await rename(staging, target);
    return { ok: true, already: false, path: target, entry };
  } finally {
    // Only ever removes a staging directory that is still there, so the success path — where
    // the rename already moved it — is a no-op rather than a race.
    await rm(staging, { recursive: true, force: true });
  }
}

/** The index, fetched in Node so the browser never speaks to the registry and CORS never applies. */
export async function fetchIndex(indexUrl) {
  const res = await fetch(indexUrl);
  if (!res.ok) throw new Error(`registry index returned ${res.status}`);
  return res.json();
}
