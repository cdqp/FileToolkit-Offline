import { $ } from "../core/dom.js";
import { totalSize, uniqueNamer, makeFile } from "../core/files.js";
import { identify } from "../core/formats.js";
import {
  conversionTargets,
  convertFile,
  releaseCache,
  sortTargets,
  targetHint,
  targetLabel,
} from "../tools/convert.js";
import {
  bindRangeOutputs,
  clearResult,
  createDropzone,
  markSteps,
  pluralize,
  readForm,
  renderChoices,
  renderFileList,
  setProgress,
  setStatus,
  showResult,
  toggleFields,
} from "./components.js";

const STEPS = [
  "Lecture des fichiers sources…",
  "Conversion en cours…",
  "Écriture des fichiers produits…",
  "Vérification finale…",
];
const RASTER = ["png", "jpg", "webp", "avif", "bmp"];

export function initConvert(root) {
  const setup = $(".setup", root);
  const list = $(".files", root);
  const choices = $("[data-targets]", root);
  const hint = $("[data-hint]", root);
  const warning = $("[data-warning]", root);
  const form = $("[data-options]", root);
  const run = $(".run", root);
  let items = [];
  let target = null;
  let generation = 0;
  let busy = false;

  const usable = () => items.filter((i) => i.state === "ok");
  const render = () => renderFileList(list, items);

  function fieldsFor(t) {
    const ok = usable();
    const images = ok.some((i) => i.info.group === "image" && i.info.format !== "pdf");
    const pdf = ok.some((i) => i.info.format === "pdf");
    const fields = [];
    if (["jpg", "webp", "avif"].includes(t) && (images || pdf)) fields.push("quality");
    if (images && RASTER.includes(t)) fields.push("longEdge");
    if (pdf && ["png", "jpg", "webp"].includes(t)) fields.push("dpi");
    if (images && t === "pdf") fields.push("pageSize");
    return fields;
  }

  function choose(t) {
    target = t;
    hint.textContent = targetHint(t, usable()[0].info);
    toggleFields(form, fieldsFor(t));
    run.disabled = false;
    markSteps(root, 2);
  }

  function reset() {
    generation++;
    items.forEach((i) => releaseCache(i.analysis?.cache));
    items = [];
    target = null;
    list.innerHTML = "";
    choices.innerHTML = "";
    hint.textContent = "";
    warning.hidden = true;
    form.reset();
    toggleFields(form, []);
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
    setStatus(
      root,
      `Analyse de ${pluralize(files.length, "fichier")} : lecture des signatures et recherche des sorties possibles…`,
      "",
      true,
    );
    for (const item of items) {
      try {
        item.info = await identify(item.file);
        item.analysis = await conversionTargets(item.file, item.info);
        item.state = "ok";
        item.message = item.analysis.warning
          ? "archivage uniquement"
          : `${pluralize(item.analysis.targets.length, "sortie possible", "sorties possibles")}`;
        item.tone = item.analysis.warning ? "warn" : "";
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
    // En lot, un fichier déjà au format visé est simplement repris tel quel.
    const can = (i, t) => i.analysis.targets.includes(t) || (ok.length > 1 && i.analysis.same === t);
    const candidates = new Set(
      ok.flatMap((i) => [...i.analysis.targets, ...(i.analysis.same ? [i.analysis.same] : [])]),
    );
    const common = sortTargets([...candidates].filter((t) => ok.every((i) => can(i, t))));
    const warnings = ok.filter((i) => i.analysis.warning);
    warning.hidden = !warnings.length;
    warning.textContent =
      ok.length === 1
        ? warnings[0]?.analysis.warning || ""
        : warnings.length
          ? `${pluralize(warnings.length, "fichier ne peut", "fichiers ne peuvent")} qu'être archivé${warnings.length > 1 ? "s" : ""}.`
          : "";
    if (!common.length) {
      setStatus(
        root,
        "Ces fichiers n'ont aucun format de sortie en commun : convertissez-les séparément, ou regroupez-les avec l'outil Assembler.",
        "bad",
      );
      return;
    }
    const picker = renderChoices(choices, common, targetLabel, choose);
    if (common.length === 1) picker.select(common[0]);
    const failed = items.length - ok.length;
    setStatus(
      root,
      `${common.length === 1 ? "Le seul format disponible a été sélectionné." : `${common.length} formats disponibles : choisissez la sortie, puis Convertir.`}${failed ? ` ${pluralize(failed, "fichier illisible ignoré", "fichiers illisibles ignorés")}.` : ""}`,
      failed ? "warn" : "good",
    );
  }

  createDropzone(root, { onFiles: load });
  bindRangeOutputs(form);
  $(".reset", root).addEventListener("click", reset);

  run.addEventListener("click", async () => {
    const ok = usable();
    if (!target || !ok.length || busy) return;
    busy = true;
    run.disabled = true;
    clearResult(root);
    const options = readForm(form);
    options.quality = Number(options.quality) / 100;
    const outputs = [];
    const errors = [];
    const unique = uniqueNamer();
    setProgress(root, 0.02, STEPS);
    for (const [index, item] of ok.entries()) {
      try {
        // Fichier déjà au format visé : repris tel quel, sauf les images (redimensionnement et qualité s'appliquent au lot).
        const passthrough =
          item.analysis.same === target &&
          !item.analysis.targets.includes(target) &&
          item.info.group !== "image";
        const produced = passthrough
          ? [item.file]
          : await convertFile(item.file, item.info, target, item.analysis.cache, options, (p) =>
              setProgress(root, (index + p) / ok.length, STEPS),
            );
        for (const f of produced)
          outputs.push(f.name === unique(f.name) ? f : makeFile(f, unique(f.name), f.type));
      } catch (e) {
        errors.push(`${item.file.name} : ${e.message}`);
      }
      setProgress(root, (index + 1) / ok.length, STEPS);
    }
    setProgress(root, null);
    busy = false;
    run.disabled = false;
    if (!outputs.length) {
      setStatus(root, errors.join(" — ") || "La conversion n'a produit aucun fichier.", "bad");
      return;
    }
    markSteps(root, 3);
    const label = targetLabel(target);
    setStatus(
      root,
      errors.length
        ? `Conversion partielle : ${errors.join(" — ")}`
        : `Conversion vers ${label} terminée : ${pluralize(outputs.length, "fichier prêt", "fichiers prêts")} à exporter.`,
      errors.length ? "warn" : "good",
    );
    const sources = ok.map((i) => i.file);
    showResult(root, {
      files: outputs,
      before: totalSize(sources),
      bundleName:
        ok.length === 1
          ? `${sources[0].name.replace(/\.[^.]+$/, "")}-${target}.zip`
          : `conversion-${target}.zip`,
      note:
        ok.length > 1
          ? `${pluralize(ok.length, "fichier converti", "fichiers convertis")} vers ${label}.`
          : "",
    });
  });
}
