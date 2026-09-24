const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { saveUniqueImage } = require('./services.cjs');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 200 * 1024 * 1024;
const MAX_BATCH_FILES = 50;
const MAX_PIXELS = 64 * 1000 * 1000;
const MAX_PREVIEW_LENGTH = 256 * 1024;
const VALID_ID = /^[a-f0-9]{64}$/;

function sanitizeDisplayName(value) {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const cleaned = leaf.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/^[ .]+|[ .]+$/g, '').slice(0, 160).trim();
  return cleaned || 'Image';
}

function validateImportBatch(files) {
  if (!Array.isArray(files)) throw new Error('Import files must be a list.');
  if (files.length > MAX_BATCH_FILES) throw new Error(`Import at most ${MAX_BATCH_FILES} files at once.`);
  let totalBytes = 0;
  for (const file of files) {
    const name = sanitizeDisplayName(file?.name);
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size < 0) throw new Error(`${name} has an invalid size.`);
    if (size > MAX_FILE_BYTES) throw new Error(`20 MB file limit exceeded by ${name}.`);
    totalBytes += size;
  }
  if (totalBytes > MAX_BATCH_BYTES) throw new Error('The import exceeds the 200 MB batch limit.');
  return { totalBytes };
}

function uniqueStrings(values) {
  const seen = new Set();
  return values.filter(value => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function publicRecord(record) {
  const { managedPath, ...safe } = record;
  return structuredClone(safe);
}

function validPersistedRecords(records) {
  const seen = new Set();
  return records.filter(record => {
    if (!record || !VALID_ID.test(String(record.id || '')) || seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  }).map(({ managedPath: _ignored, ...record }) => record);
}

class VaultStore {
  constructor(userDataRoot, { normalizePng, exporter = saveUniqueImage } = {}) {
    if (typeof normalizePng !== 'function') throw new TypeError('VaultStore requires normalizePng.');
    if (typeof exporter !== 'function') throw new TypeError('VaultStore requires an exporter.');
    this.root = path.join(path.resolve(userDataRoot), 'vault');
    this.imagesDirectory = path.join(this.root, 'images');
    this.libraryFile = path.join(this.root, 'library.json');
    this.normalizePng = normalizePng;
    this.exporter = exporter;
    this.records = [];
    this.pending = Promise.resolve();
    this.initialized = false;
  }

  async init() {
    await fs.mkdir(this.imagesDirectory, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.libraryFile, 'utf8'));
      if (!Array.isArray(parsed)) throw new Error('Vault library is invalid.');
      this.records = validPersistedRecords(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.records = [];
    }
    this.initialized = true;
    return this;
  }

  _ready() {
    if (!this.initialized) throw new Error('VaultStore must be initialized first.');
  }

  _record(id) {
    if (!VALID_ID.test(String(id || ''))) throw new Error('Vault item not found.');
    return this.records.find(record => record.id === id) || null;
  }

  _imagePath(id) {
    if (!VALID_ID.test(String(id || ''))) throw new Error('Vault item not found.');
    return path.join(this.imagesDirectory, `${id}.png`);
  }

  async list() {
    this._ready();
    await this.pending;
    return this.records.map(publicRecord);
  }

  async get(id) {
    this._ready();
    await this.pending;
    const record = this._record(id);
    return record ? publicRecord(record) : null;
  }

  async bytes(id) {
    this._ready();
    await this.pending;
    const record = this._record(id);
    if (!record) throw new Error('Vault item not found.');
    return fs.readFile(this._imagePath(record.id));
  }

  ingest(bytes, metadata = {}) {
    this._ready();
    const input = Buffer.from(bytes);
    if (input.length > MAX_FILE_BYTES) return Promise.reject(new Error('Image exceeds the 20 MB file limit.'));
    const operation = this.pending.then(async () => {
      const normalized = await this.normalizePng(input);
      const png = Buffer.from(normalized?.png || []);
      const width = Number(normalized?.width);
      const height = Number(normalized?.height);
      if (!png.length || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Unsupported image.');
      }
      if (width * height > MAX_PIXELS) throw new Error('Image exceeds the 64 megapixels limit.');
      const id = createHash('sha256').update(png).digest('hex');
      const existing = this.records.find(record => record.id === id);
      const now = new Date().toISOString();
      const title = String(metadata.title || '').trim().slice(0, 160) || 'Image';
      const originalFilename = metadata.originalFilename ? sanitizeDisplayName(metadata.originalFilename) : undefined;
      const source = metadata.query || metadata.sourceUrl
        ? { query: String(metadata.query || '').trim().slice(0, 160), url: String(metadata.sourceUrl || '').trim().slice(0, 2048) }
        : null;
      const aliases = uniqueStrings([...(existing?.aliases || []), title, originalFilename]);
      const sources = [...(existing?.sources || [])];
      if (source && !sources.some(item => item.query === source.query && item.url === source.url)) sources.push(source);
      const origins = uniqueStrings([...(existing?.origins || []), String(metadata.origin || '').trim()]);
      const record = {
        id,
        title: existing?.title || title,
        ...(existing?.originalFilename || originalFilename ? { originalFilename: existing?.originalFilename || originalFilename } : {}),
        aliases,
        sources,
        origins,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        width,
        height,
        ...(typeof (normalized.preview || metadata.preview) === 'string' && (normalized.preview || metadata.preview).length <= MAX_PREVIEW_LENGTH
          ? { preview: normalized.preview || metadata.preview }
          : existing?.preview ? { preview: existing.preview } : {})
      };
      const file = this._imagePath(id);
      let created = false;
      try {
        const handle = await fs.open(file, 'wx');
        try { await handle.writeFile(png); } finally { await handle.close(); }
        created = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const next = existing
        ? this.records.map(item => item.id === id ? record : item)
        : [record, ...this.records];
      try {
        await this._writeLibrary(next);
      } catch (error) {
        if (created) await fs.unlink(file).catch(() => {});
        throw error;
      }
      this.records = next;
      return publicRecord(record);
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async _writeLibrary(records) {
    const temporary = `${this.libraryFile}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(records, null, 2), 'utf8');
      await fs.rename(temporary, this.libraryFile);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async export(id, directory, title) {
    const record = await this.get(id);
    if (!record) throw new Error('Vault item not found.');
    return this.exporter(directory, title || record.title, await this.bytes(id));
  }

  delete(id) {
    this._ready();
    const operation = this.pending.then(async () => {
      const record = this._record(id);
      if (!record) return false;
      const file = this._imagePath(record.id);
      const staged = path.join(this.imagesDirectory, `.${record.id}.${randomUUID()}.delete`);
      let moved = false;
      try { await fs.rename(file, staged); moved = true; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const next = this.records.filter(item => item.id !== id);
      try {
        await this._writeLibrary(next);
      } catch (error) {
        if (moved) await fs.rename(staged, file);
        throw error;
      }
      this.records = next;
      if (moved) await fs.unlink(staged).catch(() => {});
      return true;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }

  async migrate(source) {
    this._ready();
    let legacyRecords;
    if (Array.isArray(source)) {
      legacyRecords = source;
    } else {
      try {
        legacyRecords = JSON.parse(await fs.readFile(source, 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return { imported: 0, duplicates: 0, skipped: [] };
        throw new Error('Legacy saved-image metadata could not be read.');
      }
    }
    if (!Array.isArray(legacyRecords)) throw new Error('Legacy saved-image metadata is invalid.');
    const report = { imported: 0, duplicates: 0, skipped: [] };
    for (const legacy of legacyRecords) {
      const name = String(legacy?.title || legacy?.query || sanitizeDisplayName(legacy?.path)).trim().slice(0, 160) || 'Image';
      try {
        if (!legacy || typeof legacy.path !== 'string' || !legacy.path) throw new Error('missing');
        const input = await fs.readFile(legacy.path);
        const countBefore = (await this.list()).length;
        await this.ingest(input, {
          title: legacy.title || legacy.query || path.parse(sanitizeDisplayName(legacy.path)).name,
          originalFilename: sanitizeDisplayName(legacy.path),
          origin: legacy.origin || (legacy.query ? 'search' : 'upload'),
          query: legacy.query,
          sourceUrl: legacy.url,
          preview: legacy.preview
        });
        if ((await this.list()).length > countBefore) report.imported += 1;
        else report.duplicates += 1;
      } catch (error) {
        report.skipped.push({ name, reason: error.code === 'ENOENT' ? 'File is missing.' : 'File could not be imported.' });
      }
    }
    return report;
  }

  migrateLegacy(source) {
    return this.migrate(source);
  }
}

module.exports = {
  VaultStore,
  validateImportBatch,
  sanitizeDisplayName,
  MAX_FILE_BYTES,
  MAX_BATCH_BYTES,
  MAX_BATCH_FILES,
  MAX_PIXELS
};
