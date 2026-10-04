# Fixture categories

Both modules live in `packages/domain/src/` and are exported only through subpaths in `packages/domain/package.json`.

| Category | Module | Subpath | Content today |
|---|---|---|---|
| `source-regression` | `graphie-calculations.source-regression.ts` (unchanged) | `@cetem-qc/domain/source-regression` | 18 workbook cells re-read under `cetem-paper-form` 2.0.0 |
| `approved-acceptance` | `graphie-calculations.approved-acceptance.ts` (new) | `@cetem-qc/domain/approved-acceptance` | empty |

## Approved-acceptance shape

```ts
type AcceptanceCaseKind = "normal" | "abnormal" | "invalid" | "boundary";

type ApprovedAcceptanceFixture = {
  category: "approved-acceptance";
  id: string;                                   // as numbered in the CETEM approval document
  test: GraphieTestName;
  caseKind: AcceptanceCaseKind;
  approval: {
    approvedBy: string;                         // CETEM signatory as written on the approval
    approvedOn: string;                         // ISO date YYYY-MM-DD
    documentRef: string;                        // approval document identifier
    ruleId: string;                             // must equal GRAPHIE_CALCULATION_IDENTITY.ruleId
    ruleVersion: string;                        // must equal GRAPHIE_CALCULATION_IDENTITY.ruleVersion
  };
  values: Readonly<Record<string, string>>;     // paper-form field ID -> value as entered
  expected: {
    /** Path inside that test's result `values`, e.g. "deviationPercent.0", "k2". */
    values: Readonly<Record<string, number | { unavailable: UnavailableReason }>>;
    verdict: GraphieVerdict["status"];
  };
  match: "exact" | "approx";                    // approx: |actual - expected| <= 1e-9, as source-regression
  source?: never;                               // no workbook provenance allowed
  note?: string;
};

export const GRAPHIE_APPROVED_ACCEPTANCE_FIXTURES: readonly ApprovedAcceptanceFixture[] = [];
```

## Acceptance status

```ts
type GraphieAcceptanceStatus =
  | { test: GraphieTestName; status: "blocked"; missingCaseKinds: AcceptanceCaseKind[] }
  | { test: GraphieTestName; status: "covered" };

function graphieAcceptanceStatus(fixtures: readonly ApprovedAcceptanceFixture[]): GraphieAcceptanceStatus[];
```

- Five entries, in the order voltage-accuracy, voltage-repeatability, output-repeatability, output-linearity, light-field.
- Only fixtures whose `approval.ruleId`/`ruleVersion` equal `GRAPHIE_CALCULATION_IDENTITY` count.
- `missingCaseKinds` follows the order normal, abnormal, invalid, boundary.
- `light-field` is always `blocked`. It has no printed tolerance, and while that is true `missingCaseKinds` holds every kind not covered (all four today).
- The function is pure and lives in the approved-acceptance module. Nothing outside tests and docs consumes it.

## Guards

- The two category sets are disjoint. No approved case has `source`, and no approved `id` equals a workbook cell in the source-regression set.
- Approval strings are non-empty after trimming. `approvedOn` matches `^\d{4}-\d{2}-\d{2}$` and is a valid date.
- Fixture `id`s are unique within the approved set.

## Adding a CETEM dataset (procedure recorded in docs)

1. Get the signed approval document. Record its identifier, signatory and date.
2. Add one fixture per case, copying the values exactly as written by CETEM. Never derive expected values from the code.
3. Run `pnpm -r test`. A failing approved case is a defect or a rule disagreement to raise with CETEM, never a reason to edit the expectation.
4. If the rule version changes, the old approvals stop counting and fail the guard until CETEM re-approves them.
