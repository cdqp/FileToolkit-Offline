import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "../../src/js/core/bytes.js";
import { baseName, sanitizeFileName, stemName, uniqueNamer } from "../../src/js/core/files.js";
import { sniff } from "../../src/js/core/formats.js";
import { cleanEntryName, tarRead, tarWrite } from "../../src/js/lib/tar.js";
import { rarReadStored, rarWrite } from "../../src/js/lib/rar.js";
import { gunzip, gzip } from "../../src/js/lib/gzip.js";
import { encodeWav, nativeSampleRate } from "../../src/js/lib/wav.js";
import { fontInfo, fontTargets, sfntToWoff, woffToSfnt } from "../../src/js/lib/fonts.js";
import { parsePageRanges } from "../../src/js/tools/split.js";
import { mergeTargets, volumeSet } from "../../src/js/tools/merge.js";
import { isAnimated } from "../../src/js/tools/optimize.js";

const te = new TextEncoder();
const bytes = (...values) => new Uint8Array(values);
const hasCommand = (cmd) => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
};

test("Signatures : détection par contenu plutôt que par extension", () => {
  assert.deepEqual(sniff(te.encode("%PDF-1.7"), "x.bin").slice(0, 1), ["pdf"]);
  assert.equal(sniff(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "a.jpg")[0], "png");
  assert.equal(sniff(bytes(0x50, 0x4b, 0x03, 0x04), "rapport.docx")[0], "docx");
  assert.equal(sniff(bytes(0x50, 0x4b, 0x03, 0x04), "notes.txt")[0], "zip");
  assert.equal(sniff(bytes(0x1f, 0x8b, 8), "a.tgz")[0], "tgz");
  assert.equal(sniff(te.encode("RIFF\0\0\0\0WEBPVP8 "), "x")[0], "webp");
  // « .ts » : TypeScript sauf octet de synchronisation MPEG-TS.
  assert.deepEqual(sniff(te.encode("const a: number = 1;"), "code.ts"), ["ts", "Code TypeScript", "text"]);
  const ts = new Uint8Array(400);
  ts[0] = ts[188] = 0x47;
  assert.equal(sniff(ts, "video.ts")[2], "video");
});

test("Noms de fichiers : extension, archives composées, unicité, caractères interdits", () => {
  assert.equal(baseName("archive.tar.gz"), "archive.tar");
  assert.equal(stemName("archive.tar.gz"), "archive");
  assert.equal(baseName(".bashrc"), ".bashrc");
  const unique = uniqueNamer();
  assert.deepEqual(["a.txt", "A.txt", "a.txt", "b"].map(unique), ["a.txt", "A-2.txt", "a-3.txt", "b"]);
  assert.equal(sanitizeFileName('con<>:"/\\|?*.txt '), "con_.txt");
  assert.equal(cleanEntryName("../../etc/./passwd"), "etc/passwd");
});

test("CRC-32 conforme à la valeur de référence", () => {
  assert.equal(crc32(te.encode("123456789")), 0xcbf43926);
});

const entries = [
  { name: "a.txt", data: te.encode("bonjour") },
  { name: `dossier/${"très-long-nom-".repeat(10)}.txt`, data: te.encode("long") },
  { name: "../evil/b.bin", data: Uint8Array.from({ length: 1500 }, (_, i) => i % 251) },
  { name: "vide.txt", data: new Uint8Array(0) },
];

test("TAR : écriture PAX (noms longs et accentués) relue à l'identique", async () => {
  const tar = new Uint8Array(await tarWrite(entries).arrayBuffer());
  const back = tarRead(tar);
  assert.deepEqual(
    back.map((e) => [e.name, e.data.length]),
    entries.map((e) => [cleanEntryName(e.name), e.data.length]),
  );
  assert.deepEqual(back[2].data, entries[2].data);
  if (hasCommand("tar")) {
    const dir = mkdtempSync(path.join(tmpdir(), "cdqp-"));
    writeFileSync(path.join(dir, "t.tar"), tar);
    // Selon la locale, tar affiche les octets UTF-8 tels quels ou échappés en octal (\303\250) :
    // la sortie est donc lue en octets, les échappements remplacés, puis le tout décodé en UTF-8.
    const raw = execFileSync("tar", ["-tf", path.join(dir, "t.tar")]).toString("latin1");
    const listing = Buffer.from(
      raw.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))),
      "latin1",
    ).toString("utf8");
    const decoded = listing.split("\n");
    assert.ok(decoded.includes(cleanEntryName(entries[1].name)), listing);
  }
});

test("TAR : lecture d'une archive GNU produite par le système (dossiers ignorés)", (t) => {
  if (!hasCommand("tar")) return t.skip("tar indisponible");
  const dir = mkdtempSync(path.join(tmpdir(), "cdqp-"));
  const deep = path.join(dir, "src", "x".repeat(120));
  execFileSync("mkdir", ["-p", deep]);
  writeFileSync(path.join(deep, "f.txt"), "hi\n");
  execFileSync("tar", ["--format=gnu", "-cf", path.join(dir, "g.tar"), "-C", dir, "src"]);
  const files = tarRead(new Uint8Array(execFileSync("cat", [path.join(dir, "g.tar")])));
  assert.equal(files.length, 1);
  assert.equal(files[0].name, `src/${"x".repeat(120)}/f.txt`);
});

test("RAR 5 stocké : aller-retour et CRC", async () => {
  const rar = new Uint8Array(await rarWrite(entries).arrayBuffer());
  assert.deepEqual([...rar.subarray(0, 8)], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
  const back = rarReadStored(rar);
  assert.deepEqual(
    back.map((e) => e.name),
    entries.map((e) => cleanEntryName(e.name)),
  );
  assert.deepEqual(back[2].data, entries[2].data);
  assert.throws(() => rarReadStored(bytes(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00)), /RAR 4/);
  const corrupt = rar.slice();
  corrupt[14] ^= 0xff;
  assert.throws(() => rarReadStored(corrupt), /endommagée|invalide/);
});

test("gzip : nom d'origine conservé (FNAME) et données intactes", async () => {
  const data = te.encode("données ".repeat(500));
  const gz = await gzip(data, "données.txt");
  assert.ok(gz.length < data.length / 10);
  const back = await gunzip(gz);
  assert.equal(back.name, "données.txt");
  assert.deepEqual(back.data, data);
  if (hasCommand("gzip")) {
    const dir = mkdtempSync(path.join(tmpdir(), "cdqp-"));
    writeFileSync(path.join(dir, "t.gz"), gz);
    assert.equal(execFileSync("gzip", ["-dc", path.join(dir, "t.gz")]).length, data.length);
  }
});

test("WAV : en-tête correct et fréquence native retrouvée", async () => {
  const left = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10));
  const wav = new Uint8Array(await encodeWav([left, left], 22050).arrayBuffer());
  const view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 22050);
  assert.equal(view.getUint32(40, true), 1000 * 2 * 2);
  assert.equal(nativeSampleRate(wav), 22050);
  const eightBit = new Uint8Array(await encodeWav([left], 8000, 8).arrayBuffer());
  assert.equal(eightBit.length, 44 + 1000);
});

function syntheticFont(flavor = 0x00010000) {
  const tables = [
    ["glyf", Uint8Array.from({ length: 400 }, (_, i) => i % 7)],
    ["head", Uint8Array.from({ length: 54 }, (_, i) => i)],
  ];
  const out = new Uint8Array(
    12 + tables.length * 16 + tables.reduce((n, [, d]) => n + ((d.length + 3) & ~3), 0),
  );
  const v = new DataView(out.buffer);
  v.setUint32(0, flavor);
  v.setUint16(4, tables.length);
  let offset = 12 + tables.length * 16;
  tables.forEach(([tag, data], i) => {
    const r = 12 + i * 16;
    out.set(te.encode(tag), r);
    v.setUint32(r + 4, crc32(data));
    v.setUint32(r + 8, offset);
    v.setUint32(r + 12, data.length);
    out.set(data, offset);
    offset += (data.length + 3) & ~3;
  });
  return out;
}

test("Polices : TTF → WOFF → TTF sans altération des tables", async () => {
  const ttf = syntheticFont();
  assert.deepEqual(fontTargets(fontInfo(ttf)), ["ttf", "otf", "woff", "css"]);
  assert.deepEqual(fontTargets(fontInfo(syntheticFont(0x4f54544f))), ["otf", "woff", "css"]);
  const woff = await sfntToWoff(new File([ttf], "police.ttf"));
  assert.equal(woff.name, "police.woff");
  const info = fontInfo(new Uint8Array(await woff.arrayBuffer()));
  assert.equal(info.container, "woff");
  assert.deepEqual(info.tags, ["glyf", "head"]);
  const back = new Uint8Array(await (await woffToSfnt(woff)).arrayBuffer());
  assert.deepEqual(back.subarray(12 + 32), ttf.subarray(12 + 32));
});

test("Découpe PDF : analyse des plages de pages", () => {
  assert.deepEqual(parsePageRanges("1-3, 5, 8-", 9), [[0, 1, 2], [4], [7, 8]]);
  assert.deepEqual(parsePageRanges("-2; 4", 5), [[0, 1], [3]]);
  assert.throws(() => parsePageRanges("12", 10), /n'existe pas/);
  assert.throws(() => parsePageRanges("3-1", 10), /invalide/);
  assert.throws(() => parsePageRanges("abc", 10), /invalide/);
});

test("Fusion : cibles proposées selon les fichiers", () => {
  const info = (format, group) => ({ format, group });
  const files = (...names) => names.map((name) => ({ name }));
  assert.deepEqual(mergeTargets(files("a.pdf", "b.jpg"), [info("pdf", "document"), info("jpg", "image")]), [
    "pdf",
    "zip",
    "tgz",
    "rar",
  ]);
  assert.deepEqual(mergeTargets(files("a.png", "b.jpg"), [info("png", "image"), info("jpg", "image")]), [
    "pdf",
    "png",
    "zip",
    "tgz",
    "rar",
  ]);
  assert.deepEqual(mergeTargets(files("a.mp4", "b.exe"), [info("mp4", "video"), info("exe", "package")]), [
    "zip",
    "tgz",
    "rar",
  ]);
  assert.deepEqual(volumeSet(files("film.mkv.part002", "film.mkv.part001")), {
    name: "film.mkv",
    contiguous: true,
    missingFirst: false,
  });
  assert.equal(volumeSet(files("a.part001", "b.part002")), null);
  assert.equal(volumeSet(files("a.part001", "a.part003")).contiguous, false);
});

test("Images animées détectées (elles ne doivent pas être réencodées)", () => {
  const gce = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0];
  assert.equal(isAnimated(bytes(...te.encode("GIF89a"), ...gce, ...gce), "gif"), true);
  assert.equal(isAnimated(bytes(...te.encode("GIF89a"), ...gce), "gif"), false);
  const png = (type) =>
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, ...te.encode(type), 0, 0, 0, 0, 0);
  assert.equal(isAnimated(png("acTL"), "png"), true);
  assert.equal(isAnimated(png("IDAT"), "png"), false);
});
