---
title: 'Story 6.2: Share versioned calculation logic between mobile and server'
story: 6.2
status: done
baseline_commit: 6b8126cc4e6dd551186907f4b4423cd8a4a2e19d
planning_baseline:
  epic_definition: _bmad-output/planning-artifacts/epics.md#story-62-share-versioned-calculation-logic-between-mobile-and-server
  catalogue_id: graphie-mobile-pov
  catalogue_version: 1.0.0
  schema_version: 2
  calculation_rule_id: cetem-workbook-explicit-formulas
  calculation_rule_version: 1.0.0
  prior_story: _bmad-output/implementation-artifacts/spec-6-1-implement-explicitly-defined-source-workbook-calculations.md
---

# Story 6.2 implementation plan

## Exact story definition

**As a Responsable,**
**I want submitted calculations reproducible by the authoritative server,**
**So that offline results and accepted results use the same rule version.**

**Acceptance criteria (verbatim from `epics.md`):**

**Given** a mobile draft contains formula inputs and rule/schema version metadata
**When** a calculation is shown offline and later checked by the server
**Then** both invoke the same pure versioned calculation implementation for all enabled formulas
**And** formula provenance, input precision and version are retained with results; display-rounded values are not reused as calculation inputs unless an approved rule requires it
**And** server acceptance does not silently substitute a different rule version or last-write-wins value.

**Traceability:** FR-025, FR-042, DR-002, DR-003, AD-2, AD-6, AD-7.

Story 6.1 is complete and defines the only enabled formula semantics. Story 6.2 integrates that package boundary into both runtimes and proves parity. It does not add or change formulas, decide presentation, or implement submission acceptance. Epic 7 owns synchronization/submission and authoritative acceptance lifecycle; this story must make the same server calculation callable for that later path without inventing a submission API now.

## Current-state findings and placement

- `packages/domain/src/graphie-calculations.ts` exports the pure, context-checked `graphieCalculations` API. `graphie-identity.ts` defines catalogue ID/version, schema version, and rule ID/version. Domain tests already check source fixtures and unsupported context behavior.
- Current calculation results carry the rule identity but do not expose an explicit per-formula provenance field. Preserve the existing numeric API semantics and add/retain a stable formula-family/source reference in the result envelope or its typed caller record so a result identifies which authorized workbook relationship produced it; use the existing Story 6.1 extraction as the authority, not newly invented provenance labels.
- `apps/mobile` depends on `@cetem-qc/domain`, but current `App.tsx` draft saves contain catalogue ID/version and schema version only. The mobile app currently does not invoke calculation functions. Keep mobile invocation in a small calculation adapter/service at the existing Graphie draft/form boundary, outside React Native rendering components; Stories 6.3/6.4 own result presentation.
- `apps/api` currently has no `@cetem-qc/domain` dependency or calculations module, and no audit/submission endpoint. Add the shared dependency and a pure calculation application entry point under `apps/api/src/modules/calculations`; future audit/sync commands can call that boundary. Do not add persistence, routes, or acceptance workflow here.
- `apps/mobile/local-drafts/model.ts` stores versioned catalogue/schema metadata with string-valued form inputs. Extend the calculation-bearing draft context with the Story 6.1 rule ID/version. Keep unmodified entered strings and full numeric precision for calculation inputs; do not save display-rounded results over inputs. Do not turn unrelated fields into calculator inputs or infer string parsing/validation policy.
- The API contract currently has task operations only. Calculation context belongs with calculation-bearing measurement data/results when the future submission contract is introduced (Epic 7); this story must define and exercise the shared context shape internally and preserve it in the local draft/result data, without prematurely adding a submission endpoint or wire operation.

## In scope

- Make both mobile and Node server consume `@cetem-qc/domain` as the sole formula implementation. The server module must delegate to `graphieCalculations`; no formula expression may be copied into apps/mobile, apps/api, API schemas, or tests as an alternate implementation.
- Bind calculation calls and outcomes to the complete Story 6.1 tuple: `catalogueId`, `catalogueVersion`, `schemaVersion`, `ruleId`, and `ruleVersion`. The current supported tuple is `graphie-mobile-pov` / `1.0.0` / `2` / `cetem-workbook-explicit-formulas` / `1.0.0`.
- Keep captured draft inputs at full source precision and separate from any display-formatted result. Preserve rule identity and a stable per-formula source reference together with calculation records. Do not alter numeric workbook behavior to add provenance.
- Provide a server-side calculation entry point usable by later authoritative acceptance code, but do not create a public HTTP route or acceptance persistence in this story.
- Reject unknown/missing/mismatched historical context safely. Do not reinterpret old payloads under today's semantics. Preserve unknown-version data for explicit compatibility handling where the existing local-draft lifecycle permits it; never calculate it as current.
- Add parity tests that run equivalent mobile and server entry points against the same authorized Story 6.1 fixture inputs and full context, and compare status, numeric value, and all identity/provenance metadata.
- Retain existing source-regression fixtures as source evidence, distinct from future CETEM-approved acceptance fixtures.

## Acceptance criteria for implementation

1. Mobile calculation calls use only the exported pure API in `@cetem-qc/domain`, with the draft's full catalogue/schema/rule context supplied on every call. No formula implementation is added to mobile UI/catalogue code.
2. The API calculation module imports and invokes the same `@cetem-qc/domain` API. It has no duplicate formula logic and no React, database, or provider dependency in the shared domain package.
3. A calculation-bearing draft retains the five-part identity with its original string inputs. Result data retains that identity and a stable formula-family/source reference traceable to the Story 6.1 extraction. A display-formatted number is never written back as an input.
4. The supported Story 6.1 tuple yields the same result from the mobile and server entry points for every enabled formula exercised by the source fixtures. Tests compare exact numeric outputs (or the same explicitly unavailable outcome) and identity/provenance; do not invent tolerance-based comparisons.
5. Unknown catalogue ID/version, schema version, rule ID, or rule version produces the domain's unsupported-version outcome and cannot return a calculated result. Missing historical metadata is treated as unsupported/incompatible, never defaulted to current.
6. A calculation result with an older supported identity remains identifiable as that identity. If this release implements no older formula set, it must return unsupported rather than claim it can recalculate that history.
7. Existing local draft authorization, employee/task isolation, stale-operation protection, and encrypted persistence behavior remain intact. Unsupported calculation metadata does not cause a destructive rewrite or silent data loss.
8. No automatic conformity, individual pass/fail verdicts, extra thresholds, new formulas, generic rules/form engine, or Stories 6.3/6.4 presentation work is introduced. Final conformity remains the Responsable's explicit decision.

## Dependencies and scope boundaries

- **Story 5.4 (done):** supplies project-defined catalogue ID/version and schema-versioned structured inputs. It is not a CETEM-approved business-rule catalogue.
- **Story 5.5 (done):** supplies offline editing and identity/task-scoped local access protections; preserve its lifecycle and authorization guarantees.
- **Story 6.1 (done):** authoritative formula definitions, result types, context tuple, supported version, unresolved source rules, and source regression fixtures. Preserve its exact workbook semantics and unsupported-version behavior.
- **Architecture:** `packages/domain` is the pure shared calculation boundary; apps may depend on shared packages, never on one another. API modules remain part of the modular monolith.
- **Story 6.3/6.4:** own employee and Responsable result presentation and unavailable-state UX. Do not begin those screens or display-format decisions here.
- **Story 6.5 / DEP-02:** owns the distinct CETEM-approved acceptance fixture set and its acceptance gate. Source fixtures in this story are parity/regression evidence only.
- **Epic 7:** owns durable synchronization, submission contracts, transactional server acceptance, idempotency, and immutable accepted evidence. This story prepares an internal API for that caller, but does not accept submissions or persist audit results.
- **Password-change runtime investigation:** separate ongoing investigation; leave its notes, artifacts, and code untouched.

## Verification plan

- Domain regression: run the existing Story 6.1 source fixture suite unchanged and confirm formulas, full-precision values, unavailable results, and identity remain unchanged.
- Mobile consumer: test its calculation adapter with representative valid and unavailable source fixtures, including proof that full input values are passed without display rounding and draft version context is forwarded.
- Server consumer: test the calculations module under Node against the same source fixture cases and verify it returns the shared domain outcome unchanged.
- Cross-runtime parity: execute a shared table of fixtures through both consumer adapters using identical input objects/context; deep-compare numeric value/status, calculation identity, and formula provenance. Cover every enabled formula, plus unresolved initial-linearity behavior.
- Version safety: test each dimension independently (catalogue ID, catalogue version, schema version, rule ID, rule version), absent metadata, and a historical/unknown tuple; assert no calculated result and no fallback to current rules.
- Draft lifecycle: test save/read/resume round-trip for rule metadata and precise raw input strings; unsupported metadata must leave persisted draft bytes intact and must not hydrate under current semantics.
- Static integration: ensure API and mobile depend on `@cetem-qc/domain`; run workspace typecheck, domain/mobile/API focused suites, contract/boundary checks if package manifests or import boundaries change, and `git diff --check`. No contract change is expected unless the implementation demonstrates a necessary versioned internal/shared type, and no network API addition is authorized by this story.

## Developer inspection checklist

- `_bmad-output/planning-artifacts/epics.md` — Story 6.2 acceptance criteria and traceability (authoritative scope).
- `_bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md` — AD-1, AD-2, AD-3, AD-6, AD-7, AD-10; modular monolith and pure domain boundary.
- `_bmad-output/implementation-artifacts/spec-6-1-implement-explicitly-defined-source-workbook-calculations.md` and `docs/product/graphie-calculation-rules-source-extraction.md` — exact formula semantics, identity tuple, provenance, fixture authority/limits.
- `_bmad-output/implementation-artifacts/spec-5-4-capture-project-defined-graphie-mobile-form-structure.md` and `apps/mobile/graphie-pov-catalogue.ts` — catalogue structure and provenance.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — current story/epic sequence; update only 6.2 planning status.
- `packages/domain/src/index.ts`, `graphie-identity.ts`, `graphie-calculations.ts`, `graphie-calculations.test.ts`, `graphie-calculations.source-regression.ts`, and `packages/domain/package.json`.
- `apps/mobile/App.tsx`, `apps/mobile/local-drafts/model.ts`, `apps/mobile/local-drafts/authorized-drafts.ts`, `apps/mobile/local-drafts/local-drafts.test.ts`, and mobile package manifest.
- `apps/api/package.json`, `apps/api/src/index.ts`, `apps/api/src/modules/tasks/tasks.ts`, API module boundary checks, and API test conventions.
- `packages/types/openapi/cetem-qc-v1.yaml` and `packages/schemas` only if a shared/wire contract is shown necessary; do not add submission operations in this story.

## Review Triage Log

- **false** — `apps/mobile/local-drafts/model.ts`: Unsupported calculation metadata raises `LocalDraftPayloadCompatibilityError`; repository reads do not rewrite or delete the encrypted row, and the App reports that it is retained unchanged.
- **false** — `apps/mobile/graphie-pov-catalogue.ts`: The legacy `{ content }` branch separates opaque content into `legacyContent` and creates an empty structured form. It does not parse or calculate historical content under the current rules.
- **false** — `apps/mobile/local-drafts/model.ts`: `payloadSchemaVersion` versions the local record envelope; unsupported/missing calculation identity in older structured payloads is rejected and retained instead of migrated to current semantics.
- **false** — `apps/mobile/graphie-calculation-service.ts`: The adapter accepts explicit numeric arguments and takes only the version context from the draft. Inferring a string-to-formula input mapping is expressly outside scope; raw draft strings remain unchanged.
- **patch** — `apps/mobile/graphie-calculation-service.ts`: Removed the unused `parseCalculationInput` helper; focused mobile calculation tests pass without adding string parsing behavior.
- **false** — `apps/api/src/modules/calculations/calculations.test.ts`: The mobile adapter import is test-only parity coverage; the API production module and package manifest depend only on `@cetem-qc/domain`, so there is no server application dependency on the mobile app.
- **false** — `apps/api/src/modules/calculations/calculations.test.ts`: The parity table uses Story 6.1 source-derived values and deep-compares complete results, including formula provenance; domain regression tests separately assert workbook outputs.
- **false** — `apps/api/src/modules/calculations/calculations.test.ts`: Shared delegation is intentional, and unchanged domain regression tests independently check source outputs, so equality between adapters is not the only calculation-semantic assertion.
- **patch** — `apps/api/src/modules/calculations/calculations.ts`: Replaced `unknown[]` with a per-calculation argument union derived from the shared API; API tests and typecheck pass.
- **patch** — `apps/mobile/graphie-calculation-service.ts`: The repeated parser finding was resolved by deleting the helper; the mobile service test suite passes.
- **patch** — `apps/mobile/App.render.test.tsx`: The App render test asserts all five identity fields on the saved row and resumes that same row; the edited render test file passes.
- **patch** — `packages/domain/src/graphie-calculations.test.ts`: Added family and workbook-cell assertions for each formula result; domain regression tests pass.
- **patch** — `apps/api/src/modules/calculations/calculations.test.ts`: Replaced the unreferenced linearity value with inputs derived from the authorized O40 fixture; API parity tests pass.
- **patch** — `packages/domain/src/index.ts`: Removed source-regression fixtures from the production root entry and exposed them through the explicit `@cetem-qc/domain/source-regression` subpath used by tests.

## Readiness

**READY FOR DEV.** The integration points and current version tuple are explicit. Story 6.1 is done, Story 5.4/5.5 are done, and this scope needs no unresolved CETEM business decision. Any formula/input mapping not authorized by Story 6.1 remains unavailable and must not be inferred. Planning does not authorize implementing Stories 6.3–6.5 or Epic 7 behavior.
