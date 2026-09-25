const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

// Render the canonical vector, then wrap each PNG in a multi-resolution ICO.
(async () => {
  const output = path.join(__dirname, '..', 'resources');
  const svg = await fs.readFile(path.join(output, 'logo.svg'), 'utf8');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const images = [];
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%;background:#101820;border-radius:18%}</style>${svg}`,
      );
      const png = await page.screenshot({ omitBackground: true });
      images.push({ size, png });
      if (size === 256) await fs.writeFile(path.join(output, 'icon.png'), png);
      if (size === 32) await fs.writeFile(path.join(output, 'tray.png'), png);
    }
    const header = Buffer.alloc(6 + images.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({ size, png }, index) => {
      const pos = 6 + index * 16;
      header[pos] = header[pos + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, pos + 4);
      header.writeUInt16LE(32, pos + 6);
      header.writeUInt32LE(png.length, pos + 8);
      header.writeUInt32LE(offset, pos + 12);
      offset += png.length;
    });
    await fs.writeFile(
      path.join(output, 'icon.ico'),
      Buffer.concat([header, ...images.map((image) => image.png)]),
    );
    console.log('Generated icon.png, tray.png, and icon.ico from logo.svg.');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
