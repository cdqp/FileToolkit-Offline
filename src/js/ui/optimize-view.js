import { $ } from "../core/dom.js";
import { fmtBytes, makeFile, totalSize, uniqueNamer } from "../core/files.js";
import { identify } from "../core/formats.js";
import { canEncode } from "../lib/image.js";
import { optimizationPlan, optimizeFile } from "../tools/optimize.js";
import {
  bindRangeOutputs,
  clearResult,
  createDropzone,
  markSteps,
  pluralize,
  readForm,
  renderFileList,
  setProgress,
  setStatus,
  showResult,
  toggleFields,
} from "./components.js";

const STEPS = [
  "Analyse du contenu…",
  "Création d'une version plus légère…",
  "Comparaison avec l'original…",
  "Vérification du poids final…",
];

const KIND_NOTES = {
  text: "Minification sans perte : seuls les commentaires et les blancs superflus disparaissent ; le contenu reste strictement équivalent.",
  zip: "Recompression ZIP au niveau maximal : le contenu de l'archive reste identique.",
  binary:
    "Aucun optimiseur spécialisé pour ce format : une compression ZIP sans perte est tentée et n'est conservée que si elle allège le fichier.",
  office:
    "Les images JPEG internes sont recompressées et le conteneur recompacté : texte, styles et mise en page ne changent pas.",
};

const PDF_HINTS = {
  images:
    "Les photos intégrées sont recompressées et redimensionnées à la résolution cible ; texte et vecteurs restent intacts.",
  lossless: "Objets inutilisés supprimés et structure compactée : rendu strictement identique.",
  raster:
    "Chaque page devient une image : gain maximal, mais le texte n'est plus sélectionnable ni recherchable.",
};

export function initOptimize(root) {
  const setup = $(".setup", root);
  const list = $(".files", root);
  const form = $("[data-options]", root);
  const warning = $("[data-warning]", root);
  const kindNote = $("[data-kind-note]", root);
  const pdfHint = $("[data-pdf-hint]", root);
  const run = $(".run", root);
  let items = [];
  let generation = 0;
  let busy = false;

  const usable = () => items.filter((i) => i.state === "ok");
  const render = () => renderFileList(list, items);

  function refreshFields() {
    const kinds = new Set(usable().map((i) => i.plan.kind));
    const s = readForm(form);
    const fields = [];
    if (kinds.has("image")) fields.push("image", "longEdge");
    if (kinds.has("image") && s.format !== "png") fields.push("quality");
    if (kinds.has("pdf")) fields.push("pdf");
    if (kinds.has("pdf") && s.pdfMode !== "lossless") fields.push("quality", "dpi");
    if (kinds.has("office")) fields.push("quality", "longEdge");
    if (kinds.has("audio")) fields.push("audio");
    toggleFields(form, fields);
    pdfHint.textContent = PDF_HINTS[s.pdfMode] || "";
    const notes = [...kinds].map((k) => KIND_NOTES[k]).filter(Boolean);
    kindNote.hidden = !notes.length;
    kindNote.textContent = notes.join(" ");
  }

  function reset() {
    generation++;
    items = [];
    list.innerHTML = "";
    form.reset();
    toggleFields(form, []);
    warning.hidden = true;
    kindNote.hidden = true;
    run.disabled = true;
    setup.hidden = true;
    setStatus(root, "");
    setProgress(root, null);
    clearResult(root);
    markSteps(root, 0);
  }

  async function load(files) {
    if (busy) return;
    reset();
    const current = generation;
    items = files.map((file) => ({ file, state: "analyzing", message: "analyse en cours…" }));
    render();
    setup.hidden = false;
    markSteps(root, 1);
    setStatus(root, "Analyse de la structure et choix du traitement le plus sûr…", "", true);
    for (const item of items) {
      try {
        item.info = await identify(item.file);
        item.plan = await optimizationPlan(item.file, item.info);
        item.state = "ok";
        item.message = item.plan.label;
        item.tone = item.plan.warning ? "warn" : "";
      } catch (e) {
        item.state = "failed";
        item.message = e.message;
        item.tone = "bad";
      }
      if (current !== generation) return;
      render();
    }
    const ok = usable();
    if (!ok.length) {
      setStatus(
        root,
        items.length === 1 ? items[0].message : "Aucun de ces fichiers ne peut être lu.",
        "bad",
      );
      return;
    }
    const formatSelect = $("#op-format", form);
    for (const option of formatSelect.options)
      if (["webp", "avif"].includes(option.value))
        option.disabled = !(await canEncode(`image/${option.value}`));
    const warnings = ok.map((i) => i.plan.warning).filter(Boolean);
    warning.hidden = !warnings.length;
    warning.textContent = [...new Set(warnings)].join(" ");
    refreshFields();
    run.disabled = false;
    markSteps(root, 2);
    const failed = items.length - ok.length;
    setStatus(
      root,
      `Prêt : réglez si besoin, puis Optimiser.${failed ? ` ${pluralize(failed, "fichier illisible ignoré", "fichiers illisibles ignorés")}.` : ""}`,
      failed ? "warn" : "good",
    );
  }

  createDropzone(root, { onFiles: load });
  bindRangeOutputs(form);
  form.addEventListener("change", refreshFields);
  form.addEventListener("reset", () => setTimeout(refreshFields));
  $(".reset", root).addEventListener("click", reset);

  run.addEventListener("click", async () => {
    const ok = usable();
    if (!ok.length || busy) return;
    busy = true;
    run.disabled = true;
    clearResult(root);
    const settings = readForm(form);
    settings.quality = Number(settings.quality) / 100;
    const outputs = [];
    const rows = [];
    const errors = [];
    const sources = [];
    const unique = uniqueNamer();
    setProgress(root, 0.02, STEPS);
    for (const [index, item] of ok.entries()) {
      try {
        const result = await optimizeFile(item.file, item.info, item.plan, settings, (p) =>
          setProgress(root, (index + p * 0.95) / ok.length, STEPS),
        );
        const name = unique(result.file.name);
        outputs.push(name === result.file.name ? result.file : makeFile(result.file, name, result.file.type));
        sources.push(item.file);
        const gain = Math.round((1 - result.file.size / item.file.size) * 100);
        rows.push(
          result.preserved
            ? { detail: "aucun gain possible", badge: "original conservé" }
            : {
                detail: `${fmtBytes(item.file.size)} → ${fmtBytes(result.file.size)} · ${result.method}`,
                badge: `−${gain} %`,
                tone: "good",
              },
        );
      } catch (e) {
        errors.push(`${item.file.name} : ${e.message}`);
      }
    }
    setProgress(root, null);
    busy = false;
    run.disabled = false;
    if (!outputs.length) {
      setStatus(root, `Le traitement n'a pas pu être appliqué : ${errors.join(" — ")}`, "bad");
      return;
    }
    markSteps(root, 3);
    const preserved = rows.filter((r) => r.badge === "original conservé").length;
    const saved = totalSize(sources) - totalSize(outputs);
    let message;
    if (outputs.length === 1)
      message = preserved
        ? "Aucun gain réel n'était possible : l'original est conservé, sans un octet de plus."
        : `Optimisation terminée : ${rows[0].detail.split(" · ").slice(1).join(" · ")}.`;
    else
      message = `${pluralize(outputs.length - preserved, "fichier allégé", "fichiers allégés")}${preserved ? `, ${pluralize(preserved, "original conservé", "originaux conservés")}` : ""} — ${fmtBytes(Math.max(0, saved))} économisés.`;
    if (errors.length) message += ` Échecs : ${errors.join(" — ")}`;
    setStatus(root, message, errors.length ? "warn" : "good");
    showResult(root, {
      files: outputs,
      before: totalSize(sources),
      optimized: true,
      rows: outputs.length > 1 ? rows : null,
      note:
        outputs.length === 1 && preserved
          ? "Garantie appliquée : le fichier d'origine vous est rendu tel quel."
          : "",
      bundleName: "fichiers-optimises.zip",
    });
  });
}
