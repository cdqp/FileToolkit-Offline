/* global PDFLib */
import { toBytes } from "../core/bytes.js";
import { drawToCanvas, encodeCanvas, fitWithin, jpegOrientation, releaseCanvas } from "./image.js";
import { loadPdfLib } from "./pdf-create.js";
import { openPdf, renderPage } from "./pdf.js";

const name = (n) => PDFLib.PDFName.of(n);

/** Supprime les objets que plus rien ne référence (anciennes révisions, ressources orphelines). */
export function collectGarbage(doc) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = PDFLib;
  const context = doc.context;
  const reachable = new Set();
  const stack = [];
  const visit = (value) => {
    if (!value) return;
    if (value instanceof PDFRef) {
      const key = value.toString();
      if (reachable.has(key)) return;
      reachable.add(key);
      stack.push(context.lookup(value));
    } else stack.push(value);
  };
  const trailer = context.trailerInfo;
  [trailer.Root, trailer.Info, trailer.Encrypt].forEach(visit);
  while (stack.length) {
    const value = stack.pop();
    if (value instanceof PDFStream) visit(value.dict);
    else if (value instanceof PDFDict) for (const [, v] of value.entries()) visit(v);
    else if (value instanceof PDFArray) for (let i = 0; i < value.size(); i++) visit(value.get(i));
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

function imageColorComponents(context, colorSpace) {
  const cs = context.lookup(colorSpace);
  if (cs === name("DeviceRGB") || cs === name("CalRGB")) return 3;
  if (cs === name("DeviceGray") || cs === name("CalGray")) return 1;
  if (cs instanceof PDFLib.PDFArray && cs.get(0) === name("ICCBased")) {
    const stream = context.lookup(cs.get(1));
    const n = context.lookup(stream?.dict?.get(name("N")));
    return n instanceof PDFLib.PDFNumber ? n.asNumber() : 0;
  }
  return 0;
}

/**
 * Recompresse les images JPEG intégrées sans toucher au texte ni aux vecteurs.
 * Une image n'est remplacée que si sa nouvelle version est nettement plus légère.
 */
export async function recompressPdfImages(
  doc,
  { quality = 0.72, maxSide = 2000, onProgress = () => {} } = {},
) {
  const { PDFRawStream, PDFArray, PDFNumber } = PDFLib;
  const context = doc.context;
  const candidates = [];
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(name("Subtype")) !== name("Image")) continue;
    const filter = dict.get(name("Filter"));
    const dct =
      filter === name("DCTDecode") ||
      (filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === name("DCTDecode"));
    if (!dct || dict.has(name("Decode")) || dict.get(name("ImageMask")) === PDFLib.PDFBool.True) continue;
    const components = imageColorComponents(context, dict.get(name("ColorSpace")));
    if (components !== 1 && components !== 3) continue;
    if (obj.contents.length < 24 * 1024) continue;
    candidates.push({ ref, obj, components });
  }
  let replaced = 0;
  let saved = 0;
  for (let i = 0; i < candidates.length; i++) {
    const { ref, obj, components } = candidates[i];
    onProgress(i / Math.max(1, candidates.length));
    const bytes = obj.contents;
    if (jpegOrientation(bytes) !== 1) continue;
    let bitmap;
    try {
      // Valeurs brutes : l'espace colorimétrique est décrit par le PDF, pas par le JPEG.
      bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), {
        colorSpaceConversion: "none",
      });
    } catch {
      continue;
    }
    const size = fitWithin(bitmap.width, bitmap.height, { longEdge: maxSide });
    const canvas = drawToCanvas(bitmap, size.width, size.height, "#ffffff");
    bitmap.close();
    const encoded = await toBytes(await encodeCanvas(canvas, "image/jpeg", quality));
    releaseCanvas(canvas);
    if (encoded.length >= bytes.length * 0.92) continue;
    const dict = obj.dict;
    dict.set(name("Width"), PDFNumber.of(size.width));
    dict.set(name("Height"), PDFNumber.of(size.height));
    dict.set(name("BitsPerComponent"), PDFNumber.of(8));
    dict.set(name("Filter"), name("DCTDecode"));
    dict.delete(name("DecodeParms"));
    if (components === 1) dict.set(name("ColorSpace"), name("DeviceRGB"));
    dict.set(name("Length"), PDFNumber.of(encoded.length));
    context.assign(ref, PDFRawStream.of(dict, encoded));
    replaced++;
    saved += bytes.length - encoded.length;
  }
  onProgress(1);
  return { replaced, candidates: candidates.length, saved };
}

async function saveDoc(doc) {
  return new Blob([await doc.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 200 })], {
    type: "application/pdf",
  });
}

/** Rend chaque page en JPEG : gain maximal, mais le texte n'est plus sélectionnable. */
export async function rasterizePdf(file, { dpi = 120, quality = 0.72, onProgress = () => {} } = {}) {
  const pdf = await openPdf(file);
  try {
    const out = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { canvas, base } = await renderPage(page, dpi / 72);
      const jpg = await toBytes(await encodeCanvas(canvas, "image/jpeg", quality));
      releaseCanvas(canvas);
      page.cleanup();
      const image = await out.embedJpg(jpg);
      out
        .addPage([base.width, base.height])
        .drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
      onProgress(i / pdf.numPages);
    }
    return saveDoc(out);
  } finally {
    pdf.destroy();
  }
}

export const PDF_MODES = {
  lossless: "Sans perte",
  images: "Images recompressées",
  raster: "Pages en images",
};

/**
 * Optimise un PDF selon le mode choisi et renvoie la plus légère des versions valides produites.
 * @param {"lossless"|"images"|"raster"} mode
 */
export async function optimizePdf(
  file,
  { mode = "images", quality = 0.72, dpi = 150, onProgress = () => {} } = {},
) {
  const candidates = [];
  const doc = await loadPdfLib(file);
  onProgress(0.05);
  const removed = collectGarbage(doc);
  candidates.push({
    blob: await saveDoc(doc),
    method: removed
      ? `structure nettoyée (${removed} objets inutiles retirés)`
      : "structure réécrite et compactée",
  });
  onProgress(0.2);
  if (mode === "images") {
    // Côté le plus long d'une page A4 à la résolution choisie.
    const maxSide = Math.round(11.7 * dpi);
    const stats = await recompressPdfImages(doc, {
      quality,
      maxSide,
      onProgress: (p) => onProgress(0.2 + p * 0.65),
    });
    if (stats.replaced) {
      collectGarbage(doc);
      candidates.push({
        blob: await saveDoc(doc),
        method: `${stats.replaced} image${stats.replaced > 1 ? "s" : ""} recompressée${stats.replaced > 1 ? "s" : ""}, texte préservé`,
      });
    }
  }
  if (mode === "raster") {
    candidates.push({
      blob: await rasterizePdf(file, { dpi, quality, onProgress: (p) => onProgress(0.2 + p * 0.75) }),
      method: `pages rendues en images à ${dpi} ppp`,
    });
  }
  for (const c of candidates)
    await PDFLib.PDFDocument.load(await c.blob.arrayBuffer(), { updateMetadata: false });
  onProgress(1);
  return candidates.reduce((best, c) => (c.blob.size < best.blob.size ? c : best));
}
