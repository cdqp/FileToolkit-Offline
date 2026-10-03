// Minification sans perte : chaque fonction ne retire que ce qui ne change pas le sens du document.

import { detectDelimiter, parseCSV, toCSV } from "./csv.js";

const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);

/** JSON : seuls les blancs hors chaînes disparaissent (aucune perte de précision numérique). */
export function minifyJSON(text) {
  const src = stripBom(text);
  try {
    JSON.parse(src);
  } catch (e) {
    throw new Error(`JSON invalide : ${e.message}`);
  }
  return src.replace(/"(?:[^"\\]|\\.)*"|[ \t\n\r]+/g, (m) => (m[0] === '"' ? m : ""));
}

/** CSS : commentaires (sauf /*! … *\/), blancs superflus et derniers points-virgules. */
export function minifyCSS(text) {
  const parts = stripBom(text).split(/("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\*[\s\S]*?\*\/)/);
  const segments = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const literal = i % 2 === 1 && !part.startsWith("/*");
    const kept = i % 2 === 1 && part.startsWith("/*!");
    const code = i % 2 === 0 ? part : part.startsWith("/*") && !kept ? " " : null;
    if (code !== null && segments.length && segments.at(-1).code) segments.at(-1).text += code;
    else if (code !== null) segments.push({ code: true, text: code });
    else segments.push({ code: false, text: part, comment: kept && !literal });
  }
  return segments
    .map((s) =>
      s.code
        ? s.text
            .replace(/\s+/g, " ")
            .replace(/\s*([{};,>])\s*/g, "$1")
            .replace(/:\s+/g, ":")
            .replace(/;+}/g, "}")
        : s.text,
    )
    .join("")
    .trim();
}

// ——— JavaScript / TypeScript ———

const REGEX_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);
const REGEX_AFTER = new Set([
  "",
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);
const isIdent = (c) => c !== undefined && (/[\w$\\]/.test(c) || c.charCodeAt(0) > 0x7f);
const isSpace = (c) =>
  c === " " ||
  c === "\t" ||
  c === "\n" ||
  c === "\r" ||
  c === "\f" ||
  c === "\v" ||
  c === "\u00a0" ||
  c === "\ufeff" ||
  c === "\u2028" ||
  c === "\u2029";
const isLineBreak = (c) => c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";

/**
 * Lexeur JavaScript minimal : supprime commentaires et indentation, conserve chaînes,
 * gabarits et expressions régulières à l'identique, et garde chaque saut de ligne
 * significatif pour ne jamais altérer l'insertion automatique de points-virgules.
 */
export function minifyJS(text) {
  const src = stripBom(text);
  const n = src.length;
  const out = [];
  let prev = ""; // dernier caractère émis
  let i = 0;
  let last = ""; // dernier jeton significatif (pour distinguer division et expression régulière)
  let gap = 0; // 0 : rien, 1 : espace, 2 : saut de ligne
  let depth = 0;
  const templates = []; // profondeurs d'accolades des ${…} ouverts

  if (src.startsWith("#!")) {
    const end = src.indexOf("\n");
    out.push(end < 0 ? src : src.slice(0, end));
    prev = "!";
    i = end < 0 ? n : end;
  }

  const emit = (token, next) => {
    if (prev) {
      if (gap === 2) out.push("\n");
      else if (gap === 1) {
        const needs =
          (isIdent(prev) && (isIdent(next) || next === ".")) ||
          ((prev === "+" || prev === "-") && next === prev) ||
          (prev === "/" && next === "/") ||
          (prev === "." && /\d/.test(next));
        if (needs) out.push(" ");
      }
    }
    gap = 0;
    out.push(token);
    prev = token[token.length - 1];
  };

  const readTemplateChunk = () => {
    // i pointe sur « ` » ou sur le « } » qui ferme une interpolation.
    const start = i++;
    while (i < n) {
      const c = src[i];
      if (c === "\\") i += 2;
      else if (c === "`") {
        i++;
        emit(src.slice(start, i), src[start]);
        last = "str";
        return;
      } else if (c === "$" && src[i + 1] === "{") {
        i += 2;
        emit(src.slice(start, i), src[start]);
        templates.push(depth);
        depth++;
        last = "{";
        return;
      } else i++;
    }
    emit(src.slice(start), src[start]);
  };

  while (i < n) {
    const c = src[i];
    if (isSpace(c)) {
      gap = Math.max(gap, isLineBreak(c) ? 2 : 1);
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && !isLineBreak(src[i])) i++;
      gap = Math.max(gap, 1);
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      const comment = src.slice(i, stop);
      i = stop;
      if (comment.startsWith("/*!") || /@license|@preserve/.test(comment)) {
        const saved = last;
        emit(comment, "/");
        gap = 2;
        last = saved;
      } else gap = Math.max(gap, /[\n\r\u2028\u2029]/.test(comment) ? 2 : 1);
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i++;
      while (i < n && src[i] !== c && !isLineBreak(src[i])) i += src[i] === "\\" ? 2 : 1;
      i++;
      emit(src.slice(start, i), c);
      last = "str";
      continue;
    }
    if (c === "`") {
      readTemplateChunk();
      continue;
    }
    if (c === "}" && templates.length && templates.at(-1) === depth - 1) {
      templates.pop();
      depth--;
      readTemplateChunk();
      continue;
    }
    if (c === "/" && (REGEX_AFTER.has(last) || REGEX_KEYWORDS.has(last))) {
      const start = i++;
      let inClass = false;
      while (i < n && !isLineBreak(src[i])) {
        const ch = src[i];
        if (ch === "\\") i += 2;
        else {
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) break;
          i++;
        }
      }
      i++;
      while (i < n && /[a-z]/i.test(src[i])) i++;
      emit(src.slice(start, i), "/");
      last = "regex";
      continue;
    }
    if (isIdent(c)) {
      const start = i;
      while (i < n && isIdent(src[i])) i++;
      emit(src.slice(start, i), c);
      last = /^\d/.test(src[start]) ? "num" : src.slice(start, i);
      continue;
    }
    // Ponctuation
    const glued = gap === 0 && prev === c;
    emit(c, c);
    if (c === "{") depth++;
    else if (c === "}") depth--;
    last = (c === "+" || c === "-") && glued ? c + c : c;
    i++;
  }
  const result = out.join("").trim();
  return result ? result + "\n" : "";
}

// ——— HTML ———

const HTML_TOKEN =
  /<!-{2}[\s\S]*?-{2}>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?[a-zA-Z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;
const JS_TYPES = /^(|text\/javascript|application\/javascript|module|text\/ecmascript)$/i;

/** Normalise les blancs d'une balise sans toucher aux valeurs entre guillemets. */
const tidyTag = (tag) =>
  tag
    .replace(
      /("[^"]*"|'[^']*')|[ \t\n\r\f]*=[ \t\n\r\f]*|[ \t\n\r\f]+/g,
      (m, quoted) => quoted || (m.includes("=") ? "=" : " "),
    )
    .replace(/ >$/, ">");

export function minifyHTML(text) {
  const src = stripBom(text);
  let out = "";
  HTML_TOKEN.lastIndex = 0;
  for (let m; (m = HTML_TOKEN.exec(src));) {
    const token = m[0];
    if (/^<!-{2}/.test(token)) {
      if (/^<!-{2}\[if|<!\[endif\]-{2}>$/.test(token)) out += token;
      continue;
    }
    if (token[0] !== "<" || token === "<") {
      let collapsed = token.replace(/[ \t\n\r\f]+/g, (ws) => (/[\n\r]/.test(ws) ? "\n" : " "));
      // Après un commentaire supprimé, deux blancs consécutifs n'en font plus qu'un.
      if (/[ \n]$/.test(out) && /^[ \n]/.test(collapsed)) collapsed = collapsed.slice(1);
      out += collapsed;
      continue;
    }
    const open = token.match(/^<([a-zA-Z][^\s/>]*)/);
    out += token.startsWith("<!") ? token : tidyTag(token);
    if (!open || token.endsWith("/>")) continue;
    const tag = open[1].toLowerCase();
    if (!["pre", "textarea", "script", "style"].includes(tag)) continue;
    const close = new RegExp(`</${tag}\\s*>`, "ig");
    close.lastIndex = HTML_TOKEN.lastIndex;
    const end = close.exec(src);
    const contentEnd = end ? end.index : src.length;
    let content = src.slice(HTML_TOKEN.lastIndex, contentEnd);
    const type = (token.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || "";
    try {
      if (tag === "style") content = minifyCSS(content);
      else if (tag === "script" && JS_TYPES.test(type)) content = minifyJS(content).trimEnd();
      else if (tag === "script" && /json/i.test(type)) content = minifyJSON(content);
    } catch {
      // Contenu non reconnu : conservé tel quel.
    }
    out += content + (end ? `</${tag}>` : "");
    HTML_TOKEN.lastIndex = end ? close.lastIndex : src.length;
  }
  return out.trim() + "\n";
}

// ——— XML / SVG ———

const XML_TOKEN =
  /<\?[\s\S]*?\?>|<!-{2}[\s\S]*?-{2}>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<\/?[^\s/>!?]+(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</gi;
const SVG_TEXT = new Set(["text", "tspan", "textPath", "title", "desc"]);

/**
 * XML : supprime commentaires et indentation entre éléments, mais conserve tout blanc
 * porteur de sens (contenu mixte, xml:space="preserve", éléments texte SVG).
 */
export function minifyXML(text) {
  const src = stripBom(text);
  const tokens = src.match(XML_TOKEN) || [];
  if (tokens.join("") !== src) throw new Error("XML non pris en charge par le minificateur.");
  const stack = [{ preserve: false, mixed: false, name: "" }];
  const items = [];
  for (const token of tokens) {
    if (/^<!-{2}/.test(token)) continue;
    if (token.startsWith("</")) {
      items.push({ kind: "close", token: token.replace(/\s+>$/, ">") });
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith("<?") || token.startsWith("<!")) {
      if (token.startsWith("<![CDATA[")) stack.at(-1).mixed = true;
      items.push({ kind: "other", token });
      continue;
    }
    if (token.startsWith("<")) {
      const name = token.match(/^<([^\s/>]+)/)[1];
      const tidy = tidyTag(token).replace(/\s*(\/?>)$/, "$1");
      const selfClosing = tidy.endsWith("/>");
      items.push({ kind: selfClosing ? "empty" : "open", token: tidy });
      if (!selfClosing) {
        const space = token.match(/\bxml:space\s*=\s*["'](\w+)["']/);
        const parent = stack.at(-1);
        stack.push({
          preserve: space ? space[1] === "preserve" : parent.preserve,
          mixed: false,
          name: name.replace(/^.*:/, ""),
        });
      }
      continue;
    }
    const scope = stack.at(-1);
    if (/\S/.test(token)) scope.mixed = true;
    items.push({ kind: "text", token, scope });
  }
  let out = "";
  items.forEach((item, k) => {
    if (item.kind === "text" && !/\S/.test(item.token)) {
      const prev = items[k - 1];
      const next = items[k + 1];
      const wholeContent = prev?.kind === "open" && next?.kind === "close";
      const significant =
        item.scope.preserve || item.scope.mixed || SVG_TEXT.has(item.scope.name) || wholeContent;
      if (!significant) return;
    }
    out += item.token;
  });
  return out.trim() + "\n";
}

// ——— Texte ———

export function minifyMarkdown(text) {
  const lines = stripBom(text).split(/\r?\n/);
  const out = [];
  let fence = null;
  let blank = 0;
  lines.forEach((line, k) => {
    const marker = line.match(/^\s{0,3}(```+|~~~+)/);
    if (fence) {
      out.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return;
    }
    if (marker) {
      fence = marker[1];
      blank = 0;
      out.push(line.trimEnd());
      return;
    }
    if (!line.trim()) {
      if (++blank <= 1) out.push("");
      return;
    }
    blank = 0;
    // Deux espaces finaux = saut de ligne forcé en Markdown : on les conserve.
    const hardBreak = / {2,}$/.test(line) && (lines[k + 1] ?? "").trim() !== "";
    out.push(line.trimEnd() + (hardBreak ? "  " : ""));
  });
  while (out.length && out.at(-1) === "") out.pop();
  return out.join("\n") + "\n";
}

export function minifyPlainText(text) {
  return stripBom(text)
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/[ \t]+$/, "")
    .replace(/(\r?\n){3,}/g, (m) => (m.includes("\r") ? "\r\n\r\n" : "\n\n"))
    .replace(/(\r?\n)+$/, (m) => (m.includes("\r") ? "\r\n" : "\n"));
}

export function minifyCSVText(text) {
  const src = stripBom(text);
  const delimiter = detectDelimiter(src);
  return toCSV(parseCSV(src, delimiter), delimiter, src.includes("\r\n") ? "\r\n" : "\n");
}

export const MINIFIABLE = {
  json: minifyJSON,
  css: minifyCSS,
  js: minifyJS,
  ts: minifyJS,
  html: minifyHTML,
  xml: minifyXML,
  svg: minifyXML,
  md: minifyMarkdown,
  markdown: minifyMarkdown,
  csv: minifyCSVText,
  tsv: minifyCSVText,
  txt: minifyPlainText,
  log: minifyPlainText,
  srt: minifyPlainText,
  vtt: minifyPlainText,
  ini: minifyPlainText,
  cfg: minifyPlainText,
};

export function minify(text, format) {
  const fn = MINIFIABLE[format];
  if (!fn) throw new Error(`Aucun minificateur sûr pour le format ${format.toUpperCase()}.`);
  return fn(text);
}
