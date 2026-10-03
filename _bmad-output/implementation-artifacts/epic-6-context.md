# Epic 6 Context: Traceable Calculations and Individual Results

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Employé (on mobile, including offline) and Responsable (on web review) see calculated values that faithfully reproduce the CETEM reference formulas. They see an individual per-test tolerance result only where an applicable rule exists. Calculations must be traceable to a versioned rule set and reproducible by the authoritative server, so offline results and accepted results agree. The epic also guards the boundary between numerical evidence and business approval. Calculations assist the work, and the final machine-conformity decision stays human. The rule reference has changed during the epic. Stories 6.1/6.2 implemented the CETEM-supplied Excel workbook formulas. Story 6.6 replaces the workbook with the signed paper form « Rapport de Contrôle de Qualité d'un Appareil Mobile de Radiographie », which also prints the tolerances. The broader planning documents still describe the workbook baseline and treat tolerances as unresolved. Where they conflict, the Story 6.6 direction is the current one.

## Stories

- Story 6.1: Implement explicitly defined source-workbook calculations
- Story 6.2: Share versioned calculation logic between mobile and server
- Story 6.3: Display authorized calculation results in the Employé form
- Story 6.4: Display authorized calculation results in Responsable review
- Story 6.5: Separate formula regression fixtures from approved acceptance fixtures
- Story 6.6: Align calculation rules with the official CETEM paper form

## Requirements & Constraints

- Calculate only explicitly defined formulas from the current rule reference. Preserve signed percentage deviations, fixed divisors and input dependencies. Never invent missing inputs, rounding, extrema or baselines.
- Missing, zero, invalid or undefined-behavior inputs and zero denominators produce an unavailable/blocked result. They never become 0, N.A. or a pass.
- An individual verdict requires an applicable threshold, boundary semantics and comparison rule. With the paper form, the printed tolerances (≤ 10 %, ≤ 5 %, < 10 %, < 15 %) give a *suggested* per-test verdict. Light-field correspondence has no printed tolerance and stays « indisponible ».
- Never compute or imply automatic overall machine conformity. No function or type aggregates tests. The human Machine conforme / non conforme decision belongs to a later epic.
- Calculations and individual feedback must remain available offline for synchronized tasks.
- Preserve calculation precision. Display-rounded values are never reused as inputs unless an approved rule requires it. Display format is not a rounding policy.
- Both roles see measured values, units, derived values with provenance, and the rule status. Accepted values are read-only for the Responsable.
- Keep source-derived regression fixtures (workbook/paper examples that prove faithful reproduction) separately labeled from CETEM-approved acceptance fixtures with approval provenance. Never present a source example as an approved verdict.
- Calculation/verdict acceptance stays marked blocked until CETEM supplies an approved dataset with normal, abnormal, invalid and boundary cases.
- Other unresolved rules stay unresolved: requiredness, special values, incomplete-test behavior, insight rules and display precision. Do not fill them in.

## Technical Decisions

- Calculation logic is pure, versioned code in `packages/domain`, with no React/RN/Next/Node/DB/provider dependencies. Mobile runs it offline, and the server re-runs the same implementation at acceptance. The server never silently substitutes another rule version or a last-write-wins value.
- The API owns two modules: `calculations` runs source-derived formulas and records provenance; `rule-evaluation` owns thresholds, boundaries, special values and deterministic insights. Unresolved rules stay unavailable rather than fabricated.
- Measurement payloads are validated versioned JSONB carrying `schemaVersion` and `ruleSetVersion`. Validate the payload schema/version before calculating. Retain schema, rule and formula provenance with each revision/result.
- Current identities: catalogue `graphie-mobile-pov` `2.0.0` / schema `3` (from Story 5.6). Rule `cetem-paper-form` `2.0.0` replaces `cetem-workbook-explicit-formulas` `1.0.0` (Story 6.6). Drafts stamped with the old rule are refused safely (unsupported version, existing compatibility notice) and are not migrated.
- Workbook-only rules (3-row reproducibility, initial-linearity baseline, fixed 0.49 linearity factor) are removed under the paper form. Linearity uses DFC instead.
- Every result carries formula provenance (rule ID and source reference).
- User-facing strings are French and centralized. Code and API identifiers are English. Shared contracts live in `packages/types` / `packages/schemas`.

## UX & Interaction Patterns

- Use the `measurement-result` component pattern on both surfaces. It shows the measured value and unit, the derived result with provenance/context, and an adjacent individual verdict only where a rule exists.
- Clearly distinguish an unavailable calculation or rule from pass/fail. No fabricated green/red badges, zero, N.A. or rounding.
- State is conveyed by text as well as visual semantics, never by color alone.
- Present verdicts as suggestions. Overall machine conformity never appears in this context.
- Responsable web review (accepted evidence) is read-only; opening it is logged access, not approval of the employee's work.

## Cross-Story Dependencies

- Story 6.3 is blocked by Story 5.6 (paper-form field alignment, done) and Story 6.6 (paper-form rule set v2). Story 6.4 follows the same rule set.
- Stories 6.1 → 6.2 → 6.6 build in sequence on the same shared domain package. Story 6.6 supersedes parts of 6.1's workbook behavior.
- Story 6.5's fixture separation applies to all calculation tests, including paper-form regression cases.
- External gates: approval of the remaining business rules is still open and limits affected verdict/submission behavior. The CETEM-approved reference dataset is still missing, so calculation acceptance stays blocked without it.
- Downstream consumers:
  - Epic 7 server acceptance re-validates calculations.
  - Epic 9 Responsable review and insights use the calculation results.
  - Epic 10's human conformity decision stays separate from the individual verdicts.
