/* global JSZip */
import { $, $$, html, setHtml } from "../core/dom.js";
import { downloadFile, fmtBytes, makeFile, totalSize, uniqueNamer } from "../core/files.js";
import { GROUP_LABELS } from "../core/formats.js";

// ——— Zone de dépôt ———

const dropzones = new Set();

/** Zone de dépôt (clic, clavier via le bouton, glisser-déposer, collage). */
export function createDropzone(root, { onFiles }) {
  const zone = $("[data-drop]", root);
  const input = $("input[type=file]", zone);
  const button = $("[data-pick]", zone);
  const multiple = zone.hasAttribute("data-multiple");
  let depth = 0;
  const deliver = (list) => {
    const files = [...list].filter((f) => f.size > 0 || f.type || f.name);
    if (!files.length) return;
    onFiles(multiple ? files : files.slice(0, 1));
  };
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    input.click();
  });
  zone.addEventListener("click", (e) => {
    if (e.target === zone || !e.target.closest("button,input")) input.click();
  });
  input.addEventListener("change", () => {
    deliver(input.files);
    input.value = "";
  });
  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    zone.classList.add("drag");
  });
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove("drag");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    zone.classList.remove("drag");
    deliver(e.dataTransfer.files);
  });
  const entry = { zone, deliver };
  dropzones.add(entry);
  return entry;
}

/** Dépôt hors zone ou collage : transmis à la zone visible (sinon le navigateur ouvrirait le fichier). */
export function installGlobalFileHandlers() {
  const visibleZone = () => [...dropzones].find((d) => d.zone.offsetParent !== null);
  window.addEventListener("dragover", (e) => {
    if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    visibleZone()?.deliver(e.dataTransfer.files);
  });
  window.addEventListener("paste", (e) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const files = [...(e.clipboardData?.files || [])];
    const zone = visibleZone();
    if (!files.length || !zone) return;
    e.preventDefault();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
    // Les images collées s'appellent souvent « image.png » : on les nomme de façon explicite.
    zone.deliver(
      files.map((f, i) =>
        /^image\.\w+$/.test(f.name)
          ? makeFile(
              f,
              `colle-${stamp}${files.length > 1 ? `-${i + 1}` : ""}.${f.name.split(".").pop()}`,
              f.type,
            )
          : f,
      ),
    );
  });
}

// ——— Liste de fichiers ———

const icon = (info, file) =>
  (info?.format || file.name.split(".").pop() || "FICHIER").slice(0, 5).toUpperCase();

/**
 * @param {{file: File, info?: object, state?: "analyzing"|"failed"|"ok", message?: string, tone?: string}[]} items
 * @param {{reorder?: boolean, onMove?: Function, onRemove?: Function}} options
 */
export function renderFileList(list, items, { reorder = false, onMove, onRemove } = {}) {
  setHtml(
    list,
    html`${items.map(
      (item, i) =>
        html`<li class="file-row ${item.state || ""}">
          <div class="file-icon" aria-hidden="true">${icon(item.info, item.file)}</div>
          <div class="file-main">
            <div class="file-name" title="${item.file.name}">${item.file.name}</div>
            <div class="file-meta">
              ${fmtBytes(item.file.size)}${item.info ? ` · ${GROUP_LABELS[item.info.group]} · ${item.info.detail}` : ""}${item.message ? html` · <span class="${item.tone || ""}">${item.message}</span>` : ""}
            </div>
          </div>
          ${
            reorder
              ? html`<div class="file-actions">
                  <button
                    class="icon-btn"
                    type="button"
                    data-move="${i}"
                    data-dir="-1"
                    aria-label="Monter ${item.file.name}"
                    ${i === 0 ? "disabled" : ""}
                  >
                    ↑
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    data-move="${i}"
                    data-dir="1"
                    aria-label="Descendre ${item.file.name}"
                    ${i === items.length - 1 ? "disabled" : ""}
                  >
                    ↓
                  </button>
                  <button
                    class="icon-btn"
                    type="button"
                    data-remove="${i}"
                    aria-label="Retirer ${item.file.name}"
                  >
                    ✕
                  </button>
                </div>`
              : ""
          }
        </li>`,
    )}`,
  );
  if (reorder) {
    $$("[data-move]", list).forEach((b) =>
      b.addEventListener("click", () => onMove(Number(b.dataset.move), Number(b.dataset.dir))),
    );
    $$("[data-remove]", list).forEach((b) =>
      b.addEventListener("click", () => onRemove(Number(b.dataset.remove))),
    );
  }
}

// ——— Choix de format (groupe de boutons radio accessible) ———

export function renderChoices(container, ids, labelOf, onChoose) {
  setHtml(
    container,
    html`${ids.map((id) => html`<button class="chip" type="button" role="radio" aria-checked="false" tabindex="-1" data-value="${id}">${labelOf(id)}</button>`)}`,
  );
  const buttons = $$("[data-value]", container);
  const choose = (button, focus = false) => {
    buttons.forEach((b) => {
      const on = b === button;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (focus) button.focus();
    onChoose(button.dataset.value);
  };
  buttons.forEach((b, i) => {
    b.addEventListener("click", () => choose(b));
    b.addEventListener("keydown", (e) => {
      const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        choose(e.key === "Home" ? buttons[0] : buttons.at(-1), true);
      } else if (delta) {
        e.preventDefault();
        choose(buttons[(i + delta + buttons.length) % buttons.length], true);
      }
    });
  });
  if (buttons[0]) buttons[0].tabIndex = 0;
  return {
    select: (id) => {
      const b = buttons.find((x) => x.dataset.value === id);
      if (b) choose(b);
    },
  };
}

// ——— Statut et progression ———

export function setStatus(root, message, tone = "", busy = false) {
  const el = $(".status", root);
  el.textContent = message;
  el.className = `status ${tone}`.trim();
  el.setAttribute("aria-busy", String(busy));
}

/** Barre de progression ; `null` la masque. Les messages suivent l'avancement réel. */
export function setProgress(root, fraction, steps = null) {
  const bar = $(".progress", root);
  if (fraction === null) {
    bar.hidden = true;
    return;
  }
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  bar.hidden = false;
  bar.setAttribute("aria-valuenow", String(pct));
  $("i", bar).style.width = `${pct}%`;
  if (steps) {
    const message = steps[Math.min(steps.length - 1, Math.floor((pct / 100) * steps.length))];
    const status = $(".status", root);
    if (status.textContent !== message) setStatus(root, message, "", true);
  }
}

export function markSteps(root, done) {
  $$(".flow-step", root).forEach((s, i) => s.classList.toggle("done", i < done));
}

// ——— Résultat ———

const previews = new WeakMap();

export function clearResult(root) {
  const el = $(".result", root);
  (previews.get(el) || []).forEach((u) => URL.revokeObjectURL(u));
  previews.delete(el);
  el.hidden = true;
  el.className = "result";
  el.innerHTML = "";
}

async function zipAll(files, name) {
  const zip = new JSZip();
  const unique = uniqueNamer();
  for (const f of files) zip.file(unique(f.name), f, { date: new Date(f.lastModified || Date.now()) });
  return makeFile(
    await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }),
    name,
    "application/zip",
  );
}

/**
 * Affiche le résultat : export principal, statistiques, aperçu d'image et téléchargements individuels.
 * @param {{files: File[], before: number, note?: string, optimized?: boolean, bundleName?: string, rows?: {name: string, detail: string, badge?: string}[]}} result
 */
export function showResult(
  root,
  { files, before, note = "", optimized = false, bundleName = "resultats.zip", rows = null },
) {
  clearResult(root);
  const el = $(".result", root);
  const after = totalSize(files);
  const single = files.length === 1;
  const change = before ? Math.round((after / before - 1) * 100) : 0;
  const metric = optimized
    ? html`<span class="${after < before ? "gain" : ""}"
        >Gain : ${before > after ? Math.round((1 - after / before) * 100) : 0} %</span
      >`
    : before
      ? html`<span>Variation : ${change > 0 ? "+" : ""}${change} %</span>`
      : "";
  const title = single ? files[0].name : `${files.length} fichiers prêts`;
  setHtml(
    el,
    html`<div class="result-top">
        <div>
          <strong>${title}</strong>
          <div class="stats">
            <span>Avant : ${fmtBytes(before)}</span><span>Après : ${fmtBytes(after)}</span>${metric}
          </div>
          ${note ? html`<div class="result-note">${note}</div>` : ""}
        </div>
        <button class="primary export-btn" type="button">
          ${single ? "Exporter le résultat" : "Tout exporter (ZIP)"}
        </button>
      </div>
      ${
        !single || rows
          ? html`<details class="parts" ${files.length <= 12 ? "open" : ""}>
              <summary>Fichiers individuels (${files.length})</summary>
              <ul>
                ${files.map(
                  (f, i) =>
                    html`<li>
                      <span
                        >${f.name}<small>${fmtBytes(f.size)}${rows?.[i]?.detail ? ` · ${rows[i].detail}` : ""}</small>${rows?.[i]?.badge ? html`<em class="badge ${rows[i].tone || ""}">${rows[i].badge}</em>` : ""}</span
                      >
                      <button class="secondary small" type="button" data-file="${i}">Télécharger</button>
                    </li>`,
                )}
              </ul>
            </details>`
          : ""
      }`,
  );
  const image = files.find((f) => /^image\/(png|jpeg|webp|avif|gif|bmp|svg\+xml|x-icon)/.test(f.type));
  if (single && image && image.size < 40 * 1024 * 1024) {
    const url = URL.createObjectURL(image);
    previews.set(el, [url]);
    const img = document.createElement("img");
    img.className = "preview";
    img.alt = `Aperçu de ${image.name}`;
    img.src = url;
    $(".result-top > div", el).append(img);
  }
  el.hidden = false;
  el.classList.add("export-ready");
  const button = $(".export-btn", el);
  button.addEventListener("click", async () => {
    if (single) downloadFile(files[0]);
    else {
      button.disabled = true;
      button.textContent = "Préparation du ZIP…";
      try {
        downloadFile(await zipAll(files, bundleName));
      } finally {
        button.disabled = false;
      }
    }
    el.classList.remove("export-ready");
    button.textContent = "Exporté ✓";
    setTimeout(() => (button.textContent = single ? "Exporter à nouveau" : "Tout exporter à nouveau"), 1600);
  });
  $$("[data-file]", el).forEach((b) =>
    b.addEventListener("click", () => downloadFile(files[Number(b.dataset.file)])),
  );
}

/** Lit un formulaire de réglages en objet simple. */
export function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/** Affiche les champs `data-when` dont la condition figure dans `active`. */
export function toggleFields(form, active) {
  const set = new Set(active);
  let visible = 0;
  $$("[data-when]", form).forEach((field) => {
    field.hidden = !field.dataset.when.split(" ").some((w) => set.has(w));
    if (!field.hidden) visible++;
  });
  form.hidden = visible === 0;
}

/** Relie un curseur à son affichage `<output>`. */
export function bindRangeOutputs(form) {
  $$("input[type=range]", form).forEach((range) => {
    const output = $(`#${range.id}-out`, form);
    if (!output) return;
    const update = () => (output.textContent = range.value);
    range.addEventListener("input", update);
    form.addEventListener("reset", () => setTimeout(update));
    update();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
}

export const pluralize = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
