# Third-party notices

`CDQP_Offline_File_Toolkit.html` embeds the following libraries, unmodified except where noted. Their license headers are kept in the embedded code.

| Library                                                                  | Version | License                                                                      | Use                                           |
| ------------------------------------------------------------------------ | ------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| [JSZip](https://github.com/Stuk/jszip)                                   | 3.10.1  | MIT or GPL-3.0 (dual), includes [pako](https://github.com/nodeca/pako) (MIT) | ZIP and Office containers                     |
| [pdf-lib](https://github.com/Hopding/pdf-lib)                            | 1.17.1  | MIT                                                                          | creating and editing PDF documents            |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`, legacy build) | 6.4.299 | Apache-2.0                                                                   | reading, text extraction and rendering of PDF |

The PDF.js worker is converted at build time from an ES module to a classic script (two module-only constructs are rewritten) so that it can run from a local `file://` page; its behavior is unchanged.

Development-only tools (not embedded): esbuild (MIT), acorn (MIT), Prettier (MIT), Playwright (Apache-2.0), axe-core (MPL-2.0).
