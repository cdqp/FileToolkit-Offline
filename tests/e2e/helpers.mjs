import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";

export const APP_URL = new URL("../../CDQP_Offline_File_Toolkit.html", import.meta.url).href;
export const APP_PATH = fileURLToPath(APP_URL);

/** Ouvre l'application et collecte toute erreur de page ou de console. */
export async function openApp(page, hash = "") {
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  await page.goto(APP_URL + (hash ? `#${hash}` : ""));
  await page.waitForFunction(() => window.CDQP);
  return problems;
}

/** Fixtures générées dans le navigateur (canevas, pdf-lib) puis renvoyées en base64. */
export async function makeFixtures(page) {
  const b64 = await page.evaluate(async () => {
    const toB64 = async (blob) => {
      const u = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
      return btoa(s);
    };
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1000;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 1600, 1000);
    gradient.addColorStop(0, "#0088aa");
    gradient.addColorStop(1, "#ffcc33");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1600, 1000);
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `hsl(${i * 7},70%,50%)`;
      ctx.beginPath();
      ctx.arc(random() * 1600, random() * 1000, random() * 40, 0, 7);
      ctx.fill();
    }
    const jpg = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.97));
    const png = await new Promise((r) => canvas.toBlob(r, "image/png"));
    const small = document.createElement("canvas");
    small.width = small.height = 64;
    const sctx = small.getContext("2d");
    sctx.fillStyle = "rgba(0,200,180,0.6)";
    sctx.fillRect(8, 8, 48, 48);
    const icon = await new Promise((r) => small.toBlob(r, "image/png"));

    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    const image = await doc.embedJpg(await jpg.arrayBuffer());
    for (let i = 1; i <= 3; i++) {
      const page = doc.addPage();
      page.drawText(`Page ${i} : texte de test`, { x: 50, y: 760, font, size: 18 });
      page.drawText("Deuxième ligne du paragraphe", { x: 50, y: 735, font, size: 18 });
      page.drawImage(image, { x: 50, y: 300, width: 480, height: 300 });
    }
    const pdf = new Blob([await doc.save()], { type: "application/pdf" });
    return { jpg: await toB64(jpg), png: await toB64(png), icon: await toB64(icon), pdf: await toB64(pdf) };
  });
  const buf = (name) => Buffer.from(b64[name], "base64");
  return {
    jpg: { name: "photo.jpg", mimeType: "image/jpeg", buffer: buf("jpg") },
    png: { name: "dessin.png", mimeType: "image/png", buffer: buf("png") },
    icon: { name: "icone.png", mimeType: "image/png", buffer: buf("icon") },
    pdf: { name: "rapport.pdf", mimeType: "application/pdf", buffer: buf("pdf") },
    csv: {
      name: "clients.csv",
      mimeType: "text/csv",
      buffer: Buffer.from('nom;âge;ville;code\nDupont;42;Paris;01000\n"Martin; Jr";35;Lyon;69000\n'),
    },
    json: {
      name: "donnees.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify(
          [
            { id: 1, nom: "Alpha", meta: { ok: true } },
            { id: 2, nom: "Béta", meta: { ok: false } },
          ],
          null,
          4,
        ),
      ),
    },
    md: {
      name: "notes.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Titre\n\nTexte **gras**.\n\n- un\n- deux\n\n| A | B |\n|---|---|\n| 1 | 2 |\n"),
    },
  };
}

export const text = (name, content, mimeType = "text/plain") => ({
  name,
  mimeType,
  buffer: Buffer.from(content),
});

/** Attend la fin d'une analyse ou d'un traitement (plus de statut « occupé »). */
export async function waitIdle(scope) {
  await expect(scope.locator(".status")).not.toHaveAttribute("aria-busy", "true");
}

/** Déclenche un export et renvoie le fichier téléchargé. */
export async function download(page, trigger) {
  const [file] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
  return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
}
