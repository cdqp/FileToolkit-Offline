import { ascii } from "../core/bytes.js";

/**
 * Encode des canaux PCM flottants en WAV (16 bits par défaut, 8 ou 24 bits possibles).
 * @param {Float32Array[]} channels
 */
export function encodeWav(channels, sampleRate, bitDepth = 16) {
  const frames = channels[0]?.length ?? 0;
  const count = channels.length;
  const bytes = bitDepth / 8;
  const dataSize = frames * count * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * bytes, true);
  view.setUint16(32, count * bytes, true);
  view.setUint16(34, bitDepth, true);
  text(36, "data");
  view.setUint32(40, dataSize, true);
  let o = 44;
  if (bitDepth === 16) {
    const out = new Int16Array(buffer, 44, frames * count);
    for (let i = 0, k = 0; i < frames; i++) {
      for (let c = 0; c < count; c++, k++) {
        const x = Math.max(-1, Math.min(1, channels[c][i]));
        out[k] = x < 0 ? x * 0x8000 : x * 0x7fff;
      }
    }
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
      // Machine gros-boutiste (rarissime) : réécriture explicite en petit-boutiste.
      for (let k = 0; k < out.length; k++) view.setInt16(44 + k * 2, out[k], true);
    }
  } else {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < count; c++) {
        const x = Math.max(-1, Math.min(1, channels[c][i]));
        if (bitDepth === 8) view.setUint8(o, Math.round((x + 1) * 127.5));
        else {
          const v = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
          view.setUint8(o, v & 255);
          view.setUint8(o + 1, (v >> 8) & 255);
          view.setUint8(o + 2, (v >> 16) & 255);
        }
        o += bytes;
      }
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Fréquence d'échantillonnage native d'un fichier audio courant (WAV, FLAC, MP3, Ogg), sinon null. */
export function nativeSampleRate(bytes) {
  const u = bytes;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  if (ascii(u, 0, 4) === "RIFF" && ascii(u, 8, 12) === "WAVE") {
    for (let o = 12; o + 8 <= u.length;) {
      const id = ascii(u, o, o + 4);
      const size = dv.getUint32(o + 4, true);
      if (id === "fmt " && o + 16 <= u.length) return dv.getUint32(o + 12, true);
      o += 8 + size + (size & 1);
    }
  }
  if (ascii(u, 0, 4) === "fLaC" && u.length > 21) return (u[18] << 12) | (u[19] << 4) | (u[20] >> 4);
  if (ascii(u, 0, 4) === "OggS") {
    const vorbis = ascii(u, 28, 35) === "\x01vorbis";
    if (vorbis && u.length > 44) return dv.getUint32(40, true);
    if (ascii(u, 28, 36) === "OpusHead") return 48000;
  }
  let o = 0;
  if (ascii(u, 0, 3) === "ID3" && u.length > 10) o = 10 + ((u[6] << 21) | (u[7] << 14) | (u[8] << 7) | u[9]);
  for (let end = Math.min(u.length - 4, o + 8192); o < end; o++) {
    if (u[o] === 0xff && (u[o + 1] & 0xe0) === 0xe0) {
      const version = (u[o + 1] >> 3) & 3;
      const index = (u[o + 2] >> 2) & 3;
      const base = [44100, 48000, 32000][index];
      if (!base || version === 1) continue;
      return version === 3 ? base : version === 2 ? base / 2 : base / 4;
    }
  }
  return null;
}
