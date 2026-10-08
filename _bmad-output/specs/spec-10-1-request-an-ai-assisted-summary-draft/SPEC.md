---
id: SPEC-10-1-request-an-ai-assisted-summary-draft
story: 10.1
status: approved
approved: 2026-10-08
baseline_commit: 0826b68
companions:
  - ai-summary-model.md
  - test-plan.md
  - ../spec-9-4-add-a-manual-insight/manual-insight-model.md
  - ../spec-9-3-retain-or-discard-proposed-insights-with-provenance/decision-model.md
  - ../spec-9-1-review-accepted-audit-evidence-read-only/evidence-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/specs/spec-9-4-add-a-manual-insight/SPEC.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 10.1 — Request an AI-assisted summary draft

## Why

**Pain.** FR-032 lets the Responsable ask for a written summary of an accepted audit. Today the W5 panel ends with the insights; nothing helps write the summary and no AI boundary exists. AD-8/AD-9 and SEC-011 (AI control) require that only authorized audit data and retained insights feed the AI, that the exact inputs and provider provenance are kept, and that AI never blocks the workflow nor decides conformity.

**Story statement.** As a Responsable, I want to request a summary draft grounded in authorized audit data and retained insights, so that writing assistance is useful without becoming an authority over the result.

**What this delivers.** A pure domain function that builds the exact input set from the stored snapshot and the retained insights, an `ai` port with `mock` (default) and `gemini` adapters, an insert-only table recording every request (success or failure) with its input set, one request route, and a draft block in the W5 panel. Saving edits, confirmation and locking are Story 10.2.

**Traceability.** FR-032, SEC-011 (AI control), DR-008, DR-009, AD-8, AD-9, UX-DR2 (loading-state, alert-message), UX-DR7, UX-DR8. Depends on 9.1–9.4 (done). Hands off to 10.2 (reads the recorded draft and its input set).

## Capabilities

Table, port, input set, route and contract are in [ai-summary-model.md](ai-summary-model.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Build the exact input set
  - **intent:** The provider receives only authorized audit data and the current retained insights, assembled by the server alone.
  - **success:**
    - `packages/domain` exports `buildSummaryInputSet(...)`: pure; takes the stored snapshot parts (identity, payload values, results) and `RetainedInsight[]` (from `collectRetainedInsights`); returns the input set defined in the model file.
    - The input set contains no task, establishment, service, employee, author or account name or ID, and no discarded or undecided proposal content. Zero retained insights gives an input set with an empty insight list and is valid.
    - `summaryInputSetId` is the SHA-256 of the canonical (sorted-key) JSON of the input set, so equal inputs give equal identities.
    - The client never supplies any input: the route body is empty.
- **CAP-2** — Request a draft
  - **intent:** The Responsable of the owning team requests a draft for an accepted audit.
  - **success:**
    - `POST /api/v1/tasks/{taskId}/summary-drafts` with body `{}` evaluates the retained set server-side (rule proposals, decisions, manual insights as of the request), builds the input set, calls the configured provider once and, on success, inserts one row and returns 201 with the draft (`id`, `text`, `status: "generated"`, `provider`, `model`, `requestedAt`, `requestedBy`, `summaryInputSetId`).
    - The draft is not a confirmed summary: the response, the table and the UI carry no confirmation, no overall conformity and no « Machine conforme / non conforme » value.
    - The provider call is not made inside a database transaction.
- **CAP-3** — Provenance and input trace
  - **intent:** Every request is traceable to who asked, when, what was sent, and who answered (DR-008, DR-009, SEC-011).
  - **success:** The row stores requester ID, server date, task, audit, submission, revision and revision identity, `summaryInputSetId`, the full input set as sent, provider name, model name, status, and the draft text on success. Provider and model are what the adapter reports (`mock` / `mock-fixed-text` for the mock).
- **CAP-4** — Failures are recorded and recoverable
  - **intent:** A failing AI never blocks the workflow and never looks like a draft.
  - **success:**
    - Provider error, timeout (20 s), empty or non-text output, or missing configuration inserts one row with `status: "failed"`, a fixed `failure_class` (`not-configured`, `timeout`, `provider-error`, `empty-output`), no draft text, and returns 502 `AI_UNAVAILABLE` with a French message. The same request can be sent again; each attempt is a new row.
    - Provider error text, prompts and keys are never stored in the failure row, returned or logged.
- **CAP-5** — Insert-only
  - **intent:** Requests and drafts are never rewritten or lost (DR-009).
  - **success:** UPDATE, DELETE and TRUNCATE on the table are refused by trigger. A second request keeps both rows.
- **CAP-6** — Provider adapter and configuration
  - **intent:** The AI vendor is replaceable and the default needs no account (AD-9).
  - **success:**
    - `ai` module port `SummaryDraftProvider`; `AI_PROVIDER` unset or `mock` selects the mock (fixed French text, no network, used by all tests); `gemini` selects Google Gemini using `GEMINI_API_KEY` (and optional `GEMINI_MODEL`) read from the environment only; any other value falls back to the mock with one startup warning that names no secret.
    - `gemini` without `GEMINI_API_KEY` yields the `not-configured` failure, not a crash.
    - `.env.example` lists `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` with empty values.
- **CAP-7** — Authorization and refusals
  - **intent:** Only the owning team's Responsable can request, only for a real accepted audit.
  - **success:**
    - Employé → 403. Malformed ID, unknown task, other team, draft or no accepted submission → the same 404 `TASK_NOT_FOUND` body as 9.1, no row, no provider call.
    - Any non-empty body property → 422 `VALIDATION_FAILED`, no row, no provider call.
    - Stored snapshot inconsistent (9.1 CAP-5) → 500 `INTERNAL_ERROR`, no row, no provider call.
- **CAP-8** — Panel block
  - **intent:** The Responsable requests, reads and edits a draft, or writes by hand, in the W5 panel.
  - **success:**
    - A block « Synthèse » with the button « Demander un brouillon IA », a visible loading state while pending (button disabled), and a text area « Texte de la synthèse » that is always present and always editable, with or without AI.
    - On success the draft fills the text area when it is empty and is labelled « Brouillon IA — non confirmé » with provider/model and date. When the text area already holds text, the new draft appears in a separate block with « Remplacer le texte par ce brouillon »; typed text is never overwritten silently.
    - On failure an alert shows « Le brouillon IA n’est pas disponible. Réessayez ou rédigez la synthèse manuellement. », typed text is kept, and the retry button stays enabled.
    - The block states the text is a draft not yet confirmed and that the conformity decision stays with the Responsable; it offers no save, confirm or conformity control (Story 10.2 / 10.4). The panel never calls a provider itself.

## Constraints

- Only the new insert-only table is written. Accepted evidence tables, `audit_insight_decisions`, `audit_manual_insights`, `audit_review_accesses` and `tasks.updated_at` are never written by a request.
- The provider receives measurement values, stored results with their per-test verdicts, the comments already in the accepted payload, and retained insights, and nothing else. The prompt tells the model to summarize only that data, to invent no value, rule or tolerance, and to give no overall conformity or approval. No CETEM rule is invented: the prompt is wording guidance, not a business rule, and the Responsable edits the text.
- Comments are free text entered by the Employé and are part of the accepted audit; they are sent as stored. Whether CETEM wants them withheld from an external provider is a deployment choice, covered by `gemini` being off by default (see decisions).
- Prompt text, input set content, draft text, provider responses, task IDs and keys never appear in logs. Log lines (`console.info` JSON) carry event, actor ID, provider name, status, failure class and duration only.
- The API key is read from the environment only, never persisted, returned or logged. Tests never reach the network: the gemini adapter is tested with an injected `fetch`.
- Final conformity stays an explicit human decision. The draft is plain text, stored and rendered as text (React escaping). No AI text becomes an insight, a confirmed summary, a report field or a conformity value in this story.
- Domain logic in `packages/domain`; `summaries` module owns table and command, `ai` module owns port and adapters; the API delegates (AD-3, AD-9, `boundaries:check`). Reuse the 9.x queries; do not duplicate or reach into `audits` tables from `summaries` (add a public read function in `audits` if the boundary check requires it). `apps/mobile` untouched; no Employé access.
- OpenAPI first: operation and schemas in `packages/types/openapi/cetem-qc-v1.yaml`, then generated types, `packages/schemas` zod (strict), typed client. `contracts:check` passes. The web call goes through a Next route handler with the CSRF check and the session cookie only.
- All text in French in `packages/i18n`. Tests use synthetic names, the mock provider, the local PostgreSQL harness (zero skipped) and the existing sync fixture path. No test is deleted, skipped or weakened; no gate script is edited.

## Non-goals

- Saving edited text, summary versions, confirmation, locking, reopening (10.2, 10.3); the conformity decision (10.4); reports (Epic 11).
- Listing or re-reading past drafts in the UI; a draft left unsaved is lost on reload (10.2 owns persistence of edited text; the row remains as the audit trail).
- Streaming, prompt tuning UI, model choice in the UI, rate limiting, cost tracking.
- Making AI mandatory, or the AI creating insights, rules or conformity.
- Deploying anything, obtaining a Gemini account, or calling Gemini in tests. Employé or mobile access.

## Success signal

Domain tests prove `buildSummaryInputSet` is pure, excludes identities and names and discarded/undecided content, handles zero insights, and gives equal identity for equal input and different identity when any input differs.

PostgreSQL route tests, with the mock provider, prove: a request returns 201 and inserts one row with requester, date, task, audit, submission, revision, identity, input set, `summaryInputSetId`, provider, model and text; the stored input set contains exactly the retained insights at request time (a discarded proposal and a later-added manual insight are reflected correctly; zero insights works); a second request keeps two rows; a failing provider inserts a `failed` row, returns 502, and a retry succeeds; all 9.1 refusal classes and a non-empty body write nothing and never call the provider; UPDATE, DELETE and TRUNCATE are refused; evidence, decision, manual-insight and access tables and `tasks.updated_at` are byte-identical; log lines contain no text, prompt, key or task ID.

Adapter tests prove the gemini adapter sends the key as a header only, maps success, HTTP error, timeout, malformed and empty responses to the fixed failure classes without echoing provider text, and that provider selection follows `AI_PROVIDER`.

Web render tests prove the button, loading state, draft fill and label, no silent overwrite, failure alert with kept text and retry, the always-editable text area, and no confirmation or conformity control or wording.

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, FR-032, SEC-011, AD-8/9, the 9.x code and the Product Owner rules. None is a CETEM business rule.

- **Provider adapter, mock by default.** Per the PO decision: `mock` (fixed French text, all tests) and `gemini` (key from `GEMINI_API_KEY`, enabled by `AI_PROVIDER=gemini`). The default needs no account and sends nothing outside.
- **Server builds the input.** The client cannot influence what is sent; this is what makes « only authorized data and retained/manual insights » enforceable. The retained set is read at request time and is the only feed (epic 9 retro item 32).
- **Minimal input, no identities.** Task, establishment, service, employee and author names and IDs are excluded (SEC-011 « unnecessary sensitive payloads », PO rule « never send real client names »). Measurement and comment content is the audit data FR-032 names.
- **Per-test verdicts are included, overall conformity is not.** Verdicts are the Story 6.6 results already stored; no overall verdict exists to send. A « indisponible » verdict (light field) is sent as such.
- **Exact input-set identity = SHA-256 of canonical JSON, plus the full input set stored.** Satisfies « exact input-set identity » and DR-009 « actual inputs »; Epic 10.2 can compare the identity of the confirmed summary's inputs with this one. Storing the sent input duplicates evidence already in the database but is required to prove what the provider received; it is not logged.
- **Failures are rows, not exceptions.** Recording failed attempts (class only) keeps provenance of every provider call. The route answers 502 `AI_UNAVAILABLE`; the UI offers retry and manual entry.
- **Two-state failure model.** `generated` and `failed` only; no confirmed/edited states here (10.2).
- **Edit is client-side in 10.1.** « Editable draft » is met by the always-editable text area. Persisting edited text and the initial-draft link is 10.2 (« preserves the initial AI draft … and final confirmed text »). The recorded row is the initial AI draft 10.2 will reference by ID.
- **No overwrite of typed text.** A draft only fills an empty text area; otherwise the user chooses to replace.
- **Timeout 20 s, mock instantaneous.** Technical bound for responsiveness, not a CETEM rule; one constant.
- **Gemini details.** REST `generateContent` on the configured model with the key in the `x-goog-api-key` header, default model `gemini-2.5-flash` overridable by `GEMINI_MODEL`; a technical default, changeable by environment without code change.
- **Unknown `AI_PROVIDER` → mock with a warning.** Avoids an unexpectedly unreachable AI path; the provider and model stored on each row show which one answered.
- **Not blocked by an unsettled summary lock.** No summary state exists before 10.2; requests are allowed repeatedly. 10.2 must refuse drafts after confirmation (retro item 32 extends to this route).
- **JSON primitive bodies get the application-wide 400.** `null` and bare strings are refused by the existing strict JSON parser (`400 VALIDATION_ERROR`) before the route, as for 9.3/9.4; objects and arrays with any content get 422. Both write nothing and never call the provider.
- **Comments go to the provider.** They are part of the accepted audit and the only place observations beyond numbers live; withholding them would make the summary useless. Risk is bounded by the opt-in `gemini` switch; a deployment guide note belongs to Epic 12.

## Open Questions

None blocking. For the Product Owner, later: whether CETEM allows free-text comments to leave to an external AI provider in production (relevant only when `AI_PROVIDER=gemini` is enabled for a real deployment).
