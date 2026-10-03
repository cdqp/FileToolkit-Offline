const CANDIDATES = [",", ";", "\t", "|"];

/** Devine le séparateur (virgule, point-virgule des exports Excel français, tabulation, barre verticale). */
export function detectDelimiter(text) {
  const sample = text.slice(0, 64 * 1024);
  let best = ",";
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const counts = [];
    let count = 0;
    let quoted = false;
    for (let i = 0; i < sample.length && counts.length < 20; i++) {
      const c = sample[i];
      if (c === '"') quoted = !quoted;
      else if (!quoted && c === d) count++;
      else if (!quoted && c === "\n") {
        counts.push(count);
        count = 0;
      }
    }
    if (count) counts.push(count);
    const lines = counts.filter((n) => n > 0);
    if (!lines.length) continue;
    const consistent = lines.filter((n) => n === lines[0]).length / counts.length;
    const score = consistent * lines[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function parseCSV(text, delimiter = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function csvCell(value, delimiter = ",") {
  const s = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, delimiter = ",", eol = "\r\n") {
  return (
    rows.map((r) => r.map((c) => csvCell(c, delimiter)).join(delimiter)).join(eol) + (rows.length ? eol : "")
  );
}

/** En-têtes utilisables comme clés : vides et doublons sont renommés. */
export function uniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((h, i) => {
    let key = String(h ?? "").trim() || `colonne_${i + 1}`;
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n) key = `${key}_${n + 1}`;
    return key;
  });
}

export function rowsToObjects(rows) {
  if (!rows.length) return [];
  const keys = uniqueHeaders(rows[0]);
  return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ""])));
}

const isPlainObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

/** Aplatit les objets imbriqués en colonnes « parent.enfant ». */
function flatten(value, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && Object.keys(v).length) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export function objectsToRows(data) {
  const list = Array.isArray(data)
    ? data
    : isPlainObject(data) && Object.values(data).every(Array.isArray) && Object.keys(data).length === 1
      ? Object.values(data)[0]
      : [data];
  const flat = list.map((x) => (isPlainObject(x) ? flatten(x) : { valeur: x }));
  const keys = [...new Set(flat.flatMap(Object.keys))];
  return [keys, ...flat.map((x) => keys.map((k) => (k in x ? x[k] : "")))];
}

export function rowsToMarkdown(rows) {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const cell = (c) =>
    String(c ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br>");
  const line = (r) => `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`;
  return (
    [line(rows[0]), `| ${Array(width).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n") +
    "\n"
  );
}
