// Extraction du texte d'un document RTF (paragraphes, tabulations, caractères accentués et Unicode).

const SKIP_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "header",
  "footer",
  "headerl",
  "headerr",
  "footerl",
  "footerr",
  "listtable",
  "listoverridetable",
  "rsidtbl",
  "generator",
  "themedata",
  "colorschememapping",
  "datastore",
  "latentstyles",
  "xmlnstbl",
  "filetbl",
  "revtbl",
  "pgdsctbl",
  "fldinst",
  "bkmkstart",
  "bkmkend",
]);

const CP1252 = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

export function rtfToText(rtf) {
  if (!/^\s*\{\\rtf/.test(rtf)) throw new Error("Document RTF invalide.");
  const stack = [];
  let skip = false;
  let ucSkip = 1;
  let pendingSkip = 0;
  let out = "";
  const emit = (s) => {
    if (pendingSkip > 0) {
      pendingSkip--;
      return;
    }
    if (!skip) out += s;
  };
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "{") {
      stack.push({ skip, ucSkip });
      continue;
    }
    if (c === "}") {
      ({ skip, ucSkip } = stack.pop() ?? { skip: false, ucSkip: 1 });
      continue;
    }
    if (c === "\r" || c === "\n") continue;
    if (c !== "\\") {
      emit(c);
      continue;
    }
    const next = rtf[i + 1];
    if (next === "\\" || next === "{" || next === "}") {
      emit(next);
      i++;
      continue;
    }
    if (next === "'") {
      const code = parseInt(rtf.substr(i + 2, 2), 16);
      emit(CP1252[code] ?? String.fromCharCode(code));
      i += 3;
      continue;
    }
    if (next === "*") {
      skip = true;
      i++;
      continue;
    }
    if (next === "~") (emit("\u00a0"), i++);
    else if (next === "-" || next === "_") (emit(next === "_" ? "-" : ""), i++);
    else if (next === "\n" || next === "\r") (emit("\n"), i++);
    else {
      const m = rtf.slice(i + 1, i + 40).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (!m) continue;
      i += m[0].length;
      const [, word, arg] = m;
      pendingSkip = 0;
      if (SKIP_DESTINATIONS.has(word)) skip = true;
      else if (word === "par" || word === "line" || word === "row") emit("\n");
      else if (word === "tab" || word === "cell") emit("\t");
      else if (word === "uc") ucSkip = Number(arg ?? 1);
      else if (word === "u") {
        let code = Number(arg);
        if (code < 0) code += 65536;
        emit(String.fromCharCode(code));
        pendingSkip = ucSkip;
      } else if (word === "emdash") emit("—");
      else if (word === "endash") emit("–");
      else if (word === "bullet") emit("•");
      else if (word === "lquote") emit("‘");
      else if (word === "rquote") emit("’");
      else if (word === "ldblquote") emit("“");
      else if (word === "rdblquote") emit("”");
    }
  }
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
