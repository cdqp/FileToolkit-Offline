import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { download, makeFixtures, openApp, text, waitIdle } from "./helpers.mjs";

test.describe("Convertisseur", () => {
  let problems;
  let fx;
  test.beforeEach(async ({ page }) => {
    problems = await openApp(page, "convertir");
    fx = await makeFixtures(page);
  });
  test.afterEach(() => expect(problems).toEqual([]));

  const root = (page) => page.locator("#convert");
  const drop = (page, files) => root(page).locator("input[type=file]").setInputFiles(files);
  const choose = (page, target) => root(page).locator(`.chip[data-value="${target}"]`).click();
  const chips = (page) => root(page).locator("[data-targets] .chip").allTextContents();

  test("PDF → DOCX : vrai document Word avec le texte et les sauts de page", async ({ page }) => {
    await drop(page, [fx.pdf]);
    await waitIdle(root(page));
    expect(await chips(page)).toEqual([
      "DOCX",
      "TXT",
      "MARKDOWN",
      "HTML",
      "PNG",
      "JPG",
      "WEBP",
      "ZIP",
      "GZ",
      "RAR",
    ]);
    await choose(page, "docx");
    await expect(root(page).locator("[data-hint]")).toContainText("document Word");
    await root(page).locator(".run").click();
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.name).toBe("rapport.docx");
    const zip = await JSZip.loadAsync(out.bytes);
    const xml = await zip.file("word/document.xml").async("text");
    expect(xml).toContain("Page 2 : texte de test");
    expect(xml).toContain("Deuxième ligne du paragraphe");
    expect(xml.match(/w:type="page"/g)).toHaveLength(2);
  });

  test("PDF → PNG : une image par page, export groupé en ZIP", async ({ page }) => {
    await drop(page, [fx.pdf]);
    await waitIdle(root(page));
    await choose(page, "png");
    await expect(root(page).locator("#cv-dpi")).toBeVisible();
    await root(page).locator("#cv-dpi").selectOption("72");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".parts li")).toHaveCount(3);
    const out = await download(page, root(page).locator(".export-btn"));
    const zip = await JSZip.loadAsync(out.bytes);
    expect(Object.keys(zip.files).sort()).toEqual([
      "rapport-page-001.png",
      "rapport-page-002.png",
      "rapport-page-003.png",
    ]);
  });

  test("lot d'images → WebP redimensionnées, avec aperçu individuel", async ({ page }) => {
    await drop(page, [fx.jpg, fx.png]);
    await waitIdle(root(page));
    expect(await chips(page)).toEqual(expect.arrayContaining(["PNG", "JPG", "WEBP", "PDF", "ICO", "BMP"]));
    await choose(page, "webp");
    await root(page).locator("#cv-long").selectOption("800");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".status")).toContainText("2 fichiers prêts");
    const single = await download(page, root(page).locator('[data-file="0"]'));
    expect(single.name).toBe("photo.webp");
    const size = await page.evaluate(async (b64) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "image/webp" }),
      );
      return [bitmap.width, bitmap.height];
    }, single.bytes.toString("base64"));
    expect(size).toEqual([800, 500]);
  });

  test("image → ICO multi-résolution et image → PDF sans réencodage du JPEG", async ({ page }) => {
    await drop(page, [fx.icon]);
    await waitIdle(root(page));
    await choose(page, "ico");
    await root(page).locator(".run").click();
    const ico = await download(page, root(page).locator(".export-btn"));
    expect([...ico.bytes.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    expect(ico.bytes.readUInt16LE(4)).toBeGreaterThanOrEqual(5);

    await root(page).locator(".reset").click();
    await drop(page, [fx.jpg]);
    await waitIdle(root(page));
    await choose(page, "pdf");
    await root(page).locator(".run").click();
    const pdf = await download(page, root(page).locator(".export-btn"));
    // Le JPEG d'origine est intégré tel quel : le PDF ne pèse guère plus que la photo.
    expect(pdf.bytes.length).toBeLessThan(fx.jpg.buffer.length + 4096);
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
  });

  test("CSV (séparateur ;) → XLSX : nombres reconnus, zéros initiaux préservés", async ({ page }) => {
    await drop(page, [fx.csv]);
    await waitIdle(root(page));
    await choose(page, "xlsx");
    await root(page).locator(".run").click();
    const out = await download(page, root(page).locator(".export-btn"));
    const zip = await JSZip.loadAsync(out.bytes);
    const sheet = await zip.file("xl/worksheets/sheet1.xml").async("text");
    expect(sheet).toContain('<c r="B2"><v>42</v></c>');
    expect(sheet).toContain('<t xml:space="preserve">01000</t>');
    expect(sheet).toContain("Martin; Jr");
    expect(sheet).toContain('state="frozen"');
  });

  test("JSON → YAML → JSON : aller-retour fidèle", async ({ page }) => {
    await drop(page, [fx.json]);
    await waitIdle(root(page));
    await choose(page, "yaml");
    await root(page).locator(".run").click();
    const yaml = await download(page, root(page).locator(".export-btn"));
    expect(yaml.name).toBe("donnees.yaml");
    await root(page).locator(".reset").click();
    await drop(page, [text("donnees.yaml", yaml.bytes.toString("utf8"))]);
    await waitIdle(root(page));
    await choose(page, "json");
    await root(page).locator(".run").click();
    const json = await download(page, root(page).locator(".export-btn"));
    expect(JSON.parse(json.bytes.toString("utf8"))).toEqual(JSON.parse(fx.json.buffer.toString("utf8")));
  });

  test("Markdown → HTML mis en forme et Markdown → DOCX", async ({ page }) => {
    await drop(page, [fx.md]);
    await waitIdle(root(page));
    await choose(page, "html");
    await root(page).locator(".run").click();
    const htmlOut = (await download(page, root(page).locator(".export-btn"))).bytes.toString("utf8");
    expect(htmlOut).toContain("<h1>Titre</h1>");
    expect(htmlOut).toContain("<strong>gras</strong>");
    expect(htmlOut).toContain("<table>");
    await choose(page, "docx");
    await root(page).locator(".run").click();
    const docx = await JSZip.loadAsync((await download(page, root(page).locator(".export-btn"))).bytes);
    const xml = await docx.file("word/document.xml").async("text");
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain("<w:tbl>");
  });

  test("archive : ZIP → TAR.GZ, puis extraction individuelle", async ({ page }) => {
    const zip = new JSZip();
    zip.file("a.txt", "alpha");
    zip.file("dossier/b.txt", "bêta");
    const zipped = await zip.generateAsync({ type: "nodebuffer" });
    await drop(page, [{ name: "lot.zip", mimeType: "application/zip", buffer: zipped }]);
    await waitIdle(root(page));
    expect(await chips(page)).toEqual(["EXTRAIRE", "TAR.GZ", "TAR", "RAR"]);
    await choose(page, "tgz");
    await root(page).locator(".run").click();
    const tgz = await download(page, root(page).locator(".export-btn"));
    expect(tgz.name).toBe("lot.tar.gz");

    await root(page).locator(".reset").click();
    await drop(page, [{ name: "lot.tar.gz", mimeType: "application/gzip", buffer: tgz.bytes }]);
    await waitIdle(root(page));
    await choose(page, "extract");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".parts li")).toHaveCount(2);
    const b = await download(page, root(page).locator('[data-file="1"]'));
    expect(b.name).toBe("b.txt");
    expect(b.bytes.toString("utf8")).toBe("bêta");
  });

  test("fichier sans moteur : seul l'archivage est proposé, avec explication", async ({ page }) => {
    await drop(page, [
      {
        name: "maquette.psd",
        mimeType: "image/vnd.adobe.photoshop",
        buffer: Buffer.from("8BPS\x00\x01rest", "latin1"),
      },
    ]);
    await waitIdle(root(page));
    await expect(root(page).locator("[data-warning]")).toContainText("PSD");
    expect(await chips(page)).toEqual(["ZIP", "GZ", "RAR"]);
  });

  test("le dépôt d'un fichier n'importe où dans la page est pris en charge", async ({ page }) => {
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["a,b\n1,2\n"], "glisse.csv", { type: "text/csv" }));
      document
        .querySelector("footer")
        .dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(root(page).locator(".file-name")).toHaveText("glisse.csv");
  });
});
