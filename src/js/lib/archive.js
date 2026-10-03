/* global JSZip */
import { toBytes } from "../core/bytes.js";
import { extOf, makeFile, stemName, uniqueNamer } from "../core/files.js";
import { gunzip, gzip } from "./gzip.js";
import { rarReadStored, rarWrite } from "./rar.js";
import { cleanEntryName, looksLikeTar, tarRead, tarWrite } from "./tar.js";

/** Formats déjà compressés : les stocker tels quels est plus rapide et jamais plus lourd. */
// prettier-ignore
const COMPRESSED = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "mp3", "mp4", "m4a", "aac", "ogg", "opus", "webm", "mkv", "mov",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "zst", "docx", "xlsx", "pptx", "odt", "ods", "epub", "woff", "woff2", "jar", "apk",
]);

export const READABLE_ARCHIVES = ["zip", "jar", "apk", "cbz", "tar", "tgz", "gz", "rar"];
export const ARCHIVE_TARGETS = ["zip", "tgz", "tar", "rar"];

export async function zipEntries(file) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("Archive ZIP illisible ou endommagée.");
  }
  const entries = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const name = cleanEntryName(entry.name);
    if (!name) continue;
    try {
      entries.push({ name, data: new Uint8Array(await entry.async("uint8array")), date: entry.date });
    } catch {
      throw new Error(
        `Entrée « ${name} » illisible : archive chiffrée ou méthode de compression non prise en charge.`,
      );
    }
  }
  return entries;
}

/** Lit le contenu d'une archive prise en charge sous forme de liste { name, data, date }. */
export async function readArchive(file, format) {
  if (["zip", "jar", "apk", "cbz"].includes(format)) return zipEntries(file);
  const bytes = await toBytes(file);
  if (format === "tar") return tarRead(bytes);
  if (format === "rar") return rarReadStored(bytes);
  if (format === "tgz" || format === "gz") {
    const { data, name } = await gunzip(bytes);
    if (format === "tgz" || looksLikeTar(data)) return tarRead(data);
    const inner = name || stemName(file.name) || "fichier";
    return [{ name: cleanEntryName(inner), data }];
  }
  throw new Error(`Lecture des archives ${format.toUpperCase()} non disponible hors ligne.`);
}

export async function zipBlob(entries, { level = 6, onProgress = () => {} } = {}) {
  const zip = new JSZip();
  for (const e of entries) {
    const stored = COMPRESSED.has(extOf(e.name));
    zip.file(e.name, e.data, { date: e.date || new Date(), compression: stored ? "STORE" : "DEFLATE" });
  }
  return zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level }, mimeType: "application/zip" },
    (meta) => onProgress(meta.percent),
  );
}

/**
 * Crée une archive dans le format demandé.
 * @param {{name: string, data: Uint8Array, date?: Date}[]} entries
 */
export async function writeArchive(entries, format, baseName, { onProgress = () => {}, level = 6 } = {}) {
  const unique = uniqueNamer();
  const list = entries.map((e) => ({ ...e, name: unique(cleanEntryName(e.name) || "fichier") }));
  if (format === "zip")
    return makeFile(await zipBlob(list, { level, onProgress }), `${baseName}.zip`, "application/zip");
  if (format === "tar") return makeFile(tarWrite(list), `${baseName}.tar`, "application/x-tar");
  if (format === "tgz") {
    const tar = new Uint8Array(await tarWrite(list).arrayBuffer());
    onProgress(50);
    return makeFile(await gzip(tar), `${baseName}.tar.gz`, "application/gzip");
  }
  if (format === "gz") {
    if (list.length !== 1)
      throw new Error(
        "Le format GZ ne contient qu'un seul fichier : utilisez TAR.GZ pour plusieurs fichiers.",
      );
    return makeFile(await gzip(list[0].data, list[0].name), `${list[0].name}.gz`, "application/gzip");
  }
  if (format === "rar") return makeFile(rarWrite(list), `${baseName}.rar`, "application/vnd.rar");
  throw new Error(`Format d'archive inconnu : ${format}.`);
}

export async function filesToEntries(files) {
  return Promise.all(
    files.map(async (f) => ({
      name: f.name,
      data: await toBytes(f),
      date: new Date(f.lastModified || Date.now()),
    })),
  );
}

export const ARCHIVE_LABELS = { zip: "ZIP", tgz: "TAR.GZ", tar: "TAR", rar: "RAR", gz: "GZ" };
