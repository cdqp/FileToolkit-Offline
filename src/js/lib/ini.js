function unquote(v) {
  const m = v.match(/^(["'])(.*)\1$/);
  return m ? m[2] : v;
}

export function parseIni(text) {
  const out = {};
  let section = out;
  for (const raw of String(text)
    .replace(/^\ufeff/, "")
    .split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[;#]/.test(line)) continue;
    const header = line.match(/^\[([^\]]+)\]\s*([;#].*)?$/);
    if (header) {
      // Les sections « [a.b] » deviennent des objets imbriqués.
      section = header[1]
        .trim()
        .split(".")
        .reduce((obj, key) => (obj[key.trim()] ??= {}), out);
      continue;
    }
    const i = line.search(/[=:]/);
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    const value = unquote(
      line
        .slice(i + 1)
        .replace(/\s+[;#].*$/, "")
        .trim(),
    );
    section[key] = value;
  }
  return out;
}

const iniValue = (v) => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /^\s|\s$|[;#"\r\n]/.test(s) ? JSON.stringify(s) : s;
};

export function toIni(data) {
  const lines = [];
  const sections = [];
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) sections.push([k, v]);
    else lines.push(`${k} = ${iniValue(v)}`);
  }
  const writeSection = (name, obj) => {
    const nested = [];
    lines.push("", `[${name}]`);
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) nested.push([`${name}.${k}`, v]);
      else lines.push(`${k} = ${iniValue(v)}`);
    }
    nested.forEach(([n, o]) => writeSection(n, o));
  };
  sections.forEach(([n, o]) => writeSection(n, o));
  return lines.join("\n").replace(/^\n/, "") + "\n";
}
