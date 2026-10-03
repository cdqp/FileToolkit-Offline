/* global JSZip */
// Moteur d'optimisation : produit une version plus légère et garantit de ne jamais rendre un fichier plus lourd.

import { ascii, toBytes } from "../core/bytes.js";
import { baseName, extOf, makeFile, MIME, normalizedExt } from "../core/files.js";
import { isBrowserImage } from "../core/formats.js";
import { audioToWav, decodeAudio, MAX_DECODE_SIZE } from "../lib/audio.js";
import {
  canEncode,
  drawToCanvas,
  encodeCanvas,
  fitWithin,
  hasTransparency,
  IMAGE_MIME,
  jpegOrientation,
  loadImage,
  releaseCanvas,
} from "../lib/image.js";
import { minify, MINIFIABLE } from "../lib/minify.js";
import { optimizePdf } from "../lib/pdf-optimize.js";

/** « rapport.pdf » → « rapport-optimise.pdf » (le fichier d'origine n'est jamais écrasé). */
const optimizedName = (name, ext = extOf(name)) => `${baseName(name)}-optimise${ext ? `.${ext}` : ""}`;

const OFFICE = ["docx", "xlsx", "pptx", "odt", "ods", "odp", "epub"];
const COMPRESSED_AUDIO = ["mp3", "aac", "m4a", "ogg", "oga", "opus", "wma", "weba", "amr"];

/** Image animée (GIF, APNG, WebP) : la réencoder via un canevas ne garderait que la première image. */
export function isAnimated(bytes, format) {
  if (format === "gif") {
    let frames = 0;
    for (let i = 0; i < bytes.length - 2 && frames < 2; i++)
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    return frames > 1;
  }
  if (format === "png" || format === "apng") {
    for (let o = 8; o + 8 < bytes.length;) {
      const length = (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
      const type = ascii(bytes, o + 4, o + 8);
      if (type === "acTL") return true;
      if (type === "IDAT") return false;
      o += 12 + length;
    }
  }
  if (format === "webp") return ascii(bytes, 12, 16) === "VP8X" && (bytes[20] & 0x02) !== 0;
  return false;
}

/**
 * Détermine la stratégie d'optimisation adaptée à un fichier.
 * @returns {Promise<{kind: string, cache: object, label: string, warning?: string}>}
 */
export async function optimizationPlan(file, info) {
  const f = info.format;
  if (f === "pdf") return { kind: "pdf", cache: {}, label: "optimisation PDF" };
  if (f === "svg") return { kind: "text", cache: { text: await file.text() }, label: "minification SVG" };
  if (info.group === "image" && isBrowserImage(f)) {
    const head = await toBytes(file.slice(0, f === "gif" ? Math.min(file.size, 4 * 1024 * 1024) : 4096));
    if (isAnimated(head, f))
      return {
        kind: "binary",
        cache: {},
        label: "image animée",
        warning:
          "Image animée : la réencoder supprimerait l'animation. Une compression ZIP sans perte est tentée à la place.",
      };
    const image = await loadImage(file);
    return { kind: "image", cache: { image }, label: `${image.width} × ${image.height} px` };
  }
  if (OFFICE.includes(f)) return { kind: "office", cache: {}, label: "images internes et conteneur" };
  if (["zip", "jar", "cbz"].includes(f)) return { kind: "zip", cache: {}, label: "recompression ZIP" };
  if (info.group === "audio" && file.size <= MAX_DECODE_SIZE) {
    const audio = await decodeAudio(file);
    const warning = COMPRESSED_AUDIO.includes(f)
      ? "Ce fichier est déjà compressé : sa version WAV serait plus lourde. Sans encodeur MP3/AAC hors ligne, l'original sera très probablement conservé."
      : undefined;
    return {
      kind: "audio",
      cache: { audio },
      label: `${audio.sampleRate.toLocaleString("fr-FR")} Hz, ${audio.numberOfChannels > 1 ? `${audio.numberOfChannels} canaux` : "mono"}`,
      warning,
    };
  }
  if (MINIFIABLE[f])
    return { kind: "text", cache: { text: await file.text() }, label: "minification sans perte" };
  return { kind: "binary", cache: {}, label: "compression ZIP" };
}

/** Format de sortie « automatique » : celui d'origine s'il est encodable, sinon le plus efficace disponible. */
export async function autoImageFormat(format, canvas) {
  const f = normalizedExt(format);
  if (["jpg", "png", "webp", "avif"].includes(f) && (await canEncode(IMAGE_MIME[f]))) return f;
  const alpha = canvas && hasTransparency(canvas);
  if (await canEncode("image/webp")) return "webp";
  return alpha ? "png" : "jpg";
}

async function optimizeImage(file, info, cache, s) {
  const { img, width, height } = cache.image || (await loadImage(file));
  const size = fitWithin(width, height, { longEdge: Number(s.longEdge) || 0 });
  let canvas = drawToCanvas(img, size.width, size.height);
  const format = s.format === "auto" ? await autoImageFormat(info.format, canvas) : s.format;
  if (format === "jpg") {
    const flat = drawToCanvas(canvas, size.width, size.height, "#ffffff");
    releaseCanvas(canvas);
    canvas = flat;
  }
  try {
    const blob = await encodeCanvas(
      canvas,
      IMAGE_MIME[format],
      format === "png" ? undefined : Number(s.quality),
    );
    const resized = size.width !== width || size.height !== height;
    return {
      blob,
      name: optimizedName(file.name, format),
      type: IMAGE_MIME[format],
      method: `${format.toUpperCase()}${format === "png" ? "" : ` qualité ${Math.round(Number(s.quality) * 100)} %`}${resized ? `, ${size.width} × ${size.height} px` : ""}, métadonnées retirées`,
    };
  } finally {
    releaseCanvas(canvas);
  }
}

async function recompressJpeg(bytes, quality, maxSide) {
  if (jpegOrientation(bytes) !== 1) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  } catch {
    return null;
  }
  const size = fitWithin(bitmap.width, bitmap.height, { longEdge: maxSide });
  const canvas = drawToCanvas(bitmap, size.width, size.height, "#ffffff");
  bitmap.close();
  const out = await toBytes(await encodeCanvas(canvas, "image/jpeg", quality));
  releaseCanvas(canvas);
  return out.length < bytes.length * 0.92 ? out : null;
}

async function optimizeOffice(file, info, s, onProgress) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("Document illisible ou protégé par mot de passe.");
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  const images = entries.filter((e) => /\.jpe?g$/i.test(e.name));
  let replaced = 0;
  for (let i = 0; i < images.length; i++) {
    const entry = images[i];
    const bytes = await entry.async("uint8array");
    if (bytes.length >= 24 * 1024) {
      const out = await recompressJpeg(bytes, Number(s.quality), Number(s.longEdge) || 2400);
      if (out) {
        zip.file(entry.name, out, { date: entry.date, createFolders: false });
        replaced++;
      }
    }
    onProgress(((i + 1) / Math.max(1, images.length)) * 0.7);
  }
  // ODF et EPUB exigent un fichier « mimetype » en tête et non compressé.
  const mimetype = zip.file("mimetype");
  if (mimetype)
    zip.file("mimetype", await mimetype.async("uint8array"), {
      compression: "STORE",
      date: mimetype.date,
      createFolders: false,
    });
  const blob = await zip.generateAsync(
    {
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
      mimeType: MIME[info.format] || file.type,
    },
    (m) => onProgress(0.7 + (m.percent / 100) * 0.3),
  );
  return {
    blob,
    name: optimizedName(file.name),
    type: MIME[info.format] || file.type,
    method: replaced
      ? `${replaced} image${replaced > 1 ? "s" : ""} recompressée${replaced > 1 ? "s" : ""} et conteneur recompacté`
      : "conteneur recompacté (compression maximale)",
  };
}

/**
 * Produit une version optimisée (non encore protégée par la garantie de poids).
 * @returns {Promise<{blob: Blob, name: string, type: string, method: string}>}
 */
async function optimizeRaw(file, info, plan, s, onProgress) {
  if (plan.kind === "image") return optimizeImage(file, info, plan.cache, s);
  if (plan.kind === "pdf") {
    const best = await optimizePdf(file, {
      mode: s.pdfMode,
      quality: Number(s.quality),
      dpi: Number(s.dpi),
      onProgress,
    });
    return {
      blob: best.blob,
      name: optimizedName(file.name, "pdf"),
      type: "application/pdf",
      method: best.method,
    };
  }
  if (plan.kind === "office") return optimizeOffice(file, info, s, onProgress);
  if (plan.kind === "zip") {
    const zip = await JSZip.loadAsync(file);
    const blob = await zip.generateAsync(
      { type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 }, mimeType: "application/zip" },
      (m) => onProgress(m.percent / 100),
    );
    return {
      blob,
      name: optimizedName(file.name),
      type: "application/zip",
      method: "recompression ZIP maximale",
    };
  }
  if (plan.kind === "audio") {
    const audio = plan.cache.audio;
    const sampleRate = s.sampleRate === "keep" ? audio.sampleRate : Number(s.sampleRate);
    const channels = s.channels === "mono" ? 1 : Math.min(2, audio.numberOfChannels);
    const bitDepth = Number(s.bitDepth) || 16;
    const blob = await audioToWav(audio, { sampleRate, channels, bitDepth });
    return {
      blob,
      name: optimizedName(file.name, "wav"),
      type: "audio/wav",
      method: `WAV ${sampleRate.toLocaleString("fr-FR")} Hz, ${channels === 1 ? "mono" : "stéréo"}, ${bitDepth} bits`,
    };
  }
  if (plan.kind === "text") {
    const text = minify(plan.cache.text, info.format);
    return {
      blob: new Blob([text], { type: file.type || "text/plain" }),
      name: optimizedName(file.name),
      type: file.type || MIME[info.format] || "text/plain",
      method: "minification sans perte",
    };
  }
  const zip = new JSZip();
  zip.file(file.name, file, { date: new Date(file.lastModified) });
  const blob = await zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } },
    (m) => onProgress(m.percent / 100),
  );
  return { blob, name: `${file.name}.zip`, type: "application/zip", method: "compression ZIP sans perte" };
}

/** Optimise puis applique la garantie : jamais de fichier plus lourd que l'original. */
export async function optimizeFile(file, info, plan, settings, onProgress = () => {}) {
  const out = await optimizeRaw(file, info, plan, settings, (p) => onProgress(Math.max(0, Math.min(1, p))));
  if (out.blob.size < file.size)
    return { file: makeFile(out.blob, out.name, out.type), preserved: false, method: out.method };
  return { file, preserved: true, method: out.method };
}
