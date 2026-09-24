const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');

const { VaultStore, validateImportBatch, sanitizeDisplayName } = require('../electron/vault.cjs');

const PNG_A = Buffer.from('normalized-png-a');
const PNG_B = Buffer.from('normalized-png-b');

async function fixture(options = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'scout-vault-'));
  const normalizePng = options.normalizePng || (async bytes => {
    if (Buffer.from(bytes).toString() === 'bad') throw new Error('Unsupported image.');
    return { png: Buffer.from(bytes), width: 20, height: 10, preview: 'data:image/png;base64,cHJldmlldw==' };
  });
  const store = new VaultStore(userData, { normalizePng, exporter: options.exporter });
  await store.init();
  return { userData, store, cleanup: () => fs.rm(userData, { recursive: true, force: true }) };
}

test('ingests normalized PNG into the managed vault and exposes no paths', async () => {
  let received;
  const f = await fixture({ normalizePng: async bytes => {
    received = Buffer.from(bytes);
    return { png: PNG_A, width: 640, height: 480, preview: 'data:image/png;base64,AAA=' };
  }});
  try {
    const record = await f.store.ingest(Buffer.from('source-jpeg'), {
      title: 'Monkey portrait', originalFilename: '..\\private\\monkey?.jpg', origin: 'upload'
    });
    const digest = createHash('sha256').update(PNG_A).digest('hex');
    assert.equal(received.toString(), 'source-jpeg');
    assert.equal(record.id, digest);
    assert.equal(record.originalFilename, 'monkey.jpg');
    assert.equal(record.width, 640);
    assert.equal(record.height, 480);
    assert.equal(record.managedPath, undefined);
    assert.deepEqual(await fs.readFile(path.join(f.userData, 'vault', 'images', `${digest}.png`)), PNG_A);
    assert.deepEqual((await f.store.list()).map(item => item.id), [digest]);
    assert.deepEqual(await f.store.bytes(digest), PNG_A);
    assert.equal((await f.store.get(digest)).id, digest);
  } finally { await f.cleanup(); }
});

test('deduplicates by normalized bytes and merges searchable context', async () => {
  const f = await fixture({ normalizePng: async () => ({ png: PNG_A, width: 20, height: 10 }) });
  try {
    const first = await f.store.ingest(Buffer.from('one'), {
      title: 'Monkey', originalFilename: 'first.jpg', origin: 'search', query: 'monkeys', sourceUrl: 'https://one.example/a'
    });
    const second = await f.store.ingest(Buffer.from('two'), {
      title: 'Primate', originalFilename: 'second.png', origin: 'upload', query: 'apes', sourceUrl: 'https://two.example/a'
    });
    assert.equal(second.id, first.id);
    assert.deepEqual(second.aliases.sort(), ['Monkey', 'Primate', 'first.jpg', 'second.png'].sort());
    assert.deepEqual(second.origins.sort(), ['search', 'upload']);
    assert.deepEqual(second.sources, [
      { query: 'monkeys', url: 'https://one.example/a' },
      { query: 'apes', url: 'https://two.example/a' }
    ]);
    assert.equal((await f.store.list()).length, 1);
  } finally { await f.cleanup(); }
});

test('serializes metadata updates and leaves a valid atomic index', async () => {
  const f = await fixture();
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) => f.store.ingest(Buffer.from(`png-${index}`), {
      title: `Image ${index}`, origin: 'upload'
    })));
    const parsed = JSON.parse(await fs.readFile(path.join(f.userData, 'vault', 'library.json'), 'utf8'));
    assert.equal(parsed.length, 12);
    assert.equal((await fs.readdir(path.join(f.userData, 'vault'))).some(name => name.endsWith('.tmp')), false);
    const reopened = new VaultStore(f.userData, { normalizePng: async bytes => ({ png: Buffer.from(bytes), width: 1, height: 1 }) });
    await reopened.init();
    assert.equal((await reopened.list()).length, 12);
  } finally { await f.cleanup(); }
});

test('exports through the injected collision-safe exporter using stored bytes', async () => {
  const calls = [];
  const f = await fixture({ exporter: async (directory, title, bytes) => {
    calls.push({ directory, title, bytes: Buffer.from(bytes) });
    return path.join(directory, `${title} (1).png`);
  }});
  try {
    const record = await f.store.ingest(PNG_A, { title: 'Monkey', origin: 'search' });
    const output = await f.store.export(record.id, 'C:\\Downloads');
    assert.equal(output, path.join('C:\\Downloads', 'Monkey (1).png'));
    assert.equal(calls[0].title, 'Monkey');
    assert.deepEqual(calls[0].bytes, PNG_A);
  } finally { await f.cleanup(); }
});

test('deletes managed content and rejects unsafe or unknown record IDs', async () => {
  const f = await fixture();
  try {
    const record = await f.store.ingest(PNG_A, { title: 'Monkey', origin: 'upload' });
    await assert.rejects(f.store.get('../library.json'), /not found/i);
    await assert.rejects(f.store.bytes('unknown'), /not found/i);
    assert.equal(await f.store.delete(record.id), true);
    assert.equal(await f.store.get(record.id), null);
    await assert.rejects(fs.access(path.join(f.userData, 'vault', 'images', `${record.id}.png`)));
    assert.deepEqual(await f.store.list(), []);
  } finally { await f.cleanup(); }
});

test('removes a newly-created image when its metadata update fails', async () => {
  const f = await fixture();
  try {
    f.store._writeLibrary = async () => { throw new Error('disk full'); };
    const digest = createHash('sha256').update(PNG_A).digest('hex');
    await assert.rejects(f.store.ingest(PNG_A, { title: 'Monkey', origin: 'upload' }), /disk full/);
    await assert.rejects(fs.access(path.join(f.userData, 'vault', 'images', `${digest}.png`)));
  } finally { await f.cleanup(); }
});

test('validates file and batch upload limits', () => {
  assert.deepEqual(validateImportBatch([{ name: 'a.png', size: 1 }, { name: 'b.png', size: 2 }]), { totalBytes: 3 });
  assert.throws(() => validateImportBatch(Array.from({ length: 51 }, (_, i) => ({ name: `${i}.png`, size: 1 }))), /50/);
  assert.throws(() => validateImportBatch([{ name: 'huge.png', size: 20 * 1024 * 1024 + 1 }]), /20 MB.*huge\.png/i);
  assert.throws(() => validateImportBatch(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.png`, size: 20 * 1024 * 1024 }))), /200 MB/i);
  assert.equal(sanitizeDisplayName('C:\\private\\folder\\monkey?.jpg'), 'monkey.jpg');
});

test('rejects failed decoding, oversized decoded images, and oversized raw input', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.store.ingest(Buffer.from('bad'), { title: 'Bad', origin: 'upload' }), /unsupported/i);
    await assert.rejects(f.store.ingest(Buffer.alloc(20 * 1024 * 1024 + 1), { title: 'Large', origin: 'upload' }), /20 MB/i);
    const huge = new VaultStore(f.userData, { normalizePng: async () => ({ png: PNG_B, width: 9000, height: 8000 }) });
    await huge.init();
    await assert.rejects(huge.ingest(PNG_B, { title: 'Huge', origin: 'upload' }), /64 megapixels/i);
  } finally { await f.cleanup(); }
});

test('migrates readable legacy records while preserving useful metadata', async () => {
  const f = await fixture({ normalizePng: async bytes => ({ png: Buffer.from(`normalized:${bytes}`), width: 30, height: 40 }) });
  try {
    const legacyImage = path.join(f.userData, 'old', 'monkey.jpg');
    const legacyFile = path.join(f.userData, 'library.json');
    await fs.mkdir(path.dirname(legacyImage), { recursive: true });
    await fs.writeFile(legacyImage, 'legacy-bytes');
    await fs.writeFile(legacyFile, JSON.stringify([{
      id: 'old-id', title: 'Monkey portrait', query: 'funny monkeys', path: legacyImage,
      preview: 'data:image/png;base64,b2xk'
    }]), 'utf8');
    const report = await f.store.migrate(legacyFile);
    assert.deepEqual(report, { imported: 1, duplicates: 0, skipped: [] });
    const [record] = await f.store.list();
    assert.equal(record.title, 'Monkey portrait');
    assert.equal(record.originalFilename, 'monkey.jpg');
    assert.ok(record.aliases.includes('monkey.jpg'));
    assert.deepEqual(record.sources, [{ query: 'funny monkeys', url: '' }]);
    assert.deepEqual(record.origins, ['search']);
    assert.equal(record.preview, 'data:image/png;base64,b2xk');
    assert.equal(await fs.readFile(legacyFile, 'utf8').then(JSON.parse).then(rows => rows[0].id), 'old-id');
  } finally { await f.cleanup(); }
});

test('migration skips missing and unreadable legacy files without stopping valid imports', async () => {
  const f = await fixture();
  try {
    const valid = path.join(f.userData, 'valid.png');
    const unreadable = path.join(f.userData, 'unreadable.png');
    await fs.writeFile(valid, PNG_A);
    await fs.writeFile(unreadable, 'bad');
    const report = await f.store.migrateLegacy([
      { title: 'Missing image', path: path.join(f.userData, 'missing.png') },
      { title: 'Unreadable image', path: unreadable },
      { title: 'Valid image', path: valid }
    ]);
    assert.equal(report.imported, 1);
    assert.equal(report.skipped.length, 2);
    assert.deepEqual(report.skipped.map(item => item.name), ['Missing image', 'Unreadable image']);
    assert.ok(report.skipped.every(item => item.reason && !item.reason.includes(f.userData)));
  } finally { await f.cleanup(); }
});

test('legacy migration deduplicates identical content and remains idempotent', async () => {
  const f = await fixture({ normalizePng: async () => ({ png: PNG_A, width: 20, height: 10 }) });
  try {
    const first = path.join(f.userData, 'one.jpg');
    const second = path.join(f.userData, 'two.jpg');
    await fs.writeFile(first, 'one');
    await fs.writeFile(second, 'two');
    const legacy = [
      { title: 'Monkey', query: 'monkeys', path: first },
      { title: 'Ape', query: 'apes', path: second }
    ];
    const firstReport = await f.store.migrateLegacy(legacy);
    const secondReport = await f.store.migrateLegacy(legacy);
    assert.deepEqual(firstReport, { imported: 1, duplicates: 1, skipped: [] });
    assert.deepEqual(secondReport, { imported: 0, duplicates: 2, skipped: [] });
    const records = await f.store.list();
    assert.equal(records.length, 1);
    assert.ok(records[0].aliases.includes('Monkey'));
    assert.ok(records[0].aliases.includes('Ape'));
    assert.deepEqual(records[0].sources, [{ query: 'monkeys', url: '' }, { query: 'apes', url: '' }]);
  } finally { await f.cleanup(); }
});

test('reopening ignores persisted paths and malformed IDs without reading or deleting outside the vault', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'scout-vault-safe-'));
  const vaultDirectory = path.join(userData, 'vault');
  const imagesDirectory = path.join(vaultDirectory, 'images');
  const outside = path.join(userData, 'outside.png');
  const id = createHash('sha256').update(PNG_A).digest('hex');
  await fs.mkdir(imagesDirectory, { recursive: true });
  await fs.writeFile(path.join(imagesDirectory, `${id}.png`), PNG_A);
  await fs.writeFile(outside, 'outside-secret');
  await fs.writeFile(path.join(vaultDirectory, 'library.json'), JSON.stringify([
    { id, title: 'Safe', managedPath: '../outside.png', aliases: [], sources: [], origins: ['upload'] },
    { id: '../outside', title: 'Traversal', managedPath: '../outside.png' },
    { id: 'A'.repeat(64), title: 'Uppercase digest', managedPath: '../outside.png' }
  ]));
  try {
    const store = new VaultStore(userData, { normalizePng: async bytes => ({ png: Buffer.from(bytes), width: 1, height: 1 }) });
    await store.init();
    assert.deepEqual((await store.list()).map(record => record.id), [id]);
    assert.deepEqual(await store.bytes(id), PNG_A);
    assert.equal(await store.delete(id), true);
    assert.equal(await fs.readFile(outside, 'utf8'), 'outside-secret');
  } finally { await fs.rm(userData, { recursive: true, force: true }); }
});

test('failed deletion metadata commit restores the image and keeps the record usable', async () => {
  const f = await fixture();
  try {
    const record = await f.store.ingest(PNG_A, { title: 'Monkey', origin: 'upload' });
    f.store._writeLibrary = async () => { throw new Error('disk full'); };
    await assert.rejects(f.store.delete(record.id), /disk full/);
    assert.equal((await f.store.get(record.id)).title, 'Monkey');
    assert.deepEqual(await f.store.bytes(record.id), PNG_A);
    assert.equal((await f.store.list()).length, 1);
  } finally { await f.cleanup(); }
});
