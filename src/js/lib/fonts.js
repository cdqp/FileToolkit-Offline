import { bytesToBase64, dec, streamCodec, toBytes } from "../core/bytes.js";
import { baseName, makeFile } from "../core/files.js";

const SFNT_TRUETYPE = 0x00010000;
const SFNT_CFF = 0x4f54544f; // « OTTO »
const SFNT_APPLE = 0x74727565; // « true »
const WOFF = 0x774f4646;
const WOFF2 = 0x774f4632;

export function fontInfo(input) {
  const u = input;
  if (u.length < 12) throw new Error("Police incomplète ou endommagée.");
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const signature = v.getUint32(0);
  if (signature === WOFF) {
    const count = v.getUint16(12);
    if (u.length < 44 + count * 20) throw new Error("WOFF invalide.");
    const tags = Array.from({ length: count }, (_, i) => dec.decode(u.subarray(44 + i * 20, 48 + i * 20)));
    return { container: "woff", flavor: v.getUint32(4), tags, count };
  }
  if (signature === WOFF2) return { container: "woff2", flavor: v.getUint32(4), tags: [], count: 0 };
  if (![SFNT_TRUETYPE, SFNT_CFF, SFNT_APPLE].includes(signature))
    throw new Error("Signature de police TTF/OTF non reconnue.");
  const count = v.getUint16(4);
  if (u.length < 12 + count * 16) throw new Error("Table de police tronquée.");
  const tags = Array.from({ length: count }, (_, i) => dec.decode(u.subarray(12 + i * 16, 16 + i * 16)));
  return { container: "sfnt", flavor: signature, tags, count };
}

const isCff = (info) => info.flavor === SFNT_CFF || info.tags.includes("CFF ") || info.tags.includes("CFF2");
const align4 = (n) => (n + 3) & ~3;

function searchFields(count) {
  let power = 1;
  let log = 0;
  while (power * 2 <= count) {
    power *= 2;
    log++;
  }
  return { searchRange: power * 16, entrySelector: log, rangeShift: count * 16 - power * 16 };
}

/** Sorties réellement réalisables pour une police donnée. */
export function fontTargets(info) {
  if (info.container === "woff2") return ["css"];
  if (info.container === "woff") return [isCff(info) ? "otf" : "ttf", "css"];
  const out = ["woff", "css"];
  if (!isCff(info)) out.unshift("ttf", "otf");
  else out.unshift("otf");
  return out;
}

export async function sfntToWoff(file) {
  const u = await toBytes(file);
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const info = fontInfo(u);
  if (info.container !== "sfnt") throw new Error("La source doit être une police TTF ou OTF.");
  const tables = [];
  for (let i = 0; i < info.count; i++) {
    const r = 12 + i * 16;
    const offset = v.getUint32(r + 8);
    const length = v.getUint32(r + 12);
    if (offset + length > u.length) throw new Error("Table de police hors limites.");
    const raw = u.subarray(offset, offset + length);
    const packed = await streamCodec(raw, "deflate", "compress");
    tables.push({
      tag: u.subarray(r, r + 4),
      checksum: v.getUint32(r + 4),
      raw,
      data: packed.length < raw.length ? packed : raw,
    });
  }
  let offset = 44 + tables.length * 20;
  for (const t of tables) {
    t.offset = offset;
    offset = align4(offset + t.data.length);
  }
  const out = new Uint8Array(offset);
  const d = new DataView(out.buffer);
  d.setUint32(0, WOFF);
  d.setUint32(4, info.flavor);
  d.setUint32(8, out.length);
  d.setUint16(12, tables.length);
  d.setUint32(16, 12 + tables.length * 16 + tables.reduce((n, t) => n + align4(t.raw.length), 0));
  d.setUint16(20, 1);
  tables.forEach((t, i) => {
    const r = 44 + i * 20;
    out.set(t.tag, r);
    d.setUint32(r + 4, t.offset);
    d.setUint32(r + 8, t.data.length);
    d.setUint32(r + 12, t.raw.length);
    d.setUint32(r + 16, t.checksum);
    out.set(t.data, t.offset);
  });
  return makeFile(out, `${baseName(file.name)}.woff`, "font/woff");
}

export async function woffToSfnt(file) {
  const u = await toBytes(file);
  const v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const info = fontInfo(u);
  if (info.container !== "woff") throw new Error("La source doit être une police WOFF.");
  const tables = [];
  for (let i = 0; i < info.count; i++) {
    const r = 44 + i * 20;
    const offset = v.getUint32(r + 4);
    const packedLength = v.getUint32(r + 8);
    const length = v.getUint32(r + 12);
    if (offset + packedLength > u.length) throw new Error("Table WOFF hors limites.");
    let data = u.subarray(offset, offset + packedLength);
    if (packedLength < length) data = await streamCodec(data, "deflate", "decompress");
    if (data.length !== length) throw new Error("Décompression WOFF incomplète.");
    tables.push({ tag: u.subarray(r, r + 4), data, checksum: v.getUint32(r + 16) });
  }
  let offset = 12 + tables.length * 16;
  for (const t of tables) {
    t.offset = offset;
    offset = align4(offset + t.data.length);
  }
  const out = new Uint8Array(offset);
  const d = new DataView(out.buffer);
  const search = searchFields(tables.length);
  d.setUint32(0, info.flavor);
  d.setUint16(4, tables.length);
  d.setUint16(6, search.searchRange);
  d.setUint16(8, search.entrySelector);
  d.setUint16(10, search.rangeShift);
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    out.set(t.tag, r);
    d.setUint32(r + 4, t.checksum);
    d.setUint32(r + 8, t.offset);
    d.setUint32(r + 12, t.data.length);
    out.set(t.data, t.offset);
  });
  const ext = isCff(info) ? "otf" : "ttf";
  return makeFile(out, `${baseName(file.name)}.${ext}`, `font/${ext}`);
}

const FONT_MIME = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
const FONT_FORMAT = { ttf: "truetype", otf: "opentype", woff: "woff", woff2: "woff2" };

export async function fontCss(file, format) {
  const u = await toBytes(file);
  const family =
    baseName(file.name)
      .replace(/[^\p{L}\p{N} _-]+/gu, " ")
      .trim() || "Police";
  const css = `@font-face {\n  font-family: "${family}";\n  src: url(data:${FONT_MIME[format]};base64,${bytesToBase64(u)}) format("${FONT_FORMAT[format]}");\n  font-style: normal;\n  font-weight: 400;\n  font-display: swap;\n}\n`;
  return makeFile(css, `${baseName(file.name)}-font-face.css`, "text/css");
}

export async function convertFont(file, format, target) {
  const u = await toBytes(file);
  const info = fontInfo(u);
  if (target === "css") return fontCss(file, format);
  if (target === "woff") return sfntToWoff(file);
  if (info.container === "woff") return woffToSfnt(file);
  if (target === "ttf" && isCff(info))
    throw new Error(
      "Cette police utilise des contours CFF : une conversion fiable vers TTF exige un moteur de contours spécialisé.",
    );
  // TTF et OTF partagent le même conteneur sfnt : seule l'extension change quand les contours sont TrueType.
  return makeFile(u, `${baseName(file.name)}.${target}`, FONT_MIME[target]);
}
