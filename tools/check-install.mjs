// The IMPURE half of the installer, judged the only way it can be: against a real gzipped
// tar fetched over a real HTTP server. `tools/check-fixture.mjs` covers the decisions in
// `src/install.js`; the failures worth catching here are ordering ones — did a byte reach
// the packages root before the digest matched, did a refused install leave staging behind,
// did anything escape the version directory.
//
// The archives are BUILT HERE rather than committed. A hostile fixture checked into the repo
// is a hostile file on every clone, and a decompression bomb is 64MB of it.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { installEngine } from '../installer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0; const fails = [];
const ok = (name, cond, detail = '') => cond ? pass++ : fails.push(`${name}${detail ? '\n    ' + detail : ''}`);

// ── a minimal tar writer, so the tool needs nothing installed ─────────────────────
function header(name, size, type = '0', linkname = '') {
  const b = Buffer.alloc(512);
  const put = (s, off, len) => Buffer.from(String(s)).copy(b, off, 0, Math.min(String(s).length, len));
  put(name, 0, 100);
  put('0000644\0', 100, 8); put('0000000\0', 108, 8); put('0000000\0', 116, 8);
  put(size.toString(8).padStart(11, '0') + '\0', 124, 12);
  put('00000000000\0', 136, 12);
  b.write('        ', 148, 8);                     // checksum field is spaces while summing
  b.write(type, 156, 1);
  put(linkname, 157, 100);
  b.write('ustar\0', 257, 6); b.write('00', 263, 2);
  let sum = 0; for (const byte of b) sum += byte;
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return b;
}
const pad = (n) => Buffer.alloc((512 - (n % 512)) % 512);
function tar(entries) {
  const out = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    out.push(header(e.name, data.length, e.type ?? '0', e.linkname ?? ''), data, pad(data.length));
  }
  out.push(Buffer.alloc(1024));
  return Buffer.concat(out);
}

const engineJson = JSON.parse(await readFile(join(ROOT, 'engines/microscope/engine.json'), 'utf8'));
const manifest = (over = {}) => Buffer.from(JSON.stringify({ ...engineJson, ...over }));

// Each package's manifest carries ITS OWN id, because invariant 5 refuses a mismatch and a
// fixture that trips it by accident tests the wrong thing. `ident` is the one that mismatches
// on purpose.
const archives = {
  good:    tar([{ name: 'engine.json', data: manifest({ id: 'good' }) }, { name: 'index.html', data: Buffer.from('<!doctype html>') }]),
  escape:  tar([{ name: 'engine.json', data: manifest({ id: 'escape' }) }, { name: '../../../../tmp/alexandria-pwned', data: Buffer.from('owned') }]),
  symlink: tar([{ name: 'engine.json', data: manifest({ id: 'symlink' }) }, { name: 'secrets', type: '2', linkname: '/etc/passwd' }]),
  bomb:    tar([{ name: 'engine.json', data: manifest({ id: 'bomb' }) }, { name: 'big.bin', data: Buffer.alloc(40 * 1024 * 1024) }]),
  ident:   tar([{ name: 'engine.json', data: manifest({ id: 'something-else' }) }]),
  broken:  tar([{ name: 'engine.json', data: Buffer.from('{"id":"broken","version":"0.1.0"}') }]),
};

const files = {}, entries = [];
for (const [id, t] of Object.entries(archives)) {
  const gz = gzipSync(t);
  files[`/${id}.tgz`] = gz;
  entries.push({ id, version: '0.1.0', name: id, subject: 'biology', review: 'unreviewed',
                 path: `${id}.tgz`, sha256: createHash('sha256').update(gz).digest('hex'), bytes: gz.length });
}
// Same bytes as `good`, but the index lies about the digest.
entries.push({ ...entries[0], id: 'tampered', sha256: '0'.repeat(64) });
files['/tampered.tgz'] = files['/good.tgz'];
const index = { version: 1, engines: entries };
files['/index.json'] = Buffer.from(JSON.stringify(index));

const server = createServer((req, res) => {
  const f = files[req.url];
  if (!f) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(f);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const indexUrl = `http://127.0.0.1:${server.address().port}/index.json`;
const packagesRoot = await mkdtemp(join(tmpdir(), 'alexandria-install-'));
const exists = (p) => access(p).then(() => true, () => false);

try {
  const run = (id) => installEngine({ id, version: '0.1.0' }, { index, indexUrl, packagesRoot });

  const good = await run('good');
  ok('a well-formed package installs', good.ok, JSON.stringify(good.failures));
  ok('it lands under id/version', String(good.path).endsWith('engines/good/0.1.0'), good.path);

  const again = await run('good');
  ok('a version directory is write-once', again.ok && again.already);

  for (const [id, want] of [
    ['escape', 'walks outside the package'],
    ['symlink', 'is a link'],
    ['bomb', 'expands past'],
    ['ident', 'is not the index'],
    ['tampered', 'sha256 mismatch'],
    ['broken', 'taskSpace'],
  ]) {
    const r = await run(id);
    const said = (r.failures ?? []).map((f) => f.reason).join('; ');
    ok(`${id} is refused`, !r.ok, 'INSTALLED — this is a hole');
    ok(`${id} is refused BY NAME`, said.includes(want), `wanted /${want}/, got: ${said}`);
    ok(`${id} left nothing behind`, !(await exists(join(packagesRoot, 'engines', id, '0.1.0'))));
  }

  ok('nothing escaped the packages root', !(await exists('/tmp/alexandria-pwned')));
  const leftovers = (await readdir(packagesRoot)).filter((n) => n.startsWith('.staging-'));
  ok('no staging directory survives a refusal', leftovers.length === 0, leftovers.join(','));
} finally {
  server.close();
  await rm(packagesRoot, { recursive: true, force: true });
  await rm('/tmp/alexandria-pwned', { force: true });
}

console.log(`${pass} install checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`);
if (fails.length) { console.log('\n' + fails.join('\n')); process.exit(1); }
