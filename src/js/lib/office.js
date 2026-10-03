/* global JSZip */
// Lecture du contenu des documents bureautiques (Office Open XML, OpenDocument, EPUB).
// Le résultat est une liste de blocs ({type: "h"|"p"|"li"|"table"}) ou de feuilles de calcul.

import { escapeHtml } from "../core/dom.js";
import { rowsToMarkdown } from "./csv.js";
import { rowsToHtmlTable } from "./htmldoc.js";

const parseXml = (text) => {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length)
    throw new Error("Document bureautique endommagé (XML invalide).");
  return doc;
};

const byLocal = (node, local) => [...node.getElementsByTagNameNS("*", local)];
const firstLocal = (node, local) => node.getElementsByTagNameNS("*", local)[0] || null;
const childrenLocal = (node, local) => [...node.children].filter((c) => c.localName === local);
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relId = (node) => node.getAttributeNS(REL_NS, "id");
const attr = (node, local) => {
  for (const a of node?.attributes || []) if (a.localName === local) return a.value;
  return null;
};

async function zipText(zip, path, required = true) {
  const entry = zip.file(path);
  if (!entry) {
    if (required) throw new Error(`Document incomplet : « ${path} » est absent.`);
    return null;
  }
  return entry.async("text");
}

function resolvePath(base, target) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

async function relationships(zip, relsPath) {
  const text = await zipText(zip, relsPath, false);
  if (!text) return new Map();
  return new Map(
    byLocal(parseXml(text), "Relationship").map((r) => [r.getAttribute("Id"), r.getAttribute("Target")]),
  );
}

// ——— Word (DOCX) ———

function wordRunText(node) {
  let out = "";
  const walk = (n) => {
    for (const c of n.children) {
      const name = c.localName;
      if (name === "t") out += c.textContent;
      else if (name === "tab") out += "\t";
      else if (name === "br" || name === "cr") out += "\n";
      else if (name === "noBreakHyphen") out += "-";
      else if (!["del", "delText", "instrText", "rPr", "pPr", "fldChar", "drawing", "pict"].includes(name))
        walk(c);
    }
  };
  walk(node);
  return out;
}

function wordParagraph(p) {
  const pPr = childrenLocal(p, "pPr")[0];
  const style = attr(pPr && childrenLocal(pPr, "pStyle")[0], "val") || "";
  const outline = attr(pPr && childrenLocal(pPr, "outlineLvl")[0], "val");
  const text = wordRunText(p);
  const heading = style.match(/^(heading|titre|berschrift|título|titolo)\s*(\d)/i);
  if (/^(title|titre)$/i.test(style)) return { type: "h", level: 1, text };
  if (heading) return { type: "h", level: Math.min(6, Number(heading[2])), text };
  if (outline !== null && Number(outline) < 6) return { type: "h", level: Number(outline) + 1, text };
  if (pPr && childrenLocal(pPr, "numPr").length) return { type: "li", text };
  return { type: "p", text };
}

function wordBlocks(container, blocks = []) {
  for (const child of container.children) {
    const name = child.localName;
    if (name === "p") blocks.push(wordParagraph(child));
    else if (name === "tbl") {
      const rows = childrenLocal(child, "tr").map((tr) =>
        childrenLocal(tr, "tc").map((tc) =>
          childrenLocal(tc, "p")
            .map((p) => wordRunText(p))
            .join("\n"),
        ),
      );
      blocks.push({ type: "table", rows });
    } else if (name === "sdt") {
      const content = childrenLocal(child, "sdtContent")[0];
      if (content) wordBlocks(content, blocks);
    }
  }
  return blocks;
}

async function readDocx(zip) {
  const doc = parseXml(await zipText(zip, "word/document.xml"));
  const body = firstLocal(doc, "body");
  return { kind: "text", blocks: body ? wordBlocks(body) : [] };
}

// ——— OpenDocument (ODT / ODP) ———

function odfText(node) {
  let out = "";
  for (const c of node.childNodes) {
    if (c.nodeType === 3) out += c.nodeValue;
    else if (c.nodeType === 1) {
      const name = c.localName;
      if (name === "s") out += " ".repeat(Number(attr(c, "c") || 1));
      else if (name === "tab") out += "\t";
      else if (name === "line-break") out += "\n";
      else if (!["note", "annotation", "bookmark-start", "bookmark-end"].includes(name)) out += odfText(c);
    }
  }
  return out;
}

function odfBlocks(container, blocks = []) {
  for (const child of container.children) {
    const name = child.localName;
    if (name === "h")
      blocks.push({
        type: "h",
        level: Math.min(6, Number(attr(child, "outline-level") || 1)),
        text: odfText(child),
      });
    else if (name === "p") blocks.push({ type: "p", text: odfText(child) });
    else if (name === "list") {
      for (const item of childrenLocal(child, "list-item")) {
        const inner = odfBlocks(item, []);
        inner.forEach((b) => blocks.push(b.type === "p" ? { type: "li", text: b.text } : b));
      }
    } else if (name === "table") {
      const rows = byLocal(child, "table-row").map((r) =>
        [...r.children].filter((c) => /table-cell$/.test(c.localName)).map((c) => odfText(c)),
      );
      blocks.push({ type: "table", rows });
    } else if (["section", "frame", "text-box", "page", "notes"].includes(name)) {
      if (name !== "notes") odfBlocks(child, blocks);
    } else if (child.children.length) odfBlocks(child, blocks);
  }
  return blocks;
}

async function readOdt(zip, presentation) {
  const doc = parseXml(await zipText(zip, "content.xml"));
  const body = firstLocal(doc, presentation ? "presentation" : "text");
  if (!body) return { kind: "text", blocks: [] };
  if (!presentation) return { kind: "text", blocks: odfBlocks(body) };
  const blocks = [];
  childrenLocal(body, "page").forEach((page, i) => {
    blocks.push({ type: "h", level: 2, text: attr(page, "name") || `Diapositive ${i + 1}` });
    odfBlocks(page, blocks);
  });
  return { kind: "text", blocks };
}

// ——— PowerPoint (PPTX) ———

async function readPptx(zip) {
  const rels = await relationships(zip, "ppt/_rels/presentation.xml.rels");
  const presentation = parseXml(await zipText(zip, "ppt/presentation.xml"));
  let paths = byLocal(presentation, "sldId")
    .map((s) => rels.get(relId(s)))
    .filter(Boolean)
    .map((t) => resolvePath("ppt/presentation.xml", t));
  if (!paths.length) {
    paths = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  const blocks = [];
  for (const [i, path] of paths.entries()) {
    const text = await zipText(zip, path, false);
    if (!text) continue;
    blocks.push({ type: "h", level: 2, text: `Diapositive ${i + 1}` });
    for (const p of byLocal(parseXml(text), "p")) {
      if (p.namespaceURI !== "http://schemas.openxmlformats.org/drawingml/2006/main") continue;
      let line = "";
      for (const c of p.children) {
        if (c.localName === "r" || c.localName === "fld") line += firstLocal(c, "t")?.textContent ?? "";
        else if (c.localName === "br") line += "\n";
      }
      if (line.trim()) blocks.push({ type: "p", text: line });
    }
  }
  return { kind: "text", blocks };
}

// ——— EPUB ———

const HTML_BLOCKS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "dt",
  "dd",
  "figcaption",
  "caption",
  "td",
  "th",
]);

export function htmlBlocks(node, blocks = []) {
  for (const child of node.children) {
    const name = child.localName.toLowerCase();
    if (/^h[1-6]$/.test(name))
      blocks.push({ type: "h", level: Number(name[1]), text: child.textContent.replace(/\s+/g, " ").trim() });
    else if (name === "li") blocks.push({ type: "li", text: child.textContent.replace(/\s+/g, " ").trim() });
    else if (name === "table")
      blocks.push({
        type: "table",
        rows: [...child.querySelectorAll("tr")].map((tr) =>
          [...tr.children].map((c) => c.textContent.trim()),
        ),
      });
    else if (HTML_BLOCKS.has(name))
      blocks.push({
        type: "p",
        text: name === "pre" ? child.textContent : child.textContent.replace(/\s+/g, " ").trim(),
      });
    else if (!["script", "style", "nav"].includes(name)) {
      const hasBlockChild = [...child.children].some(
        (c) =>
          HTML_BLOCKS.has(c.localName.toLowerCase()) ||
          ["div", "section", "article", "ul", "ol", "table"].includes(c.localName.toLowerCase()),
      );
      if (hasBlockChild) htmlBlocks(child, blocks);
      else if (child.textContent.trim())
        blocks.push({ type: "p", text: child.textContent.replace(/\s+/g, " ").trim() });
    }
  }
  return blocks;
}

async function readEpub(zip) {
  const container = parseXml(await zipText(zip, "META-INF/container.xml"));
  const opfPath = firstLocal(container, "rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB invalide : fichier OPF introuvable.");
  const opf = parseXml(await zipText(zip, opfPath));
  const manifest = new Map(byLocal(opf, "item").map((i) => [i.getAttribute("id"), i.getAttribute("href")]));
  const blocks = [];
  const title = firstLocal(opf, "title")?.textContent?.trim();
  if (title) blocks.push({ type: "h", level: 1, text: title });
  for (const ref of byLocal(opf, "itemref")) {
    const href = manifest.get(ref.getAttribute("idref"));
    if (!href) continue;
    const text = await zipText(zip, resolvePath(opfPath, decodeURIComponent(href)), false);
    if (!text) continue;
    let doc = new DOMParser().parseFromString(text, "application/xhtml+xml");
    if (doc.getElementsByTagName("parsererror").length)
      doc = new DOMParser().parseFromString(text, "text/html");
    const body = doc.body || firstLocal(doc, "body");
    if (body) htmlBlocks(body, blocks);
  }
  return { kind: "text", blocks: blocks.filter((b) => b.type === "table" || b.text) };
}

// ——— Tableurs (XLSX / ODS) ———

function columnIndex(ref) {
  const letters = (ref.match(/^[A-Z]+/i) || ["A"])[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

const trimRows = (rows) => {
  const cleaned = rows.map((r) => {
    const out = [...r];
    while (out.length && (out.at(-1) ?? "") === "") out.pop();
    return out.map((c) => c ?? "");
  });
  while (cleaned.length && !cleaned.at(-1).length) cleaned.pop();
  return cleaned;
};

async function readXlsx(zip) {
  const shared = [];
  const sharedXml = await zipText(zip, "xl/sharedStrings.xml", false);
  if (sharedXml) {
    for (const si of byLocal(parseXml(sharedXml), "si")) {
      shared.push(
        byLocal(si, "t")
          .filter((t) => t.parentNode.localName !== "rPh")
          .map((t) => t.textContent)
          .join(""),
      );
    }
  }
  const workbook = parseXml(await zipText(zip, "xl/workbook.xml"));
  const rels = await relationships(zip, "xl/_rels/workbook.xml.rels");
  const sheets = [];
  for (const sheet of byLocal(workbook, "sheet")) {
    const target = rels.get(relId(sheet));
    if (!target) continue;
    const xml = await zipText(zip, resolvePath("xl/workbook.xml", target), false);
    if (!xml) continue;
    const rows = [];
    for (const row of byLocal(parseXml(xml), "row")) {
      const index = Number(row.getAttribute("r") || rows.length + 1) - 1;
      const cells = [];
      for (const c of childrenLocal(row, "c")) {
        const col = c.getAttribute("r") ? columnIndex(c.getAttribute("r")) : cells.length;
        const type = c.getAttribute("t");
        const v = childrenLocal(c, "v")[0]?.textContent ?? "";
        let value = v;
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr")
          value = byLocal(c, "t")
            .map((t) => t.textContent)
            .join("");
        else if (type === "b") value = v === "1" ? "VRAI" : "FAUX";
        cells[col] = value;
      }
      rows[index] = cells;
    }
    sheets.push({
      name: sheet.getAttribute("name") || `Feuille ${sheets.length + 1}`,
      rows: trimRows(Array.from(rows, (r) => Array.from(r || [], (c) => c ?? ""))),
    });
  }
  return { kind: "sheet", sheets };
}

async function readOds(zip) {
  const doc = parseXml(await zipText(zip, "content.xml"));
  const sheets = byLocal(doc, "table")
    .filter((t) => t.namespaceURI?.includes("table"))
    .map((table, i) => {
      const rows = [];
      for (const row of byLocal(table, "table-row")) {
        const cells = [];
        for (const cell of row.children) {
          if (!/table-cell$/.test(cell.localName)) continue;
          const text = [...childrenLocal(cell, "p")].map(odfText).join("\n");
          const repeat = Math.min(Number(attr(cell, "number-columns-repeated") || 1), text ? 1024 : 256);
          for (let k = 0; k < repeat; k++) cells.push(text);
        }
        const repeatRows = Math.min(
          Number(attr(row, "number-rows-repeated") || 1),
          cells.some(Boolean) ? 1024 : 4,
        );
        for (let k = 0; k < repeatRows; k++) rows.push(cells);
      }
      return { name: attr(table, "name") || `Feuille ${i + 1}`, rows: trimRows(rows) };
    });
  return { kind: "sheet", sheets };
}

export const OFFICE_FORMATS = ["docx", "odt", "pptx", "odp", "epub", "xlsx", "ods"];

export async function readOffice(file, format) {
  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("Document illisible : ce n'est pas un conteneur bureautique valide (ou il est chiffré).");
  }
  if (zip.file("EncryptedPackage") || zip.file("encryption"))
    throw new Error("Document protégé par mot de passe.");
  if (format === "docx") return readDocx(zip);
  if (format === "odt") return readOdt(zip, false);
  if (format === "odp") return readOdt(zip, true);
  if (format === "pptx") return readPptx(zip);
  if (format === "epub") return readEpub(zip);
  if (format === "xlsx") return readXlsx(zip);
  if (format === "ods") return readOds(zip);
  throw new Error("Format bureautique non pris en charge.");
}

// ——— Rendu des blocs ———

export function blocksToText(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.type === "table") out.push(b.rows.map((r) => r.join("\t")).join("\n"), "");
    else if (b.type === "h") out.push("", b.text, "");
    else if (b.type === "li") out.push(`• ${b.text}`);
    else out.push(b.text);
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function blocksToMarkdown(blocks) {
  let out = "";
  let previous = null;
  for (const b of blocks) {
    let chunk;
    if (b.type === "table") chunk = rowsToMarkdown(b.rows).trimEnd();
    else if (b.type === "h") chunk = `${"#".repeat(b.level)} ${b.text.replace(/\n/g, " ")}`;
    else if (b.type === "li") chunk = `- ${b.text.replace(/\n/g, "  \n  ")}`;
    else chunk = b.text.replace(/\n/g, "  \n");
    if (!chunk.trim()) continue;
    // Une ligne vide sépare les blocs, sauf entre deux éléments d'une même liste.
    if (out) out += previous === "li" && b.type === "li" ? "\n" : "\n\n";
    out += chunk;
    previous = b.type;
  }
  return out + "\n";
}

export function blocksToHtml(blocks) {
  const out = [];
  let list = false;
  for (const b of blocks) {
    if (b.type !== "li" && list) {
      out.push("</ul>");
      list = false;
    }
    const text = escapeHtml(b.text ?? "").replace(/\n/g, "<br>");
    if (b.type === "table") out.push(rowsToHtmlTable(b.rows, { header: false }));
    else if (b.type === "h") out.push(`<h${b.level}>${text}</h${b.level}>`);
    else if (b.type === "li") {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${text}</li>`);
    } else if (b.text.trim()) out.push(`<p>${text}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

/** Blocs à partir d'un texte brut (un paragraphe par ligne). */
export const textToBlocks = (text) =>
  String(text)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => ({ type: "p", text: line }));
