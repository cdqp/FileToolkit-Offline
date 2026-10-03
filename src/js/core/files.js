export function extOf(name) {
  const m = String(name)
    .toLowerCase()
    .match(/\.([^./\\]+)$/);
  return m ? m[1] : "";
}

/** Nom sans la dernière extension (« archive.tar.gz » → « archive.tar »). */
export function baseName(name) {
  const file = String(name).split(/[\\/]/).pop();
  return file.replace(/(.)\.[^.]*$/, "$1");
}

/** Nom sans extension d'archive composée (« photos.tar.gz » → « photos »). */
export function stemName(name) {
  return baseName(name).replace(/\.tar$/i, "");
}

export function normalizedExt(ext) {
  const e = String(ext || "").toLowerCase();
  return (
    { jpeg: "jpg", jfif: "jpg", jpe: "jpg", tif: "tiff", yml: "yaml", htm: "html", mjs: "js", cjs: "js" }[
      e
    ] || e
  );
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0;
  while (Math.abs(n) >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

export const MIME = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  wav: "audio/wav",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  xml: "application/xml",
  yaml: "application/yaml",
  ini: "text/plain",
  zip: "application/zip",
  tar: "application/x-tar",
  tgz: "application/gzip",
  gz: "application/gzip",
  rar: "application/vnd.rar",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};

export function mimeOf(ext) {
  return MIME[normalizedExt(ext)] || "application/octet-stream";
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|yaml))/;

export function makeFile(data, name, type) {
  const mime = type || (data instanceof Blob && data.type) || mimeOf(extOf(name));
  const withCharset = TEXT_TYPES.test(mime) && !/charset=/.test(mime) ? `${mime};charset=utf-8` : mime;
  return new File(Array.isArray(data) ? data : [data], name, { type: withCharset, lastModified: Date.now() });
}

export function textFile(text, name, type) {
  return makeFile(String(text), name, type || mimeOf(extOf(name)));
}

/** Retire les caractères interdits dans un nom de fichier (Windows, macOS, Linux). */
export function sanitizeFileName(name, fallback = "fichier") {
  const clean = String(name)
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .slice(0, 200);
  return clean || fallback;
}

/** Fabrique des noms uniques (insensibles à la casse) : « a.txt », « a-2.txt », « a-3.txt »… */
export function uniqueNamer() {
  const used = new Set();
  return (name) => {
    const ext = extOf(name);
    const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
    let candidate = name;
    for (let i = 2; used.has(candidate.toLowerCase()); i++)
      candidate = ext ? `${stem}-${i}.${ext}` : `${stem}-${i}`;
    used.add(candidate.toLowerCase());
    return candidate;
  };
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // Firefox peut démarrer le téléchargement après un délai : on garde l'URL valide une minute.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const totalSize = (files) => files.reduce((n, f) => n + f.size, 0);
