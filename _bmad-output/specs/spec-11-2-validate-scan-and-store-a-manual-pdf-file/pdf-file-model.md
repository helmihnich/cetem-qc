# PDF file model (CAP-1 to CAP-9)

## Migration `apps/api/src/db/migrations/0023_stored_files.sql`

```sql
CREATE TABLE stored_files (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  attempt_id uuid NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,   -- opaque scope for files; no business join in files code
  kind text NOT NULL CHECK (kind IN ('manual-pdf')),
  display_name text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  storage_ref text,                      -- NULL when rejected (binary not stored)
  uploaded_by uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stored_file_checks (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES stored_files(id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('validation', 'storage', 'scan')),
  result text NOT NULL CHECK (result IN ('passed','rejected','quarantined','failed','clean','threat','unavailable','not-performed')),
  failure_class text,
  scanner text,                          -- 'none' | 'clamav' on scan rows
  checked_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((stage='validation' AND result IN ('passed','rejected','quarantined'))
      OR (stage='storage' AND result IN ('passed','failed'))
      OR (stage='scan' AND result IN ('clean','threat','unavailable','not-performed') AND scanner IS NOT NULL))
);
-- history_only + no_truncate triggers on both tables, as report_candidates; index stored_files (task_id, seq DESC), stored_file_checks (file_id, seq)
```

Follow the real names of `tasks`/`identity_accounts` and the 0022 trigger helper functions if they differ. Rejected file: `storage_ref` NULL and only a validation row. Otherwise `storage_ref = 'files/pdf/<id>.pdf'` is generated server-side at insert.

## Derived status (one function, used by list, download, rescan, `getReadyFile`)

From the file's checks in `seq` order:
1. validation `rejected` → `rejected`; validation `quarantined` → `quarantined`.
2. storage `failed` → `storage-failed`.
3. latest scan row: `threat` → `quarantined`; `clean` or `not-performed` → `ready`; `unavailable` → `scan-failed`; none yet → `scan-pending`.

A `threat` row is final: later scan rows are not written for a quarantined file. `ready` needs validation `passed` and a latest scan of `clean`/`not-performed`. The scan note « analyse antivirus non effectuée (PoV) » is derived from `not-performed`, never stored as text.

## Validator — `modules/files/validators/pdf.ts` (pure, no I/O)

`validatePdf(bytes, { maxBytes }) → { result: "passed" } | { result: "rejected", class } | { result: "quarantined", class: "active-content" }`. Order:
1. Empty or longer than `maxBytes` → caller refuses before this point (CAP-2); defensively `rejected/corrupt-structure`.
2. `not-pdf`: bytes do not start with `%PDF-` followed by `1.`–`2.` and a digit (offset 0, strict).
3. `truncated`: no `%%EOF` marker in the last 1024 bytes.
4. `corrupt-structure`: no `startxref` + decimal offset in the last 2048 bytes; offset ≥ file length; at that offset neither the keyword `xref` nor an indirect object `N G obj` (xref stream); no `/Root` anywhere in the trailer/xref region (last 64 KiB window searched by the `trailer` keyword or an object containing `/Type /XRef`).
5. `encrypted`: `/Encrypt` followed by a reference or dictionary in the trailer/xref-stream dictionary.
6. `active-content` (quarantine): any of the name tokens `/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/SubmitForm`, `/ImportData`, `/GoToR`, `/GoToE` in the raw bytes (token boundary: next byte is not a name character). `/OpenAction` and `/AA` alone do not quarantine (common, benign). Tokens inside compressed object streams are not visible: documented limitation, scanner is the second line.

Rejection precedence follows the list order (first match wins). Tokens are matched on the latin1 view of the bytes, case-sensitive per the PDF specification.

## Ports

`modules/files/ports/pdf-scanner.ts`
```ts
type ScanResult = "clean" | "threat" | "unavailable" | "not-performed";
interface PdfScanner { id: "none" | "clamav" | string; scan(bytes: Uint8Array): Promise<ScanResult>; }
```
A throwing scanner is treated as `unavailable`. Adapters: `none` (always `not-performed`), `clamav` (`node:net` to `CLAMAV_HOST:CLAMAV_PORT`, `zINSTREAM\0`, chunks as 4-byte big-endian length + data, terminator 0, parse the reply: `stream: OK` → `clean`; `… FOUND` → `threat`; anything else, an error reply, a timeout (`CLAMAV_TIMEOUT_MS`, default 30000), a socket error or an early close → `unavailable`; reply is never logged). `files/index.ts` exports `createPdfScanner(env)` (`ANTIVIRUS` default `none`; unknown value throws at start-up with a path-free message) and `resolvePdfMaxBytes(env)` (default 20 971 520; invalid, ≤ 0 or above 20 971 520 → 20 971 520).

## Commands and queries (`modules/files/commands`, `queries`)

`deps = { pool, storage, scanner, maxBytes, now? }`. The caller (route) has already authorized the task and eligibility; `files` receives an opaque `taskId` and `uploaderId`.

`storePdfFile(deps, { taskId, uploaderId, attemptId, displayName, bytes })` → `{ type: "stored" | "replayed" | "attempt-conflict" | "storage-failed", file }`:
1. Compute SHA-256; validate. Tx A: lock by advisory lock on `attempt_id`; existing row with this attempt → other task: `attempt-conflict`; same task: `replayed` (stored state, no side effect). Else insert `stored_files` (+ validation check; `storage_ref` NULL when rejected).
2. Rejected: done (`stored`, status `rejected`). Otherwise outside any transaction `storage.put`; failure → `remove` best-effort, insert storage `failed` check → `storage-failed` (502). Success → storage `passed` check.
3. Quarantined by validation: stored, no scan, done. Otherwise `scanner.scan` outside a transaction (throw ⇒ `unavailable`), then insert the scan row (`threat` ⇒ status `quarantined`). If this insert itself fails the file stays `scan-pending`.
4. Unique violation on `attempt_id` under concurrency resolves to the replay path.

`rescanPdfFile(deps, taskId, fileId)` → `{ type: "rescanned" | "not-found" | "not-rescannable", file }`: advisory lock on the file, derive status; only `scan-failed` | `scan-pending`; read bytes from storage (missing → record scan `unavailable`), scan, insert row.

`listStoredFiles(executor, taskId)`; `getReadyPdfFile(executor, taskId, fileId)` → metadata + `storageRef` only when derived status is `ready` (internal to the route; the public contract for 11.3 `getReadyFile` returns the same without `storageRef`). Team scoping is the route's job (it probes the task through `getAcceptedSubmissionForReview`-style owned-task query for list/download/rescan, no eligibility needed there); an unowned task yields 404.

## Routes (all `Cache-Control: no-store`; registrar `apps/api/src/routes/register-file-routes.ts`)

| Route | Case | Status / body | Log |
|---|---|---|---|
| `POST /api/v1/tasks/{taskId}/pdf-files` | Employé | 403 `FORBIDDEN` | `file.pdf.refused` `forbidden-role` |
| | Malformed/unknown/other team/draft/no audit | 404 `TASK_NOT_FOUND` | `not-found` |
| | `Content-Length` > limit, or bytes > limit | 413 `FILE_TOO_LARGE` | `too-large` |
| | `Content-Type` ≠ `application/pdf` | 415 `UNSUPPORTED_FILE_TYPE` | `unsupported-type` |
| | Empty body, missing/invalid `X-Attempt-Id` | 422 `VALIDATION_FAILED` | none |
| | Summary not confirmed / no decision | 409 `SUMMARY_NOT_CONFIRMED` / `CONFORMITY_NOT_DECIDED` | `not-confirmed` / `not-decided` |
| | Attempt ID of another task | 409 `FILE_ATTEMPT_CONFLICT` | `attempt-conflict` |
| | Storage failure (fresh or replay) | 502 `FILE_STORAGE_FAILED` | `file.pdf.stored` status `storage-failed` |
| | Stored (any validation/scan status) | 201 `StoredFile` | `file.pdf.stored` status |
| | Replay | 200 `StoredFile` | none |
| `GET …/pdf-files` | Employé 403; 404 classes | as above | refused |
| | OK | 200 `StoredFileList` | none |
| `GET …/pdf-files/{fileId}/content` | not `ready`, unknown, malformed, other team | 404 `TASK_NOT_FOUND` identical | `not-found` |
| | ready | 200 bytes + headers (SPEC CAP-7) | `file.pdf.downloaded` |
| `POST …/pdf-files/{fileId}/scan-retries` | refusals as above; status not rescannable | 409 `FILE_NOT_RESCANNABLE` | `not-rescannable` |
| | rescanned | 200 `StoredFile` | `file.pdf.scan-failed` when still `scan-failed` |

Order for POST: role (403) → task id syntax (404) → task ownership/audit probe (404) → declared size and media type (413/415) → attempt ID and non-empty body (422) → eligibility (409s) → command. Role and ownership precede any size/type answer so unknown tasks stay indistinguishable. Messages (French): 413 « Le fichier dépasse la taille maximale de 20 Mo. »; 415 « Seuls les fichiers PDF sont acceptés. »; 409 attempt « Cette demande d’envoi est invalide. »; 409 rescan « L’analyse de ce fichier ne peut pas être relancée. »; 502 « Le fichier n’a pas pu être enregistré. Vous pouvez réessayer. »; 422 « Cette demande est invalide. ». Body parser errors from `express.raw` (`entity.too.large`) map to the 413 body above.

## Contract

- `StoredFile` (strict): `{ id, attemptId, status: "rejected"|"quarantined"|"scan-pending"|"scan-failed"|"storage-failed"|"ready", fileName (display), byteSize, sha256, uploadedAt, uploadedBy: { id, displayName }, validation: { result: "passed"|"rejected"|"quarantined", class: string|null }, scan: { result: "clean"|"threat"|"unavailable"|"not-performed"|"pending", scanner: "none"|"clamav"|null, checkedAt: string|null } }`. No storage key, no `official`, no report property.
- `StoredFileList`: `{ files: StoredFile[] }`. Request: raw `application/pdf` body with `X-Attempt-Id` and optional `X-File-Name` headers (documented as parameters).
- `files/index.ts` public surface adds: `storePdfFile`, `rescanPdfFile`, `listStoredFiles`, `getReadyFile`, `readStoredFile`, `createPdfScanner`, `resolvePdfMaxBytes`, `validatePdf`, port types, test seams `fileCommandTestSeams` (`scanner`, `storage`).

## Web

- `apps/web/src/app/api/tasks/[taskId]/pdf-files/route.ts` (GET list, POST: CSRF check, session cookie only, forwards raw bytes with `Content-Type`, `X-Attempt-Id`, `X-File-Name`, status/body pass-through, 503 when unreachable), `…/[fileId]/content/route.ts` (GET, streams bytes, forwards `Content-Type`, `Content-Disposition`, `no-store`, `nosniff`) and `…/[fileId]/scan-retries/route.ts` (POST).
- New `pdf-files.tsx` rendered below `report-candidates.tsx` in the report area; eligibility from the same evidence-reload state (`summaryVersion.state === "confirmed"` and `conformityDecision !== null`); one `crypto.randomUUID()` per selection/click, reused only for an automatic transport retry of the same click; list refetched on every evidence reload. The file name is rendered as text only.
- i18n `fr.pdfFile`: area title « Rapport PDF manuel », labels above, status and reason labels per class (`not-pdf` « Ce fichier n’est pas un PDF valide. », `truncated` « Le fichier est incomplet ou tronqué. », `corrupt-structure` « Le fichier est illisible ou sa structure est invalide. », `encrypted` « Le fichier est protégé par un mot de passe ou chiffré. », `active-content` « Le fichier contient du contenu actif non autorisé. », scan `threat` « Un risque de sécurité a été détecté. », `unavailable` « L’analyse de sécurité n’a pas pu être effectuée. », `not-performed` « Analyse antivirus non effectuée (PoV). »), alerts and button texts. No English text.

## Environment

`.env.example` gains empty `PDF_MAX_BYTES=`, `ANTIVIRUS=`, `CLAMAV_HOST=`, `CLAMAV_PORT=`, `CLAMAV_TIMEOUT_MS=` with a comment on the defaults; `.data/` is already ignored by 11.1.
