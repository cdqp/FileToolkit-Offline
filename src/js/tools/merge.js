// Fusion sémantique (PDF, images, audio, données, texte), réassemblage de volumes et archives de regroupement.

import { extOf, makeFile, MIME, textFile, totalSize } from "../core/files.js";
import { isBrowserImage } from "../core/formats.js";
import { filesToEntries, writeArchive } from "../lib/archive.js";
import { concatAudio, decodeAudio } from "../lib/audio.js";
import { detectDelimiter, parseCSV, toCSV } from "../lib/csv.js";
import { createCanvas, encodeCanvas, fitWithin, loadImage, releaseCanvas } from "../lib/image.js";
import { mergeToPdf } from "../lib/pdf-create.js";
import { encodeWav } from "../lib/wav.js";

const VOLUME = /^(.+)\.part(\d{2,})$/i;

/** Volumes « nom.part001 », « nom.part002 »… issus d'une découpe binaire. */
export function volumeSet(files) {
  const parts = files.map((f) => f.name.match(VOLUME));
  if (files.length < 2 || parts.some((m) => !m) || new Set(parts.map((m) => m[1])).size !== 1) return null;
  const numbers = parts.map((m) => Number(m[2])).sort((a, b) => a - b);
  const contiguous = numbers.every((n, i) => n === numbers[0] + i);
  return { name: parts[0][1], contiguous, missingFirst: numbers[0] !== 1 };
}

const allOf = (infos, test) => infos.length > 1 && infos.every(test);

/** Cibles de fusion réellement réalisables, la plus pertinente en premier. */
export function mergeTargets(files, infos) {
  const out = [];
  const volumes = volumeSet(files);
  if (volumes) out.push("join");
  if (allOf(infos, (i) => i.format === "pdf" || (i.group === "image" && isBrowserImage(i.format))))
    out.push("pdf");
  if (allOf(infos, (i) => i.group === "image" && isBrowserImage(i.format))) out.push("png");
  if (allOf(infos, (i) => i.group === "audio")) out.push("wav");
  if (allOf(infos, (i) => i.format === "csv" || i.format === "tsv")) out.push("csv");
  if (allOf(infos, (i) => i.format === "json")) out.push("json");
  if (
    allOf(
      infos,
      (i) => i.group === "text" || (i.group === "data" && !["json", "csv", "tsv"].includes(i.format)),
    )
  )
    out.push("txt");
  out.push("zip", "tgz", "rar");
  return out;
}

export const MERGE_LABELS = {
  join: "RÉASSEMBLER",
  pdf: "PDF",
  png: "PLANCHE PNG",
  wav: "WAV",
  csv: "CSV",
  json: "JSON",
  txt: "TEXTE",
  zip: "ZIP",
  tgz: "TAR.GZ",
  rar: "RAR",
};

export function mergeHint(target, infos) {
  return {
    join: "Les volumes sont recollés dans l'ordre pour restaurer le fichier d'origine, octet pour octet.",
    pdf: infos.every((i) => i.format === "pdf")
      ? "Toutes les pages sont copiées dans un seul PDF, dans l'ordre de la liste."
      : "PDF et images sont réunis dans un seul PDF : une page par image, dans l'ordre de la liste.",
    png: "Les images sont assemblées sur une planche, sans déformation.",
    wav: "Les pistes sont mises bout à bout dans un WAV unique (fréquence et canaux harmonisés).",
    csv: "Les lignes sont ajoutées les unes à la suite des autres ; les colonnes sont alignées par nom d'en-tête.",
    json: "Les tableaux sont concaténés ; les autres valeurs deviennent des éléments d'un tableau.",
    txt: "Les textes sont mis bout à bout, chacun commençant sur une nouvelle ligne.",
    zip: "Les fichiers restent intacts et sont regroupés dans une archive ZIP, lisible partout.",
    tgz: "Archive TAR compressée en gzip, standard sous Linux et macOS.",
    rar: "Archive RAR 5 « stockée » (sans compression), lisible par WinRAR et 7-Zip.",
  }[target];
}

async function imageSheet(files, { layout = "vertical", gap = 0, background = "#ffffff" }) {
  const images = [];
  for (const f of files) images.push(await loadImage(f));
  const maxW = Math.max(...images.map((i) => i.width));
  const maxH = Math.max(...images.map((i) => i.height));
  const cols =
    layout === "grid" ? Math.ceil(Math.sqrt(images.length)) : layout === "horizontal" ? images.length : 1;
  const rows = Math.ceil(images.length / cols);
  let width;
  let height;
  if (layout === "vertical") {
    width = maxW;
    height = images.reduce((n, i) => n + i.height, 0) + gap * (images.length - 1);
  } else if (layout === "horizontal") {
    width = images.reduce((n, i) => n + i.width, 0) + gap * (images.length - 1);
    height = maxH;
  } else {
    width = cols * maxW + gap * (cols - 1);
    height = rows * maxH + gap * (rows - 1);
  }
  const fit = fitWithin(width, height);
  const s = fit.scale;
  const canvas = createCanvas(fit.width, fit.height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  if (background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  let x = 0;
  let y = 0;
  images.forEach((im, k) => {
    if (layout === "vertical") {
      ctx.drawImage(im.img, ((maxW - im.width) / 2) * s, y * s, im.width * s, im.height * s);
      y += im.height + gap;
    } else if (layout === "horizontal") {
      ctx.drawImage(im.img, x * s, ((maxH - im.height) / 2) * s, im.width * s, im.height * s);
      x += im.width + gap;
    } else {
      const col = k % cols;
      const row = Math.floor(k / cols);
      const r = Math.min(1, maxW / im.width, maxH / im.height);
      const w = im.width * r;
      const h = im.height * r;
      ctx.drawImage(
        im.img,
        (col * (maxW + gap) + (maxW - w) / 2) * s,
        (row * (maxH + gap) + (maxH - h) / 2) * s,
        w * s,
        h * s,
      );
    }
  });
  const blob = await encodeCanvas(canvas, "image/png");
  releaseCanvas(canvas);
  return {
    file: makeFile(blob, "planche.png", "image/png"),
    note: s < 1 ? `Planche réduite à ${Math.round(s * 100)} % pour respecter les limites du navigateur.` : "",
  };
}

function mergeCsv(texts) {
  const tables = texts.map((t) => {
    const delimiter = detectDelimiter(t);
    return { delimiter, rows: parseCSV(t, delimiter) };
  });
  const headers = tables.map((t) => t.rows[0] || []);
  const same = headers.every((h) => h.join("\u0000") === headers[0].join("\u0000"));
  const delimiter = tables[0].delimiter;
  const eol = texts[0].includes("\r\n") ? "\r\n" : "\n";
  if (same)
    return { text: toCSV([headers[0], ...tables.flatMap((t) => t.rows.slice(1))], delimiter, eol), note: "" };
  const columns = [...new Set(headers.flat())];
  const rows = tables.flatMap((t) =>
    t.rows.slice(1).map((r) => columns.map((c) => r[t.rows[0].indexOf(c)] ?? "")),
  );
  return {
    text: toCSV([columns, ...rows], delimiter, eol),
    note: `En-têtes différents : ${columns.length} colonnes réunies par nom.`,
  };
}

/**
 * Fusionne les fichiers selon la cible choisie.
 * @returns {Promise<{file: File, note?: string}>}
 */
export async function mergeFiles(files, infos, target, opts = {}, onProgress = () => {}) {
  if (["zip", "tgz", "rar"].includes(target)) {
    return {
      file: await writeArchive(await filesToEntries(files), target, opts.name || "regroupement", {
        onProgress: (p) => onProgress(p / 100),
      }),
    };
  }
  if (target === "join") {
    const volumes = volumeSet(files);
    if (!volumes?.contiguous || volumes.missingFirst)
      throw new Error("Volumes incomplets : il faut tous les morceaux, du premier au dernier, sans trou.");
    const sorted = [...files].sort(
      (a, b) => Number(a.name.match(VOLUME)[2]) - Number(b.name.match(VOLUME)[2]),
    );
    return {
      file: makeFile(sorted, volumes.name, MIME[extOf(volumes.name)]),
      note: `${sorted.length} volumes réassemblés (${totalSize(sorted).toLocaleString("fr-FR")} octets).`,
    };
  }
  if (target === "pdf") {
    const doc = await mergeToPdf(files, infos, {
      pageSize: opts.pageSize,
      onProgress: (p) => onProgress(p * 0.9),
    });
    return {
      file: makeFile(
        await doc.save({ useObjectStreams: true }),
        `${opts.name || "fusion"}.pdf`,
        "application/pdf",
      ),
      note: `${doc.getPageCount()} pages au total.`,
    };
  }
  if (target === "png") return imageSheet(files, opts);
  if (target === "wav") {
    const buffers = [];
    for (let i = 0; i < files.length; i++) {
      buffers.push(await decodeAudio(files[i]));
      onProgress(((i + 1) / files.length) * 0.6);
    }
    const sampleRate = Math.max(...buffers.map((b) => b.sampleRate));
    const channels = Math.min(2, Math.max(...buffers.map((b) => b.numberOfChannels)));
    const data = await concatAudio(buffers, { sampleRate, channels });
    return {
      file: makeFile(encodeWav(data, sampleRate), `${opts.name || "fusion"}.wav`, "audio/wav"),
      note: `${sampleRate.toLocaleString("fr-FR")} Hz, ${channels === 1 ? "mono" : "stéréo"}.`,
    };
  }
  const texts = await Promise.all(files.map((f) => f.text()));
  if (target === "csv") {
    const merged = mergeCsv(texts);
    return { file: textFile(merged.text, `${opts.name || "fusion"}.csv`, "text/csv"), note: merged.note };
  }
  if (target === "json") {
    const values = texts.map((t, i) => {
      try {
        return JSON.parse(t);
      } catch {
        throw new Error(`« ${files[i].name} » n'est pas un JSON valide.`);
      }
    });
    const merged = values.every(Array.isArray)
      ? values.flat()
      : values.flatMap((v) => (Array.isArray(v) ? v : [v]));
    return {
      file: textFile(
        JSON.stringify(merged, null, 2) + "\n",
        `${opts.name || "fusion"}.json`,
        "application/json",
      ),
    };
  }
  if (target === "txt") {
    const exts = new Set(files.map((f) => extOf(f.name)));
    const ext = exts.size === 1 ? [...exts][0] || "txt" : "txt";
    const joined = texts.map((t) => (t.endsWith("\n") ? t : `${t}\n`)).join("");
    return { file: textFile(joined, `${opts.name || "fusion"}.${ext}`, MIME[ext] || "text/plain") };
  }
  throw new Error("Ces fichiers n'ont pas de mode de fusion valide.");
}
