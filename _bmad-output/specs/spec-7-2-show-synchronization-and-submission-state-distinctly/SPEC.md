---
id: SPEC-7-2-show-synchronization-and-submission-state-distinctly
story: 7.2
status: approved
approved: 2026-10-04
baseline_commit: 9f0ff9d
companions:
  - state-model.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-7-1-queue-durable-synchronization-operations/outbox-model.md
  - ../spec-7-1-queue-durable-synchronization-operations/sync-engine.md
  - ../../planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 7.2 — Show synchronization and submission state distinctly

## Why

**Pain.** Story 7.1 records every save and submission request in a durable outbox, but the Employé cannot see it. The task detail always shows « État : Brouillon » and « Dernier état serveur : synchronisé ; modifications locales non soumises », even when nothing has reached the server. There is no Soumettre action, so the pending read-only state cannot exist. The Employé cannot tell which copy is authoritative.

**Story statement.** As an Employé, I want to see whether work is saved, synchronized, pending submission or server accepted, so that I know which copy is authoritative.

**Traceability.** FR-021, FR-042, UX-DR2 (status-badge, sync-status, alert-message, loading-state), UX-DR4, UX-DR5, UX-DR13. Depends on Story 7.1 (done).

## Capabilities

States, mapping rules and French copy are in [state-model.md](state-model.md).

- **CAP-1** — Distinct derived task state
  - **intent:** The task detail shows lifecycle, transfer, connectivity and local save as separate French states, derived from durable data.
  - **success:** A pure function maps a task's outbox items to one lifecycle state and one transfer state ([state-model.md](state-model.md)). The detail renders « État », « Synchronisation », « Connectivité » and « Enregistrement local » as four separate lines. The hard-coded « synchronisé » text is gone. After a simulated restart the same rows render the same state.
- **CAP-2** — Explicit submission request
  - **intent:** The Employé can explicitly request submission of the current draft, online or offline.
  - **success:** « Soumettre » opens a confirmation. Confirming flushes pending edits and calls `requestSubmission` once; the state becomes « Soumission en attente de synchronisation ». Cancelling changes nothing. A repeated tap cannot create a second `submit` item. A `SubmissionNotAllowedError` shows a French alert and changes nothing.
- **CAP-3** — Locked after the submission request
  - **intent:** A pending or resolved submission is locally read-only until later recovery stories unlock it.
  - **success:** While the lifecycle is not « Brouillon », fields, choices and the legacy text field are not editable, autosave and « Enregistrer » do nothing, and « Supprimer le brouillon local » and « Soumettre » are hidden. Values stay readable, with their calculated results. Reopening the task, going offline or restarting keeps it locked. No `PendingSubmissionError` reaches the user as a save failure.
- **CAP-4** — Retry after a transfer failure
  - **intent:** A retryable or blocked transfer keeps the data and offers a retry.
  - **success:** For a `retry-paused` or `blocked` item, an alert and « Réessayer la synchronisation » are shown. Pressing it starts one engine run for the signed-in employee, only when online, online-authorized and a transport exists. The draft, snapshot and pending state are unchanged by any failure.
- **CAP-5** — Submitted only on server acceptance
  - **intent:** Only a definitive server acceptance renders the audit as submitted.
  - **success:** « Soumis — accepté par le serveur » appears only when the latest `submit` item is resolved `accepted`. A transport that returns a non-union success (for example `{ ok: true }` or an HTTP 200 body without `type: "accepted"`), throws, or times out leaves « Soumission en attente de synchronisation ». Being online changes nothing either.
- **CAP-6** — Per-task state in the task list
  - **intent:** The task list shows each task's state without opening it.
  - **success:** Every row (server list, resumable drafts, cached tasks) shows the derived lifecycle label, plus the transfer label when an item is unresolved or failed. It never shows a fixed « Brouillon » or « synchronisé » label that contradicts the outbox.

## Constraints

- Changes are limited to `apps/mobile` and `packages/i18n`. No change to `apps/api`, OpenAPI, `packages/schemas`, the catalogue, rule identity or domain calculations. The 7.1 schema, repository semantics and engine semantics stay as they are. A defect may be fixed only when a failing test proves it.
- State is derived from durable outbox rows (re-read after every save, submission request, run and task open). It never comes from in-memory transport results.
- All new user-visible text is French and lives in `packages/i18n/src/fr.ts`. The labels in EXPERIENCE.md are used verbatim where they exist.
- Status is never shown by colour alone. Failures use `accessibilityRole="alert"` and routine states use `summary`. Busy is never shown as success (UX-DR13).
- A sync run requires that the device is online, `authorization.evaluate(employeeId)` is `online-authorized` and the transport is not null. No sync runs before the server revalidates authorization.
- Tests use the existing doubles and fake transports. They never use real client names. No test is deleted, skipped or weakened, and no gate script is edited.

## Non-goals

- The HTTP `SyncTransport` adapter, server draft-sync and submission endpoints, idempotency store and acceptance transaction (Story 7.3).
- Automatic sync triggers: app start, reconnect, foreground and after save (Story 7.3, as handed off by 7.1).
- Conflict resolution UI (8.1), correction draft after rejection (8.2), deactivation and unassignment recovery (8.4).
- Showing the server acceptance date and actor (needs the 7.3 response), and the Responsable web view of submissions (Epic 9).
- Client-side blocking validations before submission (DEP-01/02, server-side in 7.3).
- Deleting the local draft or outbox rows after acceptance.

## Success signal

Mobile tests show five things. (1) The state function returns the expected lifecycle and transfer state for every row of the mapping table. (2) An App render with seeded outbox rows shows each lifecycle label and never the old fixed « synchronisé » text. (3) Soumettre plus confirmation creates exactly one `submit` item offline, and the form is then read-only and stays so after a remount. (4) A fake transport that fails retryably shows the retry action, and pressing it sends the same idempotency key again. (5) A fake transport returning `{ ok: true }` leaves the task pending, and `accepted` shows « Soumis — accepté par le serveur ». `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, EXPERIENCE.md (state table, French labels, OD-01/OD-02a), the 7.1 hand-off, the current code and the Product Owner rules. None is a CETEM business rule.

- **Transport seam.** The App gets its transport from the new `apps/mobile/sync/app-sync-transport.ts` → `createAppSyncTransport(): SyncTransport | null`. It returns `null` in 7.2, so no run happens and items stay queued. This is safe and loses nothing. Render tests mock the module with `mock.module`. Story 7.3 replaces its body with the HTTP adapter.
- **Triggers.** 7.2 wires two triggers: the explicit retry action, and a run right after a successful submission request. The other triggers belong to 7.3.
- **Lifecycle.** The latest `submit` item of the task decides the state. Unresolved → pending. `accepted` → Submitted. `rejected` → acceptance blocked. `conflict` → conflict. No `submit` item → Brouillon.
- **Lock.** Every lifecycle other than Brouillon is read-only. Rejected and conflict stay locked until 8.1/8.2 provide the explicit recovery, because a pending audit never returns to editable Draft automatically.
- **No acceptance time** in 7.2. The device knows only its local recording time. The server date and actor arrive with 7.3.
- **No client-side validation** blocks Soumettre. Only the 7.1 local refusals apply: legacy content and unparseable draft.

## Open Questions

None blocking. If no story places the server draft-sync command (7.1 deferred-work entry), `sync-draft` items show « En attente de synchronisation » indefinitely. That is truthful.

## Review Findings

Code review, 2026-10-04: four review layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). Result: 9 patched, 1 deferred, 12 rejected.

- [x] [Review][Patch] A failed earlier `sync-draft` that holds a pending `submit` back was shown as « En attente », with no retry [apps/mobile/sync/task-sync-state.ts:23]. **Decision:** the engine sends a task's items in sequence order. So for `submission-pending`, the transfer state comes from the task's first unresolved item. That item is `S` unless an earlier attempted `sync-draft` is still unresolved. This applies CAP-4 and is not a business rule. Covered by S5 and new R1 rows.
- [x] [Review][Patch] The busy flag was not scoped to an employee and was never cleared after a sign-out during a run, so the next session showed « en cours » and no retry [apps/mobile/App.tsx:107]. Covered by R11.
- [x] [Review][Patch] When the first outbox read failed, the task fell back to « Brouillon » and stayed editable even with a pending submission [apps/mobile/App.tsx:185]. Opening a task now requires the outbox read, and a later failed refresh keeps the previous state. Covered by R13.
- [x] [Review][Patch] A refused or failed submission request cancelled the pending autosave and never scheduled it again [apps/mobile/App.tsx:255]. Covered by R14.
- [x] [Review][Patch] The fallback « Reprendre le brouillon » panel had no « Synchronisation » line, no retry and no read-only notice (CAP-1, CAP-3, CAP-4) [apps/mobile/App.tsx:1260].
- [x] [Review][Patch] The delete and Soumettre confirmations could be open at the same time [apps/mobile/App.tsx:996].
- [x] [Review][Patch] Submission errors were set without an identity check, so they could appear after a sign-out [apps/mobile/App.tsx:253].
- [x] [Review][Patch] The transport factory ran on every render (an issue for the 7.3 HTTP adapter) [apps/mobile/App.tsx:113].
- [x] [Review][Patch] Some paths had no tests: the busy state during a run, the generic `submissionFailed` path, outbox read failures, and the draft rows in R1 for `retry-paused`, `conflict`, and a failed `sync-draft` before `submit` [apps/mobile/App.render.test.tsx]. Added R11–R14 and three R1 cases.
- [x] [Review][Defer] A submission requested during an active run joins that run's earlier task list and stays queued [apps/mobile/App.tsx:246]. Deferred: not reachable in 7.2 (the transport is `null`). Handed off to the 7.3 automatic triggers (see deferred-work.md).

### Rejected

- One `syncRunning` flag covers all tasks. Rejected because delivery-notes.md (« Busy state ») specifies it, and every unresolved item is part of the run.
- The list label says « en attente de synchronisation » twice. Rejected because CAP-6 requires the lifecycle plus the transfer label.
- « Conflit de synchronisation » is used for both the draft conflict and the submission conflict. Rejected because state-model.md specifies that label for both.
- `acceptance-blocked` and `conflict` have no `alert` line. Rejected because state-model.md says the line is not rendered, and changing that would mean editing the approved spec.
- Soumettre is disabled rather than hidden while submitting. Rejected because the spec says the busy flag "disables the button", and the impact is cosmetic.
- Retry with a `null` transport gives no feedback. Rejected because it is unreachable in 7.2: without a transport, no item ever leaves `queued`.
- `leaveTaskDetail` or `signOut` during the few milliseconds of a local submission request can report `saveFailed`. Rejected as low and rare; the fix would add more state.
- After an unlock caused by a failed read, a `PendingSubmissionError` in `saveDraft` shows « Enregistré ». Rejected because the R13 fix makes that path unreachable.
- R4 and R5 wait in real time (about 17 s). Rejected as low: the timing margins are fixed and do not depend on load, and fixing it would need a new sleep seam.
- The test double's outbox `UPDATE` handlers depend on parameter positions. Rejected as low and test-only: an SQL change fails loudly.
- `fr.workflow.synchronizedNotSubmitted` and other old `fr.workflow` labels remain. Rejected because they are pre-existing and outside this story's string set; state-model.md covers only the `employeeTasks` key.
- R4 is flaky (Edge Case Hunter duplicate). Rejected, same reason as the R4/R5 timing item above.
