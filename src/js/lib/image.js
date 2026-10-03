import { ascii, concatBytes } from "../core/bytes.js";
import { extOf } from "../core/files.js";

/** Limites sûres pour tous les navigateurs courants (Safari iOS plafonne vers 16,7 Mpx). */
export const MAX_SIDE = 16384;
export const MAX_AREA = 40_000_000;

export function fitWithin(width, height, { maxSide = MAX_SIDE, maxArea = MAX_AREA, longEdge = 0 } = {}) {
  let scale = 1;
  if (longEdge && Math.max(width, height) > longEdge) scale = longEdge / Math.max(width, height);
  scale = Math.min(scale, maxSide / width, maxSide / height, Math.sqrt(maxArea / (width * height)));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function svgSize(text) {
  const box = text.match(/viewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i);
  return box ? { width: Number(box[1]), height: Number(box[2]) } : null;
}

/** Charge une image décodable par le navigateur. */
export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error(
        "Le navigateur ne sait pas décoder cette image (format non pris en charge par ce navigateur).",
      );
    }
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    if ((!width || !height) && extOf(file.name) === "svg") {
      const size = svgSize(await file.text()) || { width: 1024, height: 1024 };
      const scale = 1024 / Math.max(size.width, size.height);
      width = Math.round(size.width * scale);
      height = Math.round(size.height * scale);
    }
    if (!width || !height) throw new Error("Image vide ou dimensions introuvables.");
    return { img, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function releaseCanvas(canvas) {
  canvas.width = canvas.height = 1;
}

/** Dessine (et réduit par paliers pour un rendu net) une image dans un canevas aux dimensions voulues. */
export function drawToCanvas(source, width, height, background = null) {
  const srcW = source.width || source.naturalWidth;
  const srcH = source.height || source.naturalHeight;
  let current = source;
  let curW = srcW;
  let curH = srcH;
  // Réductions successives par deux : évite l'aspect crénelé des fortes réductions.
  while (curW / 2 >= width * 1.0001 && curH / 2 >= height * 1.0001 && curW > 2 && curH > 2) {
    const step = createCanvas(Math.max(width, Math.round(curW / 2)), Math.max(height, Math.round(curH / 2)));
    const ctx = step.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, step.width, step.height);
    if (current instanceof HTMLCanvasElement && current !== source) releaseCanvas(current);
    current = step;
    curW = step.width;
    curH = step.height;
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(current, 0, 0, width, height);
  if (current instanceof HTMLCanvasElement && current !== source) releaseCanvas(current);
  return canvas;
}

export function encodeCanvas(canvas, type, quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                `Encodage ${type.replace("image/", "").toUpperCase()} impossible : image trop grande ou format non pris en charge par ce navigateur.`,
              ),
            ),
      type,
      quality,
    ),
  );
}

const encoderCache = new Map();
/** Vérifie que le navigateur encode réellement ce type (Safari renvoie du PNG sinon). */
export async function canEncode(type) {
  if (!encoderCache.has(type)) {
    encoderCache.set(
      type,
      new Promise((resolve) => {
        try {
          createCanvas(2, 2).toBlob((b) => resolve(!!b && b.type === type), type, 0.8);
        } catch {
          resolve(false);
        }
      }),
    );
  }
  return encoderCache.get(type);
}

export async function rasterTargets() {
  const out = ["png", "jpg"];
  if (await canEncode("image/webp")) out.push("webp");
  if (await canEncode("image/avif")) out.push("avif");
  return out;
}

export function hasTransparency(canvas) {
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const step = width * height > 4_000_000 ? 7 : 1;
  for (let i = 3; i < data.length; i += 4 * step) if (data[i] < 255) return true;
  return false;
}

export const IMAGE_MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

/** BMP 24 bits (transparence aplatie sur fond blanc), lisible partout. */
export function encodeBMP(canvas) {
  const { width, height } = canvas;
  const flat = drawToCanvas(canvas, width, height, "#ffffff");
  const pixels = flat.getContext("2d").getImageData(0, 0, width, height).data;
  releaseCanvas(flat);
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buffer = new ArrayBuffer(size);
  const v = new DataView(buffer);
  const u = new Uint8Array(buffer);
  u[0] = 0x42;
  u[1] = 0x4d;
  v.setUint32(2, size, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, width, true);
  v.setInt32(22, height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * height, true);
  v.setInt32(38, 2835, true);
  v.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      u[o++] = pixels[p + 2];
      u[o++] = pixels[p + 1];
      u[o++] = pixels[p];
    }
  }
  return new Blob([buffer], { type: "image/bmp" });
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Icône Windows/favicon multi-résolution (images PNG intégrées, format accepté depuis Windows Vista). */
export async function encodeICO(source, sourceWidth, sourceHeight, sizes = ICO_SIZES) {
  const usable = sizes.filter((s) => s <= Math.max(32, Math.max(sourceWidth, sourceHeight)));
  const images = [];
  for (const s of usable) {
    const scale = Math.min(s / sourceWidth, s / sourceHeight);
    const w = Math.max(1, Math.round(sourceWidth * scale));
    const h = Math.max(1, Math.round(sourceHeight * scale));
    const drawn = drawToCanvas(source, w, h);
    const square = createCanvas(s, s);
    square.getContext("2d").drawImage(drawn, Math.floor((s - w) / 2), Math.floor((s - h) / 2));
    releaseCanvas(drawn);
    images.push({
      size: s,
      data: new Uint8Array(await (await encodeCanvas(square, "image/png")).arrayBuffer()),
    });
    releaseCanvas(square);
  }
  const header = new Uint8Array(6 + 16 * images.length);
  const v = new DataView(header.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let offset = header.length;
  images.forEach((img, i) => {
    const o = 6 + i * 16;
    header[o] = img.size >= 256 ? 0 : img.size;
    header[o + 1] = img.size >= 256 ? 0 : img.size;
    v.setUint16(o + 4, 1, true);
    v.setUint16(o + 6, 32, true);
    v.setUint32(o + 8, img.data.length, true);
    v.setUint32(o + 12, offset, true);
    offset += img.data.length;
  });
  return new Blob([concatBytes(header, ...images.map((i) => i.data))], { type: "image/x-icon" });
}

/** Orientation EXIF d'un JPEG (1 = normale), utile avant d'intégrer le JPEG brut dans un PDF. */
export function jpegOrientation(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let o = 2; o + 4 < bytes.length;) {
    if (bytes[o] !== 0xff) return 1;
    const marker = bytes[o + 1];
    const length = v.getUint16(o + 2);
    if (marker === 0xe1 && ascii(bytes, o + 4, o + 10) === "Exif\0\0") {
      const tiff = o + 10;
      const little = ascii(bytes, tiff, tiff + 2) === "II";
      const ifd = tiff + v.getUint32(tiff + 4, little);
      const count = v.getUint16(ifd, little);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > bytes.length) return 1;
        if (v.getUint16(entry, little) === 0x0112) return v.getUint16(entry + 8, little) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    o += 2 + length;
  }
  return 1;
}
