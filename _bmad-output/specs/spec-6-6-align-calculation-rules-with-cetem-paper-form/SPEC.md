---
id: SPEC-6-6-align-calculation-rules-with-cetem-paper-form
story: 6.6
status: approved
approved: 2026-10-03
baseline_commit: de8be0a
blocks: [6.3]
companions:
  - calculation-functions.md
  - tolerances.md
  - versioning-and-compatibility.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/field-catalogue.md
sources:
  - docs/product/source/formulaire-cetem/
  - docs/product/graphie-calculation-rules-source-extraction.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/source-analysis/calcul-graphie-01-formulas.md
  - _bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/calculation-input-mapping.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# Story 6.6 — Align calculation rules with the official CETEM paper form

## Why

**Pain.** Story 5.6 aligned the form fields with the signed paper form *Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie* (photos in `docs/product/source/formulaire-cetem/`). The shared calculations in `packages/domain` still follow the Excel workbook (rule `cetem-workbook-explicit-formulas` 1.0.0), and some of its formulas contradict the paper. The voltage-accuracy sign is inverted. kV min and max are hard-coded literals. Linearity uses a fixed 0.49 factor instead of DFC. There is also a 3-row reproducibility test and an initial-linearity test that do not exist on paper. The paper is the reference because it is the signed document. It also prints the tolerances, so each test can suggest a verdict. Story 6.3 cannot display results until this lands.

**Story statement.** As an Employé, I want the shared calculations and tolerances to match the official CETEM paper form, so that the results and suggested verdicts I see are the ones the signed report uses.

## Capabilities

Each `success` is an acceptance criterion. The signatures and result shapes are in [calculation-functions.md](calculation-functions.md). The tolerances and their sources are in [tolerances.md](tolerances.md).

- **CAP-1** — Exactitude de la tension
  - **intent:** For each of the 3 rows (KV min, KV, KV max), compute the voltage deviation with the paper's sign and judge it against the paper tolerance.
  - **success:** écart % = (kV mesuré − kV affiché) / kV affiché × 100 for each row. 50 → 49.2 gives −1.5999999999999945 (the negation of workbook F13). The verdict is `conforme` when every |écart| ≤ 10. Exactly 10 % passes.
- **CAP-2** — Répétabilité de la tension
  - **intent:** From the 5 kV mesuré readings, compute the mean, minimum and maximum, plus the min and max deviations from the mean, and judge them.
  - **success:** min and max are computed (no literals). For the workbook readings, moy = 69.66, min = 69.6, max = 69.7, écart min = −0.08613264427218242 and écart max = 0.057421762848128416. The verdict is `conforme` only when |écart min| ≤ 5 and |écart max| ≤ 5. Exactly 5 % passes.
- **CAP-3** — Reproductibilité et répétabilité du rayonnement de sortie
  - **intent:** From the 5 Kerma readings, compute Kerma moy and the deviation of each row from it, and judge them.
  - **success:** For the workbook readings, Kerma moy = 2.7006 and the 5 deviations equal workbook P25–P29. The verdict is `conforme` only when every |écart| < 10. Exactly 10 % is `non-conforme`.
- **CAP-4** — Linéarité du rayonnement de sortie
  - **intent:** From 3 rows of mAs and Kerma (dét) plus DFC, compute Kerma(1m), K1, K2 and each row's deviation, and judge them.
  - **success:** Kerma(1m) = Kerma(dét) × (DFC / 1 m)², K1 = Kerma(1m) / mAs, K2 = mean of the 3 K1, and écart % = (K1 − K2) / K2 × 100. With DFC = 0.70 m and the workbook rows, K2 ≈ 0.0332628333333333 and the deviations ≈ P40–P42. The verdict is `conforme` only when every |écart| < 15. Exactly 15 % is `non-conforme`. The literal 0.49 appears nowhere in the domain code.
- **CAP-5** — Correspondance champ lumineux / champ de rayons X
  - **intent:** From the 4 measured gaps and D.F.R, compute Σ|écarts| and the result as a percentage of D.F.R.
  - **success:** Σ|écarts| (mm) is the sum of the absolute values of the 4 gaps. résultat % = Σ|écarts| / (D.F.R m × 1000) × 100. The numbers are returned, and the verdict is always `indisponible` with reason `no-tolerance`.
- **CAP-6** — Suggested verdict per test
  - **intent:** Each test returns one suggested verdict with the tolerance it applied, so that 6.3 can show it as a suggestion.
  - **success:** The verdict is `conforme` when every compared value is within tolerance and `non-conforme` when at least one is outside. It is `indisponible` (with a reason) when any input the test needs is missing or invalid, a denominator is zero, or no tolerance exists. Comparison uses full precision with the 1e-9 noise rule in [tolerances.md](tolerances.md). No function or type aggregates the tests into an overall conformity.
- **CAP-7** — Rule versioning
  - **intent:** Calculations run only under the new rule identity, and anything stamped with the old rule is refused safely.
  - **success:** `GRAPHIE_CALCULATION_RULE_ID` / `_VERSION` = `cetem-paper-form` / `2.0.0`, and the catalogue stays `graphie-mobile-pov` / `2.0.0` / schema `3`. A context with the old rule returns `unsupported-version`. A stored draft with the old rule shows the existing compatibility notice and keeps its bytes. See [versioning-and-compatibility.md](versioning-and-compatibility.md).
- **CAP-8** — Provenance
  - **intent:** Every result says where its rule comes from.
  - **success:** Every non-version result carries `formulaSource` with `ruleId`, the paper-form page, section and photo, plus `workbookExample` cells for the tests where a workbook regression example exists (CAP-2, CAP-3, CAP-4).
- **CAP-9** — Workbook-only rules removed
  - **intent:** Rules that are not on the paper no longer exist.
  - **success:** `outputReproducibility`, `outputReproducibilityDeviation`, the normalized Kerma/mAs mean (O25), `initialLinearity` (Q40), the 0.49 factor and the `unresolved-source-rule` reason are deleted from the domain, the adapters' types and the fixtures.

## Constraints

- One implementation in `packages/domain`. `apps/mobile/graphie-calculation-service.ts` and `apps/api/src/modules/calculations/calculations.ts` only delegate, with no formulas and no tolerance comparisons (Story 6.2 architecture).
- Inputs are `number | null` (`null` = missing). String parsing, locale grammar and the meaning of blank stay in Story 6.3.
- Tolerance boundaries are exactly as printed: `≤` for both kV tests and `<` for Kerma and linearity. Values are never rounded. The comparison treats a value within 1e-9 of the limit as equal to the limit, which absorbs floating-point noise only (see [tolerances.md](tolerances.md)).
- A verdict is a suggestion. The Responsable decides the final conclusion, and nothing computes an overall conformity.
- Every compared value is a signed percentage, and the tolerance applies to its absolute value.
- The version guard checks all five identity fields, as today. No module hard-codes the rule tuple; they all read `graphie-identity.ts`.
- No draft migration and no conversion of drafts stamped with the old rule.
- The mobile UI is not touched. Field IDs from Story 5.6 are unchanged.

## Non-goals

- Displaying results, verdicts or provenance in the mobile form (Story 6.3) or in Responsable review (Story 6.4).
- Parsing draft strings, required fields, ranges and negative-value validation (6.3 / DEP-01R).
- A light-field tolerance. It is not visible on the photos.
- Overall machine conformity, « Conclusion générale », or setting the « concluant OUI/NON » boxes.
- CETEM-approved acceptance fixtures (Story 6.5 / DEP-02). The fixtures here are source-regression and paper-rule checks.
- Using mAs or mA max/2 in the repeatability or linearity formulas. No paper formula uses them.
- Changing the catalogue, the schema version or the local draft envelope.

## Success signal

`pnpm -r test` passes a domain suite that reproduces the workbook regression values under the paper rules (69.66 / 69.6 / 69.7, Kerma moy 2.7006 with P25–P29, K2 at DFC 0.70, and −1.6 % voltage accuracy). The suite also yields `conforme` exactly at 10 % and 5 % for the kV tests and `non-conforme` exactly at 10 % and 15 % for Kerma and linearity. Light field is always `indisponible`, and an old-rule context is `unsupported-version`. Mobile and API parity tests return identical results through their adapters.

## Confirmed decisions

These were confirmed by the Product Owner on 2026-10-03.

- If any value a test needs is missing, invalid or has a zero denominator, the verdict is `indisponible`, even when another row is already out of tolerance. Rows that can be computed still return their values.
- `null` means missing, a non-finite number means invalid, and the wrong array length counts as `missing-input`.
- Negative readings are not rejected. Only zero denominators (kV affiché, moy, Kerma moy, mAs, K2, D.F.R) are rejected.
- Voltage-accuracy provenance cites the paper only, because the workbook's F13–F15 have the opposite sign. Its regression fixture reuses the workbook inputs with the expected values negated.
- The verdict literals are `conforme` / `non-conforme` / `indisponible`. Story 6.3 renders the French labels.
- Capturing mAs once in the repeatability table is acceptable, because no formula uses it.
- The 6.3 spec is not edited by this story. It is refreshed when 6.3 is planned.

## Open Questions

- **For CETEM:** what is the light-field correspondence tolerance (Σ|écarts|/D.F.R), and is it inclusive or exclusive? It is not visible on the paper form. Until it is confirmed, the verdict stays `indisponible` / `no-tolerance`, with no invented value.
