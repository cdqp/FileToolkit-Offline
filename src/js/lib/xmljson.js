import { escapeXml } from "../core/dom.js";

/** Convertit un élément DOM XML en objet : attributs sous « @ », texte sous « #text ». */
export function xmlToObject(node) {
  const obj = {};
  if (node.attributes?.length)
    obj["@"] = Object.fromEntries([...node.attributes].map((a) => [a.name, a.value]));
  let text = "";
  let hasElements = false;
  for (const child of node.childNodes) {
    if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue;
    else if (child.nodeType === 1) {
      hasElements = true;
      const value = xmlToObject(child);
      const key = child.nodeName;
      obj[key] = key in obj ? [].concat(obj[key], [value]) : value;
    }
  }
  const trimmed = text.trim();
  if (!hasElements && !obj["@"]) return trimmed;
  if (trimmed) obj["#text"] = trimmed;
  return obj;
}

export function parseXmlDocument(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) throw new Error(`XML invalide : ${error.textContent.trim().split("\n")[0].slice(0, 160)}`);
  return doc;
}

export function xmlTextToObject(text) {
  const root = parseXmlDocument(text).documentElement;
  return { [root.nodeName]: xmlToObject(root) };
}

/** Nom d'élément XML valide dérivé d'une clé quelconque. */
export function xmlName(key) {
  let name = String(key).replace(/[^\p{L}\p{N}_.:-]/gu, "_");
  if (!/^[\p{L}_]/u.test(name)) name = `_${name}`;
  if (/^xml/i.test(name)) name = `_${name}`;
  return name;
}

const scalar = (v) =>
  v === null || v === undefined ? "" : escapeXml(typeof v === "object" ? JSON.stringify(v) : v);

function element(name, value, indent) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) return value.map((item) => element(name, item, indent)).join("");
  if (value === null || typeof value !== "object") return `${pad}<${name}>${scalar(value)}</${name}>\n`;
  const attrs = Object.entries(value["@"] && typeof value["@"] === "object" ? value["@"] : {})
    .map(([k, v]) => ` ${xmlName(k)}="${scalar(v)}"`)
    .join("");
  const entries = Object.entries(value).filter(([k]) => k !== "@" && k !== "#text");
  const text = "#text" in value ? scalar(value["#text"]) : "";
  if (!entries.length) return `${pad}<${name}${attrs}>${text}</${name}>\n`;
  const children = entries.map(([k, v]) => element(xmlName(k), v, indent + 1)).join("");
  return `${pad}<${name}${attrs}>${text ? `\n${pad}  ${text}` : ""}\n${children}${pad}</${name}>\n`;
}

/** Sérialise une valeur JSON en XML bien formé (une seule racine garantie). */
export function objectToXml(value, rootName = "root") {
  let body;
  const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  if (keys.length === 1 && keys[0] !== "@" && keys[0] !== "#text" && !Array.isArray(value[keys[0]])) {
    body = element(xmlName(keys[0]), value[keys[0]], 0);
  } else if (Array.isArray(value)) {
    body = element(rootName, { item: value }, 0);
  } else body = element(rootName, value, 0);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}
