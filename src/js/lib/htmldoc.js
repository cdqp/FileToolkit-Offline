import { escapeHtml } from "../core/dom.js";

const STYLE = `:root{color-scheme:light dark}body{max-width:52rem;margin:2.5rem auto;padding:0 1.25rem;font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d2327;background:#fff}
h1,h2,h3{line-height:1.25}pre,code{font:0.92em/1.5 ui-monospace,"Cascadia Mono",Consolas,monospace}pre{overflow:auto;padding:1rem;border-radius:6px;background:#f4f6f7;white-space:pre-wrap}
table{border-collapse:collapse;margin:1rem 0;font-size:0.95em}th,td{padding:0.35rem 0.6rem;border:1px solid #c9d1d3;text-align:left;vertical-align:top}th{background:#eef2f3}
blockquote{margin:1rem 0;padding:0.2rem 1rem;border-left:3px solid #00a38c;color:#4b5559}img{max-width:100%}section+section{margin-top:2rem;padding-top:1rem;border-top:1px solid #dde3e5}
@media(prefers-color-scheme:dark){body{color:#e6eceb;background:#111417}pre{background:#1b2025}th{background:#1b2025}th,td{border-color:#2f383d}blockquote{color:#a8b4b3}}`;

/** Document HTML autonome, lisible et imprimable. */
export function htmlDocument(title, bodyHtml) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export function rowsToHtmlTable(rows, { header = true } = {}) {
  if (!rows.length) return "<p><em>Tableau vide</em></p>";
  const width = Math.max(...rows.map((r) => r.length));
  const cells = (r, tag) =>
    Array.from({ length: width }, (_, i) => `<${tag}>${escapeHtml(r[i] ?? "")}</${tag}>`).join("");
  const [first, ...rest] = rows;
  const head = header ? `<thead><tr>${cells(first, "th")}</tr></thead>` : "";
  const body = (header ? rest : rows).map((r) => `<tr>${cells(r, "td")}</tr>`).join("\n");
  return `<table>${head}<tbody>\n${body}\n</tbody></table>`;
}

export const preBlock = (text) => `<pre>${escapeHtml(text)}</pre>`;
