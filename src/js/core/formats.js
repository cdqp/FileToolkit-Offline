import { ascii, startsWith } from "./bytes.js";
import { extOf, normalizedExt } from "./files.js";

// prettier-ignore
export const FORMAT_GROUPS = {
  image: [
    "jpg", "jpeg", "jfif", "jpe", "png", "apng", "gif", "bmp", "tiff", "tif", "webp", "heic", "heif", "avif", "svg",
    "ico", "cur", "psd", "ai", "eps", "indd", "raw", "dng", "cr2", "cr3", "nef", "arw", "tga", "exr", "hdr", "jxr",
    "jxl", "dds", "pam",
  ],
  audio: [
    "wav", "flac", "mp3", "aac", "ogg", "oga", "opus", "wma", "m4a", "aiff", "aif", "alac", "amr", "midi", "mid", "ac3",
    "dts", "ape", "mpc", "wv", "tak", "m4b", "m4r", "ra", "au", "caf", "voc", "mod", "weba",
  ],
  video: [
    "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "vob", "mpeg", "mpg", "m4v", "3gp", "ogv", "m2ts", "mts", "rm",
    "asf", "divx", "xvid", "swf", "f4v", "mxf", "prores", "dnxhd", "dvr-ms",
  ],
  document: [
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "rtf", "odt", "ods", "odp", "epub", "mobi", "pages", "azw3",
    "cbr", "cbz", "xps", "tex", "pub", "wpd", "numbers", "sxc", "key",
  ],
  archive: ["zip", "rar", "7z", "tar", "tgz", "gz", "bz2", "xz", "zst", "z", "ace", "arj", "lzh", "cab", "apk", "jar"],
  package: ["iso", "dmg", "img", "vhd", "vhdx", "deb", "rpm", "msi", "exe", "dll", "sys", "appimage"],
  data: ["json", "xml", "csv", "tsv", "yml", "yaml", "ini", "cfg", "toml"],
  text: [
    "txt", "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "md", "markdown", "sql", "log", "bat", "ps1",
    "vbs", "reg", "sh", "py", "java", "cpp", "c", "h", "hpp", "php", "vue", "rb", "go", "rs", "swift", "kt", "lua",
    "pl", "asm", "srt", "vtt", "sub", "ass", "cue", "m3u",
  ],
  model: ["blend", "obj", "fbx", "stl", "gltf", "glb", "3mf", "ply", "step", "stp", "iges", "igs", "dwg", "dxf"],
  font: ["ttf", "otf", "woff", "woff2"],
  database: ["db", "sqlite", "sqlite3", "bak"],
  other: ["torrent", "tmp", "class", "lnk", "vmap", "ani"],
};

export const GROUP_LABELS = {
  image: "Image",
  audio: "Audio",
  video: "Vidéo",
  document: "Document",
  archive: "Archive",
  package: "Image disque / paquet",
  data: "Données structurées",
  text: "Texte / code",
  model: "3D / CAO",
  font: "Police",
  database: "Base de données",
  other: "Autre",
};

const GROUP_OF = new Map();
for (const [group, exts] of Object.entries(FORMAT_GROUPS))
  for (const e of exts) if (!GROUP_OF.has(e)) GROUP_OF.set(e, group);

/** Formats qui sont en réalité des conteneurs ZIP : on garde leur extension. */
// prettier-ignore
const ZIP_BASED = new Set([
  "zip", "docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "jar", "apk", "cbz", "xps", "3mf", "kmz", "ipa",
  "vsix", "nupkg", "whl", "pages", "numbers", "key", "sketch", "ora", "aab",
]);

export function groupOf(ext) {
  return GROUP_OF.get(String(ext).toLowerCase()) || "other";
}

function sniffFtyp(head, ext) {
  const brand = ascii(head, 8, 12).trim().toLowerCase();
  const brands = ascii(head, 8, 32).toLowerCase();
  if (["heic", "heix", "hevc", "heim", "heis", "hevm"].includes(brand))
    return ["heic", "Conteneur HEIF (HEIC)"];
  if (brand === "avif" || brand === "avis" || (brand === "mif1" && brands.includes("avif")))
    return ["avif", "Conteneur AVIF"];
  if (brand === "mif1" || brand === "msf1") return ["heic", "Conteneur HEIF"];
  if (brand === "qt") return ["mov", "Conteneur QuickTime"];
  if (brand.startsWith("m4a") || brand === "m4b")
    return [ext === "m4b" ? "m4b" : "m4a", "Conteneur MPEG-4 audio"];
  if (brand.startsWith("3g")) return ["3gp", "Conteneur 3GPP"];
  const keep = ["mp4", "m4v", "m4a", "m4b", "m4r", "f4v", "mov"].includes(ext);
  return [keep ? ext : "mp4", "Conteneur MPEG-4"];
}

/** Identifie un format à partir de sa signature binaire, avec l'extension comme repli. */
export function sniff(head, name = "") {
  const ext = normalizedExt(extOf(name));
  const s = (signature, offset = 0) => startsWith(head, signature, offset);
  const text = (str, offset = 0) => ascii(head, offset, offset + str.length) === str;

  if (text("%PDF-") || ascii(head, 0, 1024).includes("%PDF-")) return ["pdf", "Signature PDF"];
  if (s([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return [ext === "apng" ? "apng" : "png", "Signature PNG"];
  if (s([0xff, 0xd8, 0xff])) return ["jpg", "Signature JPEG"];
  if (text("GIF87a") || text("GIF89a")) return ["gif", "Signature GIF"];
  if (text("RIFF") && text("WEBP", 8)) return ["webp", "Signature WebP"];
  if (text("RIFF") && text("WAVE", 8)) return ["wav", "Signature WAVE"];
  if (text("RIFF") && text("AVI ", 8)) return ["avi", "Signature AVI"];
  if (text("BM") && head.length > 14 && head[6] === 0 && head[7] === 0) return ["bmp", "Signature BMP"];
  if (s([0x49, 0x49, 0x2a, 0x00]) || s([0x4d, 0x4d, 0x00, 0x2a])) {
    const raw = ["dng", "cr2", "nef", "arw"].includes(ext);
    return [raw ? ext : "tiff", raw ? "Image RAW (TIFF)" : "Signature TIFF"];
  }
  if (s([0x00, 0x00, 0x01, 0x00]) && ["ico", ""].includes(ext)) return ["ico", "Signature ICO"];
  if (s([0x00, 0x00, 0x02, 0x00]) && ext === "cur") return ["cur", "Signature CUR"];
  if (text("8BPS")) return ["psd", "Signature Photoshop"];
  if (s([0xff, 0x0a]) || s([0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20]))
    return ["jxl", "Signature JPEG XL"];
  if (text("ftyp", 4)) return sniffFtyp(head, ext);
  if (s([0x1a, 0x45, 0xdf, 0xa3]))
    return [ext === "webm" ? "webm" : ext === "weba" ? "weba" : "mkv", "Conteneur Matroska / WebM"];
  if (text("fLaC")) return ["flac", "Signature FLAC"];
  if (text("OggS")) return [["ogg", "oga", "opus", "ogv"].includes(ext) ? ext : "ogg", "Conteneur Ogg"];
  if (text("ID3")) return ["mp3", "Étiquette ID3 (MP3)"];
  if (text("FORM") && (text("AIFF", 8) || text("AIFC", 8))) return ["aiff", "Signature AIFF"];
  if (text("MThd")) return ["mid", "Signature MIDI"];
  if (s([0xff, 0xf1]) || s([0xff, 0xf9])) return ["aac", "Flux AAC (ADTS)"];
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)
    return ["mp3", "Trame MPEG audio"];
  if (s([0x50, 0x4b, 0x03, 0x04]) || s([0x50, 0x4b, 0x05, 0x06]) || s([0x50, 0x4b, 0x07, 0x08])) {
    return [ZIP_BASED.has(ext) ? ext : "zip", "Conteneur ZIP"];
  }
  if (s([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]))
    return ["rar", head[6] === 1 ? "Signature RAR 5" : "Signature RAR 4"];
  if (s([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return ["7z", "Signature 7-Zip"];
  if (s([0x1f, 0x8b])) return [ext === "tgz" ? "tgz" : "gz", "Flux gzip"];
  if (text("BZh")) return ["bz2", "Flux bzip2"];
  if (s([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return ["xz", "Flux XZ"];
  if (s([0x28, 0xb5, 0x2f, 0xfd])) return ["zst", "Flux Zstandard"];
  if (text("ustar", 257)) return ["tar", "Archive TAR (ustar)"];
  if (text("wOFF")) return ["woff", "Signature WOFF"];
  if (text("wOF2")) return ["woff2", "Signature WOFF2"];
  if (text("OTTO")) return ["otf", "Police OpenType (CFF)"];
  if (s([0x00, 0x01, 0x00, 0x00, 0x00]) && ["ttf", "otf", ""].includes(ext))
    return [ext || "ttf", "Police TrueType"];
  if (text("true") && ["ttf", ""].includes(ext)) return ["ttf", "Police TrueType"];
  if (text("SQLite format 3\0")) return [ext === "db" ? "db" : "sqlite", "Base SQLite"];
  if (text("MZ") && ["exe", "dll", "sys", "msi", ""].includes(ext))
    return [ext || "exe", "Exécutable Windows"];
  if (text("{\\rtf")) return ["rtf", "Signature RTF"];
  if (text("%!PS")) return [ext === "eps" ? "eps" : "ps", "Signature PostScript"];
  if (ext === "ts") {
    // « .ts » désigne aussi bien un flux vidéo MPEG-TS que du TypeScript : l'octet de synchronisation tranche.
    const video = head[0] === 0x47 && (head.length <= 188 || head[188] === 0x47);
    return ["ts", video ? "Flux MPEG-TS" : "Code TypeScript", video ? "video" : "text"];
  }
  const start = ascii(
    head,
    head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0,
    512,
  ).trimStart();
  if (start.startsWith("<?xml")) return [ext || "xml", "En-tête XML"];
  if (/^<svg[\s>]/i.test(start)) return ["svg", "Balise SVG"];
  return [ext, "Extension"];
}

export async function identify(file) {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const [format, detail, forcedGroup] = sniff(head, file.name);
  return {
    ext: normalizedExt(extOf(file.name)),
    format,
    group: forcedGroup || groupOf(format),
    detail,
    mime: file.type || "",
  };
}

export const isBrowserImage = (format) =>
  ["jpg", "png", "apng", "gif", "webp", "bmp", "ico", "svg", "avif", "heic", "tiff", "jxl", "cur"].includes(
    format,
  );
