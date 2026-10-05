---
id: SPEC-8-2-create-a-correction-draft-after-validation-rejection
story: 8.2
status: done
approved: 2026-10-05
baseline_commit: 68061f7
companions:
  - correction-model.md
  - server-support.md
  - correction-ui.md
  - payload-validation.md
  - test-plan.md
  - delivery-notes.md
  - ../spec-8-1-resolve-a-synchronization-conflict-explicitly/conflict-model.md
  - ../spec-8-1-resolve-a-synchronization-conflict-explicitly/server-support.md
  - ../spec-7-1-queue-durable-synchronization-operations/outbox-model.md
  - ../spec-7-2-show-synchronization-and-submission-state-distinctly/state-model.md
  - ../spec-7-3-accept-submissions-transactionally-and-idempotently/server-command.md
sources:
  - .automation/task.md
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md
  - _bmad-output/implementation-artifacts/deferred-work.md
  - _bmad-output/implementation-artifacts/epic-7-retro-2026-10-05.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 8.2 — Create a correction draft after validation rejection

## Why

**Pain.** When the server refuses a submission with a stored 422, the device derives `acceptance-blocked` (7.2) and nothing comes after that:
- The task is read-only forever. Soumettre is hidden and no action is offered.
- The stored rejection detail (`code`, `issues`) is never shown, so the Employé does not know what to fix.
- No lineage links a later attempt to the refused one (AD-6).
- The device and the server check the payload with two copies of the same rules, which already differ (epic-7 retro item 20). A lone UTF-16 surrogate makes the server fail with 500 instead of a 422 (deferred, 7.3 review).

**Story statement.** As an Employé, I want to correct a rejected pending submission in a new linked draft, so that the original attempt remains intact while valid data can be resubmitted.

**Traceability.** FR-023, FR-024, UX-DR5, AD-3, AD-4, AD-5, AD-6, EXPERIENCE.md « Explicit correction of a non-conflict acceptance blocker » and its state rows. Also: epic-7 retro item 20, the deferred 7.3 entry « unpaired UTF-16 surrogate », and the 8.1 hand-off. Depends on 7.1–7.4 and 8.1 (done). DEP-01R/DEP-02 stay unresolved and gated.

## Capabilities

The local model, derivation and engine change are in [correction-model.md](correction-model.md). The envelope field, check and migration are in [server-support.md](server-support.md). The screens and their French copy are in [correction-ui.md](correction-ui.md). The validator alignment is in [payload-validation.md](payload-validation.md). Test IDs are in [test-plan.md](test-plan.md).

- **CAP-1** — Show the rejected submission
  - **intent:** The Employé sees that the server did not accept the submission, and why, without the attempt being mislabelled.
  - **success:** For a task whose latest submission was refused, the task detail shows « Soumission bloquée — non acceptée par le serveur ». It also shows:
    - the French message for the stored code;
    - one line per stored issue: `section › champ` (or « Formulaire ») and a French issue text. Values are never shown;
    - a line saying the refused submission is kept on this device, read-only.

    Nothing says « conflit », « accepté » or that the work was rejected by a person. No conflict-resolution action is offered.
- **CAP-2** — Create a correction draft
  - **intent:** On explicit request, the Employé gets a new editable draft initialized from the refused snapshot, linked to it, while the original stays intact.
  - **success:** « Créer un brouillon de correction » is offered when the refusal qualifies (every stored code except `AUDIT_ALREADY_SUBMITTED`) and the task has no open conflict. It works offline. One exclusive local transaction does three things:
    1. inserts an insert-only correction record linking the task to the refused operation and its snapshot;
    2. writes the snapshot payload as the next local draft revision;
    3. queues nothing.

    The refused outcome, its snapshot and every other row stay unchanged. A refusal (stale screen, unreadable snapshot, open conflict, unresolved item) or a storage failure changes nothing and shows « Le brouillon de correction n’a pas pu être créé. La soumission refusée est conservée. ».
- **CAP-3** — Correct and resubmit through the normal flow
  - **intent:** The correction draft behaves like any draft until the server accepts a submission.
  - **success:**
    - The task shows « Brouillon de correction » and « Correction de la soumission refusée le {date} à {time} ». The form is editable. The issue texts are shown on their fields.
    - Saves, sync-drafts and Soumettre follow the 7.1–7.3 rules: pending read-only after Soumettre, and Submitted only on server acceptance.
    - A refusal of the correction's submission shows CAP-1 again and allows a new correction linked to that newer refusal.
    - Network failure or `blocked` never offers the correction action.
- **CAP-4** — Server correction lineage
  - **intent:** The server records the correction as typed, immutable lineage to the refused attempt.
  - **success:**
    - The sync envelope accepts an optional `correctionOfOperationId`.
    - The first accepted operation carrying a valid reference inserts one `rejected-submission-correction` row in `audit_lineage_links`, in the acceptance transaction.
    - A later operation carrying the same reference, already linked to the same audit, is accepted without a second row.
    - An invalid reference gets a stored 422 `INVALID_CORRECTION_REFERENCE`.
    - Replays and fingerprints of existing outcomes are unchanged.
- **CAP-5** — Report unresolved rules as gated
  - **intent:** The correction never pretends that unapproved business rules were checked.
  - **success:** While a rejection or correction draft is shown, a fixed line says that obligation, range and unit rules for the measurements await CETEM approval and are not checked. No required-field, range, unit or tolerance check is added anywhere. Calculation verdicts keep the 6.6 behaviour (« Verdict suggéré : indisponible » where no tolerance exists).
- **CAP-6** — One structural validator for device and server
  - **intent:** The device accepts and refuses the same payloads as the server (epic-7 retro item 20).
  - **success:**
    - `parseGraphiePayload` delegates its identity, key, field-ID, option and type rules to `packages/domain`, and keeps no copy of them.
    - The domain refuses unpaired surrogates as `INVALID_PAYLOAD` (a 422, no longer a 500).
    - `requestSubmission` refuses a payload the domain validator would refuse for `submit`, writes nothing and shows the same issue texts. Drafts with such characters stay readable, so they can be corrected.

## Constraints

- The refused snapshot, its outbox item and its stored outcome are never modified, unlocked or deleted, locally or on the server. A correction is a new local revision plus an insert-only record.
- A rejection is never labelled or handled as a synchronization conflict (8.1), a server-accepted submission or a replacement (8.3). The conflict panel and its actions are never shown for a rejection.
- No CETEM business rule, tolerance, boundary or validation is invented. Only the existing structural rules and the storage-character rules run. DEP-01R/02 remain gated.
- Every local write is one exclusive SQLite transaction behind the per-scope queue, through `createAuthorizedDrafts`. Every row is scoped by `employee_id`.
- OpenAPI first: the envelope field and the rejection code go in `packages/types/openapi/cetem-qc-v1.yaml`. Then come the generated types, the `packages/schemas` zod schemas and typed client behaviour tests.
- AD-3 and `boundaries:check`: `audits` owns lineage rows and the « already linked » read. `sync` owns stored outcomes. Mobile calculations and validation only delegate to `packages/domain`.
- All user-visible text is in French and lives in `packages/i18n`. Values never appear in logs, error bodies or issue lines.
- Tests use synthetic names, the local PostgreSQL harness (zero skipped) and the SQLite test double. No test is deleted, skipped or weakened, and no gate script is edited.

## Non-goals

- Synchronization conflict resolution (8.1), replacement after acceptance (8.3), and deactivation or reassignment recovery (8.4). An `AUDIT_ALREADY_SUBMITTED` refusal stays read-only here.
- Changing the 7.2 `draft-rejected` behaviour of a refused `sync-draft` (the draft is already editable).
- Showing the refused snapshot's values side by side, or editing or deleting the refused attempt.
- Required-field, range, unit or tolerance validation (DEP-01R/02).
- Showing rejections or correction lineage to the Responsable, in history or in reports (Epics 9/11 derive lineage from `audit_lineage_links`).
- Server-side detection of a correction that never reaches the server.
- Deploying anything.

## Success signal

PostgreSQL route tests prove the following:
- a correction reference to a stored refused submission of the same actor and task is accepted with exactly one `rejected-submission-correction` row;
- a second operation with the same reference adds no row;
- every invalid reference gets a stored 422;
- a lone surrogate gets a stored 422;
- old fingerprints replay unchanged;
- migration 0011 → 0012 keeps every row.

Mobile tests on the SQLite double prove the following:
- creation commits completely or not at all, and the refused snapshot and outcome survive;
- items carry the reference until an accepted one, including through supersession;
- the derivation moves `acceptance-blocked` → correction draft → `submission-pending` → `submitted`;
- the parser and the domain agree on the shared rules.

App render tests walk four paths:
1. refusal shown, correction created, values edited, Soumettre, acceptance;
2. creation offline;
3. creation failure;
4. `AUDIT_ALREADY_SUBMITTED` (no action).

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the AC, EXPERIENCE.md, AD-4 to AD-6, the 7.x and 8.1 specs and hand-offs, the current code and the Product Owner rules. None is a CETEM business rule.

- **Qualifying refusal.** The task's latest `submit` item is resolved `rejected` and not covered by a correction. Every stored code qualifies except `AUDIT_ALREADY_SUBMITTED`: a correction draft is unavailable for server-accepted audits (EXPERIENCE « Correction draft » row), and that recovery belongs to 8.3/8.4. A refused `sync-draft` is not a submission attempt and keeps 7.2 behaviour.
- **No outbox item at creation.** The snapshot content was just refused, so re-sending it serves nothing. The next save or Soumettre queues normally. The server link waits for the first accepted operation, so creation works offline.
- **Device stamping.** Every item of the task created after the correction carries `correctionOfOperationId` until an item carrying it is resolved `accepted`. This state is derived, so no mutable column is needed. Supersession inherits the value, as with `conflictOperationId` (8.1).
- **Server tolerance of a linked reference.** Items queued before the first acceptance still carry the reference. The server therefore accepts a reference already linked to the same audit without a second row, instead of refusing it. Any other reference is invalid.
- **Reference check order.** It runs after the base-revision check and the 8.1 conflict reference, and before payload validation. Both references may be present. Each one then gets its own lineage row.
- **Fingerprint.** `correctionOfOperationId` enters the fingerprint only when present.
- **Store versus App.** The store keeps refusing only what 7.x/8.1 refuse. The App keeps an uncorrected `acceptance-blocked` task read-only. This follows the 8.1 precedent « the store accepts a save during a submit conflict ».
- **Validator split.** Shared structural rules move to one domain function used by the device parser and the server validator. The storage-character rules (NUL, unpaired surrogate) and the « legacy content on submit » rule apply only to sync payloads and submissions. Reading a draft never fails on them, so a refused draft stays correctable. Adding the surrogate rule closes the deferred 7.3 entry. It is a storage rule, not a CETEM rule.
- **Issue texts.** They are UI copy for structural issue codes. They name the field by section and field `labelFr`, never by value.

## Open Questions

None blocking. Every resolution above follows from EXPERIENCE.md, the architecture, the 8.1 hand-off or the existing code. No CETEM business rule is involved.
