// CDQP Offline File Toolkit — point d'entrée de l'interface.

import { $ } from "./core/dom.js";
import { identify } from "./core/formats.js";
import { initConvert } from "./ui/convert-view.js";
import { initOptimize } from "./ui/optimize-view.js";
import { initMerge, initSplit } from "./ui/assemble-view.js";
import { installGlobalFileHandlers } from "./ui/components.js";
import { initMotion, initRouter, initTheme } from "./ui/shell.js";
import { conversionTargets, convertFile } from "./tools/convert.js";
import { optimizationPlan, optimizeFile } from "./tools/optimize.js";
import { mergeFiles, mergeTargets } from "./tools/merge.js";
import { splitFile } from "./tools/split.js";
import { getPdfjs } from "./lib/pdf.js";

initTheme();
initMotion();
initConvert($("#convert"));
initOptimize($("#optimize"));
initMerge($("#merge"));
initSplit($("#split"));
installGlobalFileHandlers();
initRouter();

// Préchargement discret du moteur PDF quand le navigateur est inactif.
(window.requestIdleCallback || ((fn) => setTimeout(fn, 1500)))(() => getPdfjs().catch(() => {}));

/** Interface de test (utilisée par la suite Playwright), sans effet sur l'application. */
window.CDQP = Object.freeze({
  version: __APP_VERSION__,
  identify,
  conversionTargets,
  convertFile,
  optimizationPlan,
  optimizeFile,
  mergeTargets,
  mergeFiles,
  splitFile,
  getPdfjs,
});
