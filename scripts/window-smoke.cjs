const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  for (const method of ['button', 'native', 'quit']) {
    const profile = await fs.mkdtemp(
      path.join(os.tmpdir(), 'imagescout-window-'),
    );
    const env = { ...process.env, SCOUT_TEST_PROFILE: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    const instance = await electron.launch(
      process.env.SCOUT_TEST_EXECUTABLE
        ? { executablePath: process.env.SCOUT_TEST_EXECUTABLE, args: [], env }
        : { args: [path.resolve(__dirname, '..')], env },
    );
    try {
      const page = await instance.firstWindow();
      await page.waitForSelector('.brand');
      assert.equal(await page.locator('.brand').innerText(), 'ImageScout');
      await page.getByRole('button', { name: 'Hide window' }).click();
      assert.equal(
        await instance.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0].isVisible(),
        ),
        false,
      );
      await instance.evaluate(({ app }) => app.emit('second-instance'));
      await page.waitForFunction(() => document.visibilityState === 'visible');
      const theme = await page.locator('html').getAttribute('data-theme');
      await page
        .getByRole('button', {
          name: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        })
        .click();
      await page.reload();
      assert.notEqual(
        await page.locator('html').getAttribute('data-theme'),
        theme,
      );
      assert.ok(
        (
          await page.evaluate(() => window.scout.settings())
        ).vaultPath.startsWith(profile),
      );
      const fixture = [
        ...(await fs.readFile(
          path.join(__dirname, '..', 'resources', 'icon.png'),
        )),
      ];
      const imported = await page.evaluate(
        (bytes) =>
          window.scout.vault.importDropped([
            { name: 'Logo.png', bytes: new Uint8Array(bytes) },
          ]),
        fixture,
      );
      assert.equal(imported.records.length, 1);
      assert.equal(
        (await page.evaluate(() => window.scout.vault.list())).length,
        1,
      );
      const closed = instance.waitForEvent('close', { timeout: 15000 });
      if (method === 'button')
        await page.getByRole('button', { name: 'Quit ImageScout' }).click();
      else
        await instance.evaluate(({ app, BrowserWindow }, method) => {
          setTimeout(
            () =>
              method === 'native'
                ? BrowserWindow.getAllWindows()[0].close()
                : app.quit(),
            50,
          );
        }, method);
      await closed;
      console.log(
        `PASS: ${method} exits; hide preserves window; theme persists.`,
      );
    } finally {
      await instance.close().catch(() => {});
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
