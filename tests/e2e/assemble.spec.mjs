import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { download, makeFixtures, openApp, text, waitIdle } from "./helpers.mjs";

test.describe("Fusion", () => {
  let problems;
  let fx;
  test.beforeEach(async ({ page }) => {
    problems = await openApp(page, "fusionner");
    fx = await makeFixtures(page);
  });
  test.afterEach(() => expect(problems).toEqual([]));

  const root = (page) => page.locator("#merge");
  const add = (page, files) => root(page).locator("input[type=file]").setInputFiles(files);

  test("PDF + image → un PDF, dans l'ordre choisi", async ({ page }) => {
    await add(page, [fx.pdf]);
    await waitIdle(root(page));
    await expect(root(page).locator(".status")).toContainText("au moins un autre fichier");
    await add(page, [fx.jpg]);
    await waitIdle(root(page));
    await expect(root(page).locator("[data-targets] .chip")).toHaveText(["PDF", "ZIP", "TAR.GZ", "RAR"]);
    await root(page).getByRole("button", { name: "Monter photo.jpg" }).click();
    await expect(root(page).locator(".file-name").first()).toHaveText("photo.jpg");
    await root(page).locator("#mg-name").fill("dossier complet");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".result-note")).toHaveText("4 pages au total.");
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.name).toBe("dossier complet.pdf");
    const pdf = await PDFDocument.load(out.bytes);
    expect(pdf.getPageCount()).toBe(4);
    const [first] = pdf.getPages();
    expect(first.getWidth()).toBeGreaterThan(first.getHeight()); // image paysage → page A4 paysage
  });

  test("CSV aux colonnes différentes : alignement par nom d'en-tête", async ({ page }) => {
    await add(page, [text("a.csv", "id;nom\n1;Alpha\n"), text("b.csv", "nom;ville\nBêta;Lyon\n")]);
    await waitIdle(root(page));
    await root(page).locator('.chip[data-value="csv"]').click();
    await root(page).locator(".run").click();
    await expect(root(page).locator(".result-note")).toContainText("3 colonnes");
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.bytes.toString("utf8")).toBe("id;nom;ville\n1;Alpha;\n;Bêta;Lyon\n");
  });

  test("fichiers hétérogènes : regroupement ZIP fidèle", async ({ page }) => {
    await add(page, [fx.pdf, text("notes.txt", "bonjour"), text("notes.txt", "doublon")]);
    await waitIdle(root(page));
    await expect(root(page).locator("[data-targets] .chip").first()).toHaveText("ZIP");
    await root(page).locator(".run").click();
    const out = await download(page, root(page).locator(".export-btn"));
    const zip = await JSZip.loadAsync(out.bytes);
    expect(Object.keys(zip.files).sort()).toEqual(["notes-2.txt", "notes.txt", "rapport.pdf"]);
  });
});

test.describe("Découpe", () => {
  let problems;
  let fx;
  test.beforeEach(async ({ page }) => {
    problems = await openApp(page, "decouper");
    fx = await makeFixtures(page);
  });
  test.afterEach(() => expect(problems).toEqual([]));

  const root = (page) => page.locator("#split");
  const drop = (page, files) => root(page).locator("input[type=file]").setInputFiles(files);

  test("PDF : plages personnalisées et extraction", async ({ page }) => {
    await drop(page, [fx.pdf]);
    await waitIdle(root(page));
    await expect(root(page).locator(".file-meta")).toContainText("3 pages");
    await root(page).locator("#sp-pdf").selectOption("ranges");
    await root(page).locator("#sp-ranges").fill("1, 2-");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".parts li span")).toContainText([
      "rapport-001-p1.pdf",
      "rapport-002-p2-3.pdf",
    ]);

    await root(page).locator("#sp-pdf").selectOption("extract");
    await root(page).locator("#sp-ranges").fill("3, 1");
    await root(page).locator(".run").click();
    const out = await download(page, root(page).locator(".export-btn"));
    expect(out.name).toBe("rapport-extrait.pdf");
    expect((await PDFDocument.load(out.bytes)).getPageCount()).toBe(2);

    await root(page).locator("#sp-ranges").fill("9");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".status")).toContainText("n'existe pas");
  });

  test("CSV : en-tête répété dans chaque partie", async ({ page }) => {
    await drop(page, [text("liste.csv", "a;b\n1;x\n2;y\n3;z\n")]);
    await waitIdle(root(page));
    await root(page).locator("#sp-lines").fill("2");
    await root(page).locator(".run").click();
    const out = await download(page, root(page).locator(".export-btn"));
    const zip = await JSZip.loadAsync(out.bytes);
    expect(await zip.file("liste-002.csv").async("text")).toBe("a;b\n3;z\n");
  });

  test("volumes binaires puis réassemblage octet pour octet", async ({ page }) => {
    const payload = Buffer.from(Array.from({ length: 300 * 1024 }, (_, i) => (i * 31) % 256));
    await drop(page, [{ name: "donnees.bin", mimeType: "application/octet-stream", buffer: payload }]);
    await waitIdle(root(page));
    await root(page).locator("#sp-mb").fill("0.1");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".parts li")).toHaveCount(4);
    const parts = [];
    for (let i = 0; i < 3; i++) parts.push(await download(page, root(page).locator(`[data-file="${i}"]`)));
    const notice = await download(page, root(page).locator('[data-file="3"]'));
    expect(notice.bytes.toString("utf8")).toContain("copy /b");

    await page.goto(page.url().replace(/#.*$/, "#fusionner"));
    await page
      .locator("#merge input[type=file]")
      .setInputFiles(
        parts.reverse().map((p) => ({ name: p.name, mimeType: "application/octet-stream", buffer: p.bytes })),
      );
    await waitIdle(page.locator("#merge"));
    await expect(page.locator("#merge [data-targets] .chip").first()).toHaveText("RÉASSEMBLER");
    await page.locator("#merge .run").click();
    const joined = await download(page, page.locator("#merge .export-btn"));
    expect(joined.name).toBe("donnees.bin");
    expect(joined.bytes.equals(payload)).toBe(true);
  });

  test("image : découpe en tuiles", async ({ page }) => {
    await drop(page, [fx.png]);
    await waitIdle(root(page));
    await root(page).locator("#sp-rows").fill("2");
    await root(page).locator("#sp-cols").fill("3");
    await root(page).locator(".run").click();
    await expect(root(page).locator(".parts li")).toHaveCount(6);
  });
});
