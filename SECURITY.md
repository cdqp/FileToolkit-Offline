# Security

## Model

CDQP Offline File Toolkit processes untrusted files (PDF, Office documents, archives, images…) entirely inside the browser.

- **No network.** A Content Security Policy is generated at build time: `default-src 'none'`, `connect-src`, `img-src`, `media-src` and `font-src` limited to `data:`/`blob:`, `form-action 'none'`, `base-uri 'none'`.
- **Only known code runs.** `script-src` lists the SHA-256 hash of every embedded script, plus `blob:` for the PDF.js module and worker built from embedded sources. Neither `'unsafe-inline'` nor `'unsafe-eval'` is allowed for scripts.
- **PDF isolation.** PDF.js runs in a dedicated Web Worker with `isEvalSupported: false`, without XFA and without the scripting sandbox.
- **Archives.** Entry names are normalized (`../` and absolute paths removed) before being written to new archives or offered for download.
- **Dependencies** are pinned to exact versions and checked with `npm audit`.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue, and include a sample file when possible.
