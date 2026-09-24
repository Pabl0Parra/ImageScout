# Image Scout

A compact Windows image launcher. Search Google Images in independent tabs, collect images in a durable local Vault, export numbered PNGs to Downloads, and remove backgrounds locally.

## Open the app

Run `release/win-unpacked/Image Scout.exe` after packaging, or the portable `release/Image-Scout-0.1.0.exe`. Keep the entire `win-unpacked` folder together when using the unpacked app. Closing the window keeps it in the tray. Right-click its tray icon to quit.

Open Settings, paste your SerpApi key, and save. The desktop backend stores it encrypted with Windows DPAPI under the app's user-data folder. The renderer receives only whether a key exists. No key belongs in the source or a chat message. Developers can alternatively supply `SERPAPI_API_KEY` in the launching process environment.

## Shortcuts

- **Alt+Space:** show/hide. If already taken, the app tries **Ctrl+Alt+Space**; Settings shows the actual shortcut and lets you change it.
- **Ctrl+T:** new search tab, even during another search.
- **Ctrl+W:** close the current search tab.
- **Ctrl+L:** focus search.
- **Escape:** close a dialog or hide the app.

Submit searches with Enter. Copy adds an image to Vault and to the clipboard; Save adds it to Vault and exports it to Downloads. Names use the submitted query, for example `Monkey (1).png`, and never overwrite existing files.

Use **Upload** or drag files onto the window to add local images to the Vault. Vault assets are copied into app-managed local storage, deduplicated by image content, available offline, and searchable by filename, title, and source query. From Vault you can copy, export, reveal, remove backgrounds, or delete an image. Settings shows the Vault folder and can open it. Uploads accept up to 50 images at once, 20 MB per file, and 200 MB per batch; individual failures do not prevent valid files from importing. Downloads and Vault assets are normalized to PNG for reliable clipboard support. Animated formats become a still image; sources that block downloads or unsupported formats show an error.

Background removal runs on this device using IMG.LY's small model. The first use downloads the model/runtime from IMG.LY and is slower; subsequent uses reuse cached assets. No additional API key is needed. Preview the transparent result, then copy or save it; either action stores the cutout in Vault.

## Develop and test

Node 24+:

```powershell
npm install
npm test
npm run build
npm start
npm run test:ui
node scripts/desktop-smoke.cjs
npm run pack
npm run dist
```

The browser preview (`npm run dev`) needs the Electron bridge for real searches and file operations. UI tests inject a fake bridge; desktop smoke tests exercise Electron with a temporary isolated profile and a fake key without making paid search requests. Live SerpApi searches require your own locally entered key.

The app uses `@imgly/background-removal` under AGPL-3.0; the app source is licensed AGPL-3.0-only. This local build is unsigned.
