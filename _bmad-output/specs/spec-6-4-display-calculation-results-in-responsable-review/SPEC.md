---
id: SPEC-6-4-display-calculation-results-in-responsable-review
story: 6.4
status: done
approved: 2026-10-04
baseline_commit: 7c579bb
depends_on: [6.3, 6.6]
companions:
  - shared-presentation.md
  - review-view.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-6-3-display-calculation-results-in-employe-form/result-display.md
  - ../spec-6-3-display-calculation-results-in-employe-form/input-parsing-and-mapping.md
  - ../spec-6-6-align-calculation-rules-with-cetem-paper-form/calculation-functions.md
  - ../spec-6-6-align-calculation-rules-with-cetem-paper-form/tolerances.md
sources:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/implementation-artifacts/epic-6-context.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/DESIGN.md
  - docs/product/source/formulaire-cetem/
---

# Story 6.4 — Display authorized calculation results in Responsable review

## Why

**Pain.** Story 6.3 shows the paper-form results and suggested verdicts to the Employé on mobile. The Responsable has no way to read them on the web. When accepted evidence reaches the Responsable (Epic 7 acceptance, Story 9.1 W4 screen), the measured values, the calculated values, the per-test suggested verdict and its provenance must read the same as on mobile, read-only, without passing a suggestion off as the machine conformity, which the Responsable decides alone (Epic 10).

**Story statement.** As a Responsable, I want accepted measurements and permitted calculation results shown with provenance, so that review does not confuse numerical evidence with an unapproved verdict.

**Scope today.** No accepted audit, submission or snapshot exists on the server yet: migrations stop at tasks and password resets, and drafts live only on the device. 6.4 therefore delivers the reusable read-only web view and the shared code behind it, proven by render tests on accepted-evidence-shaped input. Story 9.1 renders it in W4 with the server's accepted snapshot.

## Capabilities

Each `success` is an acceptance criterion. Shared code: [shared-presentation.md](shared-presentation.md). Web view: [review-view.md](review-view.md).

- **CAP-1** — Shared result text
  - **intent:** Web and mobile describe a result with the same French text.
  - **success:** `presentGraphieResult` lives in `packages/i18n` (`@cetem-qc/i18n/graphie-results`) and both apps use it. Every 6.3 mobile test passes unchanged and the mobile block texts are identical to before.
- **CAP-2** — Shared all-tests calculation
  - **intent:** One domain function produces the five results for an identity and a value map, for mobile now and the server at acceptance later.
  - **success:** `calculateGraphieResults(context, values)` is exported by `packages/domain`. For the regression readings it equals calling each `graphieCalculations` function directly; an old-rule identity gives five `unsupported-version` results. The mobile service delegates to it.
- **CAP-3** — Measured values
  - **intent:** The Responsable reads the accepted readings each test used, exactly as entered.
  - **success:** Each test section lists its formula-input readings with the paper label and unit, in paper order, showing the stored string unchanged (`49,2 kV`, `49.2 kV`). Blank reads « Non renseigné »; an unparseable value reads « abc (valeur numérique invalide) ». No other field is shown.
- **CAP-4** — Calculated values, suggested verdict, provenance
  - **intent:** The Responsable sees each test's derived values, the domain's suggested verdict with its tolerance, and the rule and paper section, as on mobile.
  - **success:** For each of the five tests the web shows the `presentGraphieResult` lines, verdict, tolerance and provenance text unchanged (e.g. « KV min — écart : -1,5999999999999945 % », « ✓ Conforme (suggestion) », « Tolérance : |écart| ≤ 10 % », « Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 2, Exactitude de la tension »). Light field always shows « Verdict indisponible : aucune tolérance imprimée sur le formulaire officiel ».
- **CAP-5** — Unavailable is identified, never a number or a pass
  - **intent:** Missing inputs, invalid inputs, zero denominators and unsupported rule versions are stated as unavailable.
  - **success:** Unavailable values read « Indisponible — <reason> », never `0`, `N.A`, blank or « Conforme ». Evidence with an unsupported identity shows « Version de règle non prise en charge — aucun calcul » with the stored identity, still lists the measured values, and shows no result, verdict, tolerance or provenance line.
- **CAP-6** — Read-only, no overall conformity
  - **intent:** The view shows evidence; it never edits it and never states a machine-level verdict.
  - **success:** The markup has no input, textarea, select, button or form. No « Machine conforme / non conforme », overall verdict, passed-test count or approve/reject action appears. The line « Suggestion : la conformité finale de l'appareil est décidée par le Responsable. » appears once.
- **CAP-7** — Text-first status
  - **intent:** Status is understood without colour.
  - **success:** Each verdict is text plus symbol with an `aria-label` in full words (« Verdict suggéré : conforme »); colour classes are secondary; each test has a heading; text wraps without truncation.

## Constraints

- `apps/web` renders the results it is given. It never parses, calculates, compares or chooses a verdict; mobile and server calculations only delegate to `packages/domain`.
- Accepted values are shown as stored. Nothing is trimmed, re-parsed, reformatted or rounded for display, except calculated numbers in the shared shortest round-trip, decimal-comma format.
- No change to domain formulas, tolerances, catalogue, field IDs, identity, local draft envelope, API, OpenAPI or database. No web page, route or fetch is wired.
- Verdicts are per test and suggestions only (Story 6.6 rule `cetem-paper-form` `2.0.0`). Final machine conformity is a separate human decision by the Responsable.
- UI strings are French and live in `packages/i18n`. Boundaries hold: web does not import mobile; packages do not import apps.

## Non-goals

- Opening an accepted audit in W4, the server snapshot, its API contract, team authorization and review-access logging (Stories 7.3, 7.4, 9.1).
- Showing non-calculation fields (identification, visual checks, comments) — Story 9.1.
- Server re-validation at acceptance (Epic 7).
- Insights, summary, the Machine conforme / non conforme decision, the report (Epics 9–11).
- A display-precision rule, a light-field tolerance, CETEM-approved acceptance fixtures (Story 6.5 / DEP-02).

## Success signal

A web render test feeds the view the workbook regression readings as an accepted value map with the domain results for `cetem-paper-form` `2.0.0`. It shows the five paper tests in order with their measured values and units, « -1,5999999999999945 % » for KV min, the domain's suggested verdict for voltage accuracy (« ✓ Conforme (suggestion) » when all three rows are within tolerance) with « Tolérance : |écart| ≤ 10 % », page 2 provenance, and « Verdict indisponible » for light field. Blanking one kV mesuré gives « Non renseigné » and « Indisponible — mesure manquante ». The markup has no form control and no overall conformity. The same lines are produced by the mobile block. All gates pass ([test-plan.md](test-plan.md)).

## Confirmed decisions

Resolved from the code, the approved 6.3/6.6 specs, the epics, the UX documents and the PO decisions in the pipeline rules (2026-10-04):

- **Scope split.** The epics give acceptance to 7.3/7.4 and opening accepted evidence (W4, read-only, access logged) to 9.1; 6.4 owns how calculation results appear on the web. As with 6.2, which shipped the server calculation boundary before any caller, 6.4 ships the view before its data source.
- **Shared code, not copies.** The text presenter moves to `packages/i18n` and the all-tests calculation to `packages/domain`, so web and mobile cannot drift.
- **Measured values** are the formula inputs only, raw as stored; the full evidence is 9.1.
- **Unsupported identity** still lists measured values: a review must not hide accepted evidence.
- **The Responsable line** is shown once per view; full precision with decimal comma as in 6.3.
- Light field stays « indisponible » (PO rule); no overall conformity (PO rule).

## Open Questions

None blocks this story.

- **For the PO:** confirm Story 9.1 wires this view into W4 with the accepted snapshot. If 6.4 should instead wait for Epic 7, re-sequence it.
- **For CETEM (from 6.3/6.6):** display precision for calculated values; the light-field tolerance.

## Review Findings

Code review, 2026-10-04. Layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor. Result: 0 decision-needed, 4 patch (applied), 1 defer, 14 rejected. All gates pass after the patches.

- [x] [Review][Patch] Verdict colour classes never applied: `.calculation-test p` (0,1,1) overrode `.result-*` (0,1,0) [apps/web/src/app/globals.css:48]. Fixed by scoping them as `.calculation-test .result-*`.
- [x] [Review][Patch] Verdict colours had lower contrast than body text (#1F2933, about 14.7:1), against review-view.md [apps/web/src/app/globals.css:48]. Now `#052E16` (about 14.9:1), `#4C0519` (about 15.5:1) and `var(--ink)`.
- [x] [Review][Patch] `aria-label` on a role-less `<p>` is prohibited by ARIA 1.2 and often ignored by screen readers (CAP-7) [apps/web/src/app/graphie-calculation-review.tsx]. Added `role="note"` so the full-word label is exposed.
- [x] [Review][Patch] No test checked the `result-non-conforme` class [apps/web/src/app/graphie-calculation-review-render.test.tsx:82]. Added to W2.
- [x] [Review][Defer] Identity vs results-snapshot consistency is not checked by the view [apps/web/src/app/graphie-calculation-review.tsx]. Deferred: not reachable until a producer exists (7.3/7.4/9.1); see deferred-work.md.

### Rejected

- Mixed supported/unsupported snapshot hides all results: false. `calculateGraphieResults` gives all-or-none `unsupported-version` for one identity, and review-view.md step 2 specifies this behaviour.
- Missing `results[name]` crashes: false. `GraphieCalculationResults` requires all five keys.
- Numeric stored values crash `trim()`: false. `values` is typed `Record<string, string>`, and no untyped producer exists.
- Unknown reason code shows « undefined »: false. Reason codes are a closed domain union mapped exhaustively in `fr.graphieResults.reasons`.
- Unknown verdict status gives class `undefined`: false. Closed union, checked by the compiler.
- Exponent notation for tiny or huge values: rejected. The display precision rule is an open CETEM question, and the spec mandates shortest round-trip.
- Hard-coded element ids collide with two views on one page: low. 9.1 renders one view per audit, and the fix adds a parameter.
- Unsupported results keep the caller's context object: false. App.tsx passes the 5-field `formIdentity`, and the domain behaviour is the 6.3 behaviour.
- No direct mobile-vs-web parity render test: low. Both render `presentGraphieResult` text, and the 6.3 mobile tests pin those strings unchanged.
- Web assembles the identity line punctuation: low. The words come from `fr`, and the layout follows the format in review-view.md.
- Labels and units duplicated from the catalogue: low. C2 guards the drift as the test plan specifies.
- HTML collapses whitespace in `" 49,2 "`: low. The DOM keeps the raw string, and the value is unchanged.
- `GRAPHIE_RESULT_ORDER` not compile-time exhaustive: low. I7 pins the five names.
- Spec doc inconsistencies, i18n layering, and duplicated mobile name type: rejected. The fix would edit the spec, or the harm is unnamed. The i18n dependency on domain is a confirmed spec decision.
- No `next build` covers the component: low and unverified. Typecheck and the tsx runner compile it, and 9.1 wires it into a page.
