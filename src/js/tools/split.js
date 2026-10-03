// Découpe adaptée au format : pages PDF, durée audio, lignes de données, tuiles d'image ou volumes binaires.

import { baseName, extOf, makeFile, MIME, textFile } from "../core/files.js";
import { isBrowserImage } from "../core/formats.js";
import { decodeAudio } from "../lib/audio.js";
import { detectDelimiter, parseCSV, toCSV } from "../lib/csv.js";
import { canEncode, createCanvas, encodeCanvas, IMAGE_MIME, loadImage, releaseCanvas } from "../lib/image.js";
import { loadPdfLib, pdfSubsets } from "../lib/pdf-create.js";
import { encodeWav } from "../lib/wav.js";

export function splitMode(info) {
  if (info.format === "pdf") return "pdf";
  if (info.group === "audio") return "audio";
  if (info.format === "csv" || info.format === "tsv") return "csv";
  if (info.format === "json") return "json";
  if (info.group === "image" && isBrowserImage(info.format) && info.format !== "svg") return "image";
  if (info.group === "text" || info.group === "data") return "text";
  return "binary";
}

/**
 * Analyse « 1-3, 5, 8- » en groupes d'indices de pages (base 0).
 * @returns {number[][]}
 */
export function parsePageRanges(text, pageCount) {
  const groups = [];
  for (const raw of String(text).split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`Plage « ${part} » invalide. Exemple : 1-3, 5, 8-`);
    const single = m.length === 2;
    const start = single ? Number(m[1]) : m[1] ? Number(m[1]) : 1;
    const end = single ? start : m[2] ? Number(m[2]) : pageCount;
    if (start < 1 || end < start) throw new Error(`Plage « ${part} » invalide.`);
    if (start > pageCount)
      throw new Error(`La page ${start} n'existe pas : le document en compte ${pageCount}.`);
    groups.push(Array.from({ length: Math.min(end, pageCount) - start + 1 }, (_, i) => start - 1 + i));
  }
  if (!groups.length) throw new Error("Indiquez au moins une page ou une plage, par exemple : 1-3, 5");
  return groups;
}

const part = (n, total) => String(n).padStart(Math.max(3, String(total).length), "0");

async function splitPdf(file, opts, onProgress) {
  const name = baseName(file.name);
  const source = await loadPdfLib(file);
  const count = source.getPageCount();
  let groups;
  if (opts.pdfMode === "every") {
    const step = Math.max(1, Math.floor(Number(opts.pages) || 1));
    groups = [];
    for (let i = 0; i < count; i += step)
      groups.push(Array.from({ length: Math.min(step, count - i) }, (_, j) => i + j));
  } else if (opts.pdfMode === "ranges" || opts.pdfMode === "extract") {
    groups = parsePageRanges(opts.ranges, count);
    if (opts.pdfMode === "extract") groups = [groups.flat()];
  } else groups = Array.from({ length: count }, (_, i) => [i]);
  const { outputs } = await pdfSubsets(file, groups, onProgress);
  const label = (g) => (g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g.at(-1) + 1}`);
  const files = outputs.map((bytes, i) =>
    makeFile(
      bytes,
      opts.pdfMode === "extract"
        ? `${name}-extrait.pdf`
        : `${name}-${part(i + 1, outputs.length)}-${label(groups[i])}.pdf`,
      "application/pdf",
    ),
  );
  return { files, note: `${count} pages → ${files.length} fichier${files.length > 1 ? "s" : ""} PDF.` };
}

async function splitAudio(file, opts, onProgress) {
  const buffer = await decodeAudio(file);
  const name = baseName(file.name);
  const rate = buffer.sampleRate;
  const total = buffer.length;
  const step =
    opts.audioMode === "parts"
      ? Math.ceil(total / Math.max(1, Math.floor(Number(opts.parts) || 2)))
      : Math.max(1, Math.round(Math.max(0.1, Number(opts.seconds) || 30) * rate));
  const count = Math.ceil(total / step);
  const channels = Math.min(2, buffer.numberOfChannels);
  const files = [];
  for (let p = 0; p < count; p++) {
    const start = p * step;
    const end = Math.min(total, start + step);
    const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c).slice(start, end));
    files.push(makeFile(encodeWav(data, rate), `${name}-${part(p + 1, count)}.wav`, "audio/wav"));
    onProgress((p + 1) / count);
  }
  return { files, note: `${count} morceaux WAV de ${Math.round((step / rate) * 10) / 10} s maximum.` };
}

async function splitRows(file, info, opts) {
  const name = baseName(file.name);
  const ext = extOf(file.name) || info.format;
  const n = Math.max(1, Math.floor(Number(opts.lines) || 1000));
  const text = await file.text();
  const files = [];
  if (info.format === "csv" || info.format === "tsv") {
    const delimiter = info.format === "tsv" ? "\t" : detectDelimiter(text);
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const rows = parseCSV(text, delimiter);
    const [header, ...body] = rows;
    const total = Math.ceil(body.length / n) || 1;
    for (let i = 0, p = 1; i < Math.max(1, body.length); i += n, p++)
      files.push(
        textFile(
          toCSV([header, ...body.slice(i, i + n)], delimiter, eol),
          `${name}-${part(p, total)}.${ext}`,
          MIME[info.format],
        ),
      );
    return { files, note: `${body.length} lignes de données, en-tête répété dans chaque fichier.` };
  }
  if (info.format === "json") {
    let value;
    try {
      value = JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON invalide : ${e.message}`);
    }
    if (!Array.isArray(value)) throw new Error("La découpe JSON exige un tableau à la racine du document.");
    const total = Math.ceil(value.length / n) || 1;
    for (let i = 0, p = 1; i < Math.max(1, value.length); i += n, p++)
      files.push(
        textFile(
          JSON.stringify(value.slice(i, i + n), null, 2) + "\n",
          `${name}-${part(p, total)}.json`,
          "application/json",
        ),
      );
    return { files, note: `${value.length} éléments répartis par lots de ${n}.` };
  }
  const lines = text.split(/(?<=\n)/);
  const total = Math.ceil(lines.length / n) || 1;
  for (let i = 0, p = 1; i < Math.max(1, lines.length); i += n, p++)
    files.push(
      textFile(lines.slice(i, i + n).join(""), `${name}-${part(p, total)}.${ext}`, MIME[ext] || "text/plain"),
    );
  return { files, note: `${lines.length} lignes réparties par lots de ${n}.` };
}

async function splitImage(file, info, opts, onProgress) {
  const { img, width, height } = await loadImage(file);
  const rows = Math.max(1, Math.min(20, Math.floor(Number(opts.rows) || 2)));
  const cols = Math.max(1, Math.min(20, Math.floor(Number(opts.cols) || 2)));
  const format =
    ["jpg", "png", "webp"].includes(info.format) && (await canEncode(IMAGE_MIME[info.format]))
      ? info.format
      : "png";
  const name = baseName(file.name);
  const files = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round((c * width) / cols);
      const y0 = Math.round((r * height) / rows);
      const w = Math.round(((c + 1) * width) / cols) - x0;
      const h = Math.round(((r + 1) * height) / rows) - y0;
      const canvas = createCanvas(w, h);
      canvas.getContext("2d").drawImage(img, x0, y0, w, h, 0, 0, w, h);
      files.push(
        makeFile(
          await encodeCanvas(canvas, IMAGE_MIME[format], 0.92),
          `${name}-L${r + 1}-C${c + 1}.${format}`,
          IMAGE_MIME[format],
        ),
      );
      releaseCanvas(canvas);
      onProgress(files.length / (rows * cols));
    }
  }
  return {
    files,
    note: `${rows} × ${cols} tuiles de ${Math.round(width / cols)} × ${Math.round(height / rows)} px environ.`,
  };
}

function reassemblyNote(name, count) {
  const parts = Array.from({ length: count }, (_, i) => `"${name}.part${part(i + 1, count)}"`);
  return `Réassembler « ${name} »
${"=".repeat(name.length + 15)}

Ces ${count} volumes ne sont pas utilisables séparément : recollez-les dans l'ordre.

• CDQP Offline File Toolkit : Assembler › Fusion, déposez tous les volumes, choisissez « Réassembler ».
• Windows (invite de commandes) :
  copy /b ${parts.join("+")} "${name}"
• macOS / Linux (terminal) :
  cat ${parts.join(" ")} > "${name}"
`;
}

async function splitBinary(file, opts, onProgress) {
  const size = Math.max(64 * 1024, Math.round((Number(opts.megabytes) || 10) * 1024 * 1024));
  const count = Math.ceil(file.size / size) || 1;
  const files = [];
  for (let i = 0; i < count; i++) {
    files.push(
      makeFile(
        file.slice(i * size, Math.min(file.size, (i + 1) * size)),
        `${file.name}.part${part(i + 1, count)}`,
        "application/octet-stream",
      ),
    );
    onProgress((i + 1) / count);
  }
  files.push(textFile(reassemblyNote(file.name, count), `${file.name}.REASSEMBLER.txt`, "text/plain"));
  return {
    files,
    note: `${count} volumes de ${(size / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} Mo maximum, avec la notice de réassemblage.`,
    volumes: true,
  };
}

/**
 * Découpe un fichier.
 * @returns {Promise<{files: File[], note: string, volumes?: boolean}>}
 */
export async function splitFile(file, info, opts = {}, onProgress = () => {}) {
  const mode = splitMode(info);
  if (mode === "pdf") return splitPdf(file, opts, onProgress);
  if (mode === "audio") return splitAudio(file, opts, onProgress);
  if (mode === "image") return splitImage(file, info, opts, onProgress);
  if (mode === "csv" || mode === "json" || mode === "text") return splitRows(file, info, opts);
  return splitBinary(file, opts, onProgress);
}

export async function pdfPageCount(file) {
  return (await loadPdfLib(file)).getPageCount();
}
