import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as acorn from "acorn";
import {
  minifyCSS,
  minifyCSVText,
  minifyHTML,
  minifyJS,
  minifyJSON,
  minifyMarkdown,
  minifyPlainText,
  minifyXML,
} from "../../src/js/lib/minify.js";

const vendor = (file) => new URL(`../../node_modules/${file}`, import.meta.url);

function tokens(code, sourceType = "script") {
  return [...acorn.tokenizer(code, { ecmaVersion: "latest", sourceType, allowHashBang: true })].map(
    (t) => `${t.type.label}:${t.value instanceof RegExp ? String(t.value) : (t.value ?? "")}`,
  );
}

test("JSON : sans perte, grands entiers et décimales préservés", () => {
  assert.equal(
    minifyJSON('{ "big" : 12345678901234567890, "f": 1.0, "s": "a  b\\" c" }\n'),
    '{"big":12345678901234567890,"f":1.0,"s":"a  b\\" c"}',
  );
  assert.throws(() => minifyJSON("{ a: 1 }"), /JSON invalide/);
});

test("JavaScript : flux de jetons strictement identique sur du code réel", () => {
  for (const file of ["jszip/dist/jszip.js", "pdf-lib/dist/pdf-lib.js", "acorn/dist/acorn.js"]) {
    const source = readFileSync(vendor(file), "utf8");
    const min = minifyJS(source);
    assert.ok(min.length < source.length * 0.8, `${file} devrait rétrécir`);
    assert.deepEqual(tokens(min), tokens(source), file);
  }
});

test("JavaScript : gabarits, expressions régulières, ASI et commentaires de licence", () => {
  const source = `#!/usr/bin/env node
/*! licence conservée */
// commentaire supprimé
const a = \`ligne 1
   \${ { x: 1 }.x /* dans l'interpolation */ } fin\`;
let b = a
/re  gex/g.test(b)
const c = 4 / 2 / 1, d = x => /[/]/.test(x), e = i++ / 2;
return_value: if (a) b = - -c + +d
`;
  const min = minifyJS(source);
  assert.deepEqual(tokens(min), tokens(source));
  assert.match(min, /^#!\/usr\/bin\/env node\n/);
  assert.match(min, /\/\*! licence conservée \*\//);
  assert.doesNotMatch(min, /commentaire supprimé/);
  assert.match(min, /`ligne 1\n {3}\$\{/);
  assert.match(min, /- -c\+ \+d/);
});

test("CSS : commentaires, blancs, chaînes et sélecteurs descendants", () => {
  const css = `/*! garder */ a  >  b , c:hover::after { content : " a ; b " ; color: red ; }
@media screen and (min-width: 100px) { .x :not(.y) { margin: 0 auto !important; } }
/* retirer */ .g { grid-template-areas: "a  b"; width: calc(100% - 2px) }`;
  assert.equal(
    minifyCSS(css),
    '/*! garder */ a>b,c:hover::after{content :" a ; b ";color:red}@media screen and (min-width:100px){.x :not(.y){margin:0 auto !important}}.g{grid-template-areas:"a  b";width:calc(100% - 2px)}',
  );
});

test("HTML : <pre>, <textarea>, attributs et scripts préservés", () => {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <!-- retirer -->
    <!--[if IE]><p>garder</p><![endif]-->
    <style> body { color : red ; } </style>
    <script> const s = "x  y"; // c
    </script>
  </head>
  <body>
    <p>Un   <b>deux</b>  trois</p>
    <pre>
  garder   ça
    </pre>
    <input value="  a  b  "   disabled  >
    <textarea>  x
  y</textarea>
  </body>
</html>`;
  const out = minifyHTML(html);
  assert.doesNotMatch(out, /retirer/);
  assert.match(out, /<!--\[if IE\]>/);
  assert.match(out, /<style>body\{color :red\}<\/style>/);
  assert.match(out, /<script>const s="x  y";<\/script>/);
  assert.match(out, /<p>Un <b>deux<\/b> trois<\/p>/);
  assert.match(out, /<pre>\n {2}garder {3}ça\n {4}<\/pre>/);
  assert.match(out, /<input value=" {2}a {2}b {2}" disabled>/);
  assert.match(out, /<textarea> {2}x\n {2}y<\/textarea>/);
});

test("XML : blancs significatifs conservés (xml:space, contenu mixte, texte SVG)", () => {
  const xml = `<?xml version="1.0"?>
<!-- commentaire -->
<w:document xmlns:w="x">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve"> </w:t></w:r>
      <w:r><w:t> </w:t></w:r>
    </w:p>
    <mixte>Texte <b>gras</b> <i>italique</i></mixte>
  </w:body>
</w:document>`;
  assert.equal(
    minifyXML(xml),
    '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:t> </w:t></w:r></w:p><mixte>Texte <b>gras</b> <i>italique</i></mixte></w:body></w:document>\n',
  );
  assert.match(
    minifyXML('<svg><text><tspan>A</tspan> <tspan>B</tspan></text><rect x = "1" /></svg>'),
    /<tspan>A<\/tspan> <tspan>B<\/tspan>.*<rect x="1"\/>/,
  );
});

test("Markdown, texte et CSV : sauts de ligne forcés, blocs de code et séparateur conservés", () => {
  assert.equal(
    minifyMarkdown("# T  \n\nligne  \nsuite   \n\n\n\n```\ncode   \n\n\n\nx\n```\n  \n"),
    "# T\n\nligne  \nsuite\n\n```\ncode   \n\n\n\nx\n```\n",
  );
  assert.equal(minifyPlainText("a  \r\nb\r\n\r\n\r\n\r\nc  \r\n\r\n"), "a\r\nb\r\n\r\nc\r\n");
  assert.equal(minifyCSVText('"a";"b"\n"1";"x;y"\n'), 'a;b\n1;"x;y"\n');
});
