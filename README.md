# CDQP Offline File Toolkit

A free, all-in-one browser toolkit to **convert, optimize, merge, split and archive files locally**.
It ships as a **single HTML file**: everything runs in your browser and your files never leave your device.

> 🇫🇷 Version française plus bas : [En français](#en-français).

## Features

**Convert** — one file or a whole batch at once; only outputs that can really be produced offline are offered.

| Source                        | Outputs                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| PDF                           | DOCX, TXT, Markdown, HTML, PNG, JPG, WebP (one image per page)              |
| Images                        | PNG, JPG, WebP, AVIF¹, PDF, ICO (multi-size favicon), BMP — optional resize |
| DOCX, ODT, PPTX, ODP, EPUB    | DOCX, TXT, Markdown, HTML, PDF (headings, lists and tables preserved)       |
| XLSX, ODS                     | XLSX, CSV (one per sheet), JSON, HTML, Markdown, PDF                        |
| RTF                           | DOCX, TXT, HTML, PDF                                                        |
| JSON, CSV/TSV, XML, YAML, INI | between each other, plus XLSX, HTML, Markdown, PDF                          |
| Markdown, HTML, code          | rendered HTML, DOCX, PDF, TXT; subtitles SRT ↔ WebVTT                       |
| Audio (and video sound)       | WAV                                                                         |
| Fonts                         | TTF, OTF, WOFF, CSS `@font-face`                                            |
| Archives                      | ZIP, TAR, TAR.GZ, GZ, RAR², plus per-file extraction                        |

**Optimize** — with a hard guarantee: the exported file is never heavier than the original.

- PDF: embedded photos recompressed while **text stays selectable**, unused objects removed, or pages rasterized for maximum gain.
- Images: quality, format and dimensions; metadata (including GPS location) removed. Animated images are never flattened.
- Word/Excel/PowerPoint/OpenDocument/EPUB: embedded JPEGs recompressed and container repacked.
- JSON, CSS, JavaScript, HTML, XML, SVG, Markdown, CSV: **lossless** minification (strings, `<pre>`, `xml:space="preserve"`, Markdown hard breaks and big integers are preserved).
- WAV: sample rate, channels and bit depth. ZIP: maximum recompression.

**Assemble**

- Merge PDFs **and images** into one PDF (reorderable list), images into a contact sheet, WAV tracks, CSV files (columns aligned by header), JSON arrays or text files.
- Split PDFs (every page, every N pages, custom ranges such as `1-3, 5, 8-`, page extraction), audio by duration or into equal parts, CSV/JSON/text by rows, images into tiles, any file into volumes — and **reassemble volumes** byte for byte.
- Group unrelated files into ZIP, TAR.GZ or RAR².

Also: dark and light themes (following your system), optional animations, keyboard and screen-reader accessibility, drag-and-drop anywhere, paste from clipboard (<kbd>Ctrl</kbd>+<kbd>V</kbd>), responsive layout.

¹ When the browser can encode it. ² RAR is written in the open RAR 5 "store" format; only such archives can be read offline.

## How to use

1. Download [`CDQP_Offline_File_Toolkit.html`](CDQP_Offline_File_Toolkit.html) (or the file attached to the latest release).
2. Open it with a modern browser — a double-click is enough, no installation or internet connection required.
3. Pick a tool, drop your files, choose an output, then export the result.

## Privacy and security

- All processing is performed locally, in your browser.
- The page carries a strict **Content Security Policy**: `default-src 'none'`, no network connection allowed, only the embedded scripts (pinned by SHA-256 hash) may run. Even a malicious file cannot make the page send anything.
- PDF parsing runs in an isolated Web Worker with script evaluation disabled.
- Changing a file extension is not converting its contents: the toolkit only offers operations it can actually perform, and verifies its outputs.

## Browser compatibility

Recent versions of Chrome, Edge, Firefox, Opera and Safari. Some outputs depend on the browser (for instance AVIF/WebP encoding or HEIC decoding).

## Development

The HTML file is **generated** from the sources in `src/`; do not edit it by hand.

```bash
npm ci               # install the pinned tools and libraries
npm run build        # regenerate CDQP_Offline_File_Toolkit.html
npm run build -- --watch
npm test             # unit tests (Node)
npx playwright install chromium
npm run test:e2e     # end-to-end tests on the built file (Chromium)
npm run format       # Prettier
```

| Path                | Content                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `src/index.html`    | page template                                                                                 |
| `src/styles.css`    | styles (design tokens, dark and light themes)                                                 |
| `src/js/core/`      | DOM helpers, file names, byte utilities, format detection by signature                        |
| `src/js/lib/`       | format engines: CSV, YAML, XML, Markdown, minifiers, TAR/RAR/gzip, PDF, Office, audio, fonts… |
| `src/js/tools/`     | the four tools: convert, optimize, merge, split                                               |
| `src/js/ui/`        | user interface                                                                                |
| `scripts/build.mjs` | single-file build: bundles the app, inlines libraries, computes the CSP                       |
| `tests/`            | unit tests (`node:test`) and end-to-end tests (Playwright + axe accessibility)                |

Third-party libraries (installed from npm at pinned versions): [JSZip](https://stuk.github.io/jszip/), [pdf-lib](https://pdf-lib.js.org/) and [PDF.js](https://mozilla.github.io/pdf.js/). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Changes: see [CHANGELOG.md](CHANGELOG.md).

---

## En français

**CDQP Offline File Toolkit** est une boîte à outils gratuite pour **convertir, optimiser, fusionner, découper et archiver vos fichiers en local**. Elle tient dans **un seul fichier HTML** : tout s'exécute dans votre navigateur, rien n'est envoyé sur Internet.

### Utilisation

1. Téléchargez [`CDQP_Offline_File_Toolkit.html`](CDQP_Offline_File_Toolkit.html).
2. Ouvrez-le avec un navigateur récent (un double-clic suffit, sans installation ni connexion).
3. Choisissez un outil, déposez vos fichiers (ou collez-les avec <kbd>Ctrl</kbd>+<kbd>V</kbd>), choisissez la sortie, puis exportez.

### Ce que vous pouvez faire

- **Convertir** un fichier ou un lot : PDF → Word, images (PNG, JPG, WebP, AVIF, ICO, PDF), tableurs → CSV/XLSX, JSON ↔ CSV ↔ YAML ↔ XML, Markdown → HTML/Word, sous-titres SRT ↔ VTT, polices TTF/OTF/WOFF, archives ZIP/TAR.GZ/RAR et extraction.
- **Optimiser** sans jamais alourdir un fichier : PDF allégés **en gardant le texte sélectionnable**, photos recompressées et nettoyées de leurs métadonnées, documents Office allégés, code et données minifiés **sans perte**.
- **Assembler** : PDF et images réunis en un seul PDF dans l'ordre voulu, CSV aux colonnes alignées, pistes audio, planches d'images ; **découper** un PDF par pages ou plages, un CSV par lignes, un fichier en volumes, puis les **réassembler** à l'identique.

### Confidentialité

Une politique de sécurité stricte (CSP) intégrée au fichier interdit toute connexion réseau : même un fichier piégé ne peut rien transmettre. Le moteur PDF tourne dans un worker isolé, sans évaluation de code.

### Contribuer

Le fichier HTML est produit à partir des sources de `src/` par `npm run build` ; les tests se lancent avec `npm test` et `npm run test:e2e`. Voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Project

Created by **CDQP**.
