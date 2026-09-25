import { test, expect } from '@playwright/test';

test('theme follows system preference, toggles, and persists across reload', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('quit, hide and Escape remain distinct actions', async ({ page }) => {
  await page.evaluate(() => {
    window.windowCalls = [];
    window.scout.quit = () => window.windowCalls.push('quit');
    window.scout.hide = () => window.windowCalls.push('hide');
  });
  await page.getByRole('button', { name: 'Quit ImageScout' }).click();
  await page.getByRole('button', { name: 'Hide window' }).click();
  await page.keyboard.press('Escape');
  await expect
    .poll(() => page.evaluate(() => window.windowCalls))
    .toEqual(['quit', 'hide', 'hide']);
  await expect(page.locator('.brand')).toHaveText('ImageScout');
  await expect(page.locator('.brand-mark svg')).toBeVisible();
});

for (const theme of ['dark', 'light']) {
  test(`${theme} rendered text passes AAA across app surfaces`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    const checkContrast = async () => {
      const failures = await page.evaluate(() => {
        const rgb = (value) => (value.match(/[\d.]+/g) || []).map(Number);
        const lum = (value) => {
          const c = rgb(value)
            .slice(0, 3)
            .map((x) => {
              x /= 255;
              return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
          return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        };
        const contrast = (a, b) =>
          (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        const failures = [];
        for (const el of document.querySelectorAll('body *')) {
          if (
            !el.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            }) ||
            el.closest('[disabled]')
          )
            continue;
          if (
            ![...el.childNodes].some(
              (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
            ) &&
            !el.matches('input')
          )
            continue;
          if (el.closest('svg,script,style')) continue;
          let parent = el,
            bg;
          while (parent) {
            const color = getComputedStyle(parent).backgroundColor;
            if (rgb(color).length === 3 || rgb(color)[3] === 1) {
              bg = color;
              break;
            }
            parent = parent.parentElement;
          }
          if (!bg) continue;
          const color =
            el.matches('input') && !el.value
              ? getComputedStyle(el, '::placeholder').color
              : getComputedStyle(el).color;
          const ratio = contrast(color, bg);
          if (ratio < 7)
            failures.push({
              tag: el.tagName,
              text: (el.textContent || el.placeholder).slice(0, 60),
              color,
              bg,
              ratio,
            });
        }
        return failures;
      });
      expect(failures).toEqual([]);
    };
    await checkContrast();
    await page.screenshot({ path: `docs/previews/${theme}-home.png` });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await checkContrast();
    await page.screenshot({ path: `docs/previews/${theme}-settings.png` });
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Upload images' }).click();
    await page.getByRole('button', { name: 'Preview Local fox' }).hover();
    await checkContrast();
    await page.getByRole('button', { name: 'Delete Local fox' }).click();
    await checkContrast();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Preview Local fox' }).click();
    await checkContrast();
    await page.getByRole('button', { name: 'Close preview' }).click();
    await page.setViewportSize({ width: 700, height: 480 });
    await expect(
      page.getByRole('button', { name: 'Quit ImageScout' }),
    ).toBeInViewport();
    await expect(page.locator('.brand')).toBeInViewport();
    await page.screenshot({ path: `docs/previews/${theme}-compact.png` });
  });
}
const uploaded = {
  id: 'upload-1',
  title: 'Local fox',
  originalFilename: 'fox-photo.jpg',
  aliases: ['Local fox', 'fox-photo.jpg'],
  sources: [],
  origins: ['upload'],
  preview: 'data:image/png;base64,iVBORw0KGgo=',
};
const webRecord = {
  id: 'web-1',
  title: 'Monkey portrait',
  aliases: ['Monkey portrait'],
  sources: [{ query: 'monkey', url: 'https://example.com/a.png' }],
  origins: ['search'],
  preview: 'data:image/png;base64,iVBORw0KGgo=',
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ uploaded, webRecord }) => {
      window.requests = [];
      window.saves = [];
      window.vaultCalls = [];
      window.vaultRecords = [];
      window.importResult = { records: [uploaded], errors: [] };
      window.vaultInfo = JSON.parse(
        sessionStorage.getItem('vaultInfo') || 'null',
      ) || { path: 'C:/Image Scout/vault', migration: null };
      const remember = (record) => {
        window.vaultRecords = [
          record,
          ...window.vaultRecords.filter((item) => item.id !== record.id),
        ];
        return record;
      };
      window.scout = {
        settings: async () => ({
          hasKey: true,
          shortcut: 'Alt+Space',
          downloads: 'C:/Downloads',
          vaultPath: 'C:/Image Scout/vault',
        }),
        configure: async () => ({
          hasKey: true,
          shortcut: 'Alt+Space',
          downloads: 'C:/Downloads',
          vaultPath: 'C:/Image Scout/vault',
        }),
        search: (q, id) =>
          new Promise((resolve) => window.requests.push({ q, id, resolve })),
        save: async (args) => {
          window.saves.push(args);
          return { record: remember(webRecord) };
        },
        onFocus: () => () => {},
        hide: () => {},
        vault: {
          info: async () => window.vaultInfo,
          list: async () => window.vaultRecords,
          import: async () => {
            window.vaultCalls.push(['import']);
            window.importResult.records.forEach(remember);
            return window.importResult;
          },
          importDropped: async (files) => {
            window.vaultCalls.push([
              'drop',
              files.map((file) => ({
                name: file.name,
                bytes: [...file.bytes],
              })),
            ]);
            window.importResult.records.forEach(remember);
            return window.importResult;
          },
          bytes: async (id) => {
            window.vaultCalls.push(['bytes', id]);
            return new Uint8Array([137, 80, 78, 71]);
          },
          copy: async (id) => {
            window.vaultCalls.push(['copy', id]);
            return window.vaultRecords.find((item) => item.id === id);
          },
          export: async (id) => {
            window.vaultCalls.push(['export', id]);
            return {
              record: window.vaultRecords.find((item) => item.id === id),
              file: 'C:/Downloads/Fox.png',
            };
          },
          reveal: async (id) => window.vaultCalls.push(['reveal', id]),
          openFolder: async () => window.vaultCalls.push(['openFolder']),
          delete: async (id) => {
            window.vaultCalls.push(['delete', id]);
            window.vaultRecords = window.vaultRecords.filter(
              (item) => item.id !== id,
            );
            return true;
          },
        },
      };
    },
    { uploaded, webRecord },
  );
  await page.goto('/');
});
test('picker upload works offline and displays imported records immediately', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Upload images' }).click();
  await expect(page.getByRole('tab', { name: /Vault/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('button', { name: 'Preview Local fox' }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.vaultCalls))
    .toContainEqual(['import']);
});
test('drop target imports file bytes and reports partial failures', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.importResult = {
      records: [window.importResult.records[0]],
      errors: [{ name: 'broken.gif', reason: 'Unsupported image.' }],
    };
    window.scout.vault.beginDrop = async (manifest) => {
      window.vaultCalls.push(['beginDrop', manifest]);
      return {
        token: 'drop-token',
        accepted: manifest.map((file, sourceIndex) => ({
          ...file,
          sourceIndex,
        })),
        errors: window.importResult.errors,
      };
    };
    window.scout.vault.importDropFile = async (token, index, name, bytes) => {
      window.vaultCalls.push(['dropFile', token, index, name, [...bytes]]);
      const record = window.importResult.records[index];
      if (record)
        window.vaultRecords = [
          record,
          ...window.vaultRecords.filter((item) => item.id !== record.id),
        ];
      return record
        ? { record }
        : { error: { name, reason: 'Import failed.' } };
    };
  });
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(
      new File([new Uint8Array([1, 2, 3])], 'fox.jpg', { type: 'image/jpeg' }),
    );
    return data;
  });
  await page.dispatchEvent('body', 'dragenter', { dataTransfer: transfer });
  await expect(
    page.getByText('Drop images to add them to your Vault'),
  ).toBeVisible();
  await page.dispatchEvent('body', 'drop', { dataTransfer: transfer });
  await expect(
    page.getByRole('button', { name: 'Preview Local fox' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'broken.gif: Unsupported image.',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.vaultCalls.find((call) => call[0] === 'dropFile'),
      ),
    )
    .toEqual(['dropFile', 'drop-token', 0, 'fox.jpg', [1, 2, 3]]);
});
test('migration warning is shown once from info', async ({ page }) => {
  await page.evaluate(() => {
    sessionStorage.setItem(
      'vaultInfo',
      JSON.stringify({
        path: 'C:/Image Scout/vault',
        migration: {
          imported: 2,
          duplicates: 1,
          skipped: [{ title: 'Gone', error: 'File missing' }],
        },
      }),
    );
    location.reload();
  });
  await expect(page.getByRole('status')).toContainText('2 imported');
  await expect(page.getByRole('status')).toContainText('1 skipped');
});
test('internet copy and save ingest into Vault without duplicate cards', async ({
  page,
}) => {
  const input = page.getByPlaceholder('Search Google Images…');
  await input.fill('monkey');
  await input.press('Enter');
  await page.evaluate(() =>
    window.requests[0].resolve([
      {
        id: 'a',
        title: 'Monkey portrait',
        url: 'https://example.com/a.png',
        thumbnail: '',
      },
    ]),
  );
  await page.getByRole('button', { name: 'Copy Monkey portrait' }).click();
  await expect(page.getByRole('status')).toContainText('Vault');
  await page
    .getByRole('button', { name: 'Save Monkey portrait', exact: true })
    .click();
  await page.getByRole('tab', { name: /Vault/ }).click();
  await expect(
    page.getByRole('button', { name: 'Preview Monkey portrait' }),
  ).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.saves.length)).toBe(2);
});
test('failed Downloads export still shows the image stored in Vault', async ({
  page,
}) => {
  await page.evaluate(
    ({ webRecord }) => {
      window.scout.save = async (args) => {
        window.saves.push(args);
        window.vaultRecords = [webRecord];
        return {
          record: webRecord,
          warning:
            'Added to Vault, but export to Downloads failed: Folder unavailable.',
        };
      };
    },
    { webRecord },
  );
  const input = page.getByPlaceholder('Search Google Images…');
  await input.fill('monkey');
  await input.press('Enter');
  await page.evaluate(() =>
    window.requests[0].resolve([
      {
        id: 'a',
        title: 'Monkey portrait',
        url: 'https://example.com/a.png',
        thumbnail: '',
      },
    ]),
  );
  await page
    .getByRole('button', { name: 'Save Monkey portrait', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'export to Downloads failed',
  );
  await page.getByRole('tab', { name: /Vault/ }).click();
  await expect(
    page.getByRole('button', { name: 'Preview Monkey portrait' }),
  ).toBeVisible();
});
test('Vault filtering covers filename aliases and source queries', async ({
  page,
}) => {
  await page.evaluate(
    ({ uploaded, webRecord }) =>
      (window.importResult = { records: [uploaded, webRecord], errors: [] }),
    { uploaded, webRecord },
  );
  await page.getByRole('button', { name: 'Upload images' }).click();
  const filter = page.getByPlaceholder('Search your Vault…');
  await filter.fill('fox-photo');
  await expect(
    page.getByRole('button', { name: 'Preview Local fox' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Preview Monkey portrait' }),
  ).toHaveCount(0);
  await filter.fill('monkey');
  await expect(
    page.getByRole('button', { name: 'Preview Monkey portrait' }),
  ).toBeVisible();
});
test('Vault actions copy export reveal and confirm delete', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Upload images' }).click();
  await page.getByRole('button', { name: 'Copy Local fox' }).click();
  await page.getByRole('button', { name: 'Export Local fox' }).click();
  await page.getByRole('button', { name: 'Reveal Local fox' }).click();
  await page.getByRole('button', { name: 'Delete Local fox' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Delete Local fox?' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.vaultCalls.some((call) => call[0] === 'delete'),
      ),
    )
    .toBe(false);
  await page.getByRole('button', { name: 'Delete Local fox' }).click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(
    page.getByRole('button', { name: 'Preview Local fox' }),
  ).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.vaultCalls.map((call) => call[0])))
    .toEqual(expect.arrayContaining(['copy', 'export', 'reveal', 'delete']));
});
test('Vault background removal reads managed bytes without ingesting on failure', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Upload images' }).click();
  await page
    .getByRole('button', { name: 'Remove background Local fox' })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.vaultCalls))
    .toContainEqual(['bytes', 'upload-1']);
  await expect.poll(() => page.evaluate(() => window.saves.length)).toBe(0);
});
test('settings displays and opens the Vault folder', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('C:/Image Scout/vault')).toBeVisible();
  await page.getByRole('button', { name: 'Open Vault folder' }).click();
  await expect
    .poll(() => page.evaluate(() => window.vaultCalls))
    .toContainEqual(['openFolder']);
});
test('parallel tabs retain results and filenames use submitted query', async ({
  page,
}) => {
  const input = page.getByPlaceholder('Search Google Images…');
  await input.fill('monkey');
  await input.press('Enter');
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await input.fill('forest');
  await input.press('Enter');
  await page.evaluate(() =>
    window.requests[0].resolve([
      {
        id: 'a',
        title: 'Monkey portrait',
        url: 'https://example.com/a.png',
        thumbnail: '',
      },
    ]),
  );
  await page.getByRole('tab', { name: /monkey/ }).click();
  await expect(
    page.getByRole('button', { name: 'Preview Monkey portrait' }),
  ).toBeVisible();
  await input.fill('changed draft');
  await page
    .getByRole('button', { name: 'Save Monkey portrait', exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.saves[0]?.query))
    .toBe('monkey');
});
test('stale search completion cannot overwrite newer results', async ({
  page,
}) => {
  const input = page.getByPlaceholder('Search Google Images…');
  await input.fill('old');
  await input.press('Enter');
  await input.fill('new');
  await input.press('Enter');
  await page.evaluate(() => {
    window.requests[1].resolve([
      {
        id: 'new',
        title: 'New result',
        url: 'https://example.com/new',
        thumbnail: '',
      },
    ]);
    window.requests[0].resolve([
      {
        id: 'old',
        title: 'Old result',
        url: 'https://example.com/old',
        thumbnail: '',
      },
    ]);
  });
  await expect(
    page.getByRole('button', { name: 'Preview New result' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Preview Old result' }),
  ).toHaveCount(0);
});

test('drop preflights limits and reads accepted files sequentially', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.reads = [];
    window.scout.vault.beginDrop = async (manifest) => {
      window.vaultCalls.push(['beginDrop', manifest]);
      return {
        token: 'drop-token',
        accepted: manifest.map((file, sourceIndex) => ({
          ...file,
          sourceIndex,
        })),
        errors: [],
      };
    };
    window.scout.vault.importDropFile = async (token, index, name, bytes) => {
      window.vaultCalls.push(['dropFile', token, index, name, [...bytes]]);
      return {
        record:
          index === 0
            ? {
                id: 'valid-a',
                title: 'Valid A',
                aliases: [],
                sources: [],
                origins: ['upload'],
              }
            : {
                id: 'valid-b',
                title: 'Valid B',
                aliases: [],
                sources: [],
                origins: ['upload'],
              },
      };
    };
    const files = [
      {
        name: 'valid-a.png',
        size: 3,
        arrayBuffer: async () => {
          window.reads.push(['start', 'a']);
          await new Promise((resolve) => setTimeout(resolve, 20));
          window.reads.push(['end', 'a']);
          return new Uint8Array([1, 2, 3]).buffer;
        },
      },
      {
        name: 'too-large.png',
        size: 20 * 1024 * 1024 + 1,
        arrayBuffer: async () => {
          window.reads.push(['oversized']);
          return new ArrayBuffer(0);
        },
      },
      {
        name: 'valid-b.png',
        size: 2,
        arrayBuffer: async () => {
          window.reads.push(['start', 'b']);
          window.reads.push(['end', 'b']);
          return new Uint8Array([4, 5]).buffer;
        },
      },
    ];
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    document.body.dispatchEvent(event);
  });
  await expect(
    page.getByRole('button', { name: 'Preview Valid A' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Preview Valid B' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('too-large.png');
  await expect
    .poll(() => page.evaluate(() => window.reads))
    .toEqual([
      ['start', 'a'],
      ['end', 'a'],
      ['start', 'b'],
      ['end', 'b'],
    ]);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.vaultCalls.filter((call) => call[0] === 'beginDrop')[0][1],
      ),
    )
    .toEqual([
      { name: 'valid-a.png', size: 3 },
      { name: 'valid-b.png', size: 2 },
    ]);
  await expect(
    page.evaluate(() => window.reads.some((read) => read[0] === 'oversized')),
  ).resolves.toBe(false);
});

test('cutout preview is transient and copy or export persists PNG once', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.Worker = class {
      postMessage() {
        queueMicrotask(() =>
          this.onmessage({
            data: { bytes: new Uint8Array([137, 80, 78, 71]) },
          }),
        );
      }
      terminate() {}
    };
    window.scout.save = async (args) => {
      window.saves.push(args);
      const record = {
        id: 'cutout-1',
        title: 'Local fox cutout',
        aliases: [],
        sources: [{ query: 'Local fox' }],
        origins: ['cutout'],
      };
      window.vaultRecords = [
        record,
        ...window.vaultRecords.filter((item) => item.id !== record.id),
      ];
      return { record };
    };
  });
  await page.getByRole('button', { name: 'Upload images' }).click();
  await page
    .getByRole('button', { name: 'Remove background Local fox', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Background removed' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect.poll(() => page.evaluate(() => window.saves.length)).toBe(0);
  await page
    .getByRole('button', { name: 'Remove background Local fox', exact: true })
    .click();
  await page.getByRole('button', { name: 'Copy image' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        copy: window.saves[0]?.copy,
        png: [...(window.saves[0]?.png || [])],
      })),
    )
    .toEqual({ copy: true, png: [137, 80, 78, 71] });
  await page.getByRole('button', { name: 'Close preview' }).click();
  await page
    .getByRole('button', { name: 'Remove background Local fox', exact: true })
    .click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.saves[1]?.copy))
    .toBe(false);
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(
    page.getByRole('button', { name: 'Preview Local fox cutout' }),
  ).toHaveCount(1);
});
