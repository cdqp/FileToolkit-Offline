import { $ } from "../core/dom.js";
import { baseName, sanitizeFileName, totalSize } from "../core/files.js";
import { identify } from "../core/formats.js";
import { decodeAudio, formatDuration } from "../lib/audio.js";
import { MERGE_LABELS, mergeFiles, mergeHint, mergeTargets, volumeSet } from "../tools/merge.js";
import { pdfPageCount, splitFile, splitMode } from "../tools/split.js";
import {
  bindRangeOutputs,
  clearResult,
  createDropzone,
  pluralize,
  readForm,
  renderChoices,
  renderFileList,
  setProgress,
  setStatus,
  showResult,
  toggleFields,
} from "./components.js";

const MERGE_STEPS = [
  "Lecture des fichiers…",
  "Assemblage des contenus…",
  "Construction du résultat…",
  "Vérification avant export…",
];
const SPLIT_STEPS = [
  "Lecture de la structure…",
  "Création des parties…",
  "Écriture de chaque partie…",
  "Regroupement des résultats…",
];

// ——— Fusion ———

export function initMerge(root) {
  const setup = $(".setup", root);
  const list = $(".files", root);
  const tools = $(".list-tools", root);
  const choices = $("[data-targets]", root);
  const hint = $("[data-hint]", root);
  const form = $("[data-options]", root);
  const run = $(".run", root);
  let items = [];
  let target = null;
  let busy = false;
  let generation = 0;

  const files = () => items.filter((i) => i.state === "ok").map((i) => i.file);
  const infos = () => items.filter((i) => i.state === "ok").map((i) => i.info);

  function fieldsFor(t) {
    const fields = t === "join" ? [] : ["name"];
    if (t === "pdf" && infos().some((i) => i.format !== "pdf")) fields.push("pageSize");
    if (t === "png") fields.push("sheet");
    return fields;
  }

  function choose(t) {
    target = t;
    hint.textContent = mergeHint(t, infos());
    toggleFields(form, fieldsFor(t));
    run.disabled = false;
    run.textContent =
      t === "join" ? "Réassembler" : ["zip", "tgz", "rar"].includes(t) ? "Créer l'archive" : "Assembler";
  }

  function refresh() {
    renderFileList(list, items, {
      reorder: true,
      onMove: (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= items.length) return;
        [items[i], items[j]] = [items[j], items[i]];
        refresh();
        $(`[data-move="${j}"][data-dir="${dir}"]`, list)?.focus() || $(`[data-move="${j}"]`, list)?.focus();
      },
      onRemove: (i) => {
        items.splice(i, 1);
        refresh();
      },
    });
    tools.hidden = items.length < 2;
    clearResult(root);
    const ok = files();
    if (items.some((i) => i.state === "analyzing")) return;
    if (ok.length < 2) {
      setup.hidden = items.length === 0;
      choices.innerHTML = "";
      hint.textContent = "";
      run.disabled = true;
      setStatus(
        root,
        items.length ? "Ajoutez au moins un autre fichier pour assembler." : "",
        items.length ? "warn" : "",
      );
      return;
    }
    setup.hidden = false;
    const targets = mergeTargets(ok, infos());
    const previous = target;
    const picker = renderChoices(choices, targets, (t) => MERGE_LABELS[t], choose);
    picker.select(targets.includes(previous) ? previous : targets[0]);
    const semantic = targets[0] !== "zip";
    const volumes = volumeSet(ok);
    if (volumes && (!volumes.contiguous || volumes.missingFirst))
      setStatus(
        root,
        "Des volumes semblent manquer : le réassemblage exige tous les morceaux, du premier au dernier.",
        "warn",
      );
    else
      setStatus(
        root,
        semantic
          ? `${pluralize(ok.length, "fichier")} prêts : fusion directe disponible, archives en alternative.`
          : `${pluralize(ok.length, "fichier")} de natures différentes : ils peuvent être regroupés dans une archive.`,
        "good",
      );
  }

  async function add(newFiles) {
    if (busy) return;
    const current = generation;
    const added = newFiles.map((file) => ({ file, state: "analyzing", message: "analyse en cours…" }));
    items.push(...added);
    setup.hidden = false;
    refresh();
    setStatus(root, "Vérification de la compatibilité des fichiers…", "", true);
    for (const item of added) {
      try {
        item.info = await identify(item.file);
        item.state = "ok";
        item.message = "";
      } catch (e) {
        item.state = "failed";
        item.message = e.message;
        item.tone = "bad";
      }
    }
    if (current !== generation) return;
    refresh();
  }

  function reset() {
    generation++;
    items = [];
    target = null;
    list.innerHTML = "";
    choices.innerHTML = "";
    hint.textContent = "";
    tools.hidden = true;
    form.reset();
    run.disabled = true;
    setup.hidden = true;
    setStatus(root, "");
    setProgress(root, null);
    clearResult(root);
  }

  createDropzone(root, { onFiles: add });
  bindRangeOutputs(form);
  $(".reset", root).addEventListener("click", reset);
  $("[data-sort]", root).addEventListener("click", () => {
    items.sort((a, b) =>
      a.file.name.localeCompare(b.file.name, "fr", { numeric: true, sensitivity: "base" }),
    );
    refresh();
  });
  $("[data-reverse]", root).addEventListener("click", () => {
    items.reverse();
    refresh();
  });

  run.addEventListener("click", async () => {
    const ok = files();
    if (ok.length < 2 || !target || busy) return;
    busy = true;
    run.disabled = true;
    clearResult(root);
    const opts = readForm(form);
    opts.name = sanitizeFileName(opts.name || "fusion", "fusion");
    opts.gap = Number(opts.gap) || 0;
    setProgress(root, 0.03, MERGE_STEPS);
    try {
      const { file, note } = await mergeFiles(ok, infos(), target, opts, (p) =>
        setProgress(root, p, MERGE_STEPS),
      );
      setProgress(root, null);
      const archive = ["zip", "tgz", "rar"].includes(target);
      setStatus(
        root,
        target === "join"
          ? "Fichier d'origine reconstitué."
          : archive
            ? "Archive créée : chaque fichier original est conservé à l'identique."
            : "Assemblage terminé : le résultat attend son export.",
        "good",
      );
      showResult(root, {
        files: [file],
        before: totalSize(ok),
        note: note || (archive ? "Regroupement réversible, sans fausse fusion." : ""),
      });
    } catch (e) {
      setProgress(root, null);
      setStatus(root, e.message, "bad");
    } finally {
      busy = false;
      run.disabled = false;
    }
  });
}

// ——— Découpe ———

const MODE_TITLES = {
  pdf: "Découpe du PDF",
  audio: "Découpe audio (WAV)",
  csv: "Découpe par lignes (en-tête conservé)",
  json: "Découpe d'un tableau JSON",
  text: "Découpe par lignes",
  image: "Découpe en tuiles",
  binary: "Découpe en volumes",
};

export function initSplit(root) {
  const setup = $(".setup", root);
  const list = $(".files", root);
  const form = $("[data-options]", root);
  const title = $("[data-mode-title]", root);
  const linesLabel = $("[data-lines-label]", root);
  const run = $(".run", root);
  let item = null;
  let mode = null;
  let busy = false;
  let generation = 0;

  function refreshFields() {
    if (!mode) return toggleFields(form, []);
    const s = readForm(form);
    const fields = [];
    if (mode === "pdf") {
      fields.push("pdf");
      if (s.pdfMode === "every") fields.push("pdf-every");
      if (s.pdfMode === "ranges" || s.pdfMode === "extract") fields.push("pdf-ranges");
    } else if (mode === "audio")
      fields.push("audio", s.audioMode === "parts" ? "audio-parts" : "audio-seconds");
    else if (["csv", "json", "text"].includes(mode)) fields.push("lines");
    else fields.push(mode);
    toggleFields(form, fields);
  }

  function reset() {
    generation++;
    item = null;
    mode = null;
    list.innerHTML = "";
    form.reset();
    refreshFields();
    run.disabled = true;
    setup.hidden = true;
    setStatus(root, "");
    setProgress(root, null);
    clearResult(root);
  }

  async function load([file]) {
    if (busy) return;
    reset();
    const current = generation;
    item = { file, state: "analyzing", message: "analyse en cours…" };
    renderFileList(list, [item]);
    setup.hidden = false;
    setStatus(root, "Identification du mode de découpe adapté…", "", true);
    try {
      item.info = await identify(file);
      mode = splitMode(item.info, file.size);
      let detail = MODE_TITLES[mode];
      if (mode === "pdf") detail = `${pluralize(await pdfPageCount(file), "page")}`;
      if (mode === "audio") {
        const audio = await decodeAudio(file);
        detail = `durée ${formatDuration(audio.duration)}`;
      }
      if (current !== generation) return;
      item.state = "ok";
      item.message = detail;
    } catch (e) {
      if (current !== generation) return;
      item.state = "failed";
      item.message = e.message;
      item.tone = "bad";
      mode = null;
    }
    renderFileList(list, [item]);
    if (!mode) {
      setStatus(root, item.message, "bad");
      return;
    }
    title.textContent = MODE_TITLES[mode];
    linesLabel.textContent =
      mode === "csv"
        ? "Lignes de données par fichier"
        : mode === "json"
          ? "Éléments par fichier"
          : "Lignes par fichier";
    refreshFields();
    run.disabled = false;
    setStatus(
      root,
      mode === "binary"
        ? "Ce format n'a pas de structure découpable : il sera divisé en volumes binaires à réassembler."
        : "Mode adapté détecté : réglez si besoin, puis Découper.",
      mode === "binary" ? "warn" : "good",
    );
  }

  createDropzone(root, { onFiles: load });
  bindRangeOutputs(form);
  form.addEventListener("change", refreshFields);
  form.addEventListener("reset", () => setTimeout(refreshFields));
  $(".reset", root).addEventListener("click", reset);

  run.addEventListener("click", async () => {
    if (!item || !mode || busy) return;
    busy = true;
    run.disabled = true;
    clearResult(root);
    setProgress(root, 0.03, SPLIT_STEPS);
    try {
      const { files, note, volumes } = await splitFile(item.file, item.info, readForm(form), (p) =>
        setProgress(root, p, SPLIT_STEPS),
      );
      setProgress(root, null);
      setStatus(
        root,
        volumes
          ? "Volumes créés : ils devront être réassemblés avant utilisation (notice incluse)."
          : `Découpe terminée : ${pluralize(files.length, "partie", "parties")}.`,
        "good",
      );
      showResult(root, {
        files,
        before: item.file.size,
        note,
        bundleName: `${baseName(item.file.name)}-decoupe.zip`,
      });
    } catch (e) {
      setProgress(root, null);
      setStatus(root, e.message, "bad");
    } finally {
      busy = false;
      run.disabled = false;
    }
  });
}
