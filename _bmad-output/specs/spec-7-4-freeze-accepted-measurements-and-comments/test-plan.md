# Test plan

All tests run under `pnpm -r test` against the local PostgreSQL harness (`withPostgresTestSchema`), with synthetic names and zero skipped tests. Existing 7.3 tests (A1–A16) stay unchanged and must keep passing.

**Evidence fingerprint.** A helper reads, for one task, the `audits` row, every `audit_revisions` row, the `audit_submissions` row, the task row, and every `sync_operation_outcomes` row of the task, ordered and serialized. "Unchanged" means the serialization is byte-equal before and after. Count helpers alone do not count as proof.

New file `apps/api/src/freeze-routes.postgres.test.ts` (it may reuse the 7.3 fixture helpers by moving them to `apps/api/src/test-support/`).

| ID | Scenario | Expected |
|---|---|---|
| F1 | After an accepted submission, the assigned Employé sends a draft-sync and a submission, each with a new key: base = current revision, a stale base, and a payload that changes one measurement and `comments.general` | Each answers 422 `AUDIT_ALREADY_SUBMITTED`. The evidence fingerprint is unchanged except for the new stored outcome rows. The revision payload still holds the original measurement and comment |
| F2 | The original accepted submission is replayed, and a pre-acceptance draft-sync is replayed | Stored bodies byte-equal; the fingerprint is fully unchanged |
| F3 | The team's Responsable, and a Responsable of another team, call both sync routes on the accepted task | 403 `FORBIDDEN`; fingerprint fully unchanged |
| F4 | A colleague Employé (not assigned) calls both sync routes on the accepted task | 404 `TASK_NOT_FOUND`; fingerprint fully unchanged |
| F5 | Every other mutating `/api/v1` route is called by both roles with valid sessions (create task, create employee, credential, password reset, status change, password replacement, logout) | Whatever their own outcome, the accepted task's fingerprint is unchanged |
| F6 | Route inventory: the non-GET routes registered by `createApp()` (read from the Express 5 router) | Equal to the fixed list in F5 plus the two sync routes. A new mutating route fails this test |
| D1 | Direct SQL on a submitted audit: `UPDATE audits SET state = 'draft'`, `SET current_revision = …`, `SET updated_by = …`, `SET task_id = …`, `DELETE FROM audits` | Each is refused (`/frozen/` or `/never deleted/`); fingerprint unchanged |
| D2 | `DELETE FROM tasks` for the accepted task | Refused (foreign key); fingerprint unchanged |
| D3 | `TRUNCATE` of each of the four evidence tables, and `TRUNCATE tasks CASCADE` | Refused; row counts unchanged |
| D4 | A draft audit (only draft-syncs accepted) | A further draft-sync and then a submission are still accepted (the trigger does not block 7.3) |
| D5 | A second `audits` row for the same task, and a second `audit_submissions` row for the same audit | Refused by unique constraints (pins CAP-4) |
| Q1 | `getAcceptedSubmissionForReview` for the team's Responsable, after F1–F5 ran | Returns the original payload (including comments) and results byte-equal to the A1-style submission, identity `graphie-mobile-pov` / `2.0.0` / `3` / `cetem-paper-form` / `2.0.0`, `submittedBy` = the Employé, `acceptedAt` = the 7.3 response `acceptedAt`, `taskId` = the task |
| Q2 | The same query for another team's Responsable, an unknown UUID, a non-UUID, and an own-team task with only draft-syncs | `undefined` in every case |
| Q3 | `getOwnTeamTaskId` | Own-team task → its ID; another team's task, unknown and non-UUID → `undefined` |
| M1 | Migration staged upgrade with `migrateThrough` 0009 → 0010 on a database holding a submitted audit and a draft audit | Every row kept; the submitted audit is frozen afterwards, the draft audit still accepts a draft-sync |
