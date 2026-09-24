# Image Scout Implementation Plan

> For agentic workers: use subagent-driven-development for independently bounded implementation/review tasks. User approved the design and implementation; continue without repeating approval requests.

**Goal:** A working Windows shortcut launcher for concurrent Google image searches, quick clipboard/download actions, saved history, and local background removal.

**Architecture:** Electron main owns credentials, network and files through a narrow preload bridge. React owns tabs and transient view state. Local background removal runs in a worker-capable renderer library and returns PNG bytes through the bridge.

**Tech Stack:** Electron, React, Vite, Node test runner, Playwright, @imgly/background-removal.

## Chunk 1: Desktop foundation and image services
- [x] Create package.json, .gitignore, vite.config.mjs, electron/main.cjs, electron/preload.cjs.
- [x] Write tests in tests/services.test.cjs for safe titles, concurrent filename allocation, durable history, SerpApi response normalization, invalid URLs and bounded downloads. Run failing tests before implementation.
- [x] Implement electron/services.cjs and verify node --test.
- [x] Implement encrypted settings, IPC, tray, shortcut registration with conflict reporting, desktop window lifecycle and PNG clipboard/download handling.

## Chunk 2: Search interface
- [x] Create src/App.jsx, src/styles.css, src/main.jsx, index.html and src/background.js.
- [x] Add UI tests for independently loading tabs, stale responses, save/query preservation, Saved reveal and modal keyboard behavior. Native smoke covers settings persistence and clipboard.
- [x] Implement responsive tab strip, search field, result grid, accessible hover actions, image preview, Settings and Saved views. Use textContent/React escaping for remote metadata.
- [x] Add local background removal with progress, recoverable failures and transparent preview. Search and tabs remain usable while processing.

## Chunk 3: Delivery
- [x] Install dependencies, run node tests, UI tests, and production build.
- [x] Build Windows unpacked app and portable delivery, desktop launcher where permitted.
- [x] Review spec compliance and code quality; fix confirmed issues and rerun affected checks.
- [x] Smoke-test desktop via Electron Playwright with isolated temporary profile; inspect screenshot, settings persistence and clipboard; run actual background model inference. Live SerpApi key remains for user entry.
- [x] Write README with launching, key entry, shortcuts, packaging and local data storage.
