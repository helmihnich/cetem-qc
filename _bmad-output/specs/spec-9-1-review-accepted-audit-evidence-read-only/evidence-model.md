# Evidence model (CAP-1, CAP-3, CAP-4, CAP-5)

## Migration `apps/api/src/db/migrations/0015_audit_review_accesses.sql`

```sql
CREATE TABLE audit_review_accesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_review_accesses_submission_idx ON audit_review_accesses (submission_id, accessed_at);
CREATE TRIGGER audit_review_accesses_history_only BEFORE UPDATE OR DELETE ON audit_review_accesses
  FOR EACH ROW EXECUTE FUNCTION refuse_history_change();
CREATE TRIGGER audit_review_accesses_no_truncate BEFORE TRUNCATE ON audit_review_accesses
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_evidence_truncate();
```

No existing table, constraint or trigger changes. `accessed_at` is the server date. No content column exists.

## Command and query

New `apps/api/src/modules/audits/commands/record-review-access.ts`:

```ts
/** Reads the accepted snapshot and records one access, in one transaction. */
openAcceptedEvidenceForReview(pool: Pool, responsableId: string, taskId: string):
  Promise<{ type: "opened"; evidence: AcceptedSubmissionSnapshot } | { type: "not-found" } | { type: "inconsistent" }>
```

Order inside `withTransaction`:
1. `getAcceptedSubmissionForReview` (7.4). `undefined` → `not-found`, nothing written.
2. Check the snapshot invariant (below). A mismatch → `inconsistent`, nothing written.
3. `INSERT INTO audit_review_accesses (actor_id, task_id, audit_id, submission_id)`.
4. Commit and return `opened`. An insert error rolls back and propagates (the route answers 500).

The lineage lines come from `readTaskAcceptanceAndLineage` for the same task, read after the commit. They are not part of the access record.

### Snapshot invariant

For each of the five stored results that carries a rule identity, `ruleId` and `ruleVersion` equal the revision's `rule_id` and `rule_version`. A result with `unsupported-version` (no `formulaSource`) is consistent only when the revision identity is not the supported tuple. The rule of equality uses the identity fields the domain results already carry (`GraphieCalculationIdentity`); the check does not recalculate and does not call a formula.

## Route

`GET /api/v1/tasks/{taskId}/accepted-evidence` in `apps/api/src/index.ts`, after the replacement route, `Cache-Control: no-store`.

| Case | Status | Body | Server log line |
|---|---|---|---|
| Employé session | 403 `FORBIDDEN` « Accès réservé au Responsable de l’équipe. » | `ApiError` | `{ event: "audit.review_refused", class: "forbidden-role", actorId }` |
| Malformed `taskId` | 404 `TASK_NOT_FOUND` « Tâche introuvable. » | `ApiError` | class `not-found` |
| Unknown, another team's, no audit, draft audit | 404, identical body | `ApiError` | class `not-found` |
| Stored results inconsistent (CAP-5) | 500 `INTERNAL_ERROR` « Les preuves n’ont pas pu être chargées. » | `ApiError` | `{ event: "audit.review_inconsistent", actorId }` |
| Log insert or other failure | 500, same body | `ApiError` | none (never log the error; it may carry values) |
| Opened | 200 | `AcceptedEvidenceResponse` | none (the table row is the record) |

401 comes from `requireSession` as for every route. Log lines are `console.info` JSON, as in `responsable-password-reset.ts`.

## Contract

OpenAPI operation `getAcceptedEvidence`, then `AcceptedEvidenceResponse`:

```ts
{
  task: { id: string; establishment: string; service: string; assignee: string };
  submission: {
    submissionId: string; auditId: string; revision: number;
    submittedBy: { id: string; displayName: string };
    acceptedAt: string;                 // ISO 8601 UTC
  };
  identity: CalculationContext;         // the five revision identity columns
  values: Record<string, string>;       // stored payload values, strings unchanged
  results: GraphieCalculationResults;   // stored snapshot, as stored
  lineage: { replacementOf: string | null; replacedBy: string | null; recoverySource: { taskId: string; auditId: string; revision: number } | null; recoverySuccessorTaskId: string | null };
}
```

- `values` is the payload's `values` map. `GET` responses are strict zod objects (no extra properties); `results` parses with the shared results schema and `identity` with the existing identity schema.
- `task.assignee` is the assignee display name used by the list (`— Inactif` suffix rule unchanged). `service` comes from `tasks.service`.
- Another team's or unknown data never reaches the serializer: the task fields are read only after the own-team query returns the task.
- Generate types with the existing `types` generation; `contracts:check` must pass. The typed client gains `getAcceptedEvidence` with typed outcomes for 200, 403, 404 and 500.

## Web route handler

`apps/web/src/app/api/tasks/[taskId]/accepted-evidence/route.ts`, GET: forwards the session cookie as a bearer token like the neighbouring handlers, `cache: "no-store"`, passes the API status and body through, `503 SERVICE_UNAVAILABLE` when the API is unreachable. Nothing is cached by Next.
