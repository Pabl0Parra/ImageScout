# Verification — 24 September 2026

- `npm test`: 9 passed (including concurrent exclusive saves, library writes and restart, safe filenames, API normalization, credentials redaction, size/MIME bounds, private address rejection, DNS pinning and duplicate image results).
- `npm run test:ui`: 3 passed in Microsoft Edge (independent tabs, submitted query filename preservation, stale response handling, Saved reveal, dialog shortcut handling).
- `npm run build`: production build passed.
- `node scripts/desktop-smoke.cjs`: Electron launch, encrypted key on disk, shortcut registration, minimized reopen, two concurrent PNG downloads, actual Windows image clipboard, invalid image rejection, history across restart, Saved copy without duplicate downloads, and close-to-tray passed.
- `SCOUT_TEST_MODEL=1` desktop smoke: downloaded real model/runtime and completed local inference, producing PNG bytes through the built worker.
- `SCOUT_TEST_EXECUTABLE=.../release/win-unpacked/Image Scout.exe`: same native smoke passed for packaged executable.
- `npm run dist`: Windows unpacked and portable executable built successfully.
- Real HTTPS image download via pinned-address transport passed.
- Inspected desktop screenshot; independent spec and code reviews found no remaining important issues after fixes.

Live Google Images searches have not been run with the user's key. The user enters that key privately in Settings; automated tests used dummy credentials with fake search responses and made no paid searches. Background-removal smoke verifies the integration/output format, not segmentation quality across all images. The build is unsigned.
