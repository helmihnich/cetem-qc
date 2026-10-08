# Report candidate model (CAP-1 to CAP-8)

## Task 0 — route registration

Create `apps/api/src/routes/` with one registrar per module (`register-<module>-routes.ts`, each `(app, deps) => void`), move the existing route handlers verbatim, keep `index.ts` as app construction + `registerDefaultSummaryReopenParticipants()` + registrars. New: `register-report-routes.ts`. No behaviour change; existing tests unchanged and green before any report code is added.

## Migration `apps/api/src/db/migrations/0022_report_candidates.sql`

```sql
CREATE TABLE report_candidates (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  attempt_id uuid NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  audit_id uuid NOT NULL REFERENCES audits(id) ON DELETE RESTRICT,
  submission_id uuid NOT NULL REFERENCES audit_submissions(id) ON DELETE RESTRICT,
  audit_revision integer NOT NULL,
  confirmed_summary_id uuid NOT NULL REFERENCES confirmed_summaries(id) ON DELETE RESTRICT,
  summary_version integer NOT NULL,
  conformity_decision_id uuid NOT NULL REFERENCES conformity_decisions(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('generated-word')),
  template_id text NOT NULL,
  template_version text NOT NULL,
  requested_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_candidate_outcomes (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_id uuid NOT NULL UNIQUE REFERENCES report_candidates(id) ON DELETE RESTRICT,
  outcome text NOT NULL CHECK (outcome IN ('ready', 'failed', 'outdated')),
  storage_ref text, file_name text, byte_size integer, sha256 text,
  failure_class text CHECK (failure_class IN ('generation-failed', 'storage-failed')),
  completed_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome IN ('ready','outdated') AND storage_ref IS NOT NULL AND file_name IS NOT NULL AND byte_size IS NOT NULL AND sha256 IS NOT NULL AND failure_class IS NULL)
      OR (outcome = 'failed' AND failure_class IS NOT NULL AND storage_ref IS NULL AND file_name IS NULL AND byte_size IS NULL AND sha256 IS NULL))
);
-- history_only + no_truncate triggers on both tables, exactly like confirmed_summaries / summary_reopenings
```

`audit_revision` / `audit_id` / `submission_id` come from `AcceptedSubmissionSnapshot`. `storage_ref` is an opaque server-generated key (`reports/<candidateId>.docx`), never a path from user input. Index `report_candidates (task_id, seq DESC)`. If a column name differs from the existing tables' real names, follow the real schema.

## Ports

`modules/files/ports/object-storage.ts`
```ts
interface ObjectStorage {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>; // idempotent
}
```
Adapters: `local` (`FILE_STORAGE_DIR`, key validated against `^[a-z0-9/_.-]+$` and no `..`, atomic write temp + rename, directory created on first put) and `memory`. Selected by `FILE_STORAGE` (`local` default); `files/index.ts` exports `createObjectStorage(env)` and the port type.

`modules/reports/ports/report-document-generator.ts`
```ts
interface ReportDocumentGenerator {
  templateId: string; templateVersion: string; // "cetem-paper-report", "1.0.0"
  generate(document: ReportDocument): Promise<{ bytes: Uint8Array }>;
}
```
Adapter `word-template`: renders `ReportDocument` to OOXML (below). A test seam injects throwing/blocked generators and storages (same pattern as `reviewCommandTestSeams`).

## `ReportDocument` (packages/i18n, pure)

`buildReportDocument(input)` in `packages/i18n/src/report-document.ts`, French labels in `fr.report`. Input: `{ values: GraphieFormValues, results: GraphieCalculationResults, identity: CalculationContext, summary: { text: string }, decision: { outcome } }`. Output: renderer-neutral blocks following [report-template.md](report-template.md): `heading`, `paragraph`, `table` (rows of cells: `text`, `mark` (checked boolean), `empty`, `image` logo reference, spans), page breaks at the four paper-page boundaries. No Word types, no `Date.now()`, no randomness (the same input yields the same document). Numeric values use the display formatter of `graphie-results.ts` (shortest round-trip, decimal comma, never rounded); export it for reuse rather than copying. The module reads results only through the existing `presentGraphieResult`/result types; it recalculates nothing.

## Word writer (adapter)

Package parts: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`, `word/_rels/document.xml.rels`, `word/styles.xml`, `word/header1.xml` + `word/_rels/header1.xml.rels`, `word/media/logo.png` (copy of `docs/product/source/cetem-logo.png` stored in the module as an asset), `docProps/core.xml`. A4 portrait, Arial/Times-like default font declared in `styles.xml`, tables with single borders, XML-escaped text (control characters stripped). ZIP: local headers + central directory, `deflateRawSync` or stored, `zlib.crc32`, fixed entry timestamps (1980-01-01) so output bytes are deterministic for a given document. `docProps/core.xml` carries a title only (no author, no dates).

## Command `generateReportCandidate(deps, responsableId, taskId, attemptId)`

`deps = { pool, storage, generator, now? }`. Returns `{ type: "ready" | "replayed-ready" | "failed" | "replayed-failed" | "not-found" | "not-confirmed" | "not-decided" | "attempt-conflict" | "inputs-changed" | "inconsistent"; candidate? }`.

1. Tx A: `lockTaskSummary(tx, taskId)`; `getAcceptedSubmissionForReview` + `isConsistentSnapshot` (as 10.4) → none: `not-found`. Existing candidate with this `attempt_id`: other task → `attempt-conflict`; same task → replay (return stored state, no side effect). `getSummaryState` not confirmed → `not-confirmed`; `getCurrentConformityDecision` null → `not-decided`. Insert candidate row with the bindings. Commit (releases the lock).
2. Outside any transaction: load the `ReportDocument` inputs (snapshot values/results, summary text, decision outcome — all from the same Tx A reads), `generator.generate`, `storage.put(key, bytes)`; compute size and SHA-256.
3. Tx B: `lockTaskSummary`; re-read current summary id and decision id. Equal to the bound ones → insert outcome `ready`. Different → insert outcome `outdated` (file kept) → `inputs-changed`.
4. Failure at step 2: remove the object best-effort; Tx B inserts outcome `failed` with `generation-failed` or `storage-failed` → `failed`. If Tx B itself fails the candidate remains outcome-less (`generating`); a retry uses a new `attemptId`.

Unique violation on `attempt_id` under concurrency is resolved to the replay path. The command writes nothing else and calls no AI provider.

## Queries

- `listReportCandidates(executor, responsableId, taskId)` → candidates newest first with derived status: no outcome → `generating`; `failed` → `failed`; outcome `ready` and (`confirmed_summary_id`, `conformity_decision_id`) equal to the current summary id and current decision id → `ready`; otherwise (`outdated` outcome, or bound ids no longer current) → `outdated`. Joins display name and the decision outcome label source (`machine-conforme|machine-non-conforme` through `conformity_decisions`, read via a `conformity` query).
- `getReportCandidateFile(executor, responsableId, taskId, candidateId)` → `{ fileName, storageRef, byteSize, sha256 } | undefined` for an owned task and an outcome with a file.

## Routes (all `Cache-Control: no-store`)

| Route | Case | Status / body | Log |
|---|---|---|---|
| `POST /api/v1/tasks/{taskId}/report-candidates` | Employé | 403 `FORBIDDEN` | `report.candidate.refused` class `forbidden-role` |
| | Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND` (as 9.1) | class `not-found` |
| | Missing/invalid `attemptId`, extra property | 422 `VALIDATION_FAILED` | none |
| | Summary not confirmed | 409 `SUMMARY_NOT_CONFIRMED` | class `not-confirmed` |
| | No current decision | 409 `CONFORMITY_NOT_DECIDED` | class `not-decided` |
| | Attempt ID used by another task | 409 `REPORT_ATTEMPT_CONFLICT` | class `attempt-conflict` |
| | Inputs changed during generation | 409 `REPORT_INPUTS_CHANGED` | class `inputs-changed` |
| | Generator/storage failure (fresh or replay) | 502 `REPORT_GENERATION_FAILED` | `report.candidate.failed` class |
| | Inconsistent snapshot / other | 500 `INTERNAL_ERROR` | none |
| | Generated | 201 `ReportCandidate` | `report.candidate.generated` |
| | Replay of ready | 200 `ReportCandidate` | none |
| `GET …/report-candidates` | Employé 403; 404 classes | as above | refused |
| | OK | 200 `ReportCandidateList` | none |
| `GET …/report-candidates/{candidateId}/file` | refusals / failed / generating / unknown / other team / malformed id | 404 `TASK_NOT_FOUND` identical body | class `not-found` |
| | file retained | 200 bytes + headers (SPEC CAP-6) | `report.candidate.downloaded` |

Role check precedes body validation; for an invalid body the task is probed first so unknown tasks stay 404 (as 10.2–10.4). Messages (French): 502 « Le rapport n’a pas pu être généré. Vous pouvez réessayer. »; 409 not confirmed « La synthèse n’est pas confirmée : le rapport ne peut pas être généré. »; 409 not decided « Aucune décision de conformité n’est enregistrée : le rapport ne peut pas être généré. »; 409 changed « Les données ont changé pendant la génération : ce rapport est obsolète. Générez-le à nouveau. »; 409 attempt « Cette demande de génération est invalide. »; 422 « Cette demande est invalide. ».

## Contract

- `ReportCandidateRequest`: `{ attemptId: uuid }`, strict.
- `ReportCandidateStatus`: `generating | ready | failed | outdated`.
- `ReportCandidate`: `{ id, attemptId, origin: "generated-word", status, requestedAt, requestedBy: { id, displayName }, bindings: { auditRevision, summaryId, summaryVersion, conformityDecisionId, conformityOutcome }, template: { id, version }, file: { name, byteSize, sha256 } | null, failureClass: "generation-failed" | "storage-failed" | null }`, strict. No `official` property exists.
- `ReportCandidateList`: `{ candidates: ReportCandidate[] }`.
- New error codes listed in the SPEC. Binary download documented with the response media type.

## Web

- New `apps/web/.../report-candidates.tsx` rendered below the conformity decision by `InsightProposalsPanel` (it needs the evidence reload state of 10.4: eligible = `summaryVersion.state === "confirmed"` and `conformityDecision !== null`). State: `idle` / `generating` / `failed` / list. A new `crypto.randomUUID()` per click on « Générer le rapport Word » and per « Réessayer »; the same ID is reused only for an automatic transport retry of the same click.
- Handlers: `apps/web/src/app/api/tasks/[taskId]/report-candidates/route.ts` (GET, POST, CSRF check on POST, session cookie only, status/body pass-through, 503 when unreachable) and `.../[candidateId]/file/route.ts` (GET, streams bytes, forwards `Content-Type`, `Content-Disposition`, `no-store`, `nosniff`; 404 pass-through).
- The reopening flow already reloads evidence; the panel refetches the candidate list on every evidence reload so derived `outdated` shows immediately.
- i18n `fr.report`: every label and message above, status labels, section labels of the document, « Candidat — non officiel ». No « officiel » control wording, no English text.
