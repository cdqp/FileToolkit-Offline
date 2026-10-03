// Sous-ensemble YAML 1.2 sûr : mappings et séquences en bloc, collections en ligne,
// scalaires (guillemets compris) et blocs littéraux | et >. Pas d'ancres ni de balises.

class YamlError extends Error {
  constructor(message, line) {
    super(line ? `YAML ligne ${line} : ${message}` : `YAML : ${message}`);
  }
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw, lineNo) {
  const v = raw.trim();
  if (v === "" || v === "~" || /^null$/i.test(v)) return null;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === "true";
  if (/^[-+]?(0|[1-9][\d_]*)$/.test(v)) {
    const n = Number(v.replace(/_/g, ""));
    return Number.isSafeInteger(n) ? n : v;
  }
  if (/^0x[\da-f]+$/i.test(v)) return parseInt(v, 16);
  if (/^0o[0-7]+$/i.test(v)) return parseInt(v.slice(2), 8);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)(e[-+]?\d+)?$/i.test(v)) return Number(v);
  if (/^[-+]?\.inf$/i.test(v)) return v.startsWith("-") ? -Infinity : Infinity;
  if (/^\.nan$/i.test(v)) return NaN;
  if (v.startsWith('"')) {
    if (!v.endsWith('"') || v.length < 2) throw new YamlError("chaîne entre guillemets non fermée", lineNo);
    try {
      return JSON.parse(v.replace(/\\'/g, "'").replace(/\t/g, "\\t"));
    } catch {
      throw new YamlError("séquence d'échappement invalide", lineNo);
    }
  }
  if (v.startsWith("'")) {
    if (!v.endsWith("'") || v.length < 2) throw new YamlError("chaîne entre apostrophes non fermée", lineNo);
    return v.slice(1, -1).replace(/''/g, "'");
  }
  if (v.startsWith("[") || v.startsWith("{")) return parseFlow(v, lineNo);
  if (/^[&*!|>%@`]/.test(v)) throw new YamlError(`syntaxe avancée non prise en charge (« ${v[0]} »)`, lineNo);
  return v;
}

function parseFlow(text, lineNo) {
  let i = 0;
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const value = () => {
    ws();
    if (text[i] === "[") {
      i++;
      const arr = [];
      ws();
      if (text[i] === "]") return (i++, arr);
      for (;;) {
        arr.push(value());
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "]") return (i++, arr);
        else throw new YamlError("liste en ligne mal formée", lineNo);
      }
    }
    if (text[i] === "{") {
      i++;
      const obj = {};
      ws();
      if (text[i] === "}") return (i++, obj);
      for (;;) {
        const key = token(":");
        if (text[i] !== ":") throw new YamlError("dictionnaire en ligne mal formé", lineNo);
        i++;
        obj[String(parseScalar(key, lineNo))] = value();
        ws();
        if (text[i] === ",") i++;
        else if (text[i] === "}") return (i++, obj);
        else throw new YamlError("dictionnaire en ligne mal formé", lineNo);
      }
    }
    return parseScalar(token(""), lineNo);
  };
  const token = (extraStop) => {
    ws();
    const start = i;
    if (text[i] === '"' || text[i] === "'") {
      const q = text[i++];
      while (i < text.length && text[i] !== q) i += text[i] === "\\" && q === '"' ? 2 : 1;
      i++;
      return text.slice(start, i);
    }
    while (i < text.length && !",]}".includes(text[i]) && !(extraStop && text[i] === extraStop)) i++;
    return text.slice(start, i).trim();
  };
  const result = value();
  ws();
  if (i < text.length) throw new YamlError("caractères inattendus après la collection", lineNo);
  return result;
}

/** Sépare « clé: valeur » en ignorant les deux-points entre guillemets. */
function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\" && quote === '"') i++;
      else if (c === quote) quote = null;
    } else if ((c === '"' || c === "'") && i === 0) quote = c;
    else if (c === ":" && (i + 1 === text.length || text[i + 1] === " " || text[i + 1] === "\t")) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    } else if (c === "[" || c === "{") return null;
  }
  return null;
}

export function parseYaml(source) {
  const all = String(source)
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  const lines = [];
  for (let n = 0; n < all.length; n++) {
    const raw = all[n];
    const indent = raw.length - raw.trimStart().length;
    if (/^\s*$/.test(raw)) {
      lines.push({ skip: true, blank: true, no: n + 1, raw, indent });
      continue;
    }
    if (/^(---|\.\.\.)\s*(#.*)?$/.test(raw)) {
      if (lines.some((l) => !l.skip) && raw.startsWith("---"))
        throw new YamlError("plusieurs documents ne sont pas pris en charge", n + 1);
      continue;
    }
    const content = stripComment(raw).trimEnd();
    if (!content.trim()) {
      lines.push({ skip: true, no: n + 1, raw, indent });
      continue;
    }
    if (/^\s*\t/.test(raw)) throw new YamlError("les tabulations sont interdites pour l'indentation", n + 1);
    lines.push({ indent, text: content.trim(), no: n + 1, raw });
  }
  let pos = 0;
  const peek = () => {
    while (pos < lines.length && lines[pos].skip) pos++;
    return lines[pos];
  };

  const blockScalar = (header, parentIndent) => {
    const folded = header[0] === ">";
    const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
    const body = [];
    let indent = null;
    for (; pos < lines.length; pos++) {
      const l = lines[pos];
      if (l.blank) {
        body.push("");
        continue;
      }
      if (l.indent <= parentIndent) break;
      if (indent === null) indent = l.indent;
      body.push(l.raw.slice(Math.min(indent, l.indent)));
    }
    let text = folded
      ? body.reduce(
          (acc, line, i) => (i === 0 ? line : acc + (line === "" || body[i - 1] === "" ? "\n" : " ") + line),
          "",
        )
      : body.join("\n");
    if (chomp === "keep") return text + "\n";
    text = text.replace(/\n+$/, "");
    return chomp === "strip" ? text : text + "\n";
  };

  const valueAfter = (rest, indent, line) => {
    if (rest === "") {
      const next = peek();
      if (next && next.indent > indent) return block(next.indent);
      if (next && next.indent === indent && /^-(\s|$)/.test(next.text)) return block(indent);
      return null;
    }
    if (/^[|>][-+]?\d*$/.test(rest)) return blockScalar(rest, indent);
    return parseScalar(rest, line.no);
  };

  const block = (indent) => {
    const first = peek();
    if (!first) return null;
    if (/^-(\s|$)/.test(first.text)) {
      const arr = [];
      for (let l = peek(); l && l.indent === indent && /^-(\s|$)/.test(l.text); l = peek()) {
        const rest = l.text.slice(1).trimStart();
        const offset = l.text.length - rest.length;
        if (rest && (splitKey(rest) || /^-(\s|$)/.test(rest))) {
          // Élément de liste qui ouvre un mapping (« - clé: valeur ») ou une liste imbriquée.
          lines[pos] = { ...l, indent: indent + offset, text: rest };
          arr.push(block(indent + offset));
        } else {
          pos++;
          arr.push(valueAfter(rest, indent, l));
        }
      }
      return arr;
    }
    const obj = {};
    for (let l = peek(); l && l.indent === indent && !/^-(\s|$)/.test(l.text); l = peek()) {
      const kv = splitKey(l.text);
      if (!kv) throw new YamlError(`ligne inattendue « ${l.text} »`, l.no);
      pos++;
      const key = String(parseScalar(kv[0], l.no) ?? "null");
      obj[key] = valueAfter(kv[1], indent, l);
    }
    return obj;
  };

  const first = peek();
  if (!first) return null;
  let result;
  if (first.indent === 0 && !/^-(\s|$)/.test(first.text) && !splitKey(first.text)) {
    pos++;
    result = parseScalar(first.text, first.no);
  } else result = block(first.indent);
  const extra = peek();
  if (extra) throw new YamlError(`indentation incohérente près de « ${extra.text} »`, extra.no);
  return result;
}

const RESERVED =
  /^(null|~|true|false|yes|no|on|off|y|n|[-+]?(\.inf|\.nan)|[-+]?[\d._]+(e[-+]?\d+)?|0x[\da-f]+|0o[0-7]+)$/i;

export function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number")
    return Number.isNaN(value)
      ? ".nan"
      : Number.isFinite(value)
        ? String(value)
        : value > 0
          ? ".inf"
          : "-.inf";
  if (typeof value === "bigint") return String(value);
  const s = String(value);
  const needsQuotes =
    s === "" ||
    RESERVED.test(s) ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /\s$/.test(s) ||
    /: |:$| #|[\u0000-\u001f\u007f\u2028\u2029]/.test(s);
  return needsQuotes ? JSON.stringify(s) : s;
}

const yamlKey = (k) => yamlScalar(String(k));
const isCollection = (v) => v !== null && typeof v === "object";
const isEmpty = (v) => (Array.isArray(v) ? v.length === 0 : Object.keys(v).length === 0);

export function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (!isCollection(value)) return pad + yamlScalar(value);
  if (isEmpty(value)) return pad + (Array.isArray(value) ? "[]" : "{}");
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!isCollection(item) || isEmpty(item)) return `${pad}- ${toYaml(item, 0)}`;
        return `${pad}- ${toYaml(item, indent + 2).slice(indent + 2)}`;
      })
      .join("\n");
  }
  return Object.entries(value)
    .map(([k, v]) => {
      if (!isCollection(v) || isEmpty(v)) return `${pad}${yamlKey(k)}: ${toYaml(v, 0)}`;
      return `${pad}${yamlKey(k)}:\n${toYaml(v, Array.isArray(v) ? indent : indent + 2)}`;
    })
    .join("\n");
}

export const stringifyYaml = (value) => toYaml(value) + "\n";
