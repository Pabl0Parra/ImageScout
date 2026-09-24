const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scout-desktop-'));
  const profile = path.join(temporary, 'profile');
  const downloads = path.join(temporary, 'downloads');
  const env = { ...process.env, SCOUT_TEST_PROFILE: profile, SCOUT_TEST_DOWNLOADS: downloads };
  delete env.ELECTRON_RUN_AS_NODE; delete env.SERPAPI_API_KEY;
  let app;
  const launch = () => electron.launch(process.env.SCOUT_TEST_EXECUTABLE
    ? { executablePath: process.env.SCOUT_TEST_EXECUTABLE, args: [], env }
    : { args: [path.resolve(__dirname, '..')], env });
  try {
    app = await launch();
    const page = await app.firstWindow();
    await page.waitForSelector('#root > *');
    const faults = []; page.on('pageerror', (error) => faults.push(error.message));
    const before = await page.evaluate(() => window.scout.settings());
    assert.equal(before.hasKey, false);
    assert.ok(before.shortcut);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await page.waitForTimeout(300);
    await app.evaluate(({ app }) => app.emit('second-instance'));
    await page.waitForTimeout(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false, 'Launcher must restore minimized window');
    await page.evaluate(() => window.scout.configure({ apiKey: 'smoke-test-not-a-real-api-key' }));
    const rawSettings = await fs.readFile(path.join(profile, 'settings.json'), 'utf8');
    assert.ok(!rawSettings.includes('smoke-test-not-a-real-api-key'));
    assert.equal((await page.evaluate(() => window.scout.settings())).hasKey, true);
    const png = await app.evaluate(({ nativeImage }) => {
      const bytes = Buffer.from([120, 80, 200, 255, 120, 80, 200, 255, 120, 80, 200, 255, 120, 80, 200, 255]);
      return [...nativeImage.createFromBitmap(bytes, { width: 2, height: 2 }).toPNG()];
    });
    if (process.env.SCOUT_TEST_MODEL === '1') {
      const assets = await fs.readdir(path.join(__dirname, '..', 'dist', 'assets'));
      const workerFile = assets.find((name) => /^background\.worker-.*\.js$/.test(name));
      assert.ok(workerFile, 'Built background worker must exist');
      page.on('console', (message) => { if (message.type() === 'error') console.log('Renderer:', message.text()); });
      const modelResult = await page.evaluate(({ png, workerFile }) => new Promise((resolve, reject) => {
        const worker = new Worker(new URL(`assets/${workerFile}`, location.href), { type: 'module' });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('Model test timed out')); }, 180000);
        worker.onmessage = ({ data }) => {
          if (data.progress) return;
          clearTimeout(timer); worker.terminate();
          if (data.error) reject(new Error(data.error)); else resolve([...new Uint8Array(data.bytes).slice(0, 8)]);
        };
        worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
        worker.postMessage(new Uint8Array(png));
      }), { png, workerFile });
      assert.deepEqual(modelResult, [137,80,78,71,13,10,26,10]);
      console.log('PASS: real local background-removal inference returned PNG.');
    }
    const results = await page.evaluate(async (png) => Promise.all([1, 2].map(() => window.scout.save({ query: 'monkey', title: 'Smoke image', png: new Uint8Array(png), copy: true }))), png);
    assert.ok(results.every((result) => !result.warning), 'Copy must succeed without clipboard warnings');
    assert.equal(new Set(results.map(({ record }) => record.path)).size, 2);
    assert.deepEqual((await fs.readdir(downloads)).sort(), ['Monkey (1).png', 'Monkey (2).png']);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.has('image/png')), true);
    assert.equal((await page.evaluate(() => window.scout.library())).length, 2);
    await page.evaluate(() => window.scout.save({ query: 'monkey', savedId: undefined, png: new Uint8Array([]), copy: true }).catch((error) => { if (!error.message.includes('format')) throw error; }));
    await fs.mkdir(path.join(__dirname, '..', 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'desktop.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.deepEqual(faults, []);
    await app.close(); app = null;
    app = await launch();
    const restarted = await app.firstWindow();
    await restarted.waitForSelector('#root > *');
    assert.equal((await restarted.evaluate(() => window.scout.settings())).hasKey, true);
    assert.equal((await restarted.evaluate(() => window.scout.library())).length, 2);
    await restarted.evaluate(async () => {
      const records = await window.scout.library();
      await window.scout.save({ query: records[0].query, savedId: records[0].id, copy: true });
    });
    assert.equal((await fs.readdir(downloads)).length, 2);
    console.log('PASS: desktop launch, encrypted key, concurrent Downloads, real clipboard, history across restart, Saved copy, and close-to-tray.');
  } finally {
    if (app) await app.close();
    const root = path.resolve(os.tmpdir());
    if (path.dirname(temporary) === root && path.basename(temporary).startsWith('scout-desktop-')) await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
