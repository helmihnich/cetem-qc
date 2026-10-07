# Insight rules, proposals and contract (CAP-1 to CAP-5)

## Domain module `packages/domain/src/insight-rules.ts`

```ts
export const INSIGHT_REGISTRY_VERSION = "insight-registry-1"; // bump with any registry change

export interface InsightRule {
  ruleId: string;            // stable, kebab-case
  ruleVersion: number;       // integer >= 1
  approvalReference: string; // non-empty: where CETEM approved it (document, date, approver role)
  sources: readonly InsightSourceKey[]; // field keys / result keys it reads; never workbook-only cells
  evaluate(input: InsightInput): readonly InsightFinding[]; // pure
}
export type InsightSourceKey = { kind: "field"; key: string } | { kind: "result"; key: string };
export interface InsightFinding { sourceKeys: readonly InsightSourceKey[]; params: Record<string, string | number> }

export interface InsightInput {
  submissionId: string;
  identity: GraphieCalculationIdentity; // the revision identity
  values: Readonly<Record<string, string>>;
  results: GraphieCalculationResults;
}

export const INSIGHT_RULE_REGISTRY: readonly InsightRule[] = []; // CAP-1: empty until CETEM approves a rule

export function validateInsightRegistry(registry: readonly InsightRule[]): void; // throws on violation
export function evaluateInsightProposals(input: InsightInput, registry?: readonly InsightRule[]): InsightProposalSet;
```

Each rule carries its French statement template in `packages/i18n` (`fr.insights.rules[ruleId]`), filled from `params` only. A rule with no template fails registry validation.

### Registry validation (throws)

- empty `approvalReference` or `ruleId`; `ruleVersion` not a positive integer;
- duplicate `(ruleId, ruleVersion)`;
- `sources` empty, or naming a key absent from `GRAPHIE_MOBILE_POV_CATALOGUE` or from the results shape;
- missing French template.

An empty registry is valid.

## Proposal set

```ts
type InsightProposalSet =
  | { status: "unavailable"; reason: "no-approved-rules"; registryVersion: string; proposals: [] }
  | { status: "available"; registryVersion: string; proposals: InsightProposal[] };

interface InsightProposal {
  proposalId: string;        // stable hash of ruleId|ruleVersion|submissionId|source keys
  ruleId: string; ruleVersion: number; approvalReference: string;
  registryVersion: string; submissionId: string;
  sourceKeys: InsightSourceKey[];
  statement: string;         // French, template + params only
  origin: "deterministic";
}
```

- `unavailable` is returned exactly when the registry has zero rules.
- Ordering: ruleId ascending, ruleVersion ascending, then source keys in lexical order of `kind:key`.
- `proposalId`: the readable string `ruleId:vRuleVersion:submissionId:kind=key,…` (source keys sorted). No hashing, no runtime dependency, no evidence value.
- The evaluator wraps rule errors: any throw propagates (CAP-5 → 500).

## Contract

OpenAPI: `AcceptedEvidenceResponse.insights` (required) = `InsightProposalSet` as `oneOf` on `status`, strict objects. `packages/schemas` zod mirrors it with `.strict()`. The typed client keeps its four outcomes. 9.1 fields are unchanged.

## API

In `openAcceptedEvidenceForReview`, after the snapshot invariant and before the access insert:

1. Build `InsightInput` from the snapshot (stored values, stored results, revision identity, submission ID).
2. `evaluateInsightProposals(input)` with the production registry.
3. Attach as `evidence.insights`. Insert the access row, commit, return.

The route code only passes the result through. No log line is added; the proposal set contains no secret, and the access row remains the record.

## Web (W5 slot in the 9.1 panel)

Under the evidence sections, a section « Propositions d’insights » (`fr.insights`):

| State | Text | Controls |
|---|---|---|
| `unavailable` | « Propositions d’insights indisponibles : aucune règle CETEM approuvée. » | none |
| `available`, zero proposals | « Aucune observation proposée par les règles approuvées. » | none |
| `available`, proposals | one read-only item per proposal: statement, « Règle {ruleId} v{ruleVersion} », approval reference, source fields by catalogue label | none (9.3 adds retain or discard) |

The note « La conformité finale de l'appareil est décidée par le Responsable. » still appears once. No approve, reject or conformity wording appears. The section renders `insights` as received and never evaluates.
