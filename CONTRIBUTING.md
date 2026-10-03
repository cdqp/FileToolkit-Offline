# Contributing

Thank you for helping improve CDQP Offline File Toolkit.

## Principles

1. **Local only.** No feature may send data over the network. The build injects a Content Security Policy that forbids it; do not weaken it.
2. **No fake output.** Offer a target format only if the toolkit really produces a valid file of that format. When something cannot be done offline, say so clearly in the interface.
3. **Never worse.** The optimizer must never return a heavier file than the original, and lossless operations must stay strictly lossless.
4. **Single file.** The deliverable is one self-contained HTML file that works from `file://`.

## Workflow

```bash
npm ci
npm run build -- --watch   # rebuilds CDQP_Offline_File_Toolkit.html on every change in src/
npm test                   # fast unit tests
npm run test:e2e           # Playwright end-to-end tests (run `npx playwright install chromium` once)
npm run format
```

`CDQP_Offline_File_Toolkit.html` is generated: edit `src/`, run `npm run build`, and commit both. CI runs `npm run check` and fails if the committed file does not match the sources.

To use an already installed Chromium for the end-to-end tests, set `PW_CHROMIUM_EXECUTABLE=/path/to/chrome`.

## Code layout

- `src/js/core/` — small, dependency-free helpers.
- `src/js/lib/` — one module per format or engine. Keep them free of UI code; pure modules are unit-tested in Node.
- `src/js/tools/` — the business logic of the four tools (what can be done with a file, and doing it).
- `src/js/ui/` — views and shared components. User-facing text is in French.

## Adding a conversion

1. Implement the engine in `src/js/lib/` and unit-test it in `tests/unit/`.
2. Declare the target in `conversionTargets()` and produce it in `convertFile()` (`src/js/tools/convert.js`), with a short hint in `targetHint()`.
3. Add an end-to-end test in `tests/e2e/` that downloads the result and checks its actual content.

## Updating a library

Bump the exact version in `package.json`, run `npm install`, `npm audit`, `npm run build` and the full test suite, then update `THIRD_PARTY_NOTICES.md`.
