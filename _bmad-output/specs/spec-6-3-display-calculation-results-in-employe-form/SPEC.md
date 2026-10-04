---
id: SPEC-6-3-display-calculation-results-in-employe-form
story: 6.3
status: done
approved: 2026-10-04
baseline_commit: 29cffdf
depends_on: [5.6, 6.6, 6.7]
companions:
  - input-parsing-and-mapping.md
  - result-display.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-6-6-align-calculation-rules-with-cetem-paper-form/calculation-functions.md
  - ../spec-6-6-align-calculation-rules-with-cetem-paper-form/tolerances.md
  - ../spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/field-catalogue.md
sources:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/spec-6-3-display-authorized-calculation-results-in-the-employe-form.md
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - docs/product/source/formulaire-cetem/
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate. It supersedes the 2026-09 planning spec in `implementation-artifacts/`, which was blocked on catalogue `1.0.0` / rule `cetem-workbook-explicit-formulas` `1.0.0`.

# Story 6.3 — Display authorized calculation results in the Employé form

## Why

**Pain.** Stories 5.6 and 6.6 gave the mobile form the paper-form readings and gave `packages/domain` the paper formulas, tolerances and suggested per-test verdicts (rule `cetem-paper-form` `2.0.0`). The technician still sees no result: the draft holds raw strings, and nothing parses them, feeds the domain or shows the output. On paper the technician fills the écart cells and ticks « Test … concluant OUI / NON » by hand. The app should show those numbers and a *suggested* verdict while the technician works, offline, without passing a suggestion off as the final machine conformity.

**Story statement.** As an Employé, I want measured and derived values presented with their rule status in the field form, so that I can distinguish a number from a validated conformity result while working.

## Capabilities

Each `success` is an acceptance criterion. Grammar and mapping: [input-parsing-and-mapping.md](input-parsing-and-mapping.md). Layout, labels and French strings: [result-display.md](result-display.md).

- **CAP-1** — Parse raw readings
  - **intent:** The raw strings typed by the technician become domain readings without changing what is stored.
  - **success:** `""` and whitespace give `null` (missing). `"49,2"`, `"49.2"`, `"-3"` and `"+0,5"` parse to numbers. `"abc"`, `"1e3"`, `"1 000"`, `"N.A"`, `"5,"` and `"1,2,3"` give an invalid reading. The draft string is unchanged after parsing, saving and resume.
- **CAP-2** — Map fields to the five tests
  - **intent:** Each paper test receives exactly the fields named in the 6.6 source field mapping.
  - **success:** One pure domain function turns `Record<string, string>` into the five test inputs. A test asserts each input against the 6.6 table. Fields that feed no formula (mAs and mA max/2 in repeatability, kV affiché in repeatability and linearity, `lightField.kv`, `lightField.mas`) never change any result.
- **CAP-3** — Calculated values in the form
  - **intent:** The technician sees each test's derived values next to the table they come from, as they type, offline.
  - **success:** The voltage-accuracy, repeatability, linearity and light-field sections each show a read-only result block below their table. The repeatability section shows two blocks: voltage repeatability and output (Kerma) reproducibility/repeatability. Values carry their unit and paper row label, are shown at full precision with a decimal comma, and update on every edit with no network.
- **CAP-4** — Suggested verdict per test
  - **intent:** Each test shows the domain's suggested verdict with the tolerance it applied, worded as a suggestion.
  - **success:** The verdict shown is the domain `suggestedVerdict` for that test: « Conforme (suggestion) », « Non conforme (suggestion) » or « Verdict indisponible ». The printed tolerance is shown with it (e.g. « Tolérance : |écart| ≤ 10 % »). Light field always shows « Verdict indisponible » with the reason « aucune tolérance imprimée sur le formulaire officiel ».
- **CAP-5** — Unavailable is never a number or a pass
  - **intent:** A missing, invalid or zero-denominator result is shown as unavailable with its reason.
  - **success:** Each `unavailable` value shows « Indisponible » plus the French reason. It is never shown as `0`, `N.A`, blank or « Conforme ». A non-blank number field that does not parse shows « Valeur numérique invalide » under the input, and the raw text stays in the input.
- **CAP-6** — Provenance
  - **intent:** The technician can see which rule and paper section each result comes from.
  - **success:** Each block shows the rule ID and version and the paper page and section from the result's `formulaSource` (e.g. « Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 2, Exactitude de la tension »). The UI does not construct provenance itself.
- **CAP-7** — No overall conformity
  - **intent:** The app never suggests a machine-level verdict.
  - **success:** No screen, function or type combines the tests. Each block shows the line « Suggestion : la conformité finale de l'appareil est décidée par le Responsable. » No « Machine conforme », « Conforme / Non conforme » summary, or count of passed tests appears.
- **CAP-8** — Transient, reproducible results
  - **intent:** Results come from the stored raw strings plus the draft identity, so they reappear identically after resume.
  - **success:** Results are not written to the draft payload. After save, app restart and resume, the same blocks show the same values and verdicts. A fresh form uses the current identity. A draft whose identity is unsupported keeps the existing compatibility notice and shows no result.

## Constraints

- One implementation: parsing, mapping, formulas, tolerances and verdicts live in `packages/domain`. `apps/mobile` only calls the domain (via `graphie-calculation-service.ts`) and renders its result objects unchanged. No arithmetic, comparison or verdict choice in the UI.
- Draft values stay `Record<string, string>`. Nothing parsed, formatted or derived is written back to the draft or into an input.
- Values are never rounded for display or reuse. The display format is a shortest round-trip number with the decimal point replaced by a comma, not a precision policy.
- The verdict is always a suggestion. Final machine conformity is an explicit later decision by the Responsable (Epic 10).
- State is conveyed by text and a text symbol; colour is only secondary. Touch targets and phone/tablet layouts follow Stories 5.1 and 5.6.
- No change to the catalogue, field IDs, schema version, rule identity, local draft envelope, API or OpenAPI contract.
- UI strings are French and live in `packages/i18n/src/fr.ts`.

## Non-goals

- Responsable web review of results (Story 6.4) and server-side re-validation at acceptance (Epic 7). The domain mapping is written so those can reuse it, but they are not wired here.
- Ticking the paper's « concluant OUI / NON » boxes, « Conclusion générale », or any overall conformity.
- A display precision or rounding rule, a light-field tolerance, required fields or min/max ranges.
- Blocking save or navigation because of an invalid or missing reading.
- CETEM-approved acceptance fixtures (Story 6.5 / DEP-02).
- Migrating or recalculating drafts stamped with an old identity.

## Success signal

On a phone, offline, a technician types the workbook regression readings into a new Graphie Mobile form (e.g. kV affiché 50, kV mesuré `49,2`). The voltage-accuracy block shows « -1,5999999999999945 % » for KV min, the rule and page 2 provenance, and « Conforme (suggestion) ». Clearing a kV mesuré cell turns that test into « Indisponible — mesure manquante » with « Verdict indisponible ». The light-field block always shows « Verdict indisponible ». Nothing on screen states an overall machine conformity. After an app restart the same results reappear and the inputs hold exactly what was typed. `pnpm -r test` covers this through the domain parsing/mapping suite and the App render tests in [test-plan.md](test-plan.md).

## Confirmed decisions

Resolved from the code, the approved 5.6/6.6 specs, the paper form and the PO decisions in the pipeline rules (2026-10-04):

- Story 5.6 and Story 6.6 remove the old blocker. 6.6 `calculation-functions.md` fixes the field-to-operand mapping, and 6.6 fixes `null` = missing, non-finite = invalid, and the per-test verdict rule.
- The number grammar is input syntax, not a CETEM rule: comma or point decimal, optional sign, no exponent or grouping (see [input-parsing-and-mapping.md](input-parsing-and-mapping.md)).
- Parsing and mapping go in `packages/domain`, because mobile and API calculations only delegate to the domain.
- Full precision is shown because the epic leaves display precision unresolved and forbids inventing it.
- Verdicts appear per test only (PO rule: per-test verdicts follow Story 6.6; final conformity is always a human Responsable decision). Light field is « indisponible » (PO rule).
- A fresh form uses `GRAPHIE_CALCULATION_IDENTITY` because it is built from the current catalogue. Stored drafts use their own identity.

## Open Questions

Neither blocks this story.

- **For CETEM:** what display precision should calculated values use (e.g. decimals for kV écarts, Kerma moy, K1/K2)? Until answered, full precision is shown.
- **For CETEM (from 6.6):** what is the light-field tolerance? Until answered, the verdict stays « indisponible ».

### Review Findings

Code review 2026-10-04 (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). 0 decision-needed, 5 patch (all applied), 1 defer, 18 rejected. All gates pass after the patches (`pnpm -r test`: 318 tests, 0 failures, 0 skipped; typecheck, boundaries, contracts, `git diff --check` clean).

- [x] [Review][Patch] Nothing checked that results come back after an unreadable draft is discarded (`resetFormToNewDraft` is the only place that sets the identity on that path). M5 and M6 now type a kV mesuré after the discard and expect the écart line. A mutation test (identity left `undefined`) makes both fail. [apps/mobile/App.render.test.tsx]
- [x] [Review][Patch] The unavailable verdict's accessibility label read « Verdict suggéré : indisponible : mesure manquante » (two colons). It now reads « Verdict suggéré : indisponible — mesure manquante », and R1 asserts it. [apps/mobile/graphie-test-result.tsx:31]
- [x] [Review][Patch] G4 did not check that the light-field result is unaffected by a blank or invalid kV mesuré. Added to the comparison. [packages/domain/src/graphie-inputs.test.ts]
- [x] [Review][Patch] R9's « unavailable is never 0 » check only matched a line ending in a bare ` : 0`, so `0 %` would pass. It now also matches with a unit suffix. [apps/mobile/App.render.test.tsx]
- [x] [Review][Patch] R11 never reached the « no `formulaSource` → no block » branch, because the old-rule draft fails hydration first. Added a test that presents the five unsupported-version results and expects no block. [apps/mobile/App.render.test.tsx]
- [x] [Review][Defer] Readings typed with Arabic-Indic digits or the Arabic decimal separator would be flagged invalid. [packages/domain/src/graphie-inputs.ts] — deferred: unverified (would be medium). It depends on whether target devices' `decimal-pad` keyboards can emit those digits. Changing the grammar is a spec change.

Rejected:
- `low`: unrounded values (`-1,5999999999999945 %`). Full precision is a confirmed decision and CAP-3; display precision is an open question for CETEM.
- `low`: exponent notation for |value| < 1e-6 or ≥ 1e21. Probing identical and symmetric readings gives exact `0`, not float noise. Only absurd typed inputs reach it, and the fix adds a formatting branch.
- `low`: the invalid-number hint shows while typing `49,`. The approved grammar makes `5,` invalid and the hint is specified per value, not on blur. Save and navigation are not blocked.
- `low`: the hint is not a live region and the block heading has no header role. The hint is linked to `accessibilityHint` as specified, and the block has `accessibilityLabel` = heading.
- `false`: `formatValue(undefined)` invents « mesure manquante ». The domain always returns 3 accuracy rows and parallel `kermaAt1m`/`k1` arrays from fixed mappings, so `undefined` is unreachable.
- `false`: an unknown tolerance comparison renders as `<`. `GraphieTolerance.comparison` is the closed union `"abs-lte" | "abs-lt"`.
- `low`: the `unsupported-version` reason string is never rendered. CAP-8 says an unsupported identity shows no result and keeps the compatibility notice. The string is in the result-display table.
- `low`: `formIdentity` is separate state that each hydration path must set. The paths are covered (R1, R8, M5, M6). A refactor is not a review fix.
- `false`: R1 « no server call » proves nothing. CAP-3 requires results with no network, and R1 is the offline proof.
- `low`: no UI test of `zero-denominator`. It goes through the same reason lookup as the tested reasons, and the domain 6.6 suite covers zero denominators.
- `false`: block placement is only checked for repeatability. Placement is generic (before the first textarea), and the Acceptance Auditor confirmed it for all four sections.
- `low`: the Responsable line appears twice in the repeatability section. CAP-7 requires it in each block.
- `low`: units and separators are hard-coded in the component. They are SI symbols and punctuation, not French UI text.
- `false`: `scripts/automation/run-pipeline.ps1` changed. It is the pipeline's own script, not part of this story's diff, and it is not a gate script.
- `false` (duplicates): exponent notation (Edge Case Hunter), the dead `unsupported-version` string (Blind Hunter, Edge Case Hunter, Acceptance Auditor) and the awkward a11y label (Acceptance Auditor) are covered above.
