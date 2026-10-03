export const enc = new TextEncoder();
export const dec = new TextDecoder();

let CRC32_TABLE;
export function crc32(data, crc = 0) {
  if (!CRC32_TABLE) {
    CRC32_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC32_TABLE[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = CRC32_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

export function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function u32le(n) {
  const u = new Uint8Array(4);
  new DataView(u.buffer).setUint32(0, n >>> 0, true);
  return u;
}

export async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (typeof data === "string") return enc.encode(data);
  throw new TypeError("Données binaires attendues.");
}

export function ascii(bytes, start, end) {
  let s = "";
  for (let i = start; i < Math.min(end, bytes.length); i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export function startsWith(bytes, signature, offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) if (bytes[offset + i] !== signature[i]) return false;
  return true;
}

export function bytesToBase64(u) {
  let out = "";
  for (let i = 0; i < u.length; i += 0x8000) out += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Flux de compression natifs du navigateur (gzip, deflate, deflate-raw). */
export async function streamCodec(data, format, mode) {
  const Codec = mode === "compress" ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Codec) throw new Error("La compression native n'est pas disponible dans ce navigateur.");
  const stream = new Blob([data]).stream().pipeThrough(new Codec(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
