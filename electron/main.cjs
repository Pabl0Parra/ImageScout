const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, clipboard, ClipboardItem, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { searchImages, downloadImage, saveUniqueImage, LibraryStore } = require('./services.cjs');

if (process.env.SCOUT_TEST_PROFILE) app.setPath('userData', process.env.SCOUT_TEST_PROFILE);
let window, tray, library, config = {}, shortcut = '', shortcutWarning = '', quitting = false;
const searches = new Map();
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
  return { hasKey: !!(config.key || process.env.SERPAPI_API_KEY), shortcut, shortcutWarning, downloads: downloadsPath() };
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
    const record = (await library.list()).find((item) => item.id === request.savedId);
    if (!record) throw new Error('Saved image not found.');
    return decodeImage(await fs.readFile(record.path));
  }
  if (request.png) {
    if (!(request.png instanceof Uint8Array) || request.png.length > 20 * 1024 * 1024) throw new Error('Invalid image data.');
    return decodeImage(Buffer.from(request.png));
  }
  return decodeImage(await downloadImage(assertString(request.url, 'image URL', 8192)));
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
    const image = await imageFromRequest(request);
    let record;
    if (request.savedId) record = (await library.list()).find((item) => item.id === request.savedId);
    else {
      const file = await saveUniqueImage(downloadsPath(), query, image.toPNG());
      record = { id: randomUUID(), query, title: String(request.title || query).slice(0, 500), path: file,
        preview: image.resize({ width: 300 }).toDataURL(), createdAt: new Date().toISOString(), cutout: !!request.png };
      try { await library.add(record); } catch { throw new Error('Image saved to Downloads, but Saved history could not be updated.'); }
    }
    let warning;
    if (request.copy) {
      try { await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]); }
      catch { warning = 'Saved to Downloads, but the clipboard is busy. Try Copy again from Saved.'; }
    }
    return { record, warning };
  });
  handle('library:list', () => library.list());
  handle('library:reveal', async (id) => {
    const record = (await library.list()).find((item) => item.id === id);
    if (!record) throw new Error('Saved image not found.');
    await fs.access(record.path).catch(() => { throw new Error('This file was moved or deleted from Downloads.'); });
    shell.showItemInFolder(record.path);
  });
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
    library = new LibraryStore(path.join(app.getPath('userData'), 'library.json'));
    setupHandlers(); createWindow(); createTray();
    try { registerShortcut(config.shortcut || 'Alt+Space'); }
    catch { try { registerShortcut('Control+Alt+Space'); shortcutWarning = 'Alt+Space is in use. Image Scout is using Ctrl+Alt+Space.'; } catch { shortcutWarning = 'Global shortcut unavailable. Choose another in Settings; the tray icon still opens Image Scout.'; } }
  }).catch(() => { require('electron').dialog.showErrorBox('Image Scout', 'The app could not start. Please check that the app folder is writable and try again.'); app.quit(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); for (const request of searches.values()) request.abort(); });
  app.on('window-all-closed', () => {});
}
