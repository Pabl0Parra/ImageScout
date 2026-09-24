# Managed Image Vault Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Saved history with a durable managed Vault for internet and uploaded images, including import, drag-and-drop, deduplication, offline actions, export, deletion, and legacy migration.

**Architecture:** A focused `VaultStore` service in the Electron main process owns normalized PNG files and atomic metadata. IPC exposes ID-based operations only; React renders the Vault and sends bounded bytes for drag-and-drop. Existing protected downloads and image decoding feed the same ingestion path.

**Tech Stack:** Electron 44, Node.js, React 19, Vite 8, Node test runner, Playwright.

---

## Chunk 1: Vault storage service

### Task 1: Durable assets and metadata

**Files:**
- Create: `electron/vault.cjs`
- Create: `tests/vault.test.cjs`

- [x] Write failing Node tests for normalized-PNG ingestion, SHA-256 deduplication, accumulated aliases/source occurrences/origins, safe list/get-by-ID, serialized atomic writes, export naming, deletion, and validation limits.
- [x] Run `node --test tests/vault.test.cjs`; confirm failures are caused by the missing service.
- [x] Implement `VaultStore` with injected PNG normalization for unit tests, exclusive/atomic file operations, and record-ID APIs.
- [x] Run the Vault tests and full `npm test`; expect all tests to pass.
- [x] Commit the storage service and tests.

### Task 2: Legacy migration

**Files:**
- Modify: `electron/vault.cjs`
- Modify: `tests/vault.test.cjs`

- [x] Write failing tests for readable legacy records, missing files, duplicate migration, metadata preservation, and idempotent reruns.
- [x] Run the migration tests and verify the intended failures.
- [x] Implement migration only after the tests fail; retain legacy metadata until the new index is durable.
- [x] Run Vault and full service tests; expect all to pass.
- [x] Commit migration behavior.

## Chunk 2: Desktop integration

### Task 3: Native import and Vault IPC

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `scripts/desktop-smoke.cjs`

- [x] Extend desktop smoke tests first for multi-file import, partial invalid batches, internet ingestion, Vault copy/export/reveal/delete, Vault byte loading, and restart persistence; confirm they fail against the old bridge.
- [x] Instantiate and migrate `VaultStore`; expose a non-fatal migration summary for the renderer to show once, including skipped missing/unreadable legacy records.
- [x] Add native picker and dropped-file ingestion with privileged enforcement of 50 files, 20 MB per file, 200 MB per batch, sequential processing, and partial-success results for both routes.
- [x] Replace library IPC with narrow `vault:*` ID operations, including Vault PNG bytes by ID for background removal, and route web Copy/Save/cutout actions through Vault ingestion.
- [x] Ensure Copy imports then copies, Save imports then exports, Vault Copy does not export, and Vault export uses numbered Downloads names.
- [x] Run syntax, service, and desktop smoke checks; expect all to pass.
- [x] Commit desktop integration.

## Chunk 3: Vault interface

### Task 4: Upload, drag-and-drop, and Vault actions

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Modify: `tests/ui.spec.js`

- [x] Update the fake bridge and write failing Playwright tests for picker upload, dropped files, privileged limit/partial errors, migration notices, immediate Vault display, internet Copy/Save ingestion, Vault filtering, copy/export/reveal, delete confirmation, and Vault-card background removal.
- [x] Run `npm run test:ui`; confirm failures are due to the missing UI.
- [x] Rename Saved to Vault, add Upload and drag target, render imported records, add Vault actions (including background removal by Vault ID), confirmation, migration notice, and aggregated partial-error feedback.
- [x] Verify cutout preview/cancel creates no Vault record, while cutout Copy or Export ingests the transparent PNG with origin `cutout` before the requested action.
- [x] Search title, original filename, aliases, and source queries without exposing managed paths.
- [x] Run UI and full tests; expect all to pass.
- [x] Commit the interface.

### Task 5: Settings, documentation, and delivery

**Files:**
- Modify: `src/App.jsx`
- Modify: `README.md`
- Modify: `docs/verification.md`
- Modify: `scripts/desktop-smoke.cjs`

- [x] Add failing UI/smoke assertions for Vault path display and Open Vault Folder.
- [x] Implement Settings Vault location/action and update help text and README.
- [x] Run `npm test`, `npm run test:ui`, `npm run build`, desktop smoke, and real model smoke.
- [x] Run independent spec and code-quality reviews; fix important findings and repeat affected checks.
- [x] Build unpacked and portable Windows artifacts with `npm run dist`, smoke-test the packaged executable, and verify the existing shortcut target.
- [x] Record fresh evidence in `docs/verification.md` and commit the finished feature.
