import type { CalculationContext, GraphieCalculationResults } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { GRAPHIE_RESULT_ORDER, presentGraphieMeasurements, presentGraphieResult } from "@cetem-qc/i18n/graphie-results";

const t = fr.graphieResults;

/** Accepted evidence for one audit: the stored identity, the raw values and the calculation snapshot. */
export type GraphieReviewEvidence = {
  identity: CalculationContext;
  values: Readonly<Record<string, string>>;
  results: GraphieCalculationResults;
};

const verdictClass = { conforme: "result-conforme", "non-conforme": "result-non-conforme", indisponible: "result-indisponible" } as const;

/**
 * Read-only Responsable view of the calculation evidence. It renders the results it is given and never
 * calculates, parses or decides; the final machine conformity stays a separate decision by the Responsable.
 */
export function GraphieCalculationReview({ evidence }: { evidence: GraphieReviewEvidence }) {
  const tests = GRAPHIE_RESULT_ORDER.map((name) => ({
    name,
    measurements: presentGraphieMeasurements(name, evidence.values),
    presentation: presentGraphieResult(name, evidence.results[name]),
  }));
  const unsupported = tests.some((test) => !test.presentation);
  const { identity } = evidence;
  return <section className="calculation-review" aria-labelledby="calculation-review-heading">
    <h2 id="calculation-review-heading">{t.reviewHeading}</h2>
    <p className="calculation-review-note">{t.responsableDecides}</p>
    {unsupported ? <div role="alert" className="calculation-review-alert">
      <p>{t.unsupportedIdentity}</p>
      <p>{t.storedIdentity} : {identity.catalogueId} {identity.catalogueVersion}, {t.schema} {identity.schemaVersion}, {t.ruleLower} {identity.ruleId} {identity.ruleVersion}</p>
    </div> : null}
    {tests.map(({ name, measurements, presentation }) => <section key={name} className="calculation-test" aria-labelledby={`calculation-test-${name}`}>
      <h3 id={`calculation-test-${name}`}>{t.tests[name]}</h3>
      <h4>{t.measuredValues}</h4>
      <ul>{measurements.map((line, index) => <li key={index}>{line.text}</li>)}</ul>
      {presentation && !unsupported ? <>
        <h4>{t.calculatedValues}</h4>
        <ul>{presentation.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        <p className={`calculation-verdict ${verdictClass[presentation.verdict.status]}`} aria-label={presentation.verdict.label} role="note">{presentation.verdict.text}</p>
        {presentation.tolerance ? <p>{presentation.tolerance}</p> : null}
        <p className="calculation-provenance">{presentation.provenance}</p>
      </> : null}
    </section>)}
  </section>;
}
