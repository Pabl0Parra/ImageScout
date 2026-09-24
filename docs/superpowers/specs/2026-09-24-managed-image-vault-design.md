# Managed Image Vault Design

## Goal

Turn Image Scout's Saved collection into a durable, local Vault containing both images chosen from internet searches and images imported from the computer. Vault items must remain usable when the original source is offline, moved, or deleted.

## User experience

The existing **Saved** tab becomes **Vault**. An **Upload** button sits beside the search field and accepts multiple local image files. Users may also drag image files onto the app window; a clear drop target appears while files are dragged over it.

Uploading adds each accepted image to the Vault immediately. The original filename, without its extension, becomes the title. Imported images appear in Vault as soon as processing completes. Unsupported or unreadable files are reported individually so valid files in the same batch still import.

Choosing **Copy** on an internet result imports the image into Vault and copies it to the clipboard. Choosing **Save** on an internet result imports it into Vault and exports a numbered PNG to Downloads. An image already present in Vault is reused instead of creating a duplicate. Copying a Vault image only changes the clipboard; saving a Vault image exports it to Downloads.

Vault cards support preview, copy, background removal, export to Downloads, reveal the managed file, and delete. Previewing or cancelling a background-removal result does not store it. Copying or exporting a cutout first ingests its transparent PNG into the Vault with origin `cutout`, then performs the requested action. Deleting requires a confirmation inside the app and removes both the managed file and its metadata. The Vault can be searched by title, original filename, aliases, and source query. Settings displays the Vault path and provides an **Open Vault Folder** action.

## Storage and naming

Image Scout owns a directory beneath Electron's per-user application-data directory:

```text
<userData>/vault/
  images/<content-sha256>.png
  library.json
```

Every accepted image is decoded with Electron and normalized to PNG before it enters the Vault. The PNG's SHA-256 digest becomes its identity and managed filename. This makes deduplication deterministic across local imports and internet downloads. GIF and animated formats become a still image, matching current clipboard behavior.

One Vault asset record exists per digest. It contains the digest, primary title, sanitized display-only original filename when applicable, searchable title/filename aliases, source occurrences (query and optional URL), managed path, creation/update times, dimensions, origins (`upload`, `search`, and/or `cutout`), and a bounded preview data URL. The original absolute path is never stored. When identical content arrives again, Image Scout updates the existing asset's aliases, source occurrences, origins, and update time rather than creating another card or discarding the new context. Thus the same image stays deduplicated while remaining discoverable under every filename and search query by which it entered the Vault. Metadata writes remain serialized and atomic. The renderer never supplies or receives arbitrary filesystem paths for privileged operations; actions use Vault record IDs.

The existing Saved history is migrated on startup. For each readable legacy record, Image Scout imports the referenced file into the managed Vault and preserves useful metadata. Missing legacy files are skipped and reported non-fatally. Migration is idempotent, and the old metadata remains untouched until the new Vault index has been written successfully.

## Desktop boundary and data flow

The Electron main process owns file selection, file reading, decoding, hashing, Vault writes, exports, reveals, and deletes. The sandboxed renderer receives a narrow bridge:

- `vault.import()` opens the native multi-file picker and returns imported records plus per-file errors.
- `vault.importDropped(files)` accepts browser `File` byte arrays and sanitized display names, with strict per-file and batch limits.
- `vault.list()`, `vault.copy(id)`, `vault.export(id)`, `vault.reveal(id)`, and `vault.delete(id)` operate by record ID.
- Internet actions first download through the existing protected downloader, then call the same Vault ingestion service.
- Background removal accepts bytes loaded by Vault ID or an internet result, and its output can be added to Vault before copy/export.

The native picker is the primary upload route. Drag-and-drop sends image bytes rather than renderer-visible absolute paths because modern Electron does not expose trusted local paths to the sandboxed renderer.

## Limits and errors

Uploads accept image files Electron can decode, up to 20 MB per input file and 200 MB per batch. A batch contains at most 50 files. Decoded images are rejected above 64 megapixels, matching the existing protection. File extensions are hints only; successful image decoding is required.

Imports are processed sequentially to bound memory usage. Duplicate content returns the existing Vault record. Failures identify the affected filename without exposing internal paths. A failed metadata update removes any newly created orphan file. A failed export leaves the Vault item intact. A failed deletion retains metadata unless the managed file was already absent, in which case the stale record is removed.

The Vault is local and works offline. SerpApi remains necessary only for new internet searches. Local background removal may require its model download on first use, as in the current app.

## Testing and delivery

Service tests cover PNG normalization ingestion, content deduplication, collision-free exports, atomic metadata, batch limits, unsupported images, safe record-ID operations, deletion, and legacy migration. UI tests cover picker import, drag-and-drop, partial batch errors, immediate Vault display, internet Copy/Save ingestion, Vault copy/export, search, and delete confirmation.

Desktop smoke tests use a temporary user-data directory and real local fixture images to verify native multi-select import, persistence across restart, clipboard copy, Downloads export, reveal-safe IDs, deletion, and packaged executable behavior. The production build and portable executable are rebuilt, and the existing desktop shortcut continues pointing at the unpacked app.
