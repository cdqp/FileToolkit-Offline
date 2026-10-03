#!/usr/bin/env node
// Assemble le fichier HTML autonome à partir de src/ et des bibliothèques npm figées.
//
//   node scripts/build.mjs            construit CDQP_Offline_File_Toolkit.html
//   node scripts/build.mjs --check    vérifie que le fichier versionné est à jour (CI)
//   node scripts/build.mjs --watch    reconstruit à chaque modification de src/

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as esbuild from "esbuild";
import * as acorn from "acorn";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "CDQP_Offline_File_Toolkit.html");
const modules = (p) => path.join(ROOT, "node_modules", p);

const VENDOR = {
  jszip: modules("jszip/dist/jszip.min.js"),
  pdfLib: modules("pdf-lib/dist/pdf-lib.min.js"),
  pdfjs: modules("pdfjs-dist/legacy/build/pdf.min.mjs"),
  pdfjsWorker: modules("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
};

const read = (file) => readFile(file, "utf8");

/** Normalise le code tel que le verra le parseur HTML (indispensable pour les empreintes CSP). */
function normalizeScript(code, label) {
  const out = code.replace(/\r\n?/g, "\n").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
  if (/<\/script|<!--/i.test(out)) throw new Error(`${label} contient une séquence interdite dans <script>.`);
  if (out.includes("\0")) throw new Error(`${label} contient un caractère NUL.`);
  return out.trimEnd() + "\n";
}

/**
 * Sous file://, Chromium refuse les workers de type « module » créés depuis une URL blob:.
 * Le worker PDF.js est donc converti en script classique : seules deux constructions
 * propres aux modules doivent disparaître, ce que l'analyse syntaxique vérifie ensuite.
 */
function toClassicWorker(code) {
  const out = code
    .replace(/import\.meta\.url/g, "self.location.href")
    .replace(/;?\s*export\s*\{\s*WorkerMessageHandler\s*\}\s*;?\s*$/, ";\n");
  acorn.parse(out, { ecmaVersion: "latest", sourceType: "script" });
  return out;
}

const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

async function bundleApp(version) {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/js/main.js")],
    bundle: true,
    format: "iife",
    target: ["es2022"],
    charset: "utf8",
    legalComments: "none",
    write: false,
    define: { __APP_VERSION__: JSON.stringify(version) },
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

async function minifyCss(css) {
  const result = await esbuild.transform(css, {
    loader: "css",
    minify: true,
    target: ["chrome110", "firefox115", "safari16"],
  });
  return result.code.trim();
}

export async function buildHtml() {
  const pkg = JSON.parse(await read(path.join(ROOT, "package.json")));
  const [template, css, app, jszip, pdfLib, pdfjs, pdfjsWorker] = await Promise.all([
    read(path.join(ROOT, "src/index.html")),
    read(path.join(ROOT, "src/styles.css")).then(minifyCss),
    bundleApp(pkg.version),
    read(VENDOR.jszip),
    read(VENDOR.pdfLib),
    read(VENDOR.pdfjs),
    read(VENDOR.pdfjsWorker),
  ]);

  const executable = [
    ["JSZip", normalizeScript(jszip, "JSZip")],
    ["pdf-lib", normalizeScript(pdfLib, "pdf-lib")],
    ["application", normalizeScript(app, "Application")],
  ];
  const pdfModule = normalizeScript(pdfjs, "PDF.js");
  const pdfWorker = normalizeScript(toClassicWorker(pdfjsWorker), "Worker PDF.js");

  const scripts = [
    `<script type="text/plain" id="pdfjs-module">${pdfModule}</script>`,
    `<script type="text/plain" id="pdfjs-worker">${pdfWorker}</script>`,
    ...executable.map(([label, code]) => `<script data-lib="${label}">${code}</script>`),
  ].join("\n");

  let html = template.replaceAll("{{VERSION}}", pkg.version);
  const inject = (marker, value) => {
    if (!html.includes(marker)) throw new Error(`Marqueur absent du gabarit : ${marker}`);
    html = html.replace(marker, () => value);
  };
  inject("<!-- build:styles -->", `<style>${css}</style>`);
  inject("<!-- build:scripts -->", scripts);

  // Politique de sécurité : aucun accès réseau ; seuls les scripts intégrés (par empreinte) et blob: s'exécutent.
  const inlineScripts = [
    ...html.matchAll(/<script(?![^>]*\btype="text\/plain")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
  const csp = [
    "default-src 'none'",
    `script-src ${inlineScripts.map(sha256).join(" ")} blob:`,
    "worker-src blob:",
    "child-src blob:",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "media-src data: blob:",
    "connect-src data: blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
  inject("<!-- build:csp -->", `<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  return html;
}

const kb = (n) => `${(n / 1024).toFixed(0)} Ko`;

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--check")) {
    const [expected, actual] = await Promise.all([buildHtml(), read(OUTPUT).catch(() => "")]);
    if (expected !== actual) {
      console.error(
        "CDQP_Offline_File_Toolkit.html n'est pas à jour : lancez « npm run build » puis versionnez le résultat.",
      );
      process.exit(1);
    }
    console.log("Fichier HTML à jour.");
    return;
  }
  const run = async () => {
    const started = Date.now();
    const html = await buildHtml();
    await writeFile(OUTPUT, html);
    console.log(`${path.basename(OUTPUT)} — ${kb(Buffer.byteLength(html))} en ${Date.now() - started} ms`);
  };
  await run();
  if (args.has("--watch")) {
    let timer;
    console.log("Surveillance de src/…");
    watch(path.join(ROOT, "src"), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => run().catch((e) => console.error(e.message)), 120);
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
