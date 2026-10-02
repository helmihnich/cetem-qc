---
title: 'Story 6.3: Display authorized calculation results in the Employé form'
story: 6.3
status: blocked
planning_baseline:
  epic_definition: _bmad-output/planning-artifacts/epics.md#story-63-display-authorized-calculation-results-in-the-employe-form
  catalogue_id: graphie-mobile-pov
  catalogue_version: 1.0.0
  schema_version: 2
  calculation_rule_id: cetem-workbook-explicit-formulas
  calculation_rule_version: 1.0.0
  dependencies: [DEP-01R, DEP-02]
---

# Story 6.3 planning specification

## 1. Exact story statement

**As an Employé,**
**I want measured and derived values presented with their rule status in the field form,**
**So that I can distinguish a number from a validated conformity result while working.**

## 2. Exact acceptance criteria

Transcribed verbatim from `epics.md`:

**Given** a measurement has a source-backed formula but no approved tolerance rule
**When** the result is displayed in the mobile form
**Then** the numerical calculation may be shown with its provenance while tolerance/verdict is identified as unavailable pending rule approval
**And** an individual pass/fail appears only when its threshold, boundary and comparison rule are approved; no automatic overall conformity is computed
**And** state uses text and appropriate semantic cues, never color alone or a fabricated pass/fail; unresolved values are not rendered as zero, N.A. or passing.

**Traceability:** FR-026, FR-027, UX-DR2 (`measurement-result`), UX-DR6, UX-DR12. **Dependency:** DEP-01R.

## 3. Scope and behavior

This story owns the Employé mobile presentation and orchestration boundary for calculation results. It must:

- Keep the entered measurement string visible and intact as the user's raw value.
- Call only Story 6.2's `calculateGraphieDraft` adapter, which delegates to `@cetem-qc/domain`; UI components contain no formulas.
- Show a numerical result only when an authorized, complete input group can be assembled and the shared API returns `status: "calculated"`.
- Show source/rule provenance associated with that result. The currently supported identity is catalogue `graphie-mobile-pov` / `1.0.0`, schema `2`, rule `cetem-workbook-explicit-formulas` / `1.0.0`; formula source metadata identifies workbook, sheet, family and cells.
- Identify tolerance/verdict as unavailable pending rule approval. Since no approved threshold/boundary/comparison rules exist, no individual pass/fail is currently authorized.
- Work locally and offline using pure shared calculations. No network, AI, synchronization, submission, or outbox side effect is part of displaying a result.
- Preserve Story 5.2 authorization and Story 5.3/5.5 local draft protections, save/resume, and scoped async behavior.

The current catalogue has one number-typed string field per displayed family (`voltage.accuracy`, `voltage.reproducibility`, `output.reproducibility`, `output.linearity`) and does not capture all formula operands/readings. These fields cannot be treated as complete calculator inputs or as already-calculated results without an approved mapping. `beam.geometry` and `measurement.other` are project-defined fields without a source formula and receive no Story 6.1 calculation.

## 4. Out of scope

- Story 6.4 Responsable review presentation.
- Formula duplication or changes to Story 6.1/6.2 calculation semantics.
- Tolerance verdicts until threshold, comparison, and boundary rules are approved; no fabricated pass/fail.
- Overall conformity, insights, AI summaries, reports, synchronization, submission, or acceptance workflow.
- New formula operands, catalogue fields, requiredness, ranges, units, locale/number parsing, blank/zero/N.A. semantics, rounding, or special-value behavior absent an authoritative decision.

## 5. Raw-string to numeric-input mapping

### Existing contracts

- `GraphieDraftPayload.values` is `Record<string, string>`; the catalogue's number fields are rendered as `TextInput` values and saved as strings.
- `calculateGraphieDraft(draft, name, ...args)` accepts typed numeric arguments and forwards the draft's five-part identity to the shared domain API. It deliberately does not parse draft strings.
- Shared functions require formula-specific inputs: for example, applied/measured voltage numbers; five repeated readings; or Kerma and mAs arrays. The current catalogue does not expose these operand groups as structured input fields.
- Catalogue metadata does not authorize parsing grammar or special-value behavior. The PRD/DEP-01R explicitly leaves formats, blank/zero/N.A., invalid values, incomplete groups, and precision unresolved.

### Proposed contract shape, pending business authorization

Keep raw strings exactly as entered in the draft. A separate input adapter would, only after a Product Owner decision, map named catalogue field IDs and reading positions to named numeric operands and parse them into a typed union such as:

1. `ready` with finite numeric operands and the exact current five-part identity;
2. `incomplete` when a required operand is absent, only if an approved input-group definition says which operands are required; or
3. `invalid` with a validation error, only if an approved numeric grammar says the raw string is malformed.

Do not convert empty strings, whitespace, commas/periods, signs, exponent notation, N.A., or zero until their handling and locale grammar are approved. Do not default absent identity metadata to the current tuple. Do not write parsed or formatted values back over raw strings. On approval, pass full-precision parsed numbers to the Story 6.2 adapter and use its result unchanged.

### Blocker

No authoritative mapping exists from the current single-value catalogue fields to the operands required by each source formula, and no approved parsing grammar exists. This blocks calculation execution from the actual form. DEP-01R/Product Owner decisions must define (a) which raw fields/readings feed each formula and whether the catalogue must be extended/versioned, (b) input syntax/locale and precision, and (c) missing, blank, zero, invalid and incomplete-group handling. DEP-02's approved reference cases are additionally required before calculation acceptance can be claimed; they do not authorize inventing runtime rules.

## 6. Result-state model

Do not collapse these distinct facts:

| State | Meaning | Presentation rule |
|---|---|---|
| Raw entered value | Exact persisted string from the Employé | Remains in the measurement input; never replaced by a derived/display value. |
| Derived numeric calculation | Shared API `status: "calculated"`, with identity, formula source and full-precision `value` | Present separately from measurement input, with provenance. No display-rounding policy is authorized yet; do not invent one. |
| Calculation unavailable | Shared API `status: "unavailable"`, including `missing-input`, `invalid-input`, `zero-denominator`, `unresolved-source-rule`, or `unsupported-version` | Present as unavailable with a French explanation appropriate to the typed reason; never as zero, N.A., or fail. Initial linearity remains unavailable because Q40's source baseline is blank/unresolved. Unsupported identity must not calculate. |
| Input validation error | A future approved parser/input contract rejects a raw field or input group | Distinct French field/group validation feedback; preserve the raw value for correction. Until parsing semantics are approved, do not invent this classification for locale/special values. |
| Tolerance verdict | Comparison against an approved threshold, boundary, and comparison rule | Currently unavailable pending approval. Never infer pass/fail from the numerical result. |

The separate API result currently has no `validation-error` state; do not retrofit one by treating a calculation-unavailable outcome as a field-validation error.

## 7. Persistence decision

Calculation results are transiently computed for display and reproducible from the persisted raw measurement strings plus their versioned identity. Do not persist derived numeric values in local drafts for this story. Preserve the existing raw strings and five-part calculation identity using the Story 5.3 durable encrypted draft lifecycle. The shared result object already carries calculation identity and formula provenance while it is displayed. Any future submission/accepted-evidence persistence belongs to its own authoritative story and must retain provenance as Story 6.2 requires.

After restart/resume, re-read the raw draft, validate its catalogue/schema/rule identity, and recompute locally only when the input mapping/parser decision is approved. Unsupported or missing historical identity remains retained and must never be silently reinterpreted under the current rule set.

## 8. UI placement and accessibility

- Place a distinct derived-result block next to its related quantitative measurement within the corresponding form section; keep the editable measured input and read-only calculated output visibly separate.
- Use the UX `measurement-result` pattern and existing grouped form structure. Show a result label, unit only when the authorized result contract/source defines it, and concise French provenance for rule/formula source.
- Label verdict state with French text that says it is unavailable pending rule approval. Use semantic/icon cues in addition to text; never color alone.
- Show unavailable calculation explicitly when required; do not suppress it in a way that looks like a result or render placeholders as 0 / N.A. / passing.
- Reflow for phone and tablet, support screen readers and touch, and keep all user-facing labels/messages French. Do not choose numeric display rounding as a visual implementation detail.

Candidate copy for implementation after review: **« Calcul indisponible »**, **« Verdict de tolérance indisponible : règle non approuvée »**, **« Résultat calculé »**, plus a short source line. These strings are proposed presentation text, not business-rule authorization.

## 9. Versioning behavior

Every calculation call uses the complete draft identity: catalogue ID/version, schema version, calculation-rule ID/version. Current supported tuple: `graphie-mobile-pov` / `1.0.0` / `2` / `cetem-workbook-explicit-formulas` / `1.0.0`.

- Forward identity from the draft to `calculateGraphieDraft`; do not substitute module constants when draft metadata is absent.
- Let the domain's unsupported-version result pass through as unavailable. No fallback, migration, or silent calculation using current rules.
- Keep the formula source returned by the domain with the transient displayed result. Do not synthesize provenance in the component.
- A catalogue/schema/rule change requires explicit compatibility and rule-version treatment outside this story; historical drafts stay preserved and are not reinterpreted.

## 10. Dependencies and blockers

1. **Blocking: DEP-01R Product Owner decision** for formula operand-to-field mapping, catalogue/input shape (including whether new repeated readings are captured), number-string grammar/locale, precision and invalid/missing/blank/zero/incomplete behavior. This is necessary before a reliable form-to-domain call can be designed.
2. **DEP-02 approved acceptance fixtures** remain necessary before asserting CETEM calculation acceptance, particularly displayed expected values, abnormal/boundary/invalid/incomplete cases. Source-regression fixtures only prove formula reproduction and are not approval.
3. **Story 6.1 done:** sole formula implementation and unavailable outcomes; do not change.
4. **Story 6.2 done:** mobile adapter and five-part version context; it accepts numeric arguments and contains no authorized string parser.
5. **Story 5.4 done:** versioned catalogue and string-valued raw fields, but not a formula operand schema.
6. **Story 5.3 done / Story 5.5 evidence:** preserve encrypted local save/resume and offline behavior. Epic 5 retrospective says the Story 5.5 spec/closure artifact is missing; use exact 5.5 AC in `epics.md`, the inspected current implementation/tests, and retrospective as available evidence; persistence of that artifact is not itself a calculation blocker.
7. **Architecture AD-2/AD-5/AD-7 and UX:** shared pure domain; offline local calculation; French, accessible measurement-result pattern; explicit provenance and no inferred verdict.

## 11. Test strategy (planned; not run)

Once input mapping and parsing semantics are authorized:

- Valid inputs: each enabled formula family fed from the approved raw-field mapping; assert exact shared-domain result, source provenance and current identity. Test valid numeric values including supported signed results without altering sign.
- Initial-linearity case: assert unavailable/unresolved source rule and no numeric substitute.
- Unsupported identity: independently vary catalogue ID/version, schema version, rule ID/version and missing metadata; assert no calculated result and preserved raw draft.
- Malformed/non-numeric strings: exercise only cases classified by the approved grammar; assert field validation error stays distinct from domain unavailable and raw strings remain unchanged.
- Incomplete groups: test each approved required operand/group rule; assert unavailable/validation behavior as specified, never a fabricated zero or verdict.
- Offline/no-network: execute with network unavailable and assert local result rendering; spy/mock transport boundaries to prove pure calculation does not invoke network, synchronization, AI or outbox.
- Restart/resume: save raw input strings, remount/reopen draft, reproduce the same calculation state and provenance; verify no result was persisted over input and identity is retained.
- Story 5.x regression: draft save/resume/delete, encrypted persistence, account/task scoping, auth expiry/lock, stale task/account async completions, offline authorization/cache revocation and separate connectivity/local-save/sync labels.
- UI/accessibility: phone/tablet layout; raw field and result distinguishable; French text; text plus semantic cues; unavailable not color-only; no false zero/N.A./pass; screen-reader-readable result/provenance.
- Formula parity: rely on existing Story 6.1 domain regression and Story 6.2 consumer parity suites; UI tests assert delegation and do not duplicate formulas or expected formula arithmetic.

Do not add/run tests as part of this planning-only task.

## 12. Files likely affected during implementation

- `apps/mobile/App.tsx` — result presentation adjacent to quantitative input; likely extract result block to a focused component.
- New `apps/mobile/measurement-results.tsx` or similarly scoped UI component — French states, provenance, accessibility, and distinct measured/derived regions.
- `apps/mobile/graphie-calculation-service.ts` — reuse only; add a separately reviewed parser/mapping adapter only after its input contract is approved.
- `apps/mobile/graphie-pov-catalogue.ts` — only if an approved mapping requires a catalogue/schema revision.
- `apps/mobile/local-drafts/model.ts` and draft parsing/hydration — only if authorized identity/schema evolution is needed; retain raw strings and encrypted lifecycle.
- `packages/i18n/src/fr.ts` — French result/unavailable/provenance strings.
- `apps/mobile/App.render.test.tsx`, `apps/mobile/graphie-calculation-service.test.ts`, and possibly a focused new result component test — rendered states, delegation, restart/offline/version regressions.
- `packages/domain` calculation code/tests are not expected to change; Story 6.1/6.2 are the authority.
- `sprint-status.yaml` is not changed in this blocked planning result.

## 13. Readiness

**BLOCKED.** The display behavior is bounded by exact AC, but the current form does not contain a confirmed operand mapping and no parsing semantics are authorized. The numeric adapter cannot safely be wired to raw string values without product decisions under DEP-01R. DEP-02 also prevents claiming approved calculation acceptance. Resume implementation planning after the Product Owner confirms the formula input fields/groups, parsing grammar, precision, and undefined/incomplete-input behavior. Do not begin Story 6.4.

## 14. Source artifacts inspected

- `_bmad-output/planning-artifacts/epics.md` — exact Story 6.3 AC and Story 5.5 AC.
- `_bmad-output/implementation-artifacts/spec-6-1-implement-explicitly-defined-source-workbook-calculations.md` and `packages/domain/src/graphie-calculations.ts` — formula/output behavior.
- `_bmad-output/implementation-artifacts/spec-6-2-share-versioned-calculation-logic-between-mobile-and-server.md` and `apps/mobile/graphie-calculation-service.ts` — shared consumer boundary, identity, no parser.
- `_bmad-output/implementation-artifacts/spec-5-4-capture-project-defined-graphie-mobile-form-structure.md`, `apps/mobile/graphie-pov-catalogue.ts`, `apps/mobile/local-drafts/model.ts` — catalogue and raw string shape.
- `_bmad-output/implementation-artifacts/spec-5-3-save-resume-and-explicitly-delete-a-local-draft.md`, current mobile draft implementation/tests, and `_bmad-output/implementation-artifacts/epic-5-retro-2026-10-01.md` — persistence/offline and Story 5.5 evidence gap.
- `_bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md` — FR-025/026/027 and DEP-01R/DEP-02.
- `_bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/{EXPERIENCE.md,DESIGN.md,DECISIONS.md}` — measurement-result, French, accessibility, offline decisions.
- `_bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md` — AD-2, AD-5, AD-7.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — current Epic 6 / Story 6.3 state.

## 15. Sprint status

No changes. Epic 6 stays `in-progress`; Story 6.1 and 6.2 stay `done`; Story 6.3 stays `backlog` because this spec identifies a product-rule/input-mapping blocker; Story 6.4+ stay `backlog`. Planning artifact creation does not change implementation readiness status.
