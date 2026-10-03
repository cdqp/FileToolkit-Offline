# Changelog

## 2.0.0 — 2026-10-03

Complete overhaul: the toolkit is now built from modular, tested sources into the same single offline HTML file — lighter (2.75 MB instead of 3.13 MB) and faster to start.

### Security

- PDF.js upgraded from 5.6.205 to **6.4.299** (GHSA-hq66-cqwq-w95j, arbitrary JavaScript execution in affected versions).
- New built-in **Content Security Policy**: no network access at all, only hash-pinned embedded scripts may run, no `eval`.
- PDF.js now runs in a **real Web Worker** (it silently fell back to the main thread under `file://`, freezing the page on large PDFs), with `isEvalSupported: false`.
- Archive entry names are normalized (no `../` or absolute paths).

### Fixes

- `.ts` TypeScript files were identified as MPEG-TS video.
- PDF text extraction lost every line break; paragraphs are now rebuilt.
- PDF → DOCX produced invalid XML when the PDF contained control characters.
- JSON minification lost precision on large integers and rewrote numbers; it is now strictly lossless.
- XML minification emptied `xml:space="preserve"` text (e.g. spaces in Word documents) and mixed content; HTML minification broke `<pre>`, `<textarea>` and inline spacing; CSS minification could alter selectors; Markdown minification removed hard line breaks; JavaScript minification altered template literals.
- TAR: names longer than 100 characters were truncated, directories became empty files, PAX/GNU archives were misread.
- RAR: directories became empty files; encrypted and RAR 4 archives now get a clear message.
- Audio was silently resampled to 48 kHz on decode and resampled with aliasing; mono files were doubled to stereo.
- Animated GIF/APNG/WebP were flattened to their first frame by the optimizer; they are now left intact.
- Optimizing a Word/Excel/PowerPoint document wrapped it in a ZIP instead of optimizing it.
- JSON → XML produced several root elements for arrays; JSON → CSV printed `[object Object]`.
- CSV files using `;` (French Excel exports) were read as a single column; line endings are now preserved.
- Image → PDF re-encoded JPEG photos as heavy PNGs; huge images exceeded canvas limits with a misleading error.
- XLSX: only one sheet was read, in file order rather than workbook order; ODT headings and ODS repeated cells were lost; PPTX slides could be out of order; EPUB chapters were sorted by file name instead of reading order.
- Accessibility: invalid `aria-valuen`, nested interactive controls, CSS tooltips invisible on form fields, tabs without ARIA roles, a live region updated every 1.2 s with unrelated messages, insufficient contrast in the light theme.
- Dropping a file outside the drop zone made the browser leave the page; selecting the same file twice did nothing.
- About 20 % of the application code was dead duplicated code (functions redefined and overridden at runtime); it has been removed.

### New

- **Batch** conversion and optimization, with per-file reports.
- PDF optimization that recompresses embedded photos **while keeping text selectable**, plus lossless clean-up of unused objects.
- Merge **PDFs and images** into one PDF, with a reorderable file list (move, remove, sort, reverse).
- Split PDFs by custom ranges (`1-3, 5, 8-`) or extract pages; split audio into equal parts; split images into tiles; reassemble binary volumes (a reassembly notice is included).
- New formats: ICO (multi-size favicon), BMP, AVIF (when supported), XLSX output, TSV, YAML (nested), INI sections, Markdown → HTML/DOCX, HTML → Markdown/DOCX, RTF, SRT ↔ WebVTT, TAR.GZ and GZ, archive extraction, audio track of videos as WAV.
- Paste files with <kbd>Ctrl</kbd>+<kbd>V</kbd>; drop anywhere on the page.
- Navigation with addressable pages (`#convertir`, `#optimiser`, `#fusionner`, `#decouper`) and working back button.
- Theme follows the system by default; animations follow `prefers-reduced-motion`.
- Supported-formats matrix on the home page; image preview of results; individual downloads for multi-file results.

### Project

- Sources in `src/`, single-file build with esbuild (`npm run build`), libraries installed from npm at pinned versions.
- 30 unit tests and 40 end-to-end tests (Playwright, including axe accessibility checks in both themes).
- Continuous integration and automatic release of the HTML file with its SHA-256 checksum on version tags.
