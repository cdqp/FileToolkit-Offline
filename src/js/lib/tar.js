import { ascii, dec, enc } from "../core/bytes.js";

const BLOCK = 512;
const MAX_OCTAL_SIZE = 0o77777777777;

/** Chemin d'archive sûr : séparateurs « / », sans racine ni remontée « .. ». */
export function cleanEntryName(name) {
  return String(name)
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function octal(value, length) {
  return value.toString(8).padStart(length - 1, "0") + "\0";
}

function header({ name, size, mtime, type = "0", mode = 0o644 }) {
  const h = new Uint8Array(BLOCK);
  const put = (offset, length, text) => h.set(enc.encode(text).subarray(0, length), offset);
  put(0, 100, name);
  put(100, 8, octal(mode, 8));
  put(108, 8, octal(0, 8));
  put(116, 8, octal(0, 8));
  put(124, 12, octal(Math.min(size, MAX_OCTAL_SIZE), 12));
  put(136, 12, octal(Math.max(0, Math.floor(mtime / 1000)), 12));
  put(148, 8, "        ");
  h[156] = type.charCodeAt(0);
  put(257, 6, "ustar\0");
  put(263, 2, "00");
  const sum = h.reduce((a, b) => a + b, 0);
  put(148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}

/** Enregistrement PAX « longueur clé=valeur\n », la longueur incluant ses propres chiffres. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  const bodyLength = enc.encode(body).length;
  let length = bodyLength + String(bodyLength).length;
  if (String(length).length !== String(bodyLength).length) length = bodyLength + String(length).length;
  return `${length}${body}`;
}

const padding = (size) => new Uint8Array((BLOCK - (size % BLOCK)) % BLOCK);

/**
 * Écrit une archive TAR POSIX (ustar + en-têtes PAX pour les noms longs ou accentués).
 * @param {{name: string, data: Uint8Array, date?: Date}[]} entries
 */
export function tarWrite(entries) {
  const blocks = [];
  for (const entry of entries) {
    const name = cleanEntryName(entry.name) || "fichier";
    const data = entry.data;
    const mtime = entry.date instanceof Date ? entry.date.getTime() : Date.now();
    const asciiName = /^[\x20-\x7e]*$/.test(name);
    const records = [];
    if (!asciiName || name.length > 100) records.push(paxRecord("path", name));
    if (data.length > MAX_OCTAL_SIZE) records.push(paxRecord("size", data.length));
    if (records.length) {
      const pax = enc.encode(records.join(""));
      blocks.push(
        header({
          name: `PaxHeaders/${name.replace(/[^\x20-\x7e]/g, "_")}`.slice(0, 99),
          size: pax.length,
          mtime,
          type: "x",
        }),
        pax,
        padding(pax.length),
      );
    }
    const shortName = asciiName ? name.slice(0, 100) : name.replace(/[^\x20-\x7e]/g, "_").slice(0, 100);
    blocks.push(header({ name: shortName, size: data.length, mtime }), data, padding(data.length));
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  return new Blob(blocks, { type: "application/x-tar" });
}

function readNumber(h, offset, length) {
  if (h[offset] & 0x80) {
    // Encodage base 256 (GNU) pour les très grandes tailles.
    let n = 0;
    for (let i = offset + 1; i < offset + length; i++) n = n * 256 + h[i];
    return n;
  }
  const text = ascii(h, offset, offset + length)
    .replace(/\0.*$/s, "")
    .trim();
  return text ? parseInt(text, 8) : 0;
}

function parsePax(bytes) {
  const out = {};
  for (let i = 0; i < bytes.length;) {
    let space = i;
    while (space < bytes.length && bytes[space] !== 0x20) space++;
    const length = parseInt(ascii(bytes, i, space), 10);
    if (!length || i + length > bytes.length) break;
    const line = dec.decode(bytes.subarray(space + 1, i + length - 1));
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
    i += length;
  }
  return out;
}

const isZeroBlock = (h) => h.every((x) => x === 0);

/** Lit une archive TAR (ustar, PAX, noms longs GNU). Dossiers et liens sont ignorés. */
export function tarRead(input) {
  const u = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = [];
  let pax = {};
  let longName = null;
  for (let offset = 0; offset + BLOCK <= u.length;) {
    const h = u.subarray(offset, offset + BLOCK);
    if (isZeroBlock(h)) break;
    const stored = readNumber(h, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (stored !== sum) throw new Error("Archive TAR invalide ou endommagée (somme de contrôle).");
    const type = String.fromCharCode(h[156] || 48);
    const size = pax.size ? Number(pax.size) : readNumber(h, 124, 12);
    const dataStart = offset + BLOCK;
    if (dataStart + size > u.length) throw new Error("Archive TAR tronquée.");
    const data = u.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      pax = parsePax(data);
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      longName = dec.decode(data).replace(/\0.*$/s, "");
      continue;
    }
    let name = dec.decode(h.subarray(0, 100)).replace(/\0.*$/s, "");
    if (ascii(h, 257, 262) === "ustar") {
      const prefix = dec.decode(h.subarray(345, 500)).replace(/\0.*$/s, "");
      if (prefix) name = `${prefix}/${name}`;
    }
    name = pax.path || longName || name;
    const mtime = pax.mtime ? Number(pax.mtime) * 1000 : readNumber(h, 136, 12) * 1000;
    pax = {};
    longName = null;
    if (type === "0" || type === "7" || h[156] === 0) {
      const clean = cleanEntryName(name);
      if (clean) out.push({ name: clean, data: data.slice(), date: new Date(mtime) });
    }
  }
  return out;
}

export const looksLikeTar = (bytes) => bytes.length >= 512 && ascii(bytes, 257, 262) === "ustar";
