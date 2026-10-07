---
id: SPEC-9-4-add-a-manual-insight
story: 9.4
status: approved
approved: 2026-10-08
baseline_commit: d638273
companions:
  - manual-insight-model.md
  - test-plan.md
  - ../spec-9-3-retain-or-discard-proposed-insights-with-provenance/decision-model.md
  - ../spec-9-2-generate-deterministic-insight-proposals-from-approved-rules/insight-rules.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/evidence-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/specs/spec-9-3-retain-or-discard-proposed-insights-with-provenance/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 9.4 — Add a manual insight

## Why

**Pain.** The deterministic registry is empty (DEP-01R), and even when filled it cannot cover every relevant observation. FR-030 lets the Responsable add an insight by hand before summary generation; DR-007/DR-008 require its text, author, date and manual source type to be kept. Today the W5 panel offers nothing to add.

**Story statement.** As a Responsable, I want to add a factual manual insight before summary generation, so that relevant observations not represented by deterministic rules can be retained with attribution.

**What this delivers.** An insert-only manual-insight table, an add route, manual insights in the evidence response, an add form and list in the W5 panel, and a pure domain function that merges retained proposals and manual insights into the single input set Epic 10 will read. Unlike 9.3, this works in production today: it needs no approved rule.

**Traceability.** FR-030, FR-031, DR-007, DR-008, UX-DR2 (insight-item), UX-DR7. Depends on 9.1, 9.2, 9.3 (done). Hands off to 10.1 (summary input).

## Capabilities

Table, route, contract and domain function are in [manual-insight-model.md](manual-insight-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Add a manual insight
  - **intent:** The Responsable adds a free-text insight, with an optional justification, to an accepted own-team audit.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/manual-insights` with `{ text, justification? }` inserts one row holding text, optional justification, author ID, server date, source type `manual`, task, audit, submission, revision and revision identity, and returns 201 with the stored insight.
    - Text is trimmed and required (1–1000 characters after trim). Justification is trimmed, optional, at most 1000 characters; blank becomes absent.
    - The server never accepts author, date or source type from the body.
- **CAP-2** — Attribution and linkage
  - **intent:** Every manual insight is traceable to who wrote it, when, and which audit version it concerns.
  - **success:**
    - The evidence response lists `manualInsights` (required, may be empty), oldest first, each with ID, text, justification or null, `sourceType: "manual"`, author ID and display name, `createdAt`.
    - Each insight is linked to that audit's submission and revision; it never appears on another submission.
- **CAP-3** — Insert-only
  - **intent:** Manual insights are never rewritten or lost (DR-008).
  - **success:** UPDATE, DELETE and TRUNCATE on the table are refused by trigger. Adding two insights keeps two rows; identical text is allowed.
- **CAP-4** — Merged retained set for summary
  - **intent:** Epic 10 reads one set of retained content that distinguishes rule-proposed from manual.
  - **success:**
    - `packages/domain` exports `collectRetainedInsights(proposals, decisions, manualInsights)`: pure; returns retained proposals first (proposal order, `sourceType: "rule"`), then every manual insight (insertion order, `sourceType: "manual"`). Discarded and undecided proposal content is absent.
    - `selectRetainedInsights` (9.3) is unchanged.
    - Manual insights count as retained on creation; no separate decision is needed.
- **CAP-5** — Zero is valid and nothing is gated
  - **intent:** Adding is optional; a review with no insights proceeds.
  - **success:** No flag, counter or gate requires a manual insight. « Aucun insight retenu » shows only when no proposal is retained and no manual insight exists.
- **CAP-6** — Server-side authorization and refusals
  - **intent:** Only the owning team's Responsable can add, only to a real accepted audit.
  - **success:**
    - Employé → 403. Malformed ID, unknown task, other team, draft or no accepted submission → the same 404 `TASK_NOT_FOUND` body as 9.1, no row.
    - Missing, blank or too-long `text`, too-long `justification`, or any extra body property (including author, date, source type) → 422 `VALIDATION_FAILED`, no row.
    - Stored snapshot inconsistent (9.1 CAP-5) → 500 `INTERNAL_ERROR`, no row.
- **CAP-7** — Panel form and list
  - **intent:** The Responsable adds and sees manual insights in the W5 panel.
  - **success:**
    - A form « Ajouter un insight manuel » with a required text field and an optional « Justification » field, and a submit button. It is present for every accepted audit, including when proposals are `unavailable` or empty.
    - Each manual insight shows its text, justification when present, the label « Ajout manuel », « Ajouté par {name} le {date} ». It is visually distinct from « Constat système » items and offers no edit or delete control.
    - Pending disables the submit. Success appends from the response and clears the form. Failure shows a French error, keeps the typed text, and leaves the list unchanged. The panel never evaluates anything.

## Constraints

- Accepted evidence rows (`audits`, `audit_revisions`, `audit_submissions`, lineage tables), `audit_insight_decisions` and `tasks.updated_at` are never written. Only the new insert-only table is written. A manual insight never modifies accepted measurements or comments (FR-031) and is not an attachment: no file, image, URL upload or binary field exists (FR-030, SEC-010).
- No CETEM business rule is invented: no required wording, taxonomy, category, threshold or severity for manual insights. The text is the Responsable's own words; "factual" is guidance in the UI hint, not a validated property.
- A manual insight is not an approval of the employee's work and implies no machine conformity. No such state or wording appears. Final conformity stays an explicit human decision (Epic 10).
- No AI text is produced, suggested, autocompleted or stored. Source type is the fixed value `manual`.
- Text is stored and rendered as plain text (React escaping, no HTML or markdown interpretation). Logs carry IDs and refusal class only, never text, justification or task ID.
- Domain logic in `packages/domain`; `audits` module owns table, command and query; the API delegates (AD-3, `boundaries:check`). `apps/mobile` untouched; no Employé access.
- OpenAPI first: operation and schemas in `packages/types/openapi/cetem-qc-v1.yaml`, then generated types, `packages/schemas` zod (strict), typed client. `contracts:check` passes. The web mutation goes through a Next route handler with the CSRF check and the session cookie only.
- All text in French in `packages/i18n`. Tests use synthetic names, the local PostgreSQL harness (zero skipped) and the existing sync fixture path. No test is deleted, skipped or weakened; no gate script is edited.

## Non-goals

- Editing, deleting or withdrawing a manual insight; bulk add; categories, severity, tags, templates.
- Evidence attachments of any kind; photos; links.
- Summary generation, its input trace, confirmation, locking (Epic 10); reports (Epic 11).
- Defining any rule for CETEM; making the production registry non-empty.
- Employé or mobile access. Deploying anything.

## Success signal

Domain tests prove `collectRetainedInsights` returns retained proposals then manual insights with the right `sourceType`, drops discarded and undecided content, and returns `[]` validly without mutating input.

PostgreSQL route tests prove, on the production registry (no synthetic registry needed): adding inserts exactly one row with text, justification, author, server date, source type, task, audit, submission, revision and identity; two adds keep two rows; the evidence response lists them with author name and date, oldest first, and on no other submission; all 9.1 refusal classes plus invalid body and client-supplied author, date or source type write nothing; UPDATE, DELETE and TRUNCATE are refused; evidence tables, decision table and `tasks.updated_at` are byte-identical; opens still write exactly one access row each and adds write none; an open with no manual insights still works.

Web render tests prove the form, the list with label, author and date, the form presence when proposals are unavailable, « Aucun insight retenu » logic, error handling that keeps typed text, no edit or delete control, and no conformity or approval wording.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, FR-030, DR-007/008, the 9.1–9.3 code and the Product Owner rules. None is a CETEM business rule.

- **Works in production.** A manual insight needs no approved rule, so unlike 9.3 it is usable now; this is what makes the panel useful while DEP-01R is open.
- **Insert-only, no edit or delete.** The AC says only "add"; DR-008 says retain manual additions; 9.3 set the insert-only pattern. A mistaken insight cannot be removed in this story. Logged as a follow-up, not a blocker: summary text remains hand-editable by the Responsable (Epic 10), and a withdrawal row can be added later without changing this table.
- **Retained by construction.** Adding is the act of retaining; no decision row. DR-008 "manual additions retained" is met by the row itself.
- **Source type.** Fixed value `manual`; rule proposals carry `rule` in the merged set. The type is stored per row so DR-007 provenance survives later source types.
- **Justification.** Optional per FR-030 and the AC; blank is stored as absent.
- **Length limits.** 1000 characters for text and justification are technical bounds (abuse and layout), not CETEM rules; recorded here so they can be changed in one place (domain constant).
- **No "before summary confirmation" check yet.** No summary or confirmation state exists until Epic 10, so nothing can be locked. Epic 10 must refuse adds after confirmation; this story adds no unlock or versioning workflow (see vision finding on FR-031).
- **Duplicates allowed.** The system cannot judge equivalence of free text; the pending state prevents accidental double submit.
- **No access-log row.** An add is not an evidence open; the row is its own record.
- **Panel always shown.** The add form is independent of proposal availability.

## Code review (2026-10-08)

- Patched: NUL character in text/justification now refused with 422 by the request schema (PostgreSQL cannot store it; was a 500).
- Patched: two whitespace typos (`",async`, `=apiV1`) from the implementation.
- Rejected: zod length counts UTF-16 units while PostgreSQL counts code points — the API is only stricter, never looser; harmless.
- Gates: pnpm -r test, typecheck, boundaries:check, contracts:check, git diff --check all pass.

## Open Questions

None blocking. For the Product Owner, later: whether a manual insight must be withdrawable after being added (story outside Epic 9 scope).
