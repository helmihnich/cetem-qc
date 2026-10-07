---
id: SPEC-8-4-handle-unfinished-tasks-after-employee-deactivation
story: 8.4
status: approved
approved: 2026-10-07
companions:
  - recovery-model.md
  - web-behavior.md
  - mobile-offline.md
  - test-plan.md
  - delivery-notes.md
sources:
  - _bmad-output/planning-artifacts/epics.md
  - _bmad-output/planning-artifacts/architecture/architecture-cetem-qc-2026-09-26/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-cetem-qc-2026-09-25/EXPERIENCE.md
  - _bmad-output/specs/spec-8-1-resolve-a-synchronization-conflict-explicitly/SPEC.md
  - _bmad-output/specs/spec-8-2-create-a-correction-draft-after-validation-rejection/SPEC.md
  - _bmad-output/specs/spec-8-3-create-a-responsable-only-replacement-after-acceptance/SPEC.md
  - current implementation (identity, team-access, tasks, audits, sync, mobile local drafts)
---

> Approved implementation contract (refreshed 2026-10-07 against current code and Product Owner decisions). A checkpoint implementation (migration `0014_deactivation_recovery.sql`, reassignment/recovery commands, routes, web `task-recovery.tsx`) already exists in the tree; the dev pass must verify it against this contract and the gates rather than rebuild it.

# Story 8.4 — Handle unfinished tasks after employee deactivation

## Story

As a Responsable, I want explicit state-specific recovery choices for a deactivated employee's unfinished tasks, so work can continue without transferring authorship or losing local evidence.

## Why and boundary

Deactivation currently blocks authentication and authorized server work, while assignments, tasks, and history remain. The Responsable task list already marks inactive assignees, but does not flag unfinished work or offer state-aware recovery. Stories 8.1–8.3 already implement conflict resolution, rejected-submission correction, and accepted-audit replacement; this story coordinates deactivation recovery without reimplementing those flows.

Deactivation is not a task transition and never reassigns work by itself. Every recovery is a new, explicit Responsable action scoped to their own team. Server accepted evidence is immutable. Existing authorship and history remain attached to the original employee and original records.

## State model and business behavior

| State when reviewed | Responsable behavior | Required preservation / outcome |
|---|---|---|
| Assigned, no audit work started | Explicitly reassign the existing task to an active same-team Employé. | Preserve an assignment history event with old and new employee, actor, and time. No audit or evidence is created. Absence of a server draft is not proof that no tablet-only work exists; warn accordingly. |
| Editable draft synchronized to server | Responsable explicitly creates a new recovery task/audit/draft for an active same-team Employé, using the synchronized draft as a starting reference. | Preserve the original task/draft/revisions as read-only and attributed to the deactivated employee. Link source and successor with immutable `deactivated-assignee-recovery` lineage. Every copied value retains field-level source provenance; it is never presented as authored by the successor. |
| Unsynchronized work exists only on deactivated employee's device | Mark action required; do not offer normal reassignment as a way to obtain or sync that data. | Do not claim data reached server. Preserve encrypted local data under OD-01. No sync under the deactivated identity and no cross-account local-data exposure. Administrative extraction/recovery is outside PoV. |
| Submission pending / unresolved outcome | Show **Resolution required** and retain the immutable pending snapshot and operation metadata. Reconcile only through existing authorized status/read paths if available; do not unlock or assign the snapshot. | Never cancel, alter, delete, or resubmit under another employee. If the server already accepted it, handle it as accepted evidence. If acceptance is not known, retain the pending state and surface the limitation. |
| Accepted submission | Keep original task, audit, measurements, comments, calculations, submissions, and history read-only. For a material correction, use Story 8.3's explicit replacement-control flow. | Deactivation does not change acceptance, attribution, or replacement eligibility. Story 8.4 adds no replacement endpoint or replacement lineage type; `deactivated-assignee-recovery` applies only to unfinished draft recovery. |
| Rejected submission / correction draft (8.2) | Responsable creates new separately attributable recovery work for an active same-team Employé, initialized from the prior correction work as a starting reference. | Never reassign the correction draft in place. Preserve its rejected-submission-correction lineage; add `deactivated-assignee-recovery` from the prior correction work to the successor. Preserve field-level provenance; do not reuse the actor-bound correction operation reference. |
| Open synchronization conflict (8.1) | Preserve conflict and local/server snapshots; mark resolution required. Do not resolve it as the deactivated employee or bypass 8.1. | Conflict resolution actions remain 8.1's explicit employee actions. No stale overwrite, deletion, or automatic keep/discard. |
| Existing replacement task | Apply state handling to the replacement task independently. | Preserve the accepted original and 8.3 replacement link. No duplicate replacement action; no implicit change to either task. |

Server status is authoritative. A device that has not learned of deactivation may retain locally saved data within OD-01's existing authorization window, but known deactivation immediately blocks local access and sync. On reconnect, the inactive account cannot authenticate or perform server work. Do not weaken these existing identity and offline rules.

## Acceptance criteria

1. **Deactivation has no side effect on work.** Given an employee is deactivated, when deactivation completes, then no task is automatically reassigned, deleted, unlocked, or rewritten; existing assignments, audits, snapshots, outcomes, submissions, accepted evidence, and lineage remain intact.
2. **Responsible task visibility.** Given an own-team task is assigned to an inactive employee, when the Responsable loads the task list/detail, then the inactive assignee is visibly identified and every unfinished task is marked **Action required**; accepted tasks remain distinguishable and read-only.
3. **Explicit unstarted reassignment.** Given a task has no server audit work and its current assignee is inactive, when the Responsable explicitly selects an active same-team Employé, then the assignment changes atomically, the old and new assignment history is retained, and no task/audit data is fabricated. A concurrent or stale request fails without partial change.
4. **Synchronized draft recovery.** Given the server has an editable draft authored by the deactivated employee, when the Responsable explicitly creates recovery work for an active same-team employee, then a new task/audit/draft is created using that draft as a starting reference; the original remains preserved/read-only; immutable `deactivated-assignee-recovery` lineage links source and successor; and every copied value retains provenance to its source field/revision and is not presented as authored by the successor.
5. **Tablet-only work protection.** Given work may exist only on the inactive employee's device, when the Responsable reviews the task, then the UI does not claim that work is absent or server-synchronized, does not offer a path to sync under the inactive identity, and explains that administrative recovery is unavailable in the PoV. The device retains encrypted local work and does not expose it to another identity.
6. **Correction recovery.** Given a deactivated employee owns an 8.2 correction draft, when the Responsable creates recovery work for an active same-team employee, then the old correction draft is not reassigned or changed; its `rejected-submission-correction` lineage remains intact; a new task/audit/draft is created with `deactivated-assignee-recovery` lineage from the prior correction work; copied values retain source provenance; and the old actor-bound operation reference is not reused.
7. **Pending immutable snapshot.** Given an operation is pending or its server outcome is uncertain, when the Responsable reviews it, then the UI shows **Resolution required**, preserves the snapshot and permits no reassignment, deletion, unlocking, cancellation, or resubmission. The system assumes neither success nor failure; further administrative recovery is out of the PoV.
8. **Existing recovery flows remain distinct.** Given work is rejected, conflicted, or accepted, when deactivation recovery is displayed, then 8.2's rejected submission and its correction lineage remain intact, conflict resolution remains owned by 8.1, deactivated correction work uses the separate 8.4 recovery path, and accepted material correction continues to use 8.3. The 8.4 surface does not duplicate or repurpose those flows/types.
9. **Authorization.** Given a user is not the Responsable for the task's team, when they list, inspect, reassign, or recover it, then server-side authorization denies access without disclosing cross-team task existence. Only active same-team employees are eligible successors. Employees cannot invoke recovery.
10. **Auditability.** Given an allowed recovery action succeeds, when authorized task history is read, then every assignment/reassignment is recorded append-only with task, previous employee, new employee, Responsable actor, reason, and timestamp. Recovery records include source task/audit/revision, resulting task/audit/draft, lineage type, and field-level copied-value provenance. Failed, stale, canceled, or denied actions write no recovery event.
11. **No destructive recovery.** Given any recovery attempt fails, races, or is canceled, when state is reloaded, then all original work/history is unchanged and the UI does not claim success.

## API/backend requirements

- Keep `identity-auth` as owner of deactivation/auth checks, `team-access` of role/team authorization, `tasks` of assignment metadata, and `audits` of audit/evidence lineage. Use explicit command/query seams through module public interfaces.
- Reuse current inactive-session rejection; all recovery endpoints recheck active Responsable, own-team task scope, and active same-team successor server-side. No authorization from web/mobile UI alone.
- Add a server transaction for permitted reassignment/restart. Lock the task/source state and revalidate it inside the transaction. Use optimistic concurrency or equivalent so a submission/deactivation/reassignment race cannot apply a stale state decision.
- Add append-only assignment history while retaining the operational current assignment. Record task, previous employee, new employee, Responsable actor, reason, and timestamp for every assignment/reassignment.
- Recovery work is a new independent task/audit/draft. Add a dedicated immutable `deactivated-assignee-recovery` lineage type for synchronized drafts and correction drafts. Preserve 8.2's existing `rejected-submission-correction` lineage; never overload 8.1/8.2/8.3 link types.
- Each copied value records field-level provenance to source task/audit/revision/field and recovery lineage. It must not be represented as authored or newly measured by the successor; source records remain immutable.
- API contract first in OpenAPI, then generated types, schemas, typed client, Next route handler with CSRF protection, and server command. Use no-store for sensitive responses; avoid payload values in logs/errors.
- Current `GET /api/v1/tasks` already returns own-team tasks with inactive assignee label; extend response only for the explicit action-required/recovery state necessary to render this story. Employee assignment queries already retain the original assignment; do not expose Responsable recovery data to employees.
- Deactivation/recovery security events use existing correlation and redaction conventions. A transaction failure or invalid state makes no partial writes.

## Web requirements

- On W2 and task detail, show inactive assignee and **Action required** for unfinished work; show **Resolution required** for pending/immutable snapshots. Keep accepted state distinct from unfinished work.
- Provide actions only when the resolved state allows them: active same-team reassignment for unstarted tasks; explicit new recovery work for synchronized drafts and correction drafts. Show clear unavailable/out-of-PoV explanation for tablet-only and pending-snapshot administrative recovery.
- Use W3's eligible active same-team employee selector. Confirm explicit reassignment/restart with consequences and preserve entered selection on failure. No success display before server acknowledgment.
- Show source and successor relationships and attribution in task history. Reuse 8.3 replacement UI/state for accepted evidence; do not add a second replacement action.
- All new copy is French and centralized in `packages/i18n`; maintain keyboard, focus, loading, error, empty, and permission-denied behavior.

## Mobile/offline requirements

- No Responsable recovery editing on mobile and no mobile presentation of a reassigned task's old local cache as current work.
- Preserve existing OD-01 window and secure local-store boundaries. Known deactivation, logout, or authorization expiry keeps local rows encrypted and inaccessible; never silently delete them or switch their `employee_id`.
- Block network sync/submission when identity is inactive/unauthorized. Never rewrite an outbox item's actor, operation ID, snapshot, correction reference, or conflict reference to another employee.
- On authorization failure, preserve pending snapshot and expose a generic actionable state without leaking protected server data. Other active identities cannot enumerate or read the old employee's local store.
- Pending snapshot remains immutable and unresolved when the original identity is inactive. Story 8.4 adds no retry/reconciliation, reassignment, unlock, deletion, or administrative recovery action for that state.
- Recovery work downloaded by a successor is the new server-created task/draft, not a copy of the previous employee's local database, snapshots, outbox operations, or identity scope. The payload and read model retain the per-field source provenance defined by the recovery lineage.

## Data model implications

- Existing `identity_accounts.is_active`, `task_assignments`, audit snapshots/revisions, outbox operations, accepted submissions, `audit_lineage_links`, and `audit_replacement_links` already provide identity, assignment, and recovery lineage foundations. Stories 8.1–8.3 own their respective typed records.
- Add append-only assignment history. Keep current assignment query compatible; each event includes task, previous employee, new employee, Responsable actor, reason, and timestamp.
- Add a dedicated immutable `deactivated-assignee-recovery` relationship from source task/audit/revision or correction work to new task/audit/draft, with initiating Responsable and timestamp. Each copied value retains source field/revision provenance. Do not mutate source evidence or repurpose existing lineage types.
- Do not add a “deactivated” audit state or mutate accepted audits. Do not store device-only data on the server or claim it exists there.
- Migrations must be additive, preserve all existing rows, use restrictive foreign keys for history, and enforce insert-only lineage/history semantics.

## Authorization requirements

- Responsable may only see and act on tasks in their own team; cross-team/unknown IDs have indistinguishable not-found behavior where applicable.
- Successor is an active `employe` in that same team, not the Responsable. Revalidate while holding transaction locks.
- Deactivated employees cannot authenticate, use existing sessions for server work, or sync. Re-enabling an account is outside this story and does not itself recover/reassign any task.
- Employé routes continue to expose only their own assignments and no Responsable recovery controls. Server checks apply even to forged requests.

## Audit and lineage requirements

- Record deactivation event through existing identity/security event conventions (do not duplicate the account-status audit already present).
- Record every first assignment and reassignment append-only with task, previous/new employee, Responsable actor, reason, and timestamp; keep current assignment separately for operations.
- Record synchronized-draft and correction-draft recovery using `deactivated-assignee-recovery`, including source/successor references and copied-value provenance. Preserve existing correction lineage unchanged.
- Preserve original employee as submitter/author on all prior revisions and accepted submissions. New employee is attributable only to newly created work.
- Use only the new typed `deactivated-assignee-recovery` relationship for deactivation recovery; do not repurpose conflict, correction, or replacement links.

## Edge cases

- Deactivation between task read and mutation; between sync authorization and transaction commit; and while a request is in flight.
- A task appears unstarted server-side while tablet-only work may exist.
- Inactive employee has multiple tasks in different states; handle each independently.
- Pending submission is accepted server-side but client acknowledgement was lost; accepted state must win once authoritatively observed.
- Pending outcome cannot be determined because inactive employee cannot reauthenticate; retain and flag, do not guess.
- Deactivation occurs during open 8.1 conflict; preserve and flag it without bypassing actor-bound resolution.
- Deactivation occurs during 8.2 correction draft; preserve rejected-submission-correction lineage and create separate recovery work linked with deactivated-assignee-recovery.
- A replacement is already created, or the replacement task's assignee is later deactivated; preserve original replacement chain and handle the replacement as its own task.
- Selected successor deactivates or moves teams before commit; reject atomically.
- Repeated clicks, concurrent Responsable requests, stale list state, unknown IDs, network timeout after commit, and retry must be idempotent/observable without duplicate assignment history or successor tasks.
- Failed migration or any downstream failure leaves source and assignment state intact.

## Required automated tests

See [test-plan.md](test-plan.md). Minimum coverage includes PostgreSQL command/route authorization, transactional/race behavior, immutable history, web state rendering, mobile inactive-identity offline preservation, and regression tests proving 8.1–8.3 still own conflict/correction/replacement behavior.

## Dependencies on Stories 8.1, 8.2, 8.3

- **8.1 (done):** owns conflict state, snapshots, explicit keep-local/discard choices, conflict lineage, and inactive-actor authorization boundaries. 8.4 must leave open conflicts unresolved and immutable.
- **8.2 (done):** owns validation rejection, correction draft, actor-bound `correctionOfOperationId`, and rejected-submission lineage. 8.4 must not reuse a correction reference under a successor identity.
- **8.3 (done):** owns accepted state and Responsable-only independent replacement with `replacement-control` lineage. 8.4 delegates accepted corrections to that flow and does not duplicate it.
- **Existing foundations:** Story 3.2 deactivation/session behavior; Story 4.x own-team task visibility and active assignee selection; Stories 5.2–5.3 offline access/local drafts; Stories 7.1–7.4 outbox, pending/accepted distinction, idempotent acceptance and freeze.

## Out of scope

- Automatic reassignment, silent ownership transfer, changing historical authorship, editing/deleting accepted evidence, automatic unlock/cancellation of pending submissions.
- Syncing tablet-only data under the deactivated employee or copying/extracting it for another employee in the PoV.
- Administrative recovery of tablet-only or indeterminate pending snapshots; the UI must surface the limitation.
- Employee-initiated reassignment/recovery, cross-team transfer, account reactivation, new login/session policy, email notification, or new authentication mechanism.
- Duplicating conflict resolution (8.1), rejected-submission correction (8.2), or accepted replacement (8.3).
- Inventing CETEM measurement validation, business rules, or a general approval/rejection step.

## Resolved product decisions

- Synchronized editable drafts seed a new recovery task/audit/draft as a starting reference. Source remains preserved; each copied value has source provenance and is never attributed to the successor as original author.
- Deactivated-owner correction drafts are never reassigned in place. Preserve `rejected-submission-correction`; create separate recovery work linked from prior correction work by `deactivated-assignee-recovery`.
- Pending or uncertain submissions remain **Resolution required** in the PoV: no reassignment, deletion, unlocking, or assumption of success/failure. Further administrative recovery is out of scope.
- Keep operational current assignment and add append-only assignment history with task, previous employee, new employee, Responsable actor, reason, and timestamp.

No Story 8.4 product decisions remain unresolved. Exact physical device/OS test matrix remains the already documented OD-05 validation detail, not a product behavior decision.
