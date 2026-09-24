const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, clipboard, ClipboardItem, safeStorage, shell, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { searchImages, downloadImage } = require('./services.cjs');
const { VaultStore, MAX_FILE_BYTES, MAX_BATCH_BYTES, MAX_BATCH_FILES } = require('./vault.cjs');

if (process.env.SCOUT_TEST_PROFILE) app.setPath('userData', process.env.SCOUT_TEST_PROFILE);
let window, tray, vault, migrationSummary = null, config = {}, shortcut = '', shortcutWarning = '', quitting = false;
const searches = new Map();
const dropSessions = new Map();
const DROP_SESSION_MS = 60 * 1000;
const entry = path.join(__dirname, '..', 'dist', 'index.html');
const configPath = () => path.join(app.getPath('userData'), 'settings.json');
const downloadsPath = () => process.env.SCOUT_TEST_DOWNLOADS || app.getPath('downloads');
const show = () => { if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); window.webContents.send('window:focus-search'); };
const toggle = () => window?.isVisible() && window.isFocused() ? window.hide() : show();

async function readConfig() {
  try { config = JSON.parse(await fs.readFile(configPath(), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') shortcutWarning = 'Settings could not be read. Please set up your key again.'; }
}
function getKey() {
  if (process.env.SERPAPI_API_KEY) return process.env.SERPAPI_API_KEY;
  if (!config.key) return '';
  try { return safeStorage.decryptString(Buffer.from(config.key, 'base64')); }
  catch { throw new Error('Your saved key could not be unlocked. Enter it again in Settings.'); }
}
function registerShortcut(next) {
  if (next === shortcut) return;
  let registered = false;
  try { registered = globalShortcut.register(next, toggle); } catch { /* Invalid accelerator. */ }
  if (!registered) throw new Error('That shortcut is unavailable. Try Ctrl+Alt+Space.');
  if (shortcut) globalShortcut.unregister(shortcut);
  shortcut = next;
}
function settings() {
  return { hasKey: !!(config.key || process.env.SERPAPI_API_KEY), shortcut, shortcutWarning, downloads: downloadsPath(), vaultPath: vault?.root };
}
function assertString(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${name}.`);
  return value.trim();
}
function handle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
    return handler(...args);
  });
}
function decodeImage(buffer) {
  const image = nativeImage.createFromBuffer(buffer);
  if (image.isEmpty()) throw new Error('This image format could not be opened. Try another image.');
  const { width, height } = image.getSize();
  if (width * height > 64000000) throw new Error('This image is too large. Try a smaller image.');
  return image;
}
async function imageFromRequest(request) {
  if (request.savedId) {
    return decodeImage(await vault.bytes(request.savedId));
  }
  if (request.png) {
    if (!(request.png instanceof Uint8Array) || request.png.length > 20 * 1024 * 1024) throw new Error('Invalid image data.');
    return decodeImage(Buffer.from(request.png));
  }
  return decodeImage(await downloadImage(assertString(request.url, 'image URL', 8192)));
}
function normalizePng(buffer) {
  const image = decodeImage(buffer);
  const { width, height } = image.getSize();
  const previewWidth = Math.min(300, width);
  return { png: image.toPNG(), width, height, preview: image.resize({ width: previewWidth }).toDataURL() };
}
async function writeClipboard(bytes) {
  const png = Buffer.from(bytes);
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
}
function legacyRecord(record) {
  const query = record.sources?.find((source) => source.query)?.query || record.title;
  return { ...record, query, path: true };
}
async function importBatch(files, readBytes) {
  if (!Array.isArray(files)) throw new Error('Import files must be a list.');
  if (files.length > MAX_BATCH_FILES) throw new Error(`Import at most ${MAX_BATCH_FILES} files at once.`);
  const records = [], errors = [];
  let total = 0;
  for (const file of files) {
    const name = path.basename(String(file?.name || 'Image')).slice(0, 160) || 'Image';
    try {
      const declaredSize = Number(file?.size);
      if (Number.isFinite(declaredSize)) {
        if (declaredSize > MAX_FILE_BYTES) throw new Error('Image exceeds the 20 MB file limit.');
        if (total + declaredSize > MAX_BATCH_BYTES) throw new Error('The import exceeds the 200 MB batch limit.');
      }
      const bytes = Buffer.from(await readBytes(file));
      if (bytes.length > MAX_FILE_BYTES) throw new Error('Image exceeds the 20 MB file limit.');
      if (total + bytes.length > MAX_BATCH_BYTES) throw new Error('The import exceeds the 200 MB batch limit.');
      total += bytes.length;
      records.push(await vault.ingest(bytes, { title: path.parse(name).name, originalFilename: name, origin: 'upload' }));
    } catch (error) { errors.push({ name, reason: error.message || 'File could not be imported.' }); }
  }
  return { records, errors };
}
async function selectedPickerFiles() {
  if (!(process.env.SCOUT_TEST_PROFILE && process.env.SCOUT_TEST_PICKER_FILES)) {
    const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'tif', 'tiff', 'avif'] }
    ] });
    return result.canceled ? [] : result.filePaths;
  }
  let files;
  try { files = JSON.parse(process.env.SCOUT_TEST_PICKER_FILES); }
  catch { throw new Error('Invalid test picker files.'); }
  if (!Array.isArray(files) || files.length > MAX_BATCH_FILES || files.some(file => typeof file !== 'string')) {
    throw new Error('Invalid test picker files.');
  }
  return files.map(file => path.resolve(file));
}
function pruneDropSessions() {
  const now = Date.now();
  for (const [token, session] of dropSessions) if (session.expiresAt <= now) {
    clearTimeout(session.timer); dropSessions.delete(token);
  }
}
function beginDrop(manifest) {
  pruneDropSessions();
  if (!Array.isArray(manifest)) throw new Error('Import files must be a list.');
  if (manifest.length > MAX_BATCH_FILES) throw new Error(`Import at most ${MAX_BATCH_FILES} files at once.`);
  let total = 0;
  const files = [], accepted = [], errors = [];
  manifest.forEach((file, sourceIndex) => {
    const name = path.basename(String(file?.name || 'Image')).slice(0, 160) || 'Image';
    const size = Number(file?.size);
    let reason;
    if (!Number.isSafeInteger(size) || size < 0) reason = `${name} has an invalid size.`;
    else if (size > MAX_FILE_BYTES) reason = `20 MB file limit exceeded by ${name}.`;
    else if (total + size > MAX_BATCH_BYTES) reason = 'The import exceeds the 200 MB batch limit.';
    if (reason) { errors.push({ name, reason }); return; }
    total += size;
    files.push({ name, size });
    accepted.push({ sourceIndex, name });
  });
  if (!files.length) return { token: null, accepted, errors };
  const token = randomUUID();
  const session = { files, next: 0, actualBytes: 0, expiresAt: Date.now() + DROP_SESSION_MS };
  session.timer = setTimeout(() => dropSessions.delete(token), DROP_SESSION_MS);
  session.timer.unref?.();
  dropSessions.set(token, session);
  return { token, accepted, errors };
}
async function ingestDropFile(token, index, name, bytes) {
  pruneDropSessions();
  const session = dropSessions.get(token);
  if (!session) throw new Error('Drop import session expired.');
  const expected = session.files[session.next];
  if (index !== session.next || !expected || name !== expected.name) {
    clearTimeout(session.timer); dropSessions.delete(token); throw new Error('Drop import order is invalid.');
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== expected.size) {
    clearTimeout(session.timer); dropSessions.delete(token); throw new Error('Dropped image size does not match its manifest.');
  }
  if (session.actualBytes + bytes.byteLength > MAX_BATCH_BYTES) {
    clearTimeout(session.timer); dropSessions.delete(token); throw new Error('The import exceeds the 200 MB batch limit.');
  }
  try {
    session.actualBytes += bytes.byteLength;
    const record = await vault.ingest(Buffer.from(bytes), {
      title: path.parse(expected.name).name, originalFilename: expected.name, origin: 'upload'
    });
    return { record };
  } catch (error) {
    return { error: { name: expected?.name || 'Image', reason: error.message || 'File could not be imported.' } };
  } finally {
    session.next += 1;
    clearTimeout(session.timer);
    if (session.next >= session.files.length) dropSessions.delete(token);
    else {
      session.expiresAt = Date.now() + DROP_SESSION_MS;
      session.timer = setTimeout(() => dropSessions.delete(token), DROP_SESSION_MS);
      session.timer.unref?.();
    }
  }
}
async function initializeVault() {
  vault = await new VaultStore(app.getPath('userData'), { normalizePng }).init();
  const marker = path.join(vault.root, '.legacy-migration-v1.json');
  try { await fs.access(marker); return; } catch { /* First migration attempt. */ }
  try { migrationSummary = await vault.migrate(path.join(app.getPath('userData'), 'library.json')); }
  catch (error) { migrationSummary = { imported: 0, duplicates: 0, skipped: [], error: error.message }; return; }
  await fs.writeFile(marker, JSON.stringify(migrationSummary), 'utf8').catch(() => {});
}
function setupHandlers() {
  handle('settings:get', settings);
  handle('settings:set', async (input) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid settings.');
    const next = { ...config };
    if (input.apiKey) {
      const key = assertString(input.apiKey, 'API key', 256);
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable. Your key was not saved.');
      next.key = safeStorage.encryptString(key).toString('base64');
    }
    const oldShortcut = shortcut;
    if (input.shortcut) registerShortcut(assertString(input.shortcut, 'shortcut', 80));
    next.shortcut = shortcut;
    try {
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      const temporary = `${configPath()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next));
      await fs.rename(temporary, configPath());
    } catch { if (oldShortcut && oldShortcut !== shortcut) registerShortcut(oldShortcut); throw new Error('Settings could not be saved. Please try again.'); }
    config = next; shortcutWarning = ''; return settings();
  });
  handle('images:search', async (query, tabId) => {
    query = assertString(query, 'search', 200); tabId = assertString(tabId, 'tab', 100);
    const key = getKey(); if (!key) throw new Error('Add your SerpApi key in Settings to start searching.');
    searches.get(tabId)?.abort(); const controller = new AbortController(); searches.set(tabId, controller);
    try { return await searchImages(query, key, { signal: controller.signal }); }
    finally { if (searches.get(tabId) === controller) searches.delete(tabId); }
  });
  handle('images:bytes', async (url) => new Uint8Array((await imageFromRequest({ url })).toPNG()));
  handle('images:save', async (request) => {
    if (!request || typeof request !== 'object') throw new Error('Invalid image request.');
    const query = assertString(request.query, 'search title', 200);
    let record = request.savedId ? await vault.get(request.savedId) : null;
    if (!record) {
      const image = await imageFromRequest(request);
      record = await vault.ingest(image.toPNG(), { title: String(request.title || query).slice(0, 160), query,
        sourceUrl: request.url, origin: request.png ? 'cutout' : 'search' });
    }
    let warning;
    if (request.copy) {
      try { await writeClipboard(await vault.bytes(record.id)); }
      catch { warning = 'Saved to the Vault, but the clipboard is busy. Try Copy again from the Vault.'; }
    } else await vault.export(record.id, downloadsPath(), query);
    return { record: legacyRecord(record), warning };
  });
  handle('vault:info', () => { const summary = migrationSummary; migrationSummary = null; return { path: vault.root, migration: summary }; });
  handle('vault:import', async () => {
    const files = [];
    for (const file of await selectedPickerFiles()) {
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw new Error('Not a file.');
        files.push({ name: path.basename(file), file, size: stat.size });
      }
      catch { files.push({ name: path.basename(file), file }); }
    }
    return importBatch(files, item => fs.readFile(item.file));
  });
  handle('vault:drop-begin', beginDrop);
  handle('vault:drop-file', ingestDropFile);
  handle('vault:list', () => vault.list());
  handle('vault:bytes', async id => new Uint8Array(await vault.bytes(id)));
  handle('vault:copy', async id => { await writeClipboard(await vault.bytes(id)); return vault.get(id); });
  handle('vault:export', async id => ({ record: await vault.get(id), file: await vault.export(id, downloadsPath()) }));
  handle('vault:reveal', async id => { await vault.bytes(id); shell.showItemInFolder(path.join(vault.imagesDirectory, `${id}.png`)); });
  handle('vault:delete', id => vault.delete(id));
  handle('window:hide', () => window.hide());
}
function createWindow() {
  window = new BrowserWindow({ width: 1000, height: 740, minWidth: 700, minHeight: 480, show: false,
    frame: false, backgroundColor: '#101113', title: 'Image Scout', icon: path.join(__dirname, '..', 'resources', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== pathToFileURL(entry).href) event.preventDefault(); });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.once('ready-to-show', show);
  window.loadFile(entry);
}
function createTray() {
  const size = 32; const bytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4; const r = Math.hypot(x - 15.5, y - 15.5);
    const mark = r > 7 && r < 11 || (x >= 20 && x <= 25 && y >= 20 && y <= 25 && Math.abs(x - y) < 3);
    bytes[offset] = 245; bytes[offset + 1] = mark ? 180 : 30; bytes[offset + 2] = mark ? 173 : 30; bytes[offset + 3] = mark ? 255 : 0;
  }
  tray = new Tray(nativeImage.createFromBitmap(bytes, { width: size, height: size }));
  tray.setToolTip('Image Scout'); tray.on('click', show);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Image Scout', click: show }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }]));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null); await readConfig();
    await initializeVault();
    setupHandlers(); createWindow(); createTray();
    try { registerShortcut(config.shortcut || 'Alt+Space'); }
    catch { try { registerShortcut('Control+Alt+Space'); shortcutWarning = 'Alt+Space is in use. Image Scout is using Ctrl+Alt+Space.'; } catch { shortcutWarning = 'Global shortcut unavailable. Choose another in Settings; the tray icon still opens Image Scout.'; } }
  }).catch(() => { require('electron').dialog.showErrorBox('Image Scout', 'The app could not start. Please check that the app folder is writable and try again.'); app.quit(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    for (const session of dropSessions.values()) clearTimeout(session.timer);
    dropSessions.clear();
    for (const request of searches.values()) request.abort();
  });
  app.on('window-all-closed', () => {});
}
