# Recovery model

## Current implementation baseline

- `identity_accounts.is_active` blocks login and existing session authorization; task assignment rows survive deactivation.
- `listOwnTeamTasks` retains inactive employees and labels the assignee inactive. It currently derives task state from `tasks.state` (`draft`) and does not show audit/outbox recovery states.
- Assignment insertion requires an active same-team employee. The current model has one current `task_assignments` row and no assignment history.
- Accepted audit, conflict lineage, rejection correction, and replacement are implemented by Stories 7.x/8.1–8.3 with separate immutable records.
- Mobile local rows and outbox are scoped to their original `employee_id`; 8.1 and 8.2 operation references are actor-bound.

## Proposed task recovery state projection

Read state from authoritative existing task/audit/outcome sources; do not persist a duplicate task lifecycle state. Suggested read model:

```ts
type DeactivatedAssignmentRecovery =
  | { kind: "unstarted"; action: "reassign" }
  | { kind: "synchronized-draft"; action: "create-recovery-work" }
  | { kind: "device-only-unknown"; action: "administrative-recovery-unavailable" }
  | { kind: "pending-or-uncertain"; action: "resolution-required" }
  | { kind: "conflict"; action: "story-8-1-resolution-required" }
  | { kind: "rejected-correction"; action: "create-recovery-work" }
  | { kind: "accepted"; action: "story-8-3-replacement-if-needed" }
  | { kind: "replacement"; action: "evaluate-this-task-independently" };
```

`device-only-unknown` is necessarily cautious: absence of a synchronized draft cannot prove the tablet has no local work. The server cannot read the local DB. Only an explicitly recorded accepted outcome establishes accepted state; a transport response alone does not.

## Command invariants

- Reassign existing task only if current assignee is inactive, task is authoritatively unstarted, destination is active Employé in same team, and no audit/outbox evidence requires a different path.
- Synchronized draft recovery creates a new task/audit/draft for an active same-team successor, seeded from the prior synchronized draft as a starting reference. Source remains unchanged and read-only.
- Correction recovery never changes assignment of the correction draft. It creates a separate recovery task/audit/draft, preserves `rejected-submission-correction`, and adds `deactivated-assignee-recovery` from prior correction work to successor work.
- Each copied field/value records provenance to the original task/audit/revision/field and is distinguishable from values newly authored by the successor.
- Recheck authorization, source state, active status, team membership, and concurrency token in the same transaction as writes.
- Do not mutate snapshots, outbox operations, outcomes, revisions, submissions, accepted evidence, or existing lineage.
- A source state change between display and commit yields a conflict requiring refresh, never fallback to a broader operation.

## Data changes

1. Keep `task_assignments` (or its current equivalent) as the operational current assignment.
2. Add append-only assignment history for every assignment/reassignment: task, previous employee (null for initial assignment), new employee, Responsable actor, reason, timestamp. Include team and concurrency/source context as needed for integrity.
3. Add a dedicated immutable recovery relation of type `deactivated-assignee-recovery` linking source task/audit/revision or correction work to successor task/audit/draft, with Responsable actor and timestamp. Do not overload 8.1/8.2/8.3 lineage tables.
4. Store copied-value provenance at field level: source task/audit/revision/field plus recovery link. New task/audit identity and successor's new edits remain separately attributable.
5. Add no administrative data export, tablet read, or pending-snapshot transfer schema; pending/uncertain items remain resolution-required in the PoV.

Assignment-history migration may seed one baseline event per existing current assignment using the best persisted task/assignment actor and timestamp available. It must not invent prior assignees or historical reassignments that were never stored; complete history is guaranteed for assignment actions from the new model onward.

For each copied field, retain destination field/path, source task/audit/revision/field, recovery lineage ID, and copied origin. If the successor edits the copied value, record the new edit under the successor while retaining its copied-from provenance.

All migrations are additive and preserve existing rows. History tables reject UPDATE/DELETE/TRUNCATE consistent with other immutable evidence tables.
