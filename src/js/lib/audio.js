import { encodeWav, nativeSampleRate } from "./wav.js";

const OfflineContext = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
/** Au-delà, décoder tout le fichier en mémoire risquerait de saturer l'onglet. */
export const MAX_DECODE_SIZE = 512 * 1024 * 1024;

const clampRate = (rate) => Math.min(192000, Math.max(8000, Math.round(rate)));

/** Décode un fichier audio à sa fréquence d'origine (évite un rééchantillonnage implicite). */
export async function decodeAudio(file) {
  const Context = OfflineContext();
  if (!Context) throw new Error("Web Audio n'est pas disponible dans ce navigateur.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const context = new Context(1, 1, clampRate(nativeSampleRate(bytes) || 48000));
  try {
    return await context.decodeAudioData(bytes.buffer);
  } catch {
    throw new Error("Le navigateur ne sait pas décoder ce fichier audio (codec non pris en charge).");
  }
}

const channelsOf = (buffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));

/**
 * Rééchantillonne et remixe avec le moteur audio du navigateur (filtrage anti-repliement inclus).
 * @returns {Promise<Float32Array[]>}
 */
export async function renderChannels(
  buffer,
  { sampleRate = buffer.sampleRate, channels = buffer.numberOfChannels } = {},
) {
  const rate = clampRate(sampleRate);
  if (rate === buffer.sampleRate && channels === buffer.numberOfChannels) return channelsOf(buffer);
  const Context = OfflineContext();
  const context = new Context(channels, Math.max(1, Math.ceil(buffer.duration * rate)), rate);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return channelsOf(await context.startRendering());
}

export async function audioToWav(
  buffer,
  { sampleRate = buffer.sampleRate, channels = Math.min(2, buffer.numberOfChannels), bitDepth = 16 } = {},
) {
  const rate = clampRate(sampleRate);
  return encodeWav(await renderChannels(buffer, { sampleRate: rate, channels }), rate, bitDepth);
}

/** Concatène plusieurs pistes décodées dans un format commun. */
export async function concatAudio(buffers, { sampleRate, channels }) {
  const rendered = [];
  for (const b of buffers) rendered.push(await renderChannels(b, { sampleRate, channels }));
  return Array.from({ length: channels }, (_, c) => {
    const total = rendered.reduce((n, r) => n + r[c].length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const r of rendered) {
      out.set(r[c], offset);
      offset += r[c].length;
    }
    return out;
  });
}

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h} h ${String(m).padStart(2, "0")} min ${r} s` : `${m} min ${r} s`;
}
