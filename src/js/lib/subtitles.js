// Conversion de sous-titres SubRip (.srt) ↔ WebVTT (.vtt).

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;
const VTT_TIME = /(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{1,3})/g;

const pad = (n, l = 2) => String(n).padStart(l, "0");

export function srtToVtt(text) {
  const blocks = String(text)
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n{2,}/);
  const cues = blocks.map((block) => {
    const lines = block.split("\n");
    if (/^\d+$/.test(lines[0]?.trim()) && lines[1]?.includes("-->")) lines.shift();
    if (!lines[0]?.includes("-->")) throw new Error("Fichier SRT invalide : ligne de minutage introuvable.");
    lines[0] = lines[0].replace(SRT_TIME, (_, h, m, s, ms) => `${pad(h)}:${m}:${s}.${ms.padEnd(3, "0")}`);
    return lines.join("\n");
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export function vttToSrt(text) {
  const src = String(text)
    .replace(/^\ufeff/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!src.startsWith("WEBVTT")) throw new Error("Fichier WebVTT invalide : en-tête « WEBVTT » absent.");
  const cues = [];
  for (const block of src.split(/\n{2,}/).slice(1)) {
    const lines = block.split("\n");
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const time = lines[timing]
      .replace(/\s+(align|line|position|size|vertical|region):\S+/g, "")
      .replace(VTT_TIME, (_, h, m, s, ms) => `${pad(h || 0)}:${m}:${s},${ms.padEnd(3, "0")}`);
    const body = lines
      .slice(timing + 1)
      .map((l) => l.replace(/<\/?(c|v|lang|ruby|rt)(\.[^>\s]*)?(\s[^>]*)?>/g, ""));
    cues.push(`${cues.length + 1}\n${time.trim()}\n${body.join("\n")}`);
  }
  if (!cues.length) throw new Error("Aucun sous-titre trouvé dans ce fichier WebVTT.");
  return cues.join("\n\n") + "\n";
}
