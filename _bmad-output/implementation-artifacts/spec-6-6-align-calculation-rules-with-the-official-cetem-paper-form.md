---
title: 'Story 6.6: Align calculation rules with the official CETEM paper form'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '5fedbb0031f9e397ae7263f14aeaa45018e2b777'
context:
  - '{project-root}/_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/calculation-functions.md'
  - '{project-root}/_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/tolerances.md'
  - '{project-root}/_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/versioning-and-compatibility.md'
  - '{project-root}/_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/test-plan.md'
  - '{project-root}/_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/delivery-notes.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The shared Graphie calculations in `packages/domain` follow the Excel workbook (rule `cetem-workbook-explicit-formulas` 1.0.0). Parts of the workbook contradict the signed CETEM paper form: the voltage-accuracy sign is inverted, kV min and max are literals, linearity uses a fixed 0.49, and two tests are not on paper. Story 6.3 cannot display results until this is fixed.

**Approach:** Implement the approved canonical spec (`_bmad-output/specs/spec-6-6-…/SPEC.md` plus its companions, listed in `context`) exactly. Replace the function set with the 5 paper tests under rule `cetem-paper-form` 2.0.0. Each test returns full-precision values, provenance and a *suggested* per-test verdict. Update the adapters' types and tests, the mobile tuple fixtures, and the source-extraction doc. The canonical spec wins wherever this file is shorter.

## Boundaries & Constraints

**Always:** One implementation in `packages/domain`; the mobile and API adapters only delegate. Inputs are `number | null`. Tolerance comparisons are written exactly as `Math.abs(x) - limit <= TOLERANCE_EPSILON` (≤) and `limit - Math.abs(x) > TOLERANCE_EPSILON` (<), with no rounding. The version guard checks all 5 identity fields, read from `graphie-identity.ts`. The PO decisions in SPEC « Confirmed decisions » apply as written.

**Never:** Touch the mobile UI (`App.tsx` and components), catalogue content, field IDs, the OpenAPI contract, the database or the draft envelope. No overall conformity, no light-field tolerance, no draft migration, no string parsing. Do not edit the 6.3 spec. Never stage `apps/web/src/app/api/session/route.test.ts`. Do not commit.

## I/O & Edge-Case Matrix

The full matrix is in the canonical `test-plan.md` (R1–R5, B1–B15, U1–U9, V1–V5). Key cases:

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Workbook regression | D13:E15, C20:C24, L25:L29, DFC 0.70 + K40:L42 | −F13…−F15; 69.66/69.6/69.7; 2.7006 + P25–P29; k2 0.03326283333333333 | N/A |
| Inclusive limit | kV écart exactly ±10 or ±5 | `conforme` | N/A |
| Exclusive limit | Kerma ±10, linearity ±15 | `non-conforme` | N/A |
| Missing beats failing | one row out of tolerance + another `null` | `indisponible` / `missing-input` | computable rows still return values |
| Zero denominator | kV affiché, mean, Kerma moy, mAs, K2 or D.F.R = 0 | that value `zero-denominator`; verdict `indisponible` | no throw |
| Light field | any valid input | numbers returned; `indisponible` / `no-tolerance` | N/A |
| Old rule | context `cetem-workbook-explicit-formulas` / `1.0.0` | `unsupported-version` with the context echoed | stored draft keeps its bytes and shows the compatibility notice |

</frozen-after-approval>

## Code Map

- `packages/domain/src/graphie-identity.ts` -- rule constants at lines 6–7; the only place the tuple is defined.
- `packages/domain/src/graphie-calculations.ts` -- reuse `withContext`, `identity` and the `Number.isFinite` overflow guard; replace everything else. Remove `average`, the 0.49 factor and `unresolved-source-rule`.
- `packages/domain/src/graphie-calculations.source-regression.ts` -- `SourceRegressionFixture` shape (exported via `@cetem-qc/domain/source-regression`). Re-key it to the paper tests and add a `paperRule` note.
- `packages/domain/src/graphie-calculations.test.ts` -- full rewrite.
- `apps/api/src/modules/calculations/calculations.ts` -- the `VersionedGraphieCalculation` union stays; replace the cast at line 13 that names `rawKermaMean`.
- `apps/api/src/modules/calculations/calculations.test.ts` -- parity table; imports the mobile adapter as a test-only dependency (accepted in Story 6.2).
- `apps/mobile/graphie-calculation-service.ts` -- generic; expected unchanged.
- `apps/mobile/graphie-calculation-service.test.ts` -- uses `ruleVersion: "2.0.0"` as a mismatch; switch it to `"1.0.0"` and add the old-tuple case.
- `apps/mobile/graphie-pov-catalogue.test.ts:45` -- asserts the old tuple. Line 187 is a v1 fixture; keep it. Line 209 uses `ruleVersion: "2.0.0"` as a *mismatch*; it becomes current, so switch it to `"1.0.0"`.
- `apps/mobile/App.render.test.tsx:391, 1022` and `apps/mobile/local-drafts/local-drafts.test.ts:94` -- current-tuple fixtures; switch them to the new tuple. Lines 417, 1738 and 117 are v1 fixtures; keep them. Model the new App test on the v1 notice test at about line 1730.
- `docs/product/graphie-calculation-rules-source-extraction.md` -- append the « Superseded » section; the existing text stays unchanged.
- Gates: `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/domain/src/graphie-identity.ts` -- set the rule to `cetem-paper-form` / `2.0.0` -- CAP-7
- [x] `packages/domain/src/graphie-calculations.ts` -- add the 5 functions, the types, `GRAPHIE_TOLERANCES`, `TOLERANCE_EPSILON` and `judgeTolerance` per calculation-functions.md; delete the workbook-only rules -- CAP-1…6, 8, 9
- [x] `packages/domain/src/graphie-calculations.source-regression.ts` -- keep D13:F15 (negated), D26, B26/C26, D20/E20, N25, P25–P29 and O40/P40–P42; drop P14, O25 and Q40 -- R5
- [x] `packages/domain/src/graphie-calculations.test.ts` -- rewrite per test-plan.md R/B/U/V; B15 is a source assertion -- success signal
- [x] `apps/api/src/modules/calculations/calculations.ts` + its test -- generic return type; parity for the 5 functions -- adapter parity
- [x] `apps/mobile/graphie-calculation-service.test.ts` -- new functions and the old-rule refusal -- adapter parity
- [x] mobile tuple fixtures + 1 new App render test (a `2.0.0`/`3` draft with the old rule shows the notice and keeps its bytes) -- versioning-and-compatibility.md
- [x] `docs/product/graphie-calculation-rules-source-extraction.md` -- add the « Superseded by the paper form » section per delivery-notes.md

**Acceptance Criteria:**
- Given the workspace, when the gates run, then all pass, `contracts:check` shows no diff, and `git diff --check` is clean.
- Given the domain exports, when inspected, then `Object.keys(graphieCalculations)` is exactly the 5 paper tests, and `0.49` and `unresolved-source-rule` do not appear in the domain source.
- Given `git status`, when the story ends, then no UI component or catalogue file is modified, and `apps/web/src/app/api/session/route.test.ts` is not staged.

## Implementation Notes

- `packages/domain/package.json` gained a `test` script so `pnpm -r test` runs the domain suite (the success signal requires it); no other package config changed.
- Results expose `test`, `formulaSource`, `values` and `suggestedVerdict` (no top-level `status`); the unchanged `unsupported-version` shape is the only result with `status`. `judgeTolerance` and `isWithinTolerance` are exported; the latter holds the contract expressions.
- `paperForm.photo` is the repo-relative path under `docs/product/source/formulaire-cetem/`.
- Fixtures gained `test`, `match` (`exact` | `approx`) and optional `paperRule`; `expected` is now always a number.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|---|
| 1 | verification-gap | API parity suite not run by `pnpm -r test` | medium | patch | `apps/api/package.json` had only `test:calculations`; the success signal requires mobile/API parity under `pnpm -r test`. |
| 2 | edge-case | Sparse input arrays throw (`.map` keeps holes) | low | patch | `readings.map(read)` leaves holes; `find` then reads `undefined.status`. Direct fix with `Array.from`. |
| 3 | blind | Unavailable values shared by reference | low | patch | `deviation` returns its argument as-is; on overflow `mean` and `minDeviationPercent` are the same object; `resultPercent = dfr`. Direct fix by copying. |
| 4 | blind | No test of first-reason order when reasons differ | low | patch | No test mixes `zero-denominator` and `missing-input` in one call. |
| 5 | edge-case | `dfr * 1000` overflow gives a calculated 0 | low | reject | Needs D.F.R ≈ 1e306 m; unlikely, and the fix adds a guard. |
| 6 | edge-case | `(dfc)²` underflow gives a calculated 0 | low | reject | Needs DFC ≈ 1e-170 m; unlikely, and the fix adds a guard. |
| 7 | verification-gap (other) | Domain test file not type-checked, so `@ts-expect-error` is unproven | low | reject | Runtime `undefined` asserts still cover removal; adding a typecheck config is more than a direct fix. |
| 8 | blind | Voltage accuracy has no `workbookExample` | false | reject | calculation-functions.md provenance table mandates « — » because the workbook sign is opposite. |
| 9 | blind | Epsilon comment says it "never widens" | false | reject | Matches the contract wording in tolerances.md (noise absorption only). |
| 10 | blind | B13 sits on the epsilon boundary | false | reject | test-plan.md B13 and tolerances.md specify these exact values. |
| 11 | blind | Missing input hides a known failure | false | reject | PO confirmed decision: missing/invalid/zero-denominator beats failing. |
| 12 | blind | Negative or zero physical inputs accepted | false | reject | PO decision: negatives are not rejected; zero denominators are. |
| 13 | blind | No DFC/D.F.R unit-range check | false | reject | Ranges and validation are a non-goal (6.3 / DEP-01R). |
| 14 | blind | Light-field formula has no source evidence | false | reject | CAP-5 defines the formula from the paper form p4. |
| 15 | blind | No migration for old-rule drafts | false | reject | Intent: no draft migration; refusal plus notice is the specified behaviour. |
| 16 | blind | 6.3 spec now stale | false | reject | PO decision: the 6.3 spec is refreshed when 6.3 is planned. |
| 17 | blind | Domain test script not run by anything | false | reject | `pnpm -r test` ran the domain suite (26 tests). |
| 18 | blind | Wrong length reported as `missing-input` | false | reject | PO decision: wrong array length counts as `missing-input`. |
| 19 | blind | Tests assert source text | false | reject | test-plan.md B15 mandates a source assertion; R5 mirrors the 0.49 acceptance criterion. |

### Review Findings

Code review of 2026-10-03 (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor against the canonical SPEC.md). All 8 focus points verified in code and tests: voltage sign, DFC instead of 0.49, computed kV min/max, the exact `≤` / `<` expressions with 1e-9, light field `indisponible` / `no-tolerance`, no overall conformity, adapters delegate only, old-rule refusal.

- [x] [Review][Patch] Copy-on-propagate fix (triage #3) had no identity test [packages/domain/src/graphie-calculations.test.ts] — added U11 (`notStrictEqual` across slots and against `GRAPHIE_TOLERANCES`); mutation-checked on `filled`, the reference branch of `deviation` and `judgeTolerance`.
- [x] [Review][Patch] Non-number readings and missing input shapes untested [packages/domain/src/graphie-calculations.test.ts] — added U10 (string reading → `invalid-input`; absent `rows` / `kvMeasured` / `kerma` / `gapsMm` / input → `missing-input`).
- [x] [Review][Patch] Provenance photo paths not checked against the repository [packages/domain/src/graphie-calculations.test.ts] — V3 now asserts each photo exists.
- [x] [Review][Defer] Old-rule drafts cannot be deleted, contrary to versioning-and-compatibility.md [apps/mobile/App.tsx:994] — deferred: pre-existing 5.6 limitation (Delete hidden for unparseable drafts); fixing needs App.tsx, forbidden here.
- [x] [Review][Defer] `apps/api` `test` covers only the calculations suite [apps/api/package.json] — deferred: no API suite ran under `pnpm -r test` before 6.6.
- [x] [Review][Defer] Domain package and its test file are never type-checked [packages/domain/package.json] — deferred: pre-existing for every package under `packages/` (overturns build rejection #7 from reject to defer).
- [x] [Review][Defer] epic-6-context.md assigns thresholds to `rule-evaluation` [_bmad-output/implementation-artifacts/epic-6-context.md] — deferred: agent-context edit.

Build-session rejections re-checked: #5 and #6 confirmed. They are real, but the inputs (D.F.R ≈ 1e306 m, DFC ≈ 1e-170 m) are absurd; light field has no verdict, and the underflow ends in `zero-denominator` / `indisponible`, never a false pass. #7 overturned to defer (above). #8–#19 confirmed (spec, PO decisions or test-plan mandates; #17 verified: domain suite runs under `pnpm -r test`).

Rejected:
- `judgeTolerance([])` returns `conforme` — low: every caller passes 1–5 values, and the fix adds a guard to an exported contract.
- `isWithinTolerance(NaN)` is non-conforme — low: `calculated()` guarantees finite values on every internal path.
- B13 sits on the epsilon edge / doc wording — false: tolerances.md mandates this exact table and wording.
- Voltage accuracy has no `workbookExample` — false: PO confirmed decision.
- Result types not mirrored in `packages/types` — false: contracts are out of scope (no OpenAPI change).
- Front matter `status: done` versus sprint `review` — rejected: the fix edits the spec under review.
- New App test waits on a real 600 ms timer — false: same idiom as the v1 notice test and others in the file (550/650 ms).
- Redundant guard in the API parity test — false: the early return narrows the type and is not dead for TypeScript.
- `UnsupportedVersionResult` gains `formulaSource?: never` and `GraphieTestResult` gains a test parameter — false: runtime shape unchanged, types stricter.
- package.json scripts not in the delivery notes — false: required for the success signal (triage #1).
- Linearity reports `missing-input` before `invalid-input` when kerma and DFC are both unusable — false: consistent with the « first in row order » rule.
- Fourth photo `f5ae234e-…(1).jpg` unreferenced — low: no calculation lives on it.

## Verification

**Commands:**
- `pnpm -r test` -- expected: all suites pass
- `pnpm -r typecheck` -- expected: no errors
- `pnpm boundaries:check` -- expected: pass
- `pnpm contracts:check` -- expected: no generated diff
- `git diff --check` -- expected: no output
