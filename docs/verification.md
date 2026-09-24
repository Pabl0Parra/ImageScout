# Verification — 24 September 2026

- `npm test`: 22 passed (including managed Vault normalization, content deduplication and aliases, atomic index writes, traversal-safe IDs, recoverable deletion, upload limits, and idempotent migration alongside existing downloader checks).
- `npm run test:ui`: 13 passed in Microsoft Edge (picker upload, partial drag-and-drop errors, renderer preflight and sequential reads, Vault actions/filtering/deletion, cutout persistence, export failure recovery, Settings Vault folder action, and concurrent searches).
- `npm run build`: production build passed.
- `node scripts/desktop-smoke.cjs`: Electron launch, encrypted key on disk, migration retry, multi-file picker import, sequential dropped partial imports, Vault deduplication, protected web ingestion, actual Windows image clipboard, numbered exports, safe reveal/delete, persistence, and close-to-tray passed.
- `SCOUT_TEST_MODEL=1` desktop smoke: downloaded real model/runtime and completed local inference, producing PNG bytes through the built worker.
- `SCOUT_TEST_EXECUTABLE=.../release/win-unpacked/Image Scout.exe`: same native smoke passed for packaged executable.
- `npm run dist`: Windows unpacked and portable executable built successfully.
- Real HTTPS image download via pinned-address transport passed.
- Inspected desktop screenshot; independent spec and code reviews found no remaining important issues after fixes.

Live Google Images searches have not been run with the user's key. The user enters that key privately in Settings; automated tests used dummy credentials with fake search responses and made no paid searches. Background-removal smoke verifies the integration/output format, not segmentation quality across all images. The build is unsigned.
