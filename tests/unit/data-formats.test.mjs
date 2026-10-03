import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectDelimiter,
  objectsToRows,
  parseCSV,
  rowsToMarkdown,
  rowsToObjects,
  toCSV,
  uniqueHeaders,
} from "../../src/js/lib/csv.js";
import { parseYaml, stringifyYaml } from "../../src/js/lib/yaml.js";
import { parseIni, toIni } from "../../src/js/lib/ini.js";
import { objectToXml, xmlName } from "../../src/js/lib/xmljson.js";
import { srtToVtt, vttToSrt } from "../../src/js/lib/subtitles.js";
import { rtfToText } from "../../src/js/lib/rtf.js";
import { markdownToHtml } from "../../src/js/lib/markdown.js";

test("CSV : détection du séparateur, y compris le point-virgule des exports Excel français", () => {
  assert.equal(detectDelimiter("a,b,c\n1,2,3\n"), ",");
  assert.equal(detectDelimiter("nom;âge;ville\nDupont;42;Paris\n"), ";");
  assert.equal(detectDelimiter("a\tb\n1\t2\n"), "\t");
  assert.equal(detectDelimiter('"x;y",b\n"1;2",3\n'), ",");
});

test("CSV : guillemets, retours à la ligne, BOM et fins de ligne mixtes", () => {
  const rows = parseCSV('\uFEFFa,"b ""c""",d\r\n1,"multi\nligne",3\r2,,\n');
  assert.deepEqual(rows, [
    ["a", 'b "c"', "d"],
    ["1", "multi\nligne", "3"],
    ["2", "", ""],
  ]);
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
  assert.equal(toCSV([["x;y", "z"]], ";"), '"x;y";z\r\n');
});

test("CSV : en-têtes uniques et aplatissement des objets imbriqués", () => {
  assert.deepEqual(uniqueHeaders(["a", "", "a"]), ["a", "colonne_2", "a_2"]);
  assert.deepEqual(
    rowsToObjects([
      ["a", "a"],
      ["1", "2"],
    ]),
    [{ a: "1", a_2: "2" }],
  );
  assert.deepEqual(objectsToRows([{ a: 1, b: { c: 2 } }, { d: [1, 2] }]), [
    ["a", "b.c", "d"],
    [1, 2, ""],
    ["", "", [1, 2]],
  ]);
  assert.match(rowsToMarkdown([["a|b"], ["x"]]), /\| a\\\|b \|/);
});

test("YAML : analyse d'un document réaliste", () => {
  const doc = parseYaml(`# config
name: Démo
port: 8080
ratio: 1.5
debug: false
nothing: ~
tags: [a, 'b c']
meta: {x: 1}
list:
  - un
  - deux: 2
    trois: 3
same:
- a
text: |
  ligne 1
  # pas un commentaire
folded: >-
  a
  b
url: http://x.y/z#ancre
`);
  assert.deepEqual(doc, {
    name: "Démo",
    port: 8080,
    ratio: 1.5,
    debug: false,
    nothing: null,
    tags: ["a", "b c"],
    meta: { x: 1 },
    list: ["un", { deux: 2, trois: 3 }],
    same: ["a"],
    text: "ligne 1\n# pas un commentaire\n",
    folded: "a b",
    url: "http://x.y/z#ancre",
  });
});

test("YAML : aller-retour exact, y compris les chaînes ambiguës", () => {
  const value = {
    "": 1,
    yes: "no",
    list: ["", " x", "null", "1.0", "a: b", "#tag", "-", "multi\nligne", {}, []],
    deep: [[1, [2]], { a: [{ b: null }] }],
  };
  assert.deepEqual(parseYaml(stringifyYaml(value)), value);
});

test("YAML : erreurs localisées", () => {
  assert.throws(() => parseYaml("a: [1, 2"), /ligne 1/);
  assert.throws(() => parseYaml("a:\n  b: 1\n c: 2"), /ligne 3/);
  assert.throws(() => parseYaml("a: &ancre 1"), /non prise en charge/);
});

test("INI : sections imbriquées, commentaires, valeurs entre guillemets", () => {
  const value = parseIni('; commentaire\nnom = x ; fin\n[db]\nhote="a b"\n[db.options]\ndelai: 30\n');
  assert.deepEqual(value, { nom: "x", db: { hote: "a b", options: { delai: "30" } } });
  assert.deepEqual(parseIni(toIni(value)), value);
});

test("XML : une seule racine et des noms d'éléments valides", () => {
  assert.equal(xmlName("1er champ"), "_1er_champ");
  assert.equal(xmlName("xmlns"), "_xmlns");
  const xml = objectToXml([{ a: 1 }, { a: "<2>" }]);
  assert.match(xml, /^<\?xml[^>]*>\n<root>/);
  assert.equal((xml.match(/<item>/g) || []).length, 2);
  assert.match(xml, /&lt;2&gt;/);
  assert.match(objectToXml({ doc: { "@": { id: "7" }, titre: "T" } }), /<doc id="7">/);
  assert.doesNotMatch(objectToXml({ a: "x\u0001y" }), /\u0001/);
});

test("Sous-titres : SRT ↔ WebVTT", () => {
  const srt = "1\n00:00:01,000 --> 00:00:02,500\nBonjour\n\n2\n00:00:03,000 --> 00:00:04,000\nMonde\n";
  const vtt = srtToVtt(srt);
  assert.match(vtt, /^WEBVTT\n\n00:00:01\.000 --> 00:00:02\.500\nBonjour/);
  assert.equal(vttToSrt(vtt), srt);
  assert.equal(
    vttToSrt("WEBVTT\n\nNOTE x\n\n00:01.000 --> 00:02.000 align:start\n<v Bob>Salut</v>\n"),
    "1\n00:00:01,000 --> 00:00:02,000\nSalut\n",
  );
});

test("RTF : texte, accents CP1252, Unicode et destinations ignorées", () => {
  const rtf =
    "{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator X;}Bonjour \\'e9t\\'e9 \\u8364?\\par Ligne\\tab 2 {\\b gras}\\par}";
  assert.equal(rtfToText(rtf), "Bonjour été €\nLigne\t2 gras");
  assert.throws(() => rtfToText("pas du rtf"), /RTF invalide/);
});

test("Markdown : rendu prudent (HTML échappé, liens dangereux neutralisés)", () => {
  const html = markdownToHtml(
    "# Titre\n\n**gras** [ok](https://x.fr) [ko](javascript:alert(1))\n\n- a\n- [x] b\n\n| A | B |\n|:--|--:|\n| 1 | 2 |\n\n<script>alert(1)</script>",
  );
  assert.match(html, /<h1>Titre<\/h1>/);
  assert.match(html, /<strong>gras<\/strong>/);
  assert.match(html, /href="https:\/\/x\.fr"/);
  assert.match(html, /href="#">ko/);
  assert.match(html, /<input type="checkbox" disabled checked>/);
  assert.match(html, /<th style="text-align:left">A<\/th>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
