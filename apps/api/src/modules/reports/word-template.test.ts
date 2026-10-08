import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY, calculateGraphieResults } from "@cetem-qc/domain";
import { buildReportDocument } from "@cetem-qc/i18n/report-document";
import { readZip } from "../../test-support/zip-reader.js";
import { createWordTemplateGenerator, escapeXml } from "./adapters/word-template.js";

// Story 11.1 (W1): the zero-dependency .docx writer. Read back here with an independent ZIP reader.

/** Minimal well-formedness check: balanced, properly nested tags and no stray markup characters in text. */
function assertWellFormed(xml: string, name: string) {
  const body = xml.replace(/^<\?xml[^>]*\?>/, "");
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  for (const match of body.matchAll(tag)) {
    assert.ok(!/[<>]/.test(body.slice(last, match.index)), `${name}: stray markup character in text`);
    last = match.index + match[0].length;
    if (match[4]) continue;
    if (match[1]) assert.equal(stack.pop(), match[2], `${name}: unbalanced </${match[2]}>`);
    else stack.push(match[2]!);
  }
  assert.ok(!/[<>]/.test(body.slice(last)), `${name}: trailing markup`);
  assert.deepEqual(stack, [], `${name}: unclosed tags`);
}

const sampleDocument = (summary = "Synthèse & <test> \"quotes\" 'x' é à ô") => buildReportDocument({
  values: { "header.reportNumber": "R-1", "header.etablissement": "Établissement & <Fils>", "comments.general": "Ligne 1\nLigne\u0001 2" },
  results: calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, {}),
  identity: GRAPHIE_CALCULATION_IDENTITY,
  summary: { text: summary },
  decision: { outcome: "machine-conforme" },
});

test("W1 the .docx is a valid ZIP with the required parts, content types, header relationship and the logo bytes", async () => {
  const { bytes } = await createWordTemplateGenerator().generate(sampleDocument());
  const parts = readZip(bytes);
  for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/header1.xml", "word/_rels/header1.xml.rels", "word/media/logo.png", "docProps/core.xml"]) {
    assert.ok(parts.has(name), name);
  }
  for (const [name, data] of parts) if (name.endsWith(".xml") || name.endsWith(".rels")) assertWellFormed(data.toString("utf8"), name);
  assert.match(parts.get("[Content_Types].xml")!.toString("utf8"), /Extension="png" ContentType="image\/png"/);
  assert.match(parts.get("[Content_Types].xml")!.toString("utf8"), /PartName="\/word\/document.xml"/);
  assert.match(parts.get("word/header1.xml")!.toString("utf8"), /r:embed="rId1"/);
  assert.match(parts.get("word/_rels/header1.xml.rels")!.toString("utf8"), /Target="media\/logo.png"/);
  assert.match(parts.get("word/_rels/document.xml.rels")!.toString("utf8"), /Target="header1.xml"/);
  const logo = readFileSync(path.join(process.cwd(), "..", "..", "docs", "product", "source", "cetem-logo.png"));
  assert.ok(parts.get("word/media/logo.png")!.equals(logo), "the media part is the CETEM BH logo");
  const core = parts.get("docProps/core.xml")!.toString("utf8");
  assert.ok(core.includes("<dc:title>") && !/creator|lastModifiedBy|created|modified/.test(core), "title only");
});

test("W1 special characters are escaped and control characters stripped in the document body", async () => {
  const { bytes } = await createWordTemplateGenerator().generate(sampleDocument());
  const xml = readZip(bytes).get("word/document.xml")!.toString("utf8");
  assert.ok(xml.includes("Établissement &amp; &lt;Fils&gt;"));
  assert.ok(xml.includes("Synthèse &amp; &lt;test&gt; &quot;quotes&quot; &apos;x&apos; é à ô"));
  assert.ok(!xml.includes("\u0001"));
  assert.ok(xml.includes("Ligne 2"));
  assert.equal(escapeXml("a\u0000b\u000bc&\ud800d"), "abc&amp;d");
  assert.ok(!/<w:t[^>]*>[^<]*<script/.test(xml));
});

test("W1 the output is deterministic for a document and carries no signature image or watermark", async () => {
  const generator = createWordTemplateGenerator();
  const first = (await generator.generate(sampleDocument())).bytes;
  const second = (await generator.generate(sampleDocument())).bytes;
  assert.ok(Buffer.from(first).equals(Buffer.from(second)));
  const parts = readZip(first);
  assert.deepEqual([...parts.keys()].filter((name) => name.startsWith("word/media/")), ["word/media/logo.png"]);
  const xml = parts.get("word/document.xml")!.toString("utf8");
  assert.ok(!/candidat|officiel|watermark/i.test(xml));
  assert.equal(generator.templateId, "cetem-paper-report");
  assert.equal(generator.templateVersion, "1.0.0");
});
