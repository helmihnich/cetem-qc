---
id: SPEC-7-3-accept-submissions-transactionally-and-idempotently
story: 7.3
status: approved
approved: 2026-10-04
baseline_commit: 10876d3
companions:
  - server-command.md
  - data-model.md
  - mobile-transport.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-7-1-queue-durable-synchronization-operations/outbox-model.md
  - ../spec-7-1-queue-durable-synchronization-operations/sync-engine.md
  - ../spec-7-2-show-synchronization-and-submission-state-distinctly/state-model.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/implementation-artifacts/deferred-work.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 7.3 — Accept submissions transactionally and idempotently

## Why

**Pain.** The device queues draft-sync and submit operations (7.1) and shows their state (7.2), but nothing on the server receives them. `createAppSyncTransport()` returns `null`, and no audit, revision, submission or idempotency table exists. A submission can never become « Soumis — accepté par le serveur », and the Responsable has no authoritative version.

**Story statement.** As a Responsable, I want each valid employee submission accepted exactly once by the server, so that submitted evidence has one authoritative version.

**Traceability.** FR-021, FR-023, NFR-002, SEC-002, SEC-003, SEC-008, DR-001, DR-004, DR-005, AD-3, AD-4, AD-5, AD-6, AD-7, AD-10; epic-6 retro action item 15; deferred-work entries from 7.1, the 7.1 review and the 7.2 review. Depends on 7.1 and 7.2 (done). DEP-01/02 apply to business validations.

## Capabilities

The HTTP contract, check order and validations are in [server-command.md](server-command.md). The tables are in [data-model.md](data-model.md). The device side is in [mobile-transport.md](mobile-transport.md).

- **CAP-1** — Server sync commands
  - **intent:** The assigned Employé can send a draft-sync or a submission operation for one task, and the server is the only party that decides its outcome.
  - **success:** `POST /api/v1/employee/tasks/{taskId}/draft-syncs` and `.../submissions` accept the envelope in [server-command.md](server-command.md). The actor is the session account, never a body field. A missing or invalid session gets 401. A Responsable gets 403 `FORBIDDEN`. A task that is not assigned to the caller, or does not exist, gets 404 `TASK_NOT_FOUND` with no task data. None of these writes a row.
- **CAP-2** — Transactional acceptance
  - **intent:** An accepted operation is recorded completely in one transaction, or not at all.
  - **success:** One PostgreSQL transaction does four things: it inserts the immutable audit revision `current + 1`, updates the audit's current revision, inserts (for a submission) the accepted-submission row with the submitting actor and the server date, and stores the idempotency outcome. A failure injected after any of these steps leaves zero new rows. Exactly one accepted submission can exist per audit.
- **CAP-3** — Idempotent replay
  - **intent:** A retry never creates a second effect.
  - **success:** The same idempotency key from the same actor with the same request returns the stored status and body, byte-equal, and adds no row. Two concurrent identical requests produce one revision and two identical responses. The same key (or the same operation ID) with a different request or another actor gets 422 `IDEMPOTENCY_KEY_REUSED` and does not reveal the stored outcome.
- **CAP-4** — Stale base revision conflict
  - **intent:** A stale mutation never overwrites current data.
  - **success:** A base revision different from the audit's current revision returns 409 with `outcome: "conflict"` and the current-version metadata (revision, state, last change date and actor). No revision or submission is written. The conflict outcome itself is stored for replay.
- **CAP-5** — Approved validations only
  - **intent:** The server enforces authorization and every validation that is already defined, and invents none of the DEP-01/02 ones.
  - **success:** A payload that fails the catalogue `2.0.0` structural validation (identity, unknown field, non-string value, unknown choice option, NUL, legacy content on a submission) gets 422 `outcome: "rejected"` with a code and issue paths, and changes no audit data. Blank fields and unparseable readings are accepted unchanged. No required-field, range, unit or tolerance check exists. The test plan pins that the DR-004 business validation claim stays blocked on DEP-01/02.
- **CAP-6** — Server recalculation with identity invariant
  - **intent:** Accepted evidence carries results computed by the server under the identity it was submitted with.
  - **success:** For an accepted submission, the server stores the output of `calculateGraphieResults(identity, values)` from `packages/domain`, run on the raw strings. If any result's identity differs from the revision's stored identity, the transaction fails and nothing is written. The client sends no results. Draft-sync revisions store no results.
- **CAP-7** — Mobile HTTP transport and automatic triggers
  - **intent:** Queued operations reach the server on their own, through the 7.1 engine, without loss or duplication.
  - **success:** `createAppSyncTransport` returns the HTTP adapter, which maps every response to the `SyncResult` union ([mobile-transport.md](mobile-transport.md)). Runs start on online authorization, reconnection, return to foreground and after a changed save, plus the 7.2 triggers. A trigger during an active run causes exactly one follow-up run. `TASK_NOT_FOUND` blocks only that task, and the run continues with other tasks.
- **CAP-8** — Server acceptance date on the device
  - **intent:** The Employé sees when the server accepted the submission.
  - **success:** A task whose latest `submit` item is `accepted` shows « Soumission acceptée par le serveur le JJ/MM/AAAA à HH:MM. » from the stored outcome's `acceptedAt` (device local time), under the 7.2 lifecycle label. Without `acceptedAt` the line is not shown, and the lifecycle label is unchanged.

## Constraints

- No CETEM business rule is invented: no required field, range, unit, tolerance, special value or overall conformity. Light field stays « indisponible » through the domain.
- The API and mobile only call `packages/domain` for payload validation and calculations. No formula or validation rule is reimplemented in `apps/*`.
- OpenAPI first. The new operations and schemas go in `packages/types/openapi/cetem-qc-v1.yaml`, then the generated types, the zod schemas in `packages/schemas` and typed client methods with behavioural tests (retro rule epic-4-3).
- API modules follow AD-2/AD-3 and `boundaries:check`. `audits` owns audits, revisions and submissions. `sync` owns the idempotency store and coordinates. Cross-module calls go only through `commands/`, `queries/`, `contracts/`, `ports/` or `index.ts`.
- Every write of one operation is in one PostgreSQL transaction (`withTransaction`). A per-task transaction lock is taken before the idempotency lookup, so concurrent operations on one task run in sequence.
- History rows are insert-only (enforced by a trigger). Logs and error bodies never contain payload values, tokens or credentials.
- The 7.1 outbox schema and repository semantics, and the 7.2 state derivation, stay as they are. The engine may change only for the task-level skip and the follow-up run.
- All user-visible text is in French and lives in `packages/i18n`. Tests use synthetic names and the local PostgreSQL harness, with zero skipped tests. No test is deleted, skipped or weakened, and no gate script is edited.

## Non-goals

- API-level refusal of mutations to accepted evidence by either role, and its availability for review (Story 7.4).
- The Responsable read endpoint or web view of accepted evidence, and changing the task list `state` (Story 9.1; see deferred-work).
- Conflict resolution UI and reloading the server version (8.1). Correction drafts after a rejection (8.2). Replacement (8.3). Deactivation or reassignment recovery (8.4).
- Business validations that wait for DEP-01/02, and approved acceptance fixtures (DEP-02).
- A specific `ACCOUNT_DEACTIVATED` response on sync routes (401 already blocks), and structured workflow diagnostics (12.2).
- OS background execution. Removing resolved outbox items or deleting the local draft after acceptance.
- Deploying anything.

## Success signal

PostgreSQL route tests prove four things. (1) Acceptance writes one revision, one submission with actor and server date, and one stored outcome, and an injected failure rolls everything back. (2) A replay returns the stored body byte-equal with no new row, and concurrent duplicates yield one revision. (3) A stale base returns 409 conflict metadata with nothing written. (4) Structural rejections return 422 while blank and unparseable readings are accepted. Server results equal `calculateGraphieResults` for the stored identity. Mobile tests prove that the adapter maps each status as in [mobile-transport.md](mobile-transport.md), that a lost response retried through the engine produces a single `accepted` outcome, that `TASK_NOT_FOUND` skips only its task, that a trigger during a run gets a follow-up run, and that the acceptance line renders. `pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, AD-3 to AD-7, FR-021/023, the 7.1/7.2 specs and hand-offs, the current code and the Product Owner rules. None is a CETEM business rule.

- **Server draft-sync command is in 7.3.** This resolves the 7.1 deferred entry. FR-021 requires drafts to synchronize. With a real transport, attempted `sync-draft` items come before the task's `submit` item in engine order, so without an endpoint every submission would stay blocked. Both commands share the idempotency store and the revision check.
- **Revision model.** There is one audit per task, created on its first accepted operation. With no audit, the current revision is `0`. Every accepted draft-sync or submission adds revision `current + 1`. The base revision must equal the current revision.
- **Validation scope.** The only validations that exist are the structural ones the app already applies to a catalogue `2.0.0` payload (`parseGraphiePayload`). The 6.3 and 6.4 specs keep blank and unparseable readings as valid evidence. DR-004 type, unit, range and required-field rules are DEP-01/02 and are not enforced.
- **One validator.** The catalogue data and the payload validator move to `packages/domain`. `apps/mobile/graphie-pov-catalogue.ts` re-exports them, so mobile behaviour does not change.
- **Outcomes stored.** Accepted, rejected and conflict are stored with their HTTP status and body in the same transaction. Envelope errors (400), authorization failures and key reuse are not stored.
- **Assignment on replay.** Assignment is checked before the idempotency lookup, every time (SEC-003). A reassigned task answers 404, and the item stays blocked until 8.4.
- **After acceptance.** Any new operation on a submitted audit is rejected with `AUDIT_ALREADY_SUBMITTED` (stored). 7.4 broadens this to every mutation path.
- **Dates.** `acceptedAt` is the server's `now()`. The client's `savedAt` and local revision are kept for traceability only.
- **Technical limits.** Sync routes accept up to 256 kB of JSON, and other routes keep 32 kB. The device times out after 30 s. A NUL character is `INVALID_PAYLOAD`, because PostgreSQL `jsonb` cannot store it.
- **Triggers and follow-up run.** These resolve the 7.2 review deferral. **Task-level skip** resolves the 7.1 review deferral.
- **Automatic runs leave blocked items alone (build, 2026-10-05).** Automatic triggers call `engine.run(employeeId, { retryBlocked: false })`: a `blocked` item and the later items of its task wait for the explicit 7.2 retry (`retryBlocked` defaults to `true`). Without this, every foreground or reconnection would re-send a `TASK_NOT_FOUND` or 401-blocked item, contradicting « the item stays blocked until 8.4 ». A follow-up run includes blocked items if any caller asked for it. Engine test « automatic runs leave a blocked item… ».
- **Acceptance line wording.** EXPERIENCE.md says « à [heure] ». The date is added because the task may be viewed on another day.

## Open Questions

None blocking. Showing the accepted state in the Responsable task list is placed in Story 9.1 (deferred-work entry added).

## Code review (2026-10-05)

Four layers ran: blind, edge-case, verification-gap and acceptance. No finding needs a business decision.

**Patched**
- A NUL or an unpaired surrogate in an unknown key was copied into `issues[].path`. Storing the rejection in `jsonb` then failed, so the client got 500 and retried without end. `validateGraphiePayload` now replaces those characters in issue paths (domain test V2, API test A8).
- An idempotency key or operation ID sent in upper case was not recognized on replay, because PostgreSQL returns uuids in lower case. The replay got 422 `IDEMPOTENCY_KEY_REUSED`. The comparison is now case-insensitive (API test A3).
- The 256 kB route selector was case-sensitive, but Express routing is not. It is now case-insensitive (API test A12).
- Tests added for gaps the review found:
  - a submission between 32 and 256 kB is accepted, and a non-sync route still refuses bodies over 32 kB (API test A12);
  - concurrent reuse of one key on two tasks gives 200 and 422, never 500 (API test A6);
  - no automatic trigger resends a blocked item (App render test R15).

**Deferred** (see deferred-work.md): assignment is not re-checked under the task lock (Story 8.4); unpaired surrogates in field values (next validation change); an engine test for an explicit run that joins an automatic run.

**Rejected**
- 404 on a replay after reassignment: the « Assignment on replay » decision above.
- The response's `operationId` is not checked against the request on the device: both routes are `POST` with `no-store`, so no cache can serve another response.
- The identity check passes when the results are empty: `calculateGraphieResults` always returns its five results, and A14 pins them.
- `audits` has no database guard on state or revision: `audits` is the current-state pointer and stays updatable by design (data-model.md), and only `advanceAudit` writes to it, under the task lock.
- Every changed save becomes a server revision, with no retention: this is trigger 4 and the insert-only history the spec requires.
- 413 has no recovery path on the device: the spec maps 413 to `blocking`, and a catalogue form cannot realistically exceed 256 kB.
- 413 `PAYLOAD_TOO_LARGE` now applies to every route: those routes already answered 413, now with a JSON `ApiError` instead of the default HTML page.
- The sync route's `catch` logs nothing: this follows the no-payload-in-logs constraint and the existing routes, and structured diagnostics are Story 12.2.
- `graphieDraftPayloadSchema` hard-codes the identity literals: it mirrors the OpenAPI `GraphieDraftPayload` literals, and no server or client path validates with it. A catalogue version bump is a contract change that updates both together.
- R16 builds its expected string with the same local-time getters: test-plan R16 prescribes exactly this.
- `acceptedAt` can be earlier than the previous revision's date under lock contention: the spec sets it to the transaction's `now()`. Operations on one task are sequential per device, and a concurrent base would conflict.
- `localDraftRevision` above int32, or year 0000, gives 500: the device's local revision counter and `Date.now()` cannot produce such values.
- The second attempt of the unique-violation retry is not caught: that attempt reads the committed outcome, so a third concurrent duplicate would be needed.
- A `savedAt` outside the `Date` range throws in the adapter: `savedAt` always comes from `Date.now()`.
- `PAYLOAD_TOO_LARGE`, `IDEMPOTENCY_KEY_REUSED`, `VALIDATION_ERROR` and 401 are not task-level, or 401 should be retryable: mobile-transport.md sets these mappings.
- The follow-up summary overwrites `blocked`, and queued calls for another employee may add one extra run: no caller reads `summary.blocked`, and an extra run that finds nothing is harmless.
- The App still accepts a `null` transport from test doubles: the production module never returns `null`, and test-plan R7 allows the mocked module.
- `parseGraphiePayload` stays in mobile: delivery-notes.md keeps it « unchanged in behaviour », and parity test V4 guards against drift.
- The body parser runs before the session check: mounting the parser per route would parse before the handler too, and nothing is written either way.
- The `retryBlocked` engine option is beyond « task-level skip and follow-up run »: it is recorded as a build decision above, and the fix would be a spec edit.
- A submission request resends blocked items: it is an explicit user action (a 7.2 trigger), and it must be able to send a task whose earlier `sync-draft` is blocked.
- `acceptedAt` is truncated to milliseconds: this keeps the stored value equal to the ISO response, and ISO dates in JS carry milliseconds.
