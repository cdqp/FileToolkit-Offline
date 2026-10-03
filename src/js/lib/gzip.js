import { concatBytes, streamCodec, toBytes } from "../core/bytes.js";

/** Compresse au format gzip en inscrivant le nom d'origine (champ FNAME) quand il est en Latin-1. */
export async function gzip(data, name = "") {
  const bytes = await streamCodec(await toBytes(data), "gzip", "compress");
  if (!name || !/^[\x20-\x7e\xa0-\xff]+$/.test(name) || bytes[3] !== 0) return bytes;
  const header = bytes.slice(0, 10);
  header[3] |= 0x08;
  const fname = Uint8Array.from(name, (c) => c.charCodeAt(0));
  return concatBytes(header, fname, new Uint8Array([0]), bytes.subarray(10));
}

/** Décompresse un flux gzip et retrouve, si présent, le nom de fichier d'origine. */
export async function gunzip(data) {
  const bytes = await toBytes(data);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("Ce fichier n'est pas un flux gzip valide.");
  let name = "";
  const flags = bytes[3];
  let o = 10;
  if (flags & 0x04) o += 2 + (bytes[o] | (bytes[o + 1] << 8));
  if (flags & 0x08) {
    const end = bytes.indexOf(0, o);
    name = String.fromCharCode(...bytes.subarray(o, end));
    o = end + 1;
  }
  try {
    return { data: await streamCodec(bytes, "gzip", "decompress"), name };
  } catch {
    throw new Error("Flux gzip endommagé ou incomplet.");
  }
}
