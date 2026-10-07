# Test plan

IDs continue the 7.x/8.x series. Every test uses synthetic names. PostgreSQL tests run on the local harness with zero skipped. Accepted audits come from the existing `sync-fixture.ts` path (a real accepted submission), never a direct insert.

## Contracts (`packages/schemas`, `packages/api-client`)

- **K7** `acceptedEvidenceResponseSchema` parses a full 200 body, refuses extra properties, a missing `lineage`, and a non-ISO `acceptedAt`. `contracts:check` passes.
- **K8** The typed client returns typed outcomes for 200, 403, 404 and 500 of `getAcceptedEvidence`.

## API (PostgreSQL route tests, new `evidence-review-routes.postgres.test.ts`)

- **R1** An own-team Responsable gets 200 for an accepted task. The body equals the stored payload values, results, identity, submitter ID and name, and `acceptedAt` (equal to the 7.3 response). Exactly one `audit_review_accesses` row exists, with the Responsable's ID, the task, audit and submission, and a server date.
- **R2** Repeated opens add one row each. Rows in `tasks` (including `updated_at`), `task_assignments`, `audits`, `audit_revisions`, `audit_submissions`, `sync_operation_outcomes`, all lineage tables are byte-identical before and after R1/R2.
- **R3** Each refusal writes no access row. The codes are:
  - Employé session → 403;
  - malformed ID → 404;
  - unknown ID → 404;
  - another team's accepted task → 404;
  - own-team task with a draft audit → 404;
  - own-team task without an audit → 404.

  All 404 bodies are byte-identical and carry no task, audit or team field.
- **R4** Refusals emit one structured line each with the actor ID and the fixed class, and the line contains neither the requested ID nor any evidence value (capture `console.info`).
- **R5** A failure injected at the access insert (test seam) returns 500 and no evidence field, and leaves zero rows.
- **R6** A stored results snapshot whose rule identity differs from the revision identity (set up through a test seam on the query input, not by editing frozen rows) gives 500, no access row and no evidence field. A supported identity with consistent results passes. An unsupported identity with five `unsupported-version` results returns 200.
- **R7** Migration 0014 → 0015 with `migrateThrough` keeps every row. UPDATE, DELETE and TRUNCATE on `audit_review_accesses` are refused. An insert with a non-existent submission is refused.
- **R8** Comment areas, identification and visual-check values come back exactly as submitted, including leading and trailing spaces, line breaks and non-ASCII text.
- **R9** The response carries no field of another task. Another team's Responsable receives 404 for the same ID, and the first Responsable's access row is untouched.
- **R10** Cross-lineage (epic-8 retro action 5): one task set holds a conflict, a rejected-submission correction, a replacement, and a deactivation recovery. For each accepted task, `GET /tasks` and the evidence route agree on `state`, `replacementOf`, `replacedBy`, `recoverySource` and `recoverySuccessorTaskId`. No relationship is read from another relationship's table.
- **R11** Employé surface: the Employé routes and responses parse with unchanged schemas and carry no evidence, lineage or access field.

## Web

- **W1** Route handler `api/tasks/[taskId]/accepted-evidence`: no cookie gives 401, status and body are forwarded, an unreachable API gives 503, responses carry `no-store`.
- **W2** List render: « Consulter les preuves » appears only on `submitted` rows, with `aria-expanded`.
- **W3** Full path: the button, loading, the panel (context line, lineage lines, « Données saisies » with « Non renseigné », the 6.4 review, the single decision note), « Retour à la liste », focus return.
- **W4** Read-only: the panel contains no `input`, `textarea`, `select`, `form`, and no button other than « Retour à la liste ». It contains none of « Approuver », « Rejeter », « Valider », « Machine conforme ».
- **W5** Failures: 404, 403, 500 and a network failure each show their text. « Réessayer » sends one new request.
- **W6** Unsupported identity: the alert and the stored identity show, with no verdict line, and the data block still renders.
- **W7** A stored value containing HTML (`<b>x</b>`) renders as text.
