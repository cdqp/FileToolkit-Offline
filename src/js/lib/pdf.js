// Lecture et rendu PDF avec PDF.js, intégré dans la page sous forme de texte brut.

import { createCanvas, fitWithin } from "./image.js";

let pdfjsPromise = null;

const sourceUrl = (id) => {
  const text = document.getElementById(id)?.textContent;
  if (!text) throw new Error("Moteur PDF absent de cette page.");
  return URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
};

/** Démarre le worker classique et attend son signal « ready » (sinon : repli sur le thread principal). */
function startWorker(url) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(url, { name: "pdfjs" });
    } catch {
      resolve(null);
      return;
    }
    const done = (value) => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.data?.action === "ready") done(worker);
    };
    const onError = (event) => {
      event.preventDefault?.();
      worker.terminate();
      done(null);
    };
    const timer = setTimeout(() => onError({}), 10000);
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
  });
}

export function getPdfjs() {
  pdfjsPromise ??= (async () => {
    const moduleUrl = sourceUrl("pdfjs-module");
    const workerUrl = sourceUrl("pdfjs-worker");
    try {
      const lib = await import(moduleUrl);
      const worker = await startWorker(workerUrl);
      if (worker) lib.GlobalWorkerOptions.workerPort = worker;
      else await import(workerUrl); // Le worker s'enregistre dans globalThis.pdfjsWorker : PDF.js l'utilise alors en direct.
      return lib;
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  })().catch((error) => {
    pdfjsPromise = null;
    throw new Error(`Impossible de démarrer le moteur PDF : ${error.message}`);
  });
  return pdfjsPromise;
}

export async function openPdf(file) {
  const lib = await getPdfjs();
  const task = lib.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    return await task.promise;
  } catch (error) {
    if (error?.name === "PasswordException")
      throw new Error("Ce PDF est protégé par un mot de passe : il ne peut pas être traité.");
    if (error?.name === "InvalidPDFException") throw new Error("PDF invalide ou endommagé.");
    throw new Error(`Lecture du PDF impossible : ${error?.message || error}`);
  }
}

/** Reconstitue les lignes et paragraphes à partir des fragments positionnés de PDF.js. */
export function textFromItems(items) {
  let out = "";
  let lastY = null;
  let lastHeight = 0;
  let lastEnd = null;
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const height = Math.abs(item.transform[3]) || item.height || 10;
    if (lastY !== null && item.str) {
      const gap = Math.abs(y - lastY);
      const lineHeight = Math.max(lastHeight, height);
      if (gap > lineHeight * 0.5) {
        if (!out.endsWith("\n")) out += "\n";
        if (gap > lineHeight * 1.9 && !out.endsWith("\n\n")) out += "\n";
      } else if (lastEnd !== null && x - lastEnd > height * 0.2 && !/\s$/.test(out) && !/^\s/.test(item.str))
        out += " ";
    }
    out += item.str;
    if (item.hasEOL && !out.endsWith("\n")) out += "\n";
    if (item.str) {
      lastY = y;
      lastHeight = height;
      lastEnd = x + (item.width || 0);
    }
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texte de chaque page ; une erreur claire si le PDF ne contient que des images (scan). */
export async function pdfPagesText(pdf, onProgress = () => {}) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push(textFromItems((await page.getTextContent()).items));
    page.cleanup();
    onProgress(i / pdf.numPages);
  }
  if (!pages.some((p) => p.trim()))
    throw new Error(
      "Ce PDF ne contient pas de texte (document scanné) : l'extraction nécessiterait une reconnaissance de caractères (OCR).",
    );
  return pages;
}

export async function pdfHasText(pdf, maxPages = 6) {
  let chars = 0;
  for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
    const page = await pdf.getPage(i);
    chars += (await page.getTextContent()).items.reduce((n, x) => n + (x.str || "").trim().length, 0);
    page.cleanup();
    if (chars > 24) return true;
  }
  return false;
}

/** Rend une page dans un canevas (fond blanc), en respectant les limites de taille du navigateur. */
export async function renderPage(page, scale) {
  const base = page.getViewport({ scale: 1 });
  const target = fitWithin(base.width * scale, base.height * scale);
  const viewport = page.getViewport({ scale: scale * target.scale });
  const canvas = createCanvas(
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
  );
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, background: "#ffffff" }).promise;
  return { canvas, base };
}
