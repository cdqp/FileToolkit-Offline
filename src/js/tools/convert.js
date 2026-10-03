// Moteur de conversion : n'annonce que des sorties réellement produites et valides.

import { toBytes } from "../core/bytes.js";
import { escapeHtml } from "../core/dom.js";
import { baseName, makeFile, MIME, stemName, textFile } from "../core/files.js";
import { isBrowserImage } from "../core/formats.js";
import { ARCHIVE_LABELS, readArchive, writeArchive } from "../lib/archive.js";
import { audioToWav, decodeAudio } from "../lib/audio.js";
import {
  detectDelimiter,
  objectsToRows,
  parseCSV,
  rowsToMarkdown,
  rowsToObjects,
  toCSV,
} from "../lib/csv.js";
import { convertFont, fontInfo, fontTargets } from "../lib/fonts.js";
import { htmlDocument, preBlock, rowsToHtmlTable } from "../lib/htmldoc.js";
import {
  drawToCanvas,
  encodeBMP,
  encodeCanvas,
  encodeICO,
  fitWithin,
  hasTransparency,
  IMAGE_MIME,
  loadImage,
  rasterTargets,
  releaseCanvas,
} from "../lib/image.js";
import { parseIni, toIni } from "../lib/ini.js";
import { markdownToHtml } from "../lib/markdown.js";
import {
  blocksToHtml,
  blocksToMarkdown,
  blocksToText,
  htmlBlocks,
  OFFICE_FORMATS,
  readOffice,
  textToBlocks,
} from "../lib/office.js";
import { blocksToDocx, sheetsToXlsx } from "../lib/ooxml-write.js";
import { openPdf, pdfPagesText, renderPage } from "../lib/pdf.js";
import { imagesToPdf, textToPdf } from "../lib/pdf-create.js";
import { rtfToText } from "../lib/rtf.js";
import { srtToVtt, vttToSrt } from "../lib/subtitles.js";
import { objectToXml, xmlTextToObject, parseXmlDocument } from "../lib/xmljson.js";
import { parseYaml, stringifyYaml } from "../lib/yaml.js";

export const TARGET_LABELS = {
  ...ARCHIVE_LABELS,
  extract: "EXTRAIRE",
  md: "MARKDOWN",
  yaml: "YAML",
  jpg: "JPG",
};
export const targetLabel = (t) => TARGET_LABELS[t] || t.toUpperCase();

// prettier-ignore
const TARGET_ORDER = [
  "docx", "txt", "md", "html", "png", "jpg", "webp", "avif", "pdf", "ico", "bmp", "xlsx", "csv", "tsv", "json", "yaml",
  "xml", "ini", "vtt", "srt", "wav", "ttf", "otf", "woff", "css", "extract", "zip", "tgz", "tar", "gz", "rar",
];
export const sortTargets = (list) =>
  [...list].sort((a, b) => (TARGET_ORDER.indexOf(a) + 1 || 99) - (TARGET_ORDER.indexOf(b) + 1 || 99));

const GZIP_WORTHY = new Set(["text", "data", "font", "database", "model"]);
const UNCOMPRESSED = new Set([
  "bmp",
  "wav",
  "tiff",
  "svg",
  "tar",
  "aiff",
  "pdf",
  "psd",
  "ttf",
  "otf",
  "iso",
  "img",
  "exe",
  "dll",
]);
const SHEET_FORMATS = ["xlsx", "ods"];

function wrapTargets(info) {
  const out = ["zip"];
  if (GZIP_WORTHY.has(info.group) || UNCOMPRESSED.has(info.format)) out.push("gz");
  out.push("rar");
  return out;
}

const parseHtml = (text) => new DOMParser().parseFromString(text, "text/html");

/** Analyse un fichier : formats de sortie possibles, données préparées et éventuel avertissement. */
export async function conversionTargets(file, info) {
  const f = info.format;
  const g = info.group;
  const wrap = wrapTargets(info);
  const cache = {};
  const result = (targets, extra = {}) => {
    const unique = [...new Set(targets)];
    // « same » : le fichier est déjà dans ce format (utile pour un lot mixte, sans intérêt seul).
    return { targets: unique.filter((t) => t !== f), same: unique.includes(f) ? f : null, cache, ...extra };
  };

  if (f === "pdf") {
    cache.pdf = await openPdf(file);
    return result([
      "docx",
      "txt",
      "md",
      "html",
      "png",
      "jpg",
      ...(await rasterTargets()).filter((t) => t === "webp"),
      ...wrap,
    ]);
  }
  if (g === "image") {
    if (!isBrowserImage(f) && f) {
      return result(wrap, {
        warning: `Aucun moteur ${f.toUpperCase()} n'est disponible hors ligne : seul l'archivage est proposé.`,
      });
    }
    try {
      cache.image = await loadImage(file);
    } catch (e) {
      return result(wrap, { warning: e.message });
    }
    return result([...(await rasterTargets()), "pdf", "ico", "bmp", ...wrap]);
  }
  if (g === "audio" || g === "video") {
    try {
      cache.audio = await decodeAudio(file);
    } catch (e) {
      const warning =
        g === "video"
          ? "La conversion vidéo exige un encodeur indisponible hors ligne ; la piste audio n'a pas pu être lue."
          : e.message;
      return result(wrap, { warning });
    }
    return result(
      ["wav", ...wrap],
      g === "video" ? { note: "La piste audio de cette vidéo peut être extraite en WAV." } : {},
    );
  }
  if (OFFICE_FORMATS.includes(f)) {
    try {
      cache.office = await readOffice(file, f);
    } catch (e) {
      return result(wrap, { warning: e.message });
    }
    if (cache.office.kind === "sheet") return result(["xlsx", "csv", "json", "html", "md", "pdf", ...wrap]);
    return result(["docx", "txt", "md", "html", "pdf", ...wrap]);
  }
  if (f === "rtf") {
    cache.text = rtfToText(await file.text());
    return result(["docx", "txt", "html", "pdf", ...wrap]);
  }
  if (["zip", "jar", "apk", "cbz", "tar", "tgz", "gz", "rar"].includes(f)) {
    cache.entries = await readArchive(file, f);
    if (!cache.entries.length) throw new Error("Cette archive ne contient aucun fichier.");
    const targets =
      f === "gz" && cache.entries.length === 1 ? ["extract", "zip"] : ["extract", "zip", "tgz", "tar", "rar"];
    return result(targets.filter((t) => !(f === "zip" && t === "zip")));
  }
  if (g === "font") {
    const bytes = await toBytes(file);
    cache.font = fontInfo(bytes);
    return result([...fontTargets(cache.font), ...wrap]);
  }
  if (g === "data") {
    const text = (cache.text = await file.text());
    if (f === "json") {
      try {
        cache.value = JSON.parse(text);
      } catch (e) {
        throw new Error(`JSON invalide : ${e.message}`);
      }
      return result(["csv", "xlsx", "yaml", "xml", "html", "pdf", ...wrap]);
    }
    if (f === "csv" || f === "tsv") {
      cache.rows = parseCSV(text, f === "tsv" ? "\t" : detectDelimiter(text));
      return result(["xlsx", "json", f === "csv" ? "tsv" : "csv", "html", "md", "xml", "pdf", ...wrap]);
    }
    if (f === "xml") {
      cache.value = xmlTextToObject(text);
      return result(["json", "yaml", "html", "txt", "pdf", ...wrap]);
    }
    if (f === "yaml") {
      cache.value = parseYaml(text);
      return result(["json", "xml", "pdf", ...wrap]);
    }
    if (f === "ini" || f === "cfg") {
      cache.value = parseIni(text);
      return result(["json", "yaml", "pdf", ...wrap]);
    }
    return result(["txt", "pdf", ...wrap]);
  }
  if (g === "text") {
    cache.text = await file.text();
    if (f === "srt") return result(["vtt", "txt", ...wrap]);
    if (f === "vtt") return result(["srt", "txt", ...wrap]);
    if (f === "md" || f === "markdown") return result(["html", "docx", "pdf", "txt", ...wrap]);
    if (f === "html") return result(["txt", "md", "docx", "pdf", ...wrap]);
    return result(["html", "pdf", "docx", "txt", ...wrap]);
  }
  const why = {
    video: "La conversion vidéo exige un encodeur indisponible hors ligne.",
    archive: `Le format ${f.toUpperCase()} n'est pas lisible hors ligne.`,
    document: `Aucun moteur ${f.toUpperCase()} n'est disponible hors ligne.`,
  }[g];
  return result(wrap, why ? { warning: `${why} Seul l'archivage est proposé.` } : {});
}

/** Indication affichée sous le format de sortie choisi. */
export function targetHint(target, info) {
  if (target === "extract")
    return "Chaque fichier contenu dans l'archive pourra être téléchargé individuellement.";
  if (["zip", "rar", "tgz", "tar", "gz"].includes(target)) {
    const archive = ["zip", "tar", "tgz", "gz", "rar", "apk", "jar", "cbz"].includes(info.format);
    const base =
      target === "rar"
        ? "RAR 5 « stocké » (sans compression), lisible par WinRAR et 7-Zip."
        : target === "gz"
          ? "Compression gzip d'un fichier unique, standard sous Linux et macOS."
          : `${targetLabel(target)} est un format d'archive.`;
    return `${base} ${archive ? "Le contenu est extrait puis réarchivé à l'identique." : "Le fichier original y est placé sans modification."}`;
  }
  if (info.format === "pdf") {
    if (target === "docx")
      return "Le texte et les paragraphes sont repris dans un vrai document Word, une page Word par page PDF. La mise en page complexe n'est pas reproduite.";
    if (["png", "jpg", "webp"].includes(target))
      return "Chaque page devient une image ; plusieurs pages sont regroupées dans une archive.";
    return "Le texte est extrait page par page, avec ses retours à la ligne. Un PDF scanné nécessiterait un OCR.";
  }
  if (target === "pdf" && info.group === "image")
    return "L'image est placée dans un PDF sans perte de qualité (JPEG et PNG intégrés tels quels).";
  if (target === "pdf")
    return "Le contenu textuel est mis en page dans un PDF A4 (polices standard : les caractères non latins sont remplacés).";
  if (target === "ico") return "Icône multi-résolution (16 à 256 px) prête pour Windows ou comme favicon.";
  if (target === "bmp") return "Bitmap 24 bits non compressé ; la transparence est remplacée par du blanc.";
  if (target === "jpg" && info.group === "image")
    return "JPEG ne gère pas la transparence : elle sera remplacée par du blanc.";
  if (target === "wav" && info.group === "video")
    return "Seule la piste audio est extraite, en WAV non compressé.";
  if (target === "wav") return "Audio décodé en WAV PCM 16 bits, à la fréquence d'origine.";
  if (target === "xlsx") return "Classeur Excel : nombres reconnus, première ligne en en-tête figé.";
  if (target === "csv" && SHEET_FORMATS.includes(info.format))
    return "Une feuille par fichier CSV ; plusieurs feuilles sont regroupées dans une archive.";
  if (target === "html" && ["md", "markdown"].includes(info.format))
    return "Le Markdown est mis en forme : titres, listes, tableaux, code, liens.";
  if (target === "docx")
    return "Document Word modifiable, titres et tableaux conservés lorsque la source les décrit.";
  if (info.group === "font") {
    if (target === "woff") return "Police WOFF compressée, conçue pour le Web.";
    if (target === "css") return "Feuille CSS autonome intégrant la police en base64.";
    if (target === "otf") return "Conteneur OpenType ; les contours d'origine sont conservés à l'identique.";
    if (target === "ttf") return "Police TrueType reconstruite à partir du conteneur WOFF.";
  }
  return "La sortie est générée localement puis vérifiée.";
}

const textOut = (text, name, ext) => textFile(text, `${name}.${ext}`, MIME[ext]);

async function convertImage(file, cache, target, opts) {
  const { img, width, height } = cache.image || (await loadImage(file));
  const name = baseName(file.name);
  if (target === "pdf")
    return [await imagesToPdf([file], `${name}.pdf`, { pageSize: opts.pageSize || "image" })];
  if (target === "ico") return [makeFile(await encodeICO(img, width, height), `${name}.ico`, IMAGE_MIME.ico)];
  const size = fitWithin(width, height, { longEdge: Number(opts.longEdge) || 0 });
  const background = target === "jpg" || target === "bmp" ? "#ffffff" : null;
  const canvas = drawToCanvas(img, size.width, size.height, background);
  try {
    if (target === "bmp") return [makeFile(encodeBMP(canvas), `${name}.bmp`, IMAGE_MIME.bmp)];
    const blob = await encodeCanvas(
      canvas,
      IMAGE_MIME[target],
      target === "png" ? undefined : Number(opts.quality) || 0.9,
    );
    return [makeFile(blob, `${name}.${target}`, IMAGE_MIME[target])];
  } finally {
    releaseCanvas(canvas);
  }
}

async function convertPdf(file, cache, target, opts, progress) {
  const name = baseName(file.name);
  const pdf = cache.pdf || (await openPdf(file));
  if (["png", "jpg", "webp"].includes(target)) {
    const out = [];
    const scale = (Number(opts.dpi) || 150) / 72;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const { canvas } = await renderPage(page, scale);
      const blob = await encodeCanvas(
        canvas,
        IMAGE_MIME[target],
        target === "png" ? undefined : Number(opts.quality) || 0.9,
      );
      releaseCanvas(canvas);
      page.cleanup();
      out.push(
        makeFile(
          blob,
          pdf.numPages === 1 ? `${name}.${target}` : `${name}-page-${String(i).padStart(3, "0")}.${target}`,
          IMAGE_MIME[target],
        ),
      );
      progress(i / pdf.numPages);
    }
    return out;
  }
  const pages = await pdfPagesText(pdf, (p) => progress(p * 0.8));
  if (target === "txt")
    return [
      textOut(
        pages.map((p, i) => (pages.length > 1 ? `——— Page ${i + 1} ———\n${p}` : p)).join("\n\n") + "\n",
        name,
        "txt",
      ),
    ];
  if (target === "md")
    return [textOut(pages.map((p) => p.replace(/\n(?!\n)/g, "  \n")).join("\n\n---\n\n") + "\n", name, "md")];
  if (target === "html") {
    const body = pages
      .map(
        (p, i) =>
          `<section><h2>Page ${i + 1}</h2>${p
            .split(/\n{2,}/)
            .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
            .join("\n")}</section>`,
      )
      .join("\n");
    return [textOut(htmlDocument(name, body), name, "html")];
  }
  if (target === "docx") {
    const blocks = [];
    pages.forEach((page, i) => {
      if (i) blocks.push({ type: "pagebreak" });
      for (const para of page.split(/\n{2,}/))
        blocks.push({ type: "p", text: para.replace(/-\n(?=\p{Ll})/gu, "").replace(/\n/g, " ") });
    });
    return [await blocksToDocx(blocks, `${name}.docx`)];
  }
  throw new Error("Conversion PDF non disponible.");
}

function blocksOutput(blocks, title, name, target) {
  if (target === "txt") return textOut(blocksToText(blocks) + "\n", name, "txt");
  if (target === "md") return textOut(blocksToMarkdown(blocks), name, "md");
  if (target === "html") return textOut(htmlDocument(title, blocksToHtml(blocks)), name, "html");
  return null;
}

async function convertOffice(file, cache, target) {
  const name = baseName(file.name);
  const office = cache.office;
  if (office.kind === "sheet") {
    const sheets = office.sheets.filter((s) => s.rows.length);
    if (!sheets.length) throw new Error("Le classeur ne contient aucune donnée.");
    const suffix = (s) => (sheets.length > 1 ? `${name}-${s.name.replace(/[\\/:*?"<>|]+/g, "_")}` : name);
    if (target === "xlsx") return [await sheetsToXlsx(sheets, `${name}.xlsx`)];
    if (target === "csv") return sheets.map((s) => textOut(toCSV(s.rows), suffix(s), "csv"));
    if (target === "json") {
      const value =
        sheets.length > 1
          ? Object.fromEntries(sheets.map((s) => [s.name, rowsToObjects(s.rows)]))
          : rowsToObjects(sheets[0].rows);
      return [textOut(JSON.stringify(value, null, 2) + "\n", name, "json")];
    }
    if (target === "md")
      return [textOut(sheets.map((s) => `## ${s.name}\n\n${rowsToMarkdown(s.rows)}`).join("\n"), name, "md")];
    if (target === "html")
      return [
        textOut(
          htmlDocument(
            name,
            sheets
              .map((s) => `<section><h2>${escapeHtml(s.name)}</h2>${rowsToHtmlTable(s.rows)}</section>`)
              .join("\n"),
          ),
          name,
          "html",
        ),
      ];
    if (target === "pdf")
      return [
        await textToPdf(
          sheets.flatMap((s) => [
            { text: s.name, heading: 2 },
            ...s.rows.map((r) => ({ text: r.join("   ") })),
          ]),
          name,
        ),
      ];
  }
  const blocks = office.blocks;
  if (target === "docx") return [await blocksToDocx(blocks, `${name}.docx`)];
  if (target === "pdf")
    return [
      await textToPdf(
        blocks.flatMap((b) =>
          b.type === "table"
            ? b.rows.map((r) => ({ text: r.join("   ") }))
            : [{ text: b.type === "li" ? `• ${b.text}` : b.text, heading: b.type === "h" ? b.level : 0 }],
        ),
        name,
      ),
    ];
  const out = blocksOutput(blocks, name, name, target);
  if (out) return [out];
  throw new Error("Conversion bureautique non disponible.");
}

async function convertData(file, info, cache, target) {
  const name = baseName(file.name);
  const f = info.format;
  if (target === "pdf") return [await textToPdf(cache.text, file.name)];
  if (f === "csv" || f === "tsv") {
    const rows = cache.rows;
    if (target === "xlsx") return [await sheetsToXlsx([{ name, rows }], `${name}.xlsx`)];
    if (target === "json")
      return [textOut(JSON.stringify(rowsToObjects(rows), null, 2) + "\n", name, "json")];
    if (target === "csv") return [textOut(toCSV(rows, ","), name, "csv")];
    if (target === "tsv") return [textOut(toCSV(rows, "\t"), name, "tsv")];
    if (target === "html") return [textOut(htmlDocument(name, rowsToHtmlTable(rows)), name, "html")];
    if (target === "md") return [textOut(rowsToMarkdown(rows), name, "md")];
    if (target === "xml")
      return [textOut(objectToXml({ lignes: { ligne: rowsToObjects(rows) } }), name, "xml")];
  }
  const value = cache.value;
  if (target === "json") return [textOut(JSON.stringify(value, null, 2) + "\n", name, "json")];
  if (target === "yaml") return [textOut(stringifyYaml(value), name, "yaml")];
  if (target === "xml") return [textOut(objectToXml(value), name, "xml")];
  if (target === "ini") return [textOut(toIni(value), name, "ini")];
  if (target === "csv") return [textOut(toCSV(objectsToRows(value)), name, "csv")];
  if (target === "xlsx") return [await sheetsToXlsx([{ name, rows: objectsToRows(value) }], `${name}.xlsx`)];
  if (target === "html")
    return [textOut(htmlDocument(name, preBlock(JSON.stringify(value, null, 2))), name, "html")];
  if (target === "txt" && f === "xml")
    return [
      textOut(
        parseXmlDocument(cache.text)
          .documentElement.textContent.replace(/\n\s*\n+/g, "\n")
          .trim() + "\n",
        name,
        "txt",
      ),
    ];
  if (target === "txt") return [textOut(cache.text, name, "txt")];
  throw new Error("Conversion de données non disponible.");
}

async function convertText(file, info, cache, target) {
  const name = baseName(file.name);
  const f = info.format;
  const text = cache.text;
  if (f === "srt" && target === "vtt") return [textOut(srtToVtt(text), name, "vtt")];
  if (f === "vtt" && target === "srt") return [textOut(vttToSrt(text), name, "srt")];
  if (f === "srt" || f === "vtt") {
    const plain = text
      .replace(/^WEBVTT.*$/m, "")
      .split(/\n{2,}/)
      .map((b) =>
        b
          .split("\n")
          .filter((l) => !/-->|^\d+$/.test(l.trim()))
          .join("\n"),
      )
      .filter(Boolean)
      .join("\n");
    return [textOut(plain.trim() + "\n", name, "txt")];
  }
  if (f === "md" || f === "markdown") {
    const rendered = markdownToHtml(text);
    if (target === "html") return [textOut(htmlDocument(name, rendered), name, "html")];
    const blocks = htmlBlocks(parseHtml(rendered).body);
    if (target === "docx") return [await blocksToDocx(blocks, `${name}.docx`)];
    if (target === "pdf")
      return [
        await textToPdf(
          blocks.map((b) => ({
            text: b.type === "li" ? `• ${b.text}` : (b.text ?? ""),
            heading: b.type === "h" ? b.level : 0,
          })),
          name,
        ),
      ];
    if (target === "txt") return [textOut(blocksToText(blocks) + "\n", name, "txt")];
  }
  if (f === "html") {
    const doc = parseHtml(text);
    const title = doc.title || name;
    const blocks = htmlBlocks(doc.body);
    if (target === "docx") return [await blocksToDocx(blocks, `${name}.docx`, title)];
    if (target === "pdf")
      return [
        await textToPdf(
          blocks.map((b) => ({
            text: b.type === "li" ? `• ${b.text}` : (b.text ?? ""),
            heading: b.type === "h" ? b.level : 0,
          })),
          title,
        ),
      ];
    const out = blocksOutput(blocks, title, name, target);
    if (out) return [out];
  }
  if (target === "html") return [textOut(htmlDocument(file.name, preBlock(text)), name, "html")];
  if (target === "pdf") return [await textToPdf(text, file.name)];
  if (target === "docx") return [await blocksToDocx(textToBlocks(text), `${name}.docx`)];
  if (target === "txt") return [textOut(text, name, "txt")];
  throw new Error("Conversion de texte non disponible.");
}

/**
 * Convertit un fichier vers la cible choisie.
 * @returns {Promise<File[]>} un ou plusieurs fichiers produits
 */
export async function convertFile(file, info, target, cache = {}, opts = {}, onProgress = () => {}) {
  const progress = (p) => onProgress(Math.max(0, Math.min(1, p)));
  const f = info.format;
  const g = info.group;
  if (target === "extract")
    return (cache.entries || (await readArchive(file, f))).map((e) =>
      makeFile(e.data, e.name.split("/").pop(), undefined),
    );
  if (["zip", "tgz", "tar", "rar", "gz"].includes(target)) {
    const archive = ["zip", "jar", "apk", "cbz", "tar", "tgz", "gz", "rar"].includes(f);
    const entries = archive
      ? cache.entries || (await readArchive(file, f))
      : [{ name: file.name, data: await toBytes(file), date: new Date(file.lastModified) }];
    return [
      await writeArchive(
        entries,
        target,
        archive ? stemName(file.name) : file.name.replace(/\.[^.]+$/, "") || "archive",
        { onProgress: (p) => progress(p / 100) },
      ),
    ];
  }
  if (f === "pdf") return convertPdf(file, cache, target, opts, progress);
  if (g === "image") return convertImage(file, cache, target, opts);
  if ((g === "audio" || g === "video") && target === "wav") {
    const audio = cache.audio || (await decodeAudio(file));
    return [
      makeFile(
        await audioToWav(audio, { channels: Math.min(2, audio.numberOfChannels) }),
        `${baseName(file.name)}.wav`,
        "audio/wav",
      ),
    ];
  }
  if (OFFICE_FORMATS.includes(f))
    return convertOffice(file, { office: cache.office || (await readOffice(file, f)) }, target);
  if (f === "rtf") {
    const text = cache.text ?? rtfToText(await file.text());
    const blocks = textToBlocks(text);
    if (target === "docx") return [await blocksToDocx(blocks, `${baseName(file.name)}.docx`)];
    if (target === "pdf") return [await textToPdf(text, file.name)];
    if (target === "html")
      return [textOut(htmlDocument(baseName(file.name), blocksToHtml(blocks)), baseName(file.name), "html")];
    return [textOut(text + "\n", baseName(file.name), "txt")];
  }
  if (g === "font") return [await convertFont(file, f, target)];
  if (g === "data")
    return convertData(
      file,
      info,
      cache.text !== undefined ? cache : await conversionTargets(file, info).then((r) => r.cache),
      target,
    );
  if (g === "text") return convertText(file, info, { text: cache.text ?? (await file.text()) }, target);
  throw new Error("Conversion non disponible pour ce format.");
}

/** Libère les ressources retenues par une analyse (documents PDF ouverts dans le worker). */
export function releaseCache(cache) {
  cache?.pdf?.destroy?.();
}
