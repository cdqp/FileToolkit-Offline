export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Fragment HTML déjà sûr, inséré tel quel par le gabarit `html`. */
export class SafeHtml {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}
export const raw = (value) => new SafeHtml(String(value));

/** Gabarit HTML qui échappe toute valeur interpolée (sauf `raw()` et les tableaux de fragments). */
export function html(strings, ...values) {
  const render = (v) =>
    v instanceof SafeHtml
      ? v.value
      : Array.isArray(v)
        ? v.map(render).join("")
        : v === false || v == null
          ? ""
          : escapeHtml(v);
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ""), ""));
}

export function setHtml(element, fragment) {
  element.innerHTML = fragment instanceof SafeHtml ? fragment.value : escapeHtml(fragment);
}

export function show(element, visible = true) {
  element.hidden = !visible;
}

/** Échappe pour XML 1.0 en retirant les caractères de contrôle interdits (sinon Word refuse le fichier). */
export function escapeXml(value) {
  return escapeHtml(String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, ""));
}
