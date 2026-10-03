/* global JSZip */
// Écriture de documents Office Open XML minimaux mais conformes (Word et Excel les ouvrent sans réparation).

import { escapeXml } from "../core/dom.js";
import { makeFile, MIME } from "../core/files.js";

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const DOCX_STYLES = `${XML_HEAD}<w:styles xmlns:w="${W_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
${[1, 2, 3, 4, 5, 6]
  .map(
    (n) =>
      `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.max(22, 34 - n * 3)}"/></w:rPr></w:style>`,
  )
  .join("\n")}
<w:style w:type="table" w:styleId="Grille"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="A6B0B3"/>`).join("")}</w:tblBorders></w:tblPr></w:style>
</w:styles>`;

function runs(text) {
  return String(text)
    .split("\n")
    .map((line, i) => {
      const parts = line.split("\t").map((t) => `<w:t xml:space="preserve">${escapeXml(t)}</w:t>`);
      return `${i ? "<w:br/>" : ""}${parts.join("<w:tab/>")}`;
    })
    .join("");
}

function paragraph(text, style = null) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}<w:r>${runs(text)}</w:r></w:p>`;
}

function table(rows) {
  const width = Math.max(1, ...rows.map((r) => r.length));
  const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(width)}</w:tblGrid>`;
  const body = rows
    .map(
      (r) =>
        `<w:tr>${Array.from({ length: width }, (_, i) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(r[i] ?? "")}</w:tc>`).join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="Grille"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${grid}${body}</w:tbl>`;
}

/**
 * Crée un DOCX à partir de blocs { type: "h" | "p" | "li" | "table" | "pagebreak" }.
 */
export async function blocksToDocx(blocks, fileName, title = "") {
  const body = [];
  if (title) body.push(paragraph(title, "Title"));
  for (const b of blocks) {
    if (b.type === "h") body.push(paragraph(b.text, `Heading${Math.min(6, Math.max(1, b.level))}`));
    else if (b.type === "li") body.push(paragraph(`•\t${b.text}`));
    else if (b.type === "table") body.push(table(b.rows), paragraph(""));
    else if (b.type === "pagebreak") body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    else body.push(paragraph(b.text));
  }
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>CDQP Offline File Toolkit</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file("word/styles.xml", DOCX_STYLES);
  zip.file(
    "word/document.xml",
    `${XML_HEAD}<w:document xmlns:w="${W_NS}" xmlns:r="${REL}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return makeFile(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), fileName, MIME.docx);
}

function columnName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const NUMERIC = /^-?(0|[1-9]\d{0,14})(\.\d{1,15})?$/;
const sheetName = (name, i, used) => {
  let n =
    String(name || `Feuille ${i + 1}`)
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || `Feuille ${i + 1}`;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 27)} (${i + 1})`;
  used.add(n.toLowerCase());
  return n;
};

/** Crée un classeur XLSX (cellules texte en ligne, nombres reconnus, première ligne figée en gras). */
export async function sheetsToXlsx(sheets, fileName) {
  const zip = new JSZip();
  const used = new Set();
  const names = sheets.map((s, i) => sheetName(s.name, i, used));
  zip.file(
    "[Content_Types].xml",
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>${names
      .map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join(
        "",
      )}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
  );
  sheets.forEach((sheet, i) => {
    const rows = sheet.rows
      .map((row, r) => {
        const cells = row
          .map((value, c) => {
            const ref = `${columnName(c)}${r + 1}`;
            const style = r === 0 && sheet.header !== false ? ' s="1"' : "";
            const v = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
            if (v === "") return "";
            if (typeof value === "number" || (typeof value === "string" && NUMERIC.test(v)))
              return `<c r="${ref}"${style}><v>${v}</v></c>`;
            if (typeof value === "boolean") return `<c r="${ref}"${style} t="b"><v>${value ? 1 : 0}</v></c>`;
            return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(v.slice(0, 32767))}</t></is></c>`;
          })
          .join("");
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join("");
    const freeze =
      sheet.header !== false && sheet.rows.length > 1
        ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        : "";
    zip.file(
      `xl/worksheets/sheet${i + 1}.xml`,
      `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}<sheetData>${rows}</sheetData></worksheet>`,
    );
  });
  return makeFile(await zip.generateAsync({ type: "blob", compression: "DEFLATE" }), fileName, MIME.xlsx);
}
