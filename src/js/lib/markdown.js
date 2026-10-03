import { escapeHtml } from "../core/dom.js";

// Rendu Markdown (CommonMark courant + tableaux GFM) volontairement prudent :
// tout le HTML source est échappé et seuls les liens http(s), mailto et relatifs sont conservés.

const safeUrl = (url) => {
  const u = url.trim().replace(/^<|>$/g, "");
  return /^(https?:|mailto:|#|\.{0,2}\/|[\w.-]+(\/|$|\.\w+))/i.test(u) &&
    !/^\s*(javascript|data|vbscript):/i.test(u)
    ? u
    : "#";
};

export function inlineMarkdown(text) {
  const codes = [];
  let s = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, __, code) => {
    codes.push(`<code>${escapeHtml(code.trim())}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s
    .replace(
      /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
      (_, alt, url, title) =>
        `<img src="${escapeHtml(safeUrl(url))}" alt="${alt}"${title ? ` title="${title}"` : ""}>`,
    )
    .replace(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
      (_, label, url, title) =>
        `<a href="${escapeHtml(safeUrl(url))}"${title ? ` title="${title}"` : ""}>${label}</a>`,
    )
    .replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url) => `<a href="${url}">${url}</a>`)
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, "<strong>$2</strong>")
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/ {2,}\n|\\\n/g, "<br>\n");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[+i]);
}

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

export function markdownToHtml(source) {
  const lines = String(source)
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .split("\n");
  const out = [];
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  const startsBlock = (l) =>
    /^(#{1,6}\s|```|~~~|>|\s*([-*+]|\d+[.)])\s|\s*(\*\s*){3,}$|\s*(-\s*){3,}$|\s*(_\s*){3,}$)/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = line.match(/^(\s*)(```+|~~~+)\s*([\w+#.-]*)/);
    if (fence) {
      const close = fence[2];
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(close); i++) body.push(lines[i]);
      i++;
      const lang = fence[3] ? ` class="language-${escapeHtml(fence[3])}"` : "";
      out.push(`<pre><code${lang}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      out.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
      i++;
      continue;
    }
    if (/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (/^\s{4,}\S/.test(line)) {
      const body = [];
      while (
        i < lines.length &&
        (/^\s{4,}/.test(lines[i]) || (isBlank(lines[i]) && /^\s{4,}\S/.test(lines[i + 1] || "")))
      )
        body.push(lines[i++].slice(4));
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${markdownToHtml(body.join("\n"))}</blockquote>`);
      continue;
    }
    const list = line.match(/^(\s*)([-*+]|\d+[.)])\s+/);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const baseIndent = list[1].length;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m && m[1].length === baseIndent && /\d/.test(m[2]) === ordered) {
          items.push([m[3]]);
          i++;
        } else if (
          items.length &&
          !isBlank(lines[i]) &&
          (/^\s/.test(lines[i]) || !startsBlock(lines[i])) &&
          (m ? m[1].length > baseIndent : true)
        ) {
          items
            .at(-1)
            .push(lines[i].slice(Math.min(baseIndent + 2, lines[i].length - lines[i].trimStart().length)));
          i++;
        } else if (
          isBlank(lines[i]) &&
          i + 1 < lines.length &&
          /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1]) &&
          lines[i + 1].match(/^\s*/)[0].length >= baseIndent
        ) {
          i++;
        } else break;
      }
      const start = ordered && parseInt(list[2], 10) !== 1 ? ` start="${parseInt(list[2], 10)}"` : "";
      const tag = ordered ? "ol" : "ul";
      const renderItem = (parts) => {
        const [first, ...rest] = parts;
        const task = first.match(/^\[([ xX])\]\s+(.*)$/);
        const head = task
          ? `<input type="checkbox" disabled${task[1] !== " " ? " checked" : ""}> ${inlineMarkdown(task[2])}`
          : inlineMarkdown(first);
        return `<li>${head}${rest.length ? markdownToHtml(rest.join("\n")) : ""}</li>`;
      };
      out.push(`<${tag}${start}>${items.map(renderItem).join("")}</${tag}>`);
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] || "")) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":")
          ? "center"
          : c.endsWith(":")
            ? "right"
            : c.startsWith(":")
              ? "left"
              : "",
      );
      const cell = (tag, c, k) =>
        `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ""}>${inlineMarkdown(c ?? "")}</${tag}>`;
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && !isBlank(lines[i]); i++)
        rows.push(splitRow(lines[i]));
      out.push(
        `<table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_, k) => cell("td", r[k], k)).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !(para.length && startsBlock(lines[i]))) {
      if (para.length && /^\s*(=+|-+)\s*$/.test(lines[i])) {
        const level = lines[i].trim()[0] === "=" ? 1 : 2;
        out.push(`<h${level}>${inlineMarkdown(para.join("\n"))}</h${level}>`);
        para.length = 0;
        i++;
        break;
      }
      para.push(lines[i++]);
    }
    if (para.length) out.push(`<p>${inlineMarkdown(para.join("\n").trim())}</p>`);
  }
  return out.join("\n");
}
