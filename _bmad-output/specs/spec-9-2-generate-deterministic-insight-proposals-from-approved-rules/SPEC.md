---
id: SPEC-9-2-generate-deterministic-insight-proposals-from-approved-rules
story: 9.2
status: approved
approved: 2026-10-07
baseline_commit: 808b67a
companions:
  - insight-rules.md
  - test-plan.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/evidence-model.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/review-ui.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - docs/product/graphie-calculation-rules-source-extraction.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 9.2 — Generate deterministic insight proposals from approved rules

## Why

**Pain.** The Responsable reviews accepted evidence (9.1) with no help spotting observations CETEM BH has explicitly defined as worth noting. FR-028 wants factual, reproducible proposals, but no CETEM-approved insight rule exists anywhere: the paper form prints tolerances for per-test verdicts only, the workbook extraction states "no additional … insight rule may be inferred", and DEP-01R is open.

**Story statement.** As a Responsable, I want factual insight proposals derived from accepted audit evidence, so that review highlights only observations CETEM BH has explicitly defined.

**What this story delivers.** The complete, tested proposal mechanism — a versioned rule registry, a pure deterministic evaluator, an API field and a W5 panel state — shipped with an **empty approved-rule registry**. Until CETEM defines a rule, the feature reports « indisponible » and no proposal can appear. Adding an approved rule later is a registry entry plus fixtures, with no change to the mechanism.

**Traceability.** FR-028, DR-002, DR-007, DR-008, AD-7, DEP-01R. Depends on 9.1, 6.6, 7.4 (done). Hands off to 9.3 (retain or discard).

## Capabilities

Registry shape, proposal shape, identity and contract are in [insight-rules.md](insight-rules.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Approved-rule registry
  - **intent:** The only source of proposals is a versioned registry of CETEM-approved insight rules, each with an approval reference.
  - **success:**
    - `packages/domain` exports `INSIGHT_RULE_REGISTRY` and the registry version.
    - It contains zero rules in this story.
    - A registry entry without an approval reference, or a rule that reads workbook-only data, fails registry validation.
    - A guard test fails if a rule is added without a matching fixture.
- **CAP-2** — Deterministic evaluation
  - **intent:** The same accepted input and rule version always yield the same proposals.
  - **success:**
    - `evaluateInsightProposals(input, registry)` is a pure function over the stored values, stored results and revision identity. It does not read the clock, randomness, the network or the database, and it does not recalculate.
    - Two runs give deep-equal output in the same order. Order is by rule ID, then by source key.
    - Proposal IDs are derived from rule ID, rule version, submission ID and source key, so they are stable across runs.
    - AI is never an input or an author.
- **CAP-3** — Provenance on every proposal
  - **intent:** Each proposal says which rule and which evidence produced it.
  - **success:**
    - A proposal carries rule ID, rule version, approval reference, registry version, submission ID, the source field keys or result keys, and a French factual statement built only from the rule's template and stored values.
    - No proposal exists without these fields (schema-enforced).
- **CAP-4** — Unavailable state, no fabrication
  - **intent:** When no approved rule applies, the feature says so and invents nothing.
  - **success:**
    - With the production registry the evaluator returns `{ status: "unavailable", reason: "no-approved-rules", proposals: [] }`.
    - A registry with rules that all evaluate to nothing returns `{ status: "available", proposals: [] }`: « aucune observation » is distinct from « indisponible ».
    - The Responsable screen shows « Propositions d’insights indisponibles : aucune règle CETEM approuvée. » and no proposal, retain or discard control.
- **CAP-5** — Delivered with the accepted evidence
  - **intent:** Proposals reach the Responsable only through the already-authorized, already-logged evidence open.
  - **success:**
    - `AcceptedEvidenceResponse` gains a strict `insights` object (CAP-4 shape). It is evaluated in `openAcceptedEvidenceForReview` after the consistency check and before the access insert commits.
    - An evaluator error fails the request (500, no access row, no evidence), like any other failure there.
    - Every 9.1 refusal and the 404 body stay identical. An Employé never receives `insights`.
    - Nothing is stored: no table or migration is added.

## Constraints

- Read only and stateless. No migration. Nothing in `audits`, `audit_revisions`, `audit_submissions`, lineage tables or `tasks` is written; `tasks.updated_at` does not move. Persisting proposals and decisions is Story 9.3.
- No CETEM business rule is invented. No threshold, boundary, comparison or proposal rule is inferred from workbook formulas, from the paper form's per-test tolerances, or from a failed per-test verdict. A rule enters the registry only with a CETEM approval reference recorded in the rule entry.
- The evaluator lives in `packages/domain` and imports nothing from `apps/*`. The API only delegates (AD-7, `boundaries:check`). `apps/mobile` is untouched; no offline or employee-facing insight.
- No overall machine conformity, approval state or AI text is produced or implied. A proposal is an observation, never a decision.
- OpenAPI first: extend `AcceptedEvidenceResponse` in `packages/types/openapi/cetem-qc-v1.yaml`, then generated types, zod schema and typed client. `contracts:check` passes.
- All user-visible text is in French in `packages/i18n`. Tests use synthetic names and the local PostgreSQL harness (zero skipped). No test is deleted, skipped or weakened, and no gate script is edited.
- Test-only rules are built inside tests and passed to the evaluator as the `registry` argument. They are never exported from a production module or placed in the production registry.

## Non-goals

- Defining any insight rule, threshold or wording on CETEM's behalf, or turning per-test verdicts into insights.
- Retain or discard, decision persistence, proposal history (9.3). Manual insights (9.4). AI summary and machine conformity (Epic 10). Reports (Epic 11).
- A rule-authoring UI, rule storage in the database, or a rule import tool.
- Employé or mobile access to insights.
- Deploying anything.

## Success signal

Domain tests prove the following:
- the production registry is empty and passes registry validation, and `evaluateInsightProposals` returns `unavailable` / `no-approved-rules` for it;
- with a synthetic approved test registry the evaluator returns identical, identically ordered proposals on repeated runs, with full provenance and stable IDs, and returns `available` with zero proposals when no rule fires;
- invalid registries are refused (missing approval reference, duplicate rule ID and version, workbook-only source).

PostgreSQL route tests prove that an accepted-evidence open returns `insights` `unavailable` with the production registry, that exactly one access row is written, that refusals are unchanged, and that an evaluator failure returns 500 with no access row. Web render tests prove the unavailable message with no insight controls, and a rendered synthetic `available` set with provenance and no retain, discard or approve control.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, the architecture, the existing code and the Product Owner rules. None is a CETEM business rule.

- **Blocked path is the delivered behaviour.** The AC says that until DEP-01R defines a rule the feature is « blocked/unavailable » with no fabricated proposal. No approved insight rule exists in the repository, the PRD, the paper form photos or the extraction, so the registry is empty. This is complete delivery of 9.2, not a gap in it.
- **Per-test verdicts are not insights.** Story 6.6 verdicts are suggestions for the tests they cover. Promoting a non-conforme verdict to an insight would be a CETEM rule (what is worth noting, and how it is worded), so it is not done. The light-field verdict stays « indisponible » (unchanged).
- **Delivery inside the evidence response.** One logged open returns evidence and insights together, so insight disclosure can never bypass the access log (9.1 CAP-3). A separate route was rejected because it would either skip the log or double it.
- **No persistence.** Proposals are recomputed on demand. Same input and rule version give the same proposals, so nothing needs storing until the Responsable decides (9.3 stores the initial proposal set with the decision, per DR-008).
- **Availability vocabulary.** `unavailable` means no approved rule exists. `available` with an empty list means rules exist and none fired (the all-normal case, valid per FR-029).
- **Registry version.** A string constant bumped with any registry change; it is part of every proposal's provenance.
- **Location.** `packages/domain/src/insight-rules.ts`, exported from the package index; zod schema in `packages/schemas`; strings in `packages/i18n` under `fr.insights`.

## Open Questions

None blocking. For CETEM (DEP-01R), not for this story: which observations deserve a deterministic insight, with threshold, boundary semantics, comparison rule and French wording. When supplied, they land as registry entries with fixtures in a follow-up change.
