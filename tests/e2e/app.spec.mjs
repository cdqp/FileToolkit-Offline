import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openApp } from "./helpers.mjs";

test("se charge sans erreur, avec le moteur PDF dans un vrai worker", async ({ page }) => {
  const problems = await openApp(page);
  await expect(page).toHaveTitle("CDQP Offline File Toolkit");
  const engine = await page.evaluate(async () => {
    const lib = await CDQP.getPdfjs();
    return { version: lib.version, worker: !!lib.GlobalWorkerOptions.workerPort };
  });
  expect(engine.version).toMatch(/^6\./);
  expect(engine.worker).toBe(true);
  expect(problems).toEqual([]);
});

test("la politique de sécurité bloque tout accès réseau", async ({ page }) => {
  await openApp(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(csp).toContain("default-src 'none'");
  expect(csp).not.toContain("unsafe-eval");
  const attempts = await page.evaluate(async () => {
    const results = {};
    try {
      await fetch("https://example.com/");
      results.fetch = "autorisé";
    } catch {
      results.fetch = "bloqué";
    }
    results.image = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve("autorisé");
      img.onerror = () => resolve("bloqué");
      img.src = "https://example.com/pixel.png";
    });
    return results;
  });
  expect(attempts).toEqual({ fetch: "bloqué", image: "bloqué" });
});

test("navigation par ancres, retour arrière et focus du titre", async ({ page }) => {
  await openApp(page);
  await page.getByRole("link", { name: /Convertir/ }).click();
  await expect(page).toHaveURL(/#convertir$/);
  await expect(page.locator("#convert")).toBeVisible();
  await expect(page.locator("#home")).toBeHidden();
  await expect(page.locator("#convert-title")).toBeFocused();
  await expect(page).toHaveTitle(/^Convertir/);
  await page.goBack();
  await expect(page.locator("#home")).toBeVisible();
  await page.goto(page.url().replace(/#.*$/, "") + "#decouper");
  await expect(page.locator("#split")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Découpe" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Découpe" }).press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Fusion" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/#fusionner$/);
});

test("thème et animations mémorisés", async ({ page }) => {
  await openApp(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.locator("#themeBtn").click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.locator("#motionBtn").click();
  await expect(html).toHaveAttribute("data-motion", "off");
  await expect(page.locator("#motionBtn")).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-motion", "off");
});

for (const hash of ["", "convertir", "optimiser", "fusionner", "decouper"]) {
  for (const theme of ["dark", "light"]) {
    test(`accessibilité (axe) : ${hash || "accueil"}, thème ${theme === "dark" ? "sombre" : "clair"}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openApp(page, hash);
      await page.evaluate(() => (document.documentElement.dataset.motion = "off"));
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      const serious = results.violations.filter((v) => ["serious", "critical"].includes(v.impact));
      expect(serious.map((v) => `${v.id} : ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual(
        [],
      );
    });
  }
}
