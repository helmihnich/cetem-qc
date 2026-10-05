# Freeze model (CAP-1, CAP-3, CAP-4)

## What "accepted evidence" is

For a task whose audit has `state = 'submitted'`:

| Evidence | Where | Frozen by |
|---|---|---|
| Measurements and comments (comments are catalogue area fields such as `comments.general`, inside `values`) | `audit_revisions.payload` of the submission revision | 0009 insert-only trigger |
| Server calculation results | `audit_revisions.results` | 0009 insert-only trigger |
| Schema/rule versions | `audit_revisions` identity columns | 0009 insert-only trigger |
| Submitting actor, server date, operation | `audit_submissions` | 0009 insert-only trigger |
| Current-state pointer (`state`, `current_revision`, `updated_*`, `task_id`) | `audits` | **0010 (new)** |
| Stored outcomes, including the original 200 | `sync_operation_outcomes` | 0009 insert-only trigger |
| Linked task | `tasks` row | `audits.task_id` FK `ON DELETE RESTRICT` (delete only) |

Earlier draft-sync revisions of the same audit are history and are insert-only as well.

## Migration `apps/api/src/db/migrations/0010_freeze_submitted_audits.sql`

```sql
CREATE FUNCTION refuse_submitted_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audits are never deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.state = 'submitted' THEN
    RAISE EXCEPTION 'Submitted audits are frozen' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audits_freeze_submitted BEFORE UPDATE OR DELETE ON audits
  FOR EACH ROW EXECUTE FUNCTION refuse_submitted_audit_change();

CREATE FUNCTION refuse_evidence_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Evidence table % cannot be truncated', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

-- One statement-level trigger per table:
CREATE TRIGGER audits_no_truncate BEFORE TRUNCATE ON audits
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
-- … same for audit_revisions, audit_submissions, sync_operation_outcomes.
```

A draft audit stays updatable, so the 7.3 path still works: `advanceAudit` moves a `draft` row to `submitted`, and `OLD.state` is `draft` at that moment. No application code path changes. The 7.3 check order already refuses every operation on a submitted audit before `advanceAudit`, so in normal operation the trigger never fires. It is the floor under that check.

Error messages contain no payload values.

## Review query (CAP-3)

Public `tasks` query, new file `apps/api/src/modules/tasks/queries/own-team-task.ts`:

```ts
/** The task ID when the task is assigned within the Responsable's own team, otherwise undefined. */
getOwnTeamTaskId(pool: Pool, responsableId: string, taskId: string): Promise<string | undefined>
```

Its predicate is the one `listOwnTeamTasks` uses (assignment team → `identity_teams.responsable_account_id`, employee in that team with role `employe`), so every task in the Responsable's list is reviewable and no other task is. A non-UUID `taskId` returns `undefined` and does not reach SQL.

Public `audits` query, new file `apps/api/src/modules/audits/queries/accepted-submission.ts`:

```ts
export type AcceptedSubmissionSnapshot = {
  submissionId: string;
  operationId: string;
  taskId: string;
  auditId: string;
  revision: number;
  identity: CalculationContext;            // the five revision identity columns
  payload: ValidatedGraphiePayload;        // stored jsonb, raw strings unchanged
  results: GraphieCalculationResults;      // stored jsonb, as stored
  submittedBy: { id: string; displayName: string };
  acceptedAt: string;                      // ISO 8601 UTC, equal to the 7.3 response acceptedAt
};

getAcceptedSubmissionForReview(pool: Pool, responsableId: string, taskId: string): Promise<AcceptedSubmissionSnapshot | undefined>
```

It calls `getOwnTeamTaskId` first, then reads `audit_submissions` joined to its `audit_revisions` row and `identity_accounts`. It returns `undefined` for another team's task, an unknown task, or a task with no accepted submission, and the caller cannot tell these apart. `submittedBy.displayName` is the current account display name; the ID is the authority. It reads only: no access log and no route here (Story 9.1 adds both).

## Replacement and correction (CAP-4)

Existing constraints that already force a distinct record: `audits.task_id UNIQUE` (one audit per task), `audit_submissions.audit_id UNIQUE` (one submission per audit), and the triggers above. A replacement (8.3) therefore needs a new task and a new audit, linked by an AD-6 typed lineage record that 8.3 creates. A correction draft (8.2) follows a rejection, so its audit is never `submitted`. Story 7.4 adds no lineage table.
