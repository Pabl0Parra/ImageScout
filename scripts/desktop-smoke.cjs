const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scout-desktop-'));
  const profile = path.join(temporary, 'profile');
  const downloads = path.join(temporary, 'downloads');
  const fixture = path.join(temporary, 'Offline violet.png');
  const secondFixture = path.join(temporary, 'Offline coral.png');
  const env = { ...process.env, SCOUT_TEST_PROFILE: profile, SCOUT_TEST_DOWNLOADS: downloads,
    SCOUT_TEST_PICKER_FILES: JSON.stringify([fixture, secondFixture]) };
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(profile, 'library.json'), '{ invalid legacy json', 'utf8');
  const mainSource = await fs.readFile(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
  assert.ok(!mainSource.includes("handle('vault:import-dropped'"), 'Drop bytes must not cross IPC as a whole batch');
  assert.ok(mainSource.includes("handle('vault:drop-begin'") && mainSource.includes("handle('vault:drop-file'"));
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
    const secondPng = await app.evaluate(({ nativeImage }) => {
      const bytes = Buffer.from([240, 110, 90, 255, 240, 110, 90, 255, 240, 110, 90, 255, 240, 110, 90, 255]);
      return [...nativeImage.createFromBitmap(bytes, { width: 2, height: 2 }).toPNG()];
    });
    await fs.writeFile(fixture, Buffer.from(png));
    await fs.writeFile(secondFixture, Buffer.from(secondPng));
    const picked = await page.evaluate(() => window.scout.vault.import());
    assert.equal(picked.records.length, 2);
    const imported = await page.evaluate((png) => window.scout.vault.importDropped([
      { name: 'Offline violet duplicate.png', bytes: new Uint8Array(png) },
      { name: 'broken.txt', bytes: new Uint8Array([1, 2, 3]) }
    ]), png);
    assert.equal(imported.records.length, 1);
    assert.equal(imported.errors.length, 1);
    assert.equal(imported.errors[0].name, 'broken.txt');
    assert.equal('managedPath' in imported.records[0] || 'path' in imported.records[0], false);
    const partialOversize = await page.evaluate((png) => window.scout.vault.importDropped([
      { name: 'too-large.png', bytes: new Uint8Array(20 * 1024 * 1024 + 1) },
      { name: 'still-valid.png', bytes: new Uint8Array(png) }
    ]), png);
    assert.equal(partialOversize.records.length, 1);
    assert.equal(partialOversize.errors.length, 1);
    assert.equal(partialOversize.errors[0].name, 'too-large.png');
    const vaultInfo = await page.evaluate(() => window.scout.vault.info());
    assert.ok(vaultInfo.path.endsWith('vault'));
    // The renderer consumes this one-time notice on startup; a second bridge read may be null.
    assert.ok(vaultInfo.migration === null || vaultInfo.migration.error, 'Invalid legacy migration must be reported once');
    await assert.rejects(fs.access(path.join(profile, 'vault', '.legacy-migration-v1.json')));
    assert.equal((await page.evaluate(() => window.scout.vault.list())).length, 2);
    await page.evaluate(id => window.scout.vault.reveal(id), picked.records[0].id);
    await page.evaluate(() => window.scout.vault.reveal('../outside').then(
      () => { throw new Error('Expected malformed-ID rejection'); }, error => { if (!error.message.includes('not found')) throw error; }
    ));
    const web = await page.evaluate(() => window.scout.save({
      query: 'google logo', title: 'Google logo', copy: false,
      url: 'https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png'
    }));
    assert.ok(web.record.id);
    assert.ok((await page.evaluate(() => window.scout.vault.list())).some(record => record.origins.includes('search')));
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
    const copied = await page.evaluate((png) => window.scout.save({ query: 'monkey', title: 'Smoke cutout', png: new Uint8Array(png), copy: true }), png);
    assert.equal(copied.warning, undefined, 'Copy must succeed without clipboard warnings');
    assert.deepEqual(await fs.readdir(downloads), ['Google logo (1).png'], 'Copy must not add a Downloads export');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.has('image/png')), true);
    assert.equal((await page.evaluate(() => window.scout.vault.list())).length, 3, 'Identical local content must deduplicate');
    await page.evaluate(id => window.scout.vault.export(id), copied.record.id);
    await page.evaluate(id => window.scout.vault.export(id), copied.record.id);
    assert.deepEqual((await fs.readdir(downloads)).sort(), ['Google logo (1).png', 'Offline violet (1).png', 'Offline violet (2).png']);
    const bytes = await page.evaluate(id => window.scout.vault.bytes(id).then(value => [...value.slice(0, 8)]), copied.record.id);
    assert.deepEqual(bytes, [137,80,78,71,13,10,26,10]);
    await page.evaluate(() => window.scout.vault.importDropped(Array.from({ length: 51 }, (_, index) => ({ name: `${index}.png`, bytes: new Uint8Array() }))).then(
      () => { throw new Error('Expected file-count rejection'); }, error => { if (!error.message.includes('50')) throw error; }
    ));
    await fs.mkdir(path.join(__dirname, '..', 'test-results'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'test-results', 'desktop.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.deepEqual(faults, []);
    await app.close(); app = null;
    await fs.writeFile(path.join(profile, 'library.json'), '[]', 'utf8');
    app = await launch();
    const restarted = await app.firstWindow();
    await restarted.waitForSelector('#root > *');
    assert.equal((await restarted.evaluate(() => window.scout.settings())).hasKey, true);
    const retriedMigration = await restarted.evaluate(() => window.scout.vault.info());
    assert.ok(retriedMigration.migration === null || retriedMigration.migration.error === undefined);
    await fs.access(path.join(profile, 'vault', '.legacy-migration-v1.json'));
    assert.equal((await restarted.evaluate(() => window.scout.vault.list())).length, 3);
    await restarted.evaluate(async () => window.scout.vault.copy((await window.scout.vault.list())[0].id));
    assert.equal((await fs.readdir(downloads)).length, 3);
    await restarted.evaluate(async () => Promise.all((await window.scout.vault.list()).map(record => window.scout.vault.delete(record.id))));
    assert.equal((await restarted.evaluate(() => window.scout.vault.list())).length, 0);
    console.log('PASS: desktop launch, encrypted key, dropped partial import, Vault dedupe, copy, numbered exports, persistence, delete, limits, and close-to-tray.');
  } finally {
    if (app) await app.close();
    const root = path.resolve(os.tmpdir());
    if (path.dirname(temporary) === root && path.basename(temporary).startsWith('scout-desktop-')) await fs.rm(temporary, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
