import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { download, makeFixtures, openApp, text, waitIdle } from "./helpers.mjs";

test.describe("Optimiseur", () => {
  let problems;
  let fx;
  test.beforeEach(async ({ page }) => {
    problems = await openApp(page, "optimiser");
    fx = await makeFixtures(page);
  });
  test.afterEach(() => expect(problems).toEqual([]));

  const root = (page) => page.locator("#optimize");
  const drop = (page, files) => root(page).locator("input[type=file]").setInputFiles(files);

  test("PDF « équilibré » : images recompressées, texte toujours extractible", async ({ page }) => {
    await drop(page, [fx.pdf]);
    await waitIdle(root(page));
    await expect(root(page).locator("#op-pdf")).toBeVisible();
    await root(page).locator(".run").click();
    await expect(root(page).locator(".status")).toContainText("texte préservé");
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.name).toBe("rapport-optimise.pdf");
    expect(out.bytes.length).toBeLessThan(fx.pdf.buffer.length * 0.6);
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(3);
    const pages = await page.evaluate(async (b64) => {
      const lib = await CDQP.getPdfjs();
      const pdf = await lib.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
      const page = await pdf.getPage(2);
      return (await page.getTextContent()).items.map((i) => i.str).join(" ");
    }, out.bytes.toString("base64"));
    expect(pages).toContain("Page 2 : texte de test");
  });

  test("garantie : un fichier impossible à alléger est rendu tel quel", async ({ page }) => {
    const tiny = text("mini.json", '{"a":1}');
    await drop(page, [tiny]);
    await waitIdle(root(page));
    await root(page).locator(".run").click();
    await expect(root(page).locator(".status")).toContainText("l'original est conservé");
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.name).toBe("mini.json");
    expect(out.bytes.equals(tiny.buffer)).toBe(true);
  });

  test("lot mixte : image recompressée, JSON minifié sans perte, rapport par fichier", async ({ page }) => {
    await drop(page, [fx.jpg, fx.json]);
    await waitIdle(root(page));
    await expect(root(page).locator("#op-format")).toBeVisible();
    await root(page).locator(".run").click();
    await expect(root(page).locator(".parts li")).toHaveCount(2);
    await expect(root(page).locator(".parts li").first()).toContainText("−");
    const json = await download(page, root(page).locator('[data-file="1"]'));
    expect(json.name).toBe("donnees-optimise.json");
    expect(JSON.parse(json.bytes.toString("utf8"))).toEqual(JSON.parse(fx.json.buffer.toString("utf8")));
    expect(json.bytes.length).toBeLessThan(fx.json.buffer.length);
  });

  test("document Word : photos internes recompressées, document toujours valide", async ({ page }) => {
    const docx = new JSZip();
    docx.file(
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    docx.file("word/document.xml", "<w:document/>", { createFolders: false });
    docx.file("word/media/image1.jpeg", fx.jpg.buffer, { createFolders: false });
    const buffer = await docx.generateAsync({ type: "nodebuffer", compression: "STORE" });
    await drop(page, [{ name: "lettre.docx", mimeType: "application/octet-stream", buffer }]);
    await waitIdle(root(page));
    await expect(root(page).locator("[data-kind-note]")).toContainText("images JPEG internes");
    await root(page).locator(".run").click();
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.name).toBe("lettre-optimise.docx");
    const zip = await JSZip.loadAsync(out.bytes);
    expect(Object.keys(zip.files)).toEqual([
      "[Content_Types].xml",
      "word/document.xml",
      "word/media/image1.jpeg",
    ]);
    expect((await zip.file("word/media/image1.jpeg").async("uint8array")).length).toBeLessThan(
      fx.jpg.buffer.length,
    );
  });

  test("image animée : jamais réencodée (l'animation serait perdue)", async ({ page }) => {
    const gce = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0];
    const gif = Buffer.from([...Buffer.from("GIF89a"), 1, 0, 1, 0, 0, 0, 0, ...gce, ...gce, 0x3b]);
    await drop(page, [{ name: "anim.gif", mimeType: "image/gif", buffer: gif }]);
    await waitIdle(root(page));
    await expect(root(page).locator("[data-warning]")).toContainText("animation");
  });
});
