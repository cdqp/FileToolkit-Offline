import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { encodeWav } from "../../src/js/lib/wav.js";
import { download, openApp, waitIdle } from "./helpers.mjs";

async function wav(seconds, rate = 44100, channels = 2) {
  const frames = Math.round(seconds * rate);
  const data = Array.from({ length: channels }, (_, c) =>
    Float32Array.from(
      { length: frames },
      (_, i) => 0.4 * Math.sin((2 * Math.PI * (440 + c * 110) * i) / rate),
    ),
  );
  return Buffer.from(await encodeWav(data, rate).arrayBuffer());
}

const wavInfo = (bytes) => ({
  channels: bytes.readUInt16LE(22),
  rate: bytes.readUInt32LE(24),
  bits: bytes.readUInt16LE(34),
  frames: bytes.readUInt32LE(40) / (bytes.readUInt16LE(22) * (bytes.readUInt16LE(34) / 8)),
});

test.describe("Audio", () => {
  let problems;
  test.beforeEach(async ({ page }) => {
    problems = await openApp(page);
  });
  test.afterEach(() => expect(problems).toEqual([]));

  test("WAV : fréquence native détectée, rééchantillonnage et passage en mono", async ({ page }) => {
    await page.goto(page.url().replace(/#.*$/, "") + "#optimiser");
    const root = page.locator("#optimize");
    await root
      .locator("input[type=file]")
      .setInputFiles([{ name: "son.wav", mimeType: "audio/wav", buffer: await wav(2) }]);
    await waitIdle(root);
    await expect(root.locator(".file-meta")).toContainText("44 100 Hz, 2 canaux");
    await root.locator("#op-rate").selectOption("22050");
    await root.locator("#op-channels").selectOption("mono");
    await root.locator(".run").click();
    const out = await download(page, root.locator(".export-btn"));
    expect(wavInfo(out.bytes)).toEqual({ channels: 1, rate: 22050, bits: 16, frames: 44100 });
  });

  test("WAV : découpe en parts égales puis fusion", async ({ page }) => {
    await page.goto(page.url().replace(/#.*$/, "") + "#decouper");
    const split = page.locator("#split");
    await split
      .locator("input[type=file]")
      .setInputFiles([{ name: "son.wav", mimeType: "audio/wav", buffer: await wav(3, 48000) }]);
    await waitIdle(split);
    await expect(split.locator(".file-meta")).toContainText("0 min 03 s");
    await split.locator("#sp-audio").selectOption("parts");
    await split.locator("#sp-parts").fill("3");
    await split.locator(".run").click();
    await expect(split.locator(".parts li")).toHaveCount(3);
    const parts = [];
    for (let i = 0; i < 3; i++) parts.push(await download(page, split.locator(`[data-file="${i}"]`)));
    expect(wavInfo(parts[0].bytes)).toEqual({ channels: 2, rate: 48000, bits: 16, frames: 48000 });

    await page.goto(page.url().replace(/#.*$/, "") + "#fusionner");
    const merge = page.locator("#merge");
    await merge
      .locator("input[type=file]")
      .setInputFiles(parts.map((p) => ({ name: p.name, mimeType: "audio/wav", buffer: p.bytes })));
    await waitIdle(merge);
    await expect(merge.locator("[data-targets] .chip").first()).toHaveText("WAV");
    await merge.locator(".run").click();
    const joined = await download(page, merge.locator(".export-btn"));
    expect(wavInfo(joined.bytes)).toEqual({ channels: 2, rate: 48000, bits: 16, frames: 144000 });
  });
});

test.describe("Bureautique", () => {
  let problems;
  test.beforeEach(async ({ page }) => {
    problems = await openApp(page, "convertir");
  });
  test.afterEach(() => expect(problems).toEqual([]));

  test("DOCX → Markdown : titres, listes et tableaux reconnus", async ({ page }) => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const p = (text, style) =>
      `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document ${W}><w:body>${p("Rapport annuel", "Heading1")}${p("Introduction &amp; contexte")}<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Premier point</w:t></w:r></w:p><w:tbl><w:tr><w:tc>${p("A")}</w:tc><w:tc>${p("B")}</w:tc></w:tr></w:tbl><w:p><w:r><w:t>Texte</w:t><w:tab/><w:t>tabulé</w:t></w:r></w:p></w:body></w:document>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const root = page.locator("#convert");
    await root
      .locator("input[type=file]")
      .setInputFiles([{ name: "rapport.docx", mimeType: "application/octet-stream", buffer }]);
    await waitIdle(root);
    await root.locator('.chip[data-value="md"]').click();
    await root.locator(".run").click();
    const md = (await download(page, root.locator(".export-btn"))).bytes.toString("utf8");
    expect(md).toBe(
      "# Rapport annuel\n\nIntroduction & contexte\n\n- Premier point\n\n| A | B |\n| --- | --- |\n\nTexte\ttabulé\n",
    );
  });

  test("XLSX à plusieurs feuilles → un CSV par feuille", async ({ page }) => {
    const zip = new JSZip();
    const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    zip.file(
      "xl/workbook.xml",
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ${R}><sheets><sheet name="Ventes" sheetId="1" r:id="rId1"/><sheet name="Stock" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    );
    zip.file(
      "xl/sharedStrings.xml",
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Produit</t></si><si><t>Qté</t></si></sst>',
    );
    const sheet = (rows) =>
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
    zip.file(
      "xl/worksheets/sheet1.xml",
      sheet(
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Vis</t></is></c><c r="C2"><v>12</v></c></row>',
      ),
    );
    zip.file("xl/worksheets/sheet2.xml", sheet('<row r="1"><c r="A1" t="b"><v>1</v></c></row>'));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const root = page.locator("#convert");
    await root
      .locator("input[type=file]")
      .setInputFiles([{ name: "classeur.xlsx", mimeType: "application/octet-stream", buffer }]);
    await waitIdle(root);
    await root.locator('.chip[data-value="csv"]').click();
    await root.locator(".run").click();
    await expect(root.locator(".parts li")).toHaveCount(2);
    const first = await download(page, root.locator('[data-file="0"]'));
    expect(first.name).toBe("classeur-Ventes.csv");
    expect(first.bytes.toString("utf8")).toBe("Produit,Qté\r\nVis,,12\r\n");
  });
});
