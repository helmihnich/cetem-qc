---
id: SPEC-10-4-record-the-explicit-human-machine-conformity-decision
story: 10.4
status: approved
approved: 2026-10-08
baseline_commit: 77df86b
companions:
  - conformity-decision-model.md
  - test-plan.md
  - ../spec-10-3-reopen-a-confirmed-summary-before-official-designation/summary-reopening-model.md
  - ../spec-10-2-write-edit-and-explicitly-confirm-a-summary/summary-confirmation-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/specs/spec-10-3-reopen-a-confirmed-summary-before-official-designation/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 10.4 — Record the explicit human machine-conformity decision

## Why

**Pain.** Stories 10.2–10.3 confirm and reopen the summary but nothing records the final machine verdict. FR-038 and FR-026 require that « Machine conforme » or « Machine non conforme » be an accountable, explicit choice by the Responsable, separate from per-test verdicts, calculations, insights and AI text, and that a reopened summary make the earlier choice historical (OD-10, DR-005).

**Story statement.** As a Responsable, I want to choose Machine conforme or Machine non conforme after summary confirmation, so that overall conformity remains an accountable human decision.

**What this delivers.** One insert-only decision table and one insert-only invalidation table; one record route; a `conformity` module with a public read and a reopen participant registered into the 10.3 contract; the current decision and decision history in the evidence response; the decision area in the W5 panel.

**Traceability.** FR-026, FR-038, DR-005, AD-8, UX-DR2 (conformity-decision), UX-DR9, OD-10. Depends on 10.1–10.3 (done). Hands off to 11.x (reports bind to the decision `id`; either outcome is eligible).

## Capabilities

Table, command, participant, route, contract and web details are in [conformity-decision-model.md](conformity-decision-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Record an explicit decision
  - **intent:** The Responsable of the owning team records one of two outcomes for the current confirmed summary.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/conformity-decision` with body `{ "outcome": "machine-conforme" | "machine-non-conforme" }` inserts one row and returns 201 `ConformityDecision` (`id`, `outcome`, `decidedAt`, `decidedBy` (ID, display name), `summaryId`, `summaryVersion`).
    - Actor and date come from the session and the server clock only. The body has no other property (strict, 422). No default outcome exists anywhere (API, DB, UI).
    - Role/ownership/404 refusal classes are those of 10.2/10.3.
- **CAP-2** — Only after the current summary is confirmed
  - **intent:** No decision without an approved summary (AC).
  - **success:** When the summary state is `open` (never confirmed, or reopened and not yet reconfirmed) → 409 `SUMMARY_NOT_CONFIRMED`, no row. The decision is bound to the current confirmed summary `id`. Recording takes the per-task lock of 10.2 (`lockTaskSummary`), so a concurrent reopen or confirm is serialized with it.
- **CAP-3** — Independent of every computed or AI value
  - **intent:** The outcome is never set or inferred (FR-026, AC).
  - **success:** The command receives only the outcome. It reads no result, verdict, calculation, insight, AI draft or summary text and calls no provider. Either outcome is accepted whatever the per-test verdicts are (including all « indisponible », all conforming, or mixed).
- **CAP-4** — One decision per confirmed summary
  - **intent:** A decision is final for its summary version; changing it goes through a reopening.
  - **success:** A second record for the same confirmed summary → 409 `CONFORMITY_ALREADY_DECIDED`, original row untouched. Two concurrent records produce exactly one row; the other gets 409. Rows are insert-only (UPDATE, DELETE, TRUNCATE refused).
- **CAP-5** — A reopening makes the decision historical
  - **intent:** A reopened summary invalidates the prior decision and requires a fresh one (AC, OD-10).
  - **success:**
    - The `conformity` module registers a `SummaryReopenParticipant` (10.3) whose `onSummaryReopened` inserts one invalidation row for the decision bound to the reopened summary, if any, in the reopening transaction. Its `hasOfficialDesignation` returns `false` (designation belongs to reports).
    - After reopening, `getCurrentConformityDecision` returns `null` and the old decision appears in `conformityHistory` with its invalidation date. It is never copied, preselected or inferred for the next version.
    - After the next confirmation a new decision can be recorded; the history then holds the old one and the current one is the new row.
    - Currentness is by binding, not by the invalidation row alone: a decision is current only if its `summaryId` equals `getConfirmedSummary(...).id`.
- **CAP-6** — Evidence response and panel
  - **intent:** The Responsable sees, makes and reads the decision in the W5 panel.
  - **success:**
    - `AcceptedEvidenceResponse` gains required `conformityDecision` (`ConformityDecision | null`) and `conformityHistory` (array, possibly empty, newest first).
    - Panel, summary confirmed and no current decision: area « Décision de conformité de la machine » with two equal buttons « Machine conforme » and « Machine non conforme », none preselected or highlighted; each opens a second-step prompt « Enregistrer la décision « {label} » ? Elle restera liée à la version {n} de la synthèse ; elle ne pourra être modifiée qu’en rouvrant la synthèse. » with « Enregistrer » / « Annuler ». Cancel changes nothing.
    - On 201 the area shows « Décision : {label} — enregistrée par {name} le {date} » and no buttons. On 409 `SUMMARY_NOT_CONFIRMED` / `CONFORMITY_ALREADY_DECIDED` it reloads evidence and shows the French message; any other failure shows « La décision n’a pas pu être enregistrée. » and no decision is claimed.
    - Summary open: no buttons; text « La décision de conformité pourra être enregistrée après la confirmation de la synthèse. ».
    - « Décisions précédentes » lists historical decisions read-only: « {label} — synthèse version {n} remplacée — par {name} le {date} ». The panel shows no report control.

## Constraints

- Written by recording: only the `conformity_decisions` row. Written by a reopening (via the participant): only a `conformity_decision_invalidations` row. Accepted evidence, summaries, reopenings, drafts, insights, decisions on insights, access rows and `tasks.updated_at` are never written.
- No CETEM rule is invented. The two outcomes and their labels come from FR-038 and the AC. No justification field, no minimum condition on verdicts, no extra role, no automatic or suggested outcome. One decision per summary version follows from insert-only history plus OD-10 (change = reopen); it is not a business tolerance.
- Module boundaries: `conformity` imports from `summaries` and `audits` only through their public surface (`index.ts`, `commands/`, `queries/`, `contracts/`, `ports/`). 10.3's `reopen-participants.ts` sits at the `summaries` module root and is not importable from another module: this story adds `apps/api/src/modules/summaries/index.ts` exporting the participant interface, `registerSummaryReopenParticipant` and the read functions `conformity` needs (see model). `summaries` never imports `conformity`. Registration happens at application start-up outside the modules. `boundaries:check` passes.
- Registration is idempotent per application instance (the registry is process-global and tests build several apps): the start-up helper skips a name already registered. Tests that clear the registry for synthetic participants re-register the conformity participant explicitly when they need it.
- Migration `0021` is additive: two new tables, insert-only triggers (`refuse_history_change`, `refuse_evidence_truncate` as in `confirmed_summaries`). No existing row is rewritten.
- OpenAPI first: operation, `ConformityDecision` / `ConformityDecisionRequest` schemas, `conformityDecision` and `conformityHistory` on `AcceptedEvidenceResponse`, error code `CONFORMITY_ALREADY_DECIDED` (409 reuses `SUMMARY_NOT_CONFIRMED`); then generated types, strict zod, typed client. `contracts:check` passes. Web goes through a Next route handler with the CSRF check and session cookie only.
- Logs carry event, actor ID and fixed class only (`conformity.recorded`, `conformity.refused` with class `forbidden-role|not-found|not-confirmed|already-decided`); never task or decision IDs, text or outcome.
- All text in French in `packages/i18n`. `apps/mobile` untouched; no Employé access. Tests: synthetic names, mock provider, local PostgreSQL harness (zero skipped). No test deleted, skipped or weakened; no gate script edited. Existing evidence tests change only by adding the new required fields. The two 10.3 assertions that « no conformity-decision control / no Machine conforme wording » exist (W42, i18n wording check) are superseded by this story and are narrowed to « no report control, no decision control while the summary is open or a decision is current », with the same coverage for everything else.

## Non-goals

- Report generation, candidates, templates, « Conclusion générale » content, designation or their participant (Epic 11); the `hasOfficialDesignation` veto stays `false` here.
- Editing or withdrawing a decision other than by reopening the summary; a justification or comment on the decision; a third outcome.
- Any link from per-test verdicts, calculations, insights or AI text to the outcome (suggestion, warning, prefill, counter).
- Mobile or Employé access; deploying anything; calling a real AI provider.

## Success signal

PostgreSQL route tests prove: confirm then record `machine-conforme` returns 201 with `summaryId` = the confirmed summary `id`, one row with actor and server date; the same for `machine-non-conforme`; fixtures with every per-test verdict combination accept both outcomes; a body without `outcome`, with another value or an extra property → 422 and no row; recording with no confirmed summary or after a reopening → 409 `SUMMARY_NOT_CONFIRMED`; a second record on the same summary → 409 `CONFORMITY_ALREADY_DECIDED` with the first row unchanged; two concurrent records leave one row; a concurrent reopen and record end consistent (either the decision is then invalidated or the record is refused); reopening writes one invalidation row, `conformityDecision` becomes `null`, the old decision is in `conformityHistory`, a new decision after reconfirmation is current and the old one stays historical; a decision bound to an older summary `id` is never returned as current even without an invalidation row; a throwing conformity participant rolls the reopening back; refusals (Employé 403, malformed/unknown/other-team/draft/no-audit 404 identical to 9.1) write nothing; UPDATE, DELETE, TRUNCATE on both tables are refused; other tables and `tasks.updated_at` unchanged; logs hold no IDs of tasks or decisions and no outcome.

Web render tests prove: no decision button before confirmation (explanatory text instead), two unselected buttons after confirmation, two-step prompt, Cancel inert, success shows the decision and removes the buttons, failure and 409 behaviours, reopening removes the current decision and lists it under « Décisions précédentes », a new decision after reconfirmation, no report control, no English text.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, FR-026/038, DR-005, OD-10, the 10.2/10.3 code and the Product Owner rules. None is a CETEM business rule.

- **Final conformity is always an explicit human decision** (PO rule): no automatic overall conformity, no default, no suggestion; the command signature carries the outcome only.
- **Verdict « indisponible » (light-field tolerance unknown) never blocks or steers** either outcome.
- **One decision per confirmed summary version, changed only by reopening.** The AC give no edit path and say a reopening makes the decision historical; insert-only history (DR-005) forbids overwriting. Reopening before designation is the existing, audited way to change it.
- **Invalidation is explicit and by binding.** A separate insert-only `conformity_decision_invalidations` row records when a reopening made a decision historical (OD-10: invalidation happens on reopening); `getCurrentConformityDecision` additionally compares the bound summary `id`, so a missed participant call can never expose a stale decision as current.
- **Reuse of `SUMMARY_NOT_CONFIRMED`** for « no confirmed summary to decide on »; a new code only for the new condition.
- **Either outcome remains eligible for report completion** (AC): 11.x must treat `machine-conforme` and `machine-non-conforme` identically as inputs.
- **Official designation locks the decision** through the existing 10.3 veto: once 11.4 registers its participant, reopening (the only way to change a decision) is refused; this story adds no separate lock.
- **Labels** « Machine conforme » / « Machine non conforme » are the exact wording of FR-038, UX-DR9 and the conformity-decision component.

## Open Questions

None blocking. For the Product Owner, later: whether a recorded decision should be correctable without reopening the summary (not assumed; not requested by the AC).
