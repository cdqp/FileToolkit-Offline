/* global PDFLib */
import { toBytes } from "../core/bytes.js";
import { baseName, makeFile } from "../core/files.js";
import {
  drawToCanvas,
  encodeCanvas,
  hasTransparency,
  jpegOrientation,
  loadImage,
  releaseCanvas,
} from "./image.js";
import { sniff } from "../core/formats.js";

export const A4 = [595.28, 841.89];
const MARGIN = 56;

/** Remplace les caractères absents de l'encodage WinAnsi des polices standard PDF. */
function encoder(font) {
  const cache = new Map();
  const encodable = (ch) => {
    try {
      font.encodeText(ch);
      return true;
    } catch {
      return false;
    }
  };
  const fallback = (ch) => {
    if (/\s/.test(ch)) return " ";
    const base = ch.normalize("NFD")[0];
    return base !== ch && encodable(base) ? base : "?";
  };
  return (text) => {
    let out = "";
    for (const ch of text) {
      if (!cache.has(ch)) cache.set(ch, encodable(ch) ? ch : fallback(ch));
      out += cache.get(ch);
    }
    return out;
  };
}

/** Découpe une ligne en segments qui tiennent dans la largeur donnée (coupure aux espaces). */
function wrap(line, font, size, width) {
  if (!line) return [""];
  const words = line.split(/(\s+)/);
  const lines = [];
  let current = "";
  const fits = (s) => font.widthOfTextAtSize(s, size) <= width;
  for (const word of words) {
    if (fits(current + word)) {
      current += word;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    current = word.trimStart();
    while (current && !fits(current)) {
      // Mot plus long que la ligne : coupure franche.
      let cut = current.length - 1;
      while (cut > 1 && !fits(current.slice(0, cut))) cut--;
      lines.push(current.slice(0, cut));
      current = current.slice(cut);
    }
  }
  if (current || !lines.length) lines.push(current.trimEnd());
  return lines;
}

/**
 * Met en page un texte brut dans un PDF A4 (titre, retour à la ligne aux mots, pagination).
 * @param {{text: string, heading?: number}[] | string} content
 */
export async function textToPdf(content, title, { fontSize = 10.5 } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("CDQP Offline File Toolkit");
  doc.setCreator("CDQP Offline File Toolkit");
  const regular = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
  const safe = { regular: encoder(regular), bold: encoder(bold) };
  const width = A4[0] - MARGIN * 2;
  const blocks =
    typeof content === "string"
      ? content
          .replace(/\r\n?/g, "\n")
          .replace(/\t/g, "    ")
          .split("\n")
          .map((text) => ({ text }))
      : content;

  let page;
  let y = 0;
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
  };
  const draw = (text, font, size, color, gapAfter = 0) => {
    const lineHeight = size * 1.42;
    for (const line of wrap(text, font, size, width)) {
      if (y - lineHeight < MARGIN) newPage();
      y -= lineHeight;
      page.drawText(line, { x: MARGIN, y, size, font, color });
    }
    y -= gapAfter;
  };

  newPage();
  draw(safe.bold(title), bold, 16, PDFLib.rgb(0.1, 0.12, 0.14), 10);
  for (const block of blocks) {
    if (block.heading)
      draw(
        safe.bold(block.text),
        bold,
        Math.max(fontSize + 1, 17 - block.heading * 1.5),
        PDFLib.rgb(0.1, 0.12, 0.14),
        4,
      );
    else draw(safe.regular(block.text), regular, fontSize, PDFLib.rgb(0.13, 0.13, 0.15));
  }
  const pages = doc.getPages();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `${i + 1} / ${pages.length}`;
      p.drawText(label, {
        x: A4[0] - MARGIN - regular.widthOfTextAtSize(label, 8),
        y: MARGIN / 2,
        size: 8,
        font: regular,
        color: PDFLib.rgb(0.45, 0.45, 0.48),
      });
    });
  }
  return makeFile(await doc.save({ useObjectStreams: true }), `${baseName(title)}.pdf`, "application/pdf");
}

/** Prépare une image pour l'intégration PDF : JPEG/PNG d'origine si possible, sinon réencodage. */
async function embeddableImage(doc, file) {
  const bytes = await toBytes(file);
  const [format] = sniff(bytes.subarray(0, 1024), file.name);
  if (format === "jpg" && jpegOrientation(bytes) === 1) {
    try {
      return await doc.embedJpg(bytes);
    } catch {
      // JPEG exotique (CMJN, arithmétique…) : réencodage ci-dessous.
    }
  }
  if (format === "png") {
    try {
      return await doc.embedPng(bytes);
    } catch {
      // PNG entrelacé ou 16 bits non pris en charge : réencodage ci-dessous.
    }
  }
  const { img, width, height } = await loadImage(file);
  const canvas = drawToCanvas(img, width, height);
  const transparent = hasTransparency(canvas);
  const photo = ["jpg", "webp", "heic", "avif", "tiff"].includes(format) && !transparent;
  const blob = await encodeCanvas(canvas, photo ? "image/jpeg" : "image/png", 0.92);
  releaseCanvas(canvas);
  const data = await toBytes(blob);
  return photo ? doc.embedJpg(data) : doc.embedPng(data);
}

/**
 * Ajoute une image sur une nouvelle page.
 * @param {"a4"|"image"} pageSize « a4 » : page A4 orientée selon l'image ; « image » : page aux dimensions de l'image.
 */
export async function addImagePage(doc, file, pageSize = "a4") {
  const image = await embeddableImage(doc, file);
  if (pageSize === "image") {
    // 96 ppp, plafonné à 20 pouces de côté comme les visionneuses courantes.
    const scale = Math.min(0.75, 1440 / Math.max(image.width, image.height));
    const w = Math.max(1, image.width * scale);
    const h = Math.max(1, image.height * scale);
    doc.addPage([w, h]).drawImage(image, { x: 0, y: 0, width: w, height: h });
    return;
  }
  const landscape = image.width > image.height;
  const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
  const margin = 24;
  const scale = Math.min((pw - margin * 2) / image.width, (ph - margin * 2) / image.height, 1.5);
  const w = image.width * scale;
  const h = image.height * scale;
  doc.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}

export async function imagesToPdf(files, name, { pageSize = "a4", onProgress = () => {} } = {}) {
  const doc = await PDFLib.PDFDocument.create();
  doc.setProducer("CDQP Offline File Toolkit");
  for (let i = 0; i < files.length; i++) {
    await addImagePage(doc, files[i], pageSize);
    onProgress((i + 1) / files.length);
  }
  return makeFile(await doc.save({ useObjectStreams: true }), name, "application/pdf");
}

export async function loadPdfLib(file) {
  try {
    return await PDFLib.PDFDocument.load(await toBytes(file), { updateMetadata: false });
  } catch (error) {
    if (/encrypt/i.test(error?.message || ""))
      throw new Error(
        `« ${file.name} » est chiffré ou protégé par mot de passe : il ne peut pas être modifié.`,
      );
    throw new Error(`« ${file.name} » n'est pas un PDF valide.`);
  }
}

/** Fusionne PDF et images (une page par image) dans l'ordre donné. */
export async function mergeToPdf(files, infos, { pageSize = "a4", onProgress = () => {} } = {}) {
  const out = await PDFLib.PDFDocument.create();
  out.setProducer("CDQP Offline File Toolkit");
  for (let i = 0; i < files.length; i++) {
    if (infos[i].format === "pdf") {
      const src = await loadPdfLib(files[i]);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else await addImagePage(out, files[i], pageSize);
    onProgress((i + 1) / files.length);
  }
  return out;
}

/** Extrait des groupes de pages (indices à partir de 0) dans autant de PDF. */
export async function pdfSubsets(file, groups, onProgress = () => {}) {
  const src = await loadPdfLib(file);
  const outputs = [];
  for (let i = 0; i < groups.length; i++) {
    const doc = await PDFLib.PDFDocument.create();
    const pages = await doc.copyPages(src, groups[i]);
    pages.forEach((p) => doc.addPage(p));
    outputs.push(await doc.save({ useObjectStreams: true }));
    onProgress((i + 1) / groups.length);
  }
  return { outputs, pageCount: src.getPageCount() };
}
