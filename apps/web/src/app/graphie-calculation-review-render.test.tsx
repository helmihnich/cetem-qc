import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GRAPHIE_CALCULATION_IDENTITY, calculateGraphieResults } from "@cetem-qc/domain";
import type { CalculationContext } from "@cetem-qc/domain";
import { GRAPHIE_RESULT_ORDER, presentGraphieMeasurements, presentGraphieResult } from "@cetem-qc/i18n/graphie-results";
import { GraphieCalculationReview } from "./graphie-calculation-review";

// The web tsconfig keeps Next's `jsx: preserve`, so tsx compiles JSX with the classic runtime,
// which resolves `React` from the global scope inside the rendered components.
(globalThis as typeof globalThis & { React?: typeof React }).React = React;

// Workbook source-regression readings as an accepted value map. Not CETEM-approved acceptance cases.
const accepted: Readonly<Record<string, string>> = Object.freeze({
  "voltage.accuracy.row1.kvDisplayed": "50", "voltage.accuracy.row1.kvMeasured": "49,2",
  "voltage.accuracy.row2.kvDisplayed": "70", "voltage.accuracy.row2.kvMeasured": "69,6",
  "voltage.accuracy.row3.kvDisplayed": "120", "voltage.accuracy.row3.kvMeasured": "119,8",
  "voltage.repeatability.row1.kvMeasured": "69,7", "voltage.repeatability.row2.kvMeasured": "69,6",
  "voltage.repeatability.row3.kvMeasured": "69,7", "voltage.repeatability.row4.kvMeasured": "69,6",
  "voltage.repeatability.row5.kvMeasured": "69,7",
  "voltage.repeatability.row1.kerma": "2,677", "voltage.repeatability.row2.kerma": "2,708",
  "voltage.repeatability.row3.kerma": "2,705", "voltage.repeatability.row4.kerma": "2,708",
  "voltage.repeatability.row5.kerma": "2,705",
  "output.linearity.dfc": "0,7",
  "output.linearity.row1.mas": "10", "output.linearity.row1.kerma": "0,672",
  "output.linearity.row2.mas": "40", "output.linearity.row2.kerma": "2,708",
  "output.linearity.row3.mas": "160", "output.linearity.row3.kerma": "11",
  "lightField.dfr": "1",
  "lightField.gap1": "2", "lightField.gap2": "-3", "lightField.gap3": "1", "lightField.gap4": "-4",
});

const OLD_RULE: CalculationContext = { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" };

function render(values: Readonly<Record<string, string>>, identity: CalculationContext = GRAPHIE_CALCULATION_IDENTITY): string {
  return renderToStaticMarkup(<GraphieCalculationReview evidence={{ identity, values, results: calculateGraphieResults(identity, values) }} />);
}

const decode = (markup: string) => markup.replace(/<[^>]*>/g, "")
  .replaceAll("&#x27;", "'").replaceAll("&quot;", "\"").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const contents = (markup: string, tag: string) => [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => decode(match[1]!));
/** One entry per test section, in render order, with its decoded heading, list items and paragraphs. */
function sections(html: string) {
  return html.split("<section class=\"calculation-test\"").slice(1).map((markup) => ({
    markup,
    heading: contents(markup, "h3")[0],
    items: contents(markup, "li"),
    paragraphs: contents(markup, "p"),
  }));
}
const sectionOf = (html: string, heading: string) => {
  const section = sections(html).find((candidate) => candidate.heading === heading);
  assert.ok(section, heading);
  return section;
};

test("W1 the regression readings show the five paper tests in order with measured values, results, verdicts and provenance", () => {
  const html = render(accepted);
  assert.deepEqual(sections(html).map((section) => section.heading), [
    "Exactitude de la tension",
    "Répétabilité de la tension",
    "Reproductibilité et répétabilité du rayonnement de sortie",
    "Linéarité du rayonnement de sortie",
    "Correspondance champ lumineux / champ de rayons X",
  ]);
  const accuracy = sectionOf(html, "Exactitude de la tension");
  assert.ok(accuracy.items.includes("KV min — kV affiché : 50 kV · kV mesuré : 49,2 kV"), accuracy.items.join("\n"));
  assert.ok(accuracy.items.includes("KV min — écart : -1,5999999999999945 %"));
  assert.ok(accuracy.paragraphs.includes("✓ Conforme (suggestion)"));
  assert.ok(accuracy.paragraphs.includes("Tolérance : |écart| ≤ 10 %"));
  const provenance = accuracy.paragraphs.find((text) => text.startsWith("Règle "));
  assert.equal(provenance, "Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 2, Exactitude de la tension");
  assert.ok(sectionOf(html, "Linéarité du rayonnement de sortie").items.includes("DFC (distance foyer–chambre) : 0,7 m"));
  assert.ok(sectionOf(html, "Reproductibilité et répétabilité du rayonnement de sortie").items.includes("Mesure 1 — Kerma : 2,677 mGy"));
});

test("W2 one voltage-accuracy row at 11 % shows « ✗ Non conforme (suggestion) »", () => {
  const html = render({ ...accepted, "voltage.accuracy.row3.kvMeasured": "133,2" });
  const accuracy = sectionOf(html, "Exactitude de la tension");
  assert.ok(accuracy.paragraphs.includes("✗ Non conforme (suggestion)"), accuracy.paragraphs.join("\n"));
  assert.ok(!accuracy.paragraphs.includes("✓ Conforme (suggestion)"));
  assert.match(html, /class="calculation-verdict result-non-conforme"/);
});

test("W3 light field always reads « Verdict indisponible » with no tolerance", () => {
  for (const values of [accepted, {}]) {
    const light = sectionOf(render(values), "Correspondance champ lumineux / champ de rayons X");
    assert.ok(light.paragraphs.includes("— Verdict indisponible : aucune tolérance imprimée sur le formulaire officiel"), light.paragraphs.join("\n"));
    assert.equal(light.paragraphs.some((text) => text.startsWith("Tolérance")), false);
  }
});

test("W4 a blank and an unparseable kV mesuré are named, and their results are unavailable, never 0 or N.A", () => {
  const html = render({ ...accepted, "voltage.accuracy.row2.kvMeasured": "", "voltage.accuracy.row3.kvMeasured": "abc" });
  const accuracy = sectionOf(html, "Exactitude de la tension");
  assert.ok(accuracy.items.includes("KV — kV affiché : 70 kV · kV mesuré : Non renseigné"), accuracy.items.join("\n"));
  assert.ok(accuracy.items.includes("KV max — kV affiché : 120 kV · kV mesuré : abc (valeur numérique invalide)"));
  assert.ok(accuracy.items.includes("KV — écart : Indisponible — mesure manquante"));
  assert.ok(accuracy.items.includes("KV max — écart : Indisponible — valeur numérique invalide"));
  for (const text of accuracy.items) assert.doesNotMatch(text, /^KV(?: max)? — écart : (?:0 %|N\.A|$)/, text);
  assert.ok(!accuracy.paragraphs.some((text) => /Conforme \(suggestion\)/.test(text)), "an incomplete test is never conforme");
  assert.doesNotMatch(decode(html), /N\.A/);
});

test("W5 an old-rule identity shows the unsupported-version alert, the stored identity and the measured values only", () => {
  const html = render(accepted, OLD_RULE);
  const text = decode(html);
  assert.equal(text.split("Version de règle non prise en charge — aucun calcul").length - 1, 1);
  assert.match(text, /graphie-mobile-pov 2\.0\.0, schéma 3, règle cetem-workbook-explicit-formulas 1\.0\.0/);
  assert.match(html, /role="alert"/);
  const rendered = sections(html);
  assert.equal(rendered.length, 5);
  assert.ok(rendered[0]!.items.includes("KV min — kV affiché : 50 kV · kV mesuré : 49,2 kV"));
  for (const section of rendered) {
    assert.equal(section.items.length, presentGraphieMeasurements(GRAPHIE_RESULT_ORDER[rendered.indexOf(section)]!, accepted).length, section.heading);
    assert.deepEqual(section.paragraphs, [], section.heading);
  }
  assert.doesNotMatch(text, /Valeurs calculées|Verdict|Tolérance|Règle cetem|suggestion\)/);
});

test("W6 the view is read-only: no form control", () => {
  for (const html of [render(accepted), render({}), render(accepted, OLD_RULE)]) {
    for (const tag of ["<input", "<textarea", "<select", "<button", "<form", "<a "]) assert.ok(!html.includes(tag), tag);
  }
});

test("W7 no overall conformity; the Responsable line appears once", () => {
  const text = decode(render(accepted));
  assert.doesNotMatch(text, /Machine conforme|Machine non conforme|conformité globale|verdict global|tests? réussis?|\d+ ?\/ ?5/i);
  assert.equal(text.split("Suggestion : la conformité finale de l'appareil est décidée par le Responsable.").length - 1, 1);
});

test("W8 every verdict carries a full-word aria-label and every test has an h3 heading", () => {
  const html = render(accepted);
  assert.equal((html.match(/<h3\b/g) ?? []).length, 5);
  const labels = [...html.matchAll(/<p class="calculation-verdict [^"]*" aria-label="([^"]*)"/g)].map((match) => decode(match[1]!));
  assert.equal(labels.length, 5);
  assert.equal(labels[0], "Verdict suggéré : conforme");
  assert.equal(labels[4], "Verdict suggéré : indisponible — aucune tolérance imprimée sur le formulaire officiel");
  assert.match(html, /class="calculation-verdict result-conforme"/);
  assert.match(html, /class="calculation-verdict result-indisponible"/);
});

test("W9 calculated lines, verdict, tolerance and provenance are the shared presenter's text, unchanged", () => {
  for (const values of [accepted, { ...accepted, "voltage.accuracy.row2.kvMeasured": "", "lightField.gap1": "x" }]) {
    const results = calculateGraphieResults(GRAPHIE_CALCULATION_IDENTITY, values);
    const rendered = sections(render(values));
    GRAPHIE_RESULT_ORDER.forEach((name, index) => {
      const presentation = presentGraphieResult(name, results[name]);
      assert.ok(presentation, name);
      const section = rendered[index]!;
      assert.equal(section.heading, presentation.heading);
      const measured = presentGraphieMeasurements(name, values).map((line) => line.text);
      assert.deepEqual(section.items, [...measured, ...presentation.lines], name);
      assert.deepEqual(section.paragraphs, [presentation.verdict.text, ...(presentation.tolerance ? [presentation.tolerance] : []), presentation.provenance], name);
    });
  }
});
