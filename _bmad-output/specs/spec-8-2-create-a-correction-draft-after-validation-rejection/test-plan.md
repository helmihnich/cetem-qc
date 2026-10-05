# Test plan

IDs continue the 7.x/8.1 series. Every test uses synthetic names. PostgreSQL tests run on the local harness with zero skipped. Mobile tests use the SQLite test double.

## Contracts (`packages/schemas`, `packages/api-client`)

- **K3** `syncOperationRequestSchema` accepts an optional UUID `correctionOfOperationId` and refuses a non-UUID. `syncOperationRejectedSchema` accepts `INVALID_CORRECTION_REFERENCE`. `contracts:check` passes with the OpenAPI change.
- **K4** The typed client sends `correctionOfOperationId` only when it is given (request body asserted).

## Domain (`packages/domain`)

- **V1** `validateGraphiePayload` refuses a lone high surrogate and a lone low surrogate in a value and in `legacyContent` (`INVALID_PAYLOAD`, `unpaired-surrogate`, path without the value). It accepts a paired surrogate. Every existing V/domain case keeps its result.
- **V2** `checkGraphiePayloadStructure` returns the same code and issues as `validateGraphiePayload` for every structural case, and passes NUL and surrogate payloads.

## API (PostgreSQL route tests)

- **L9** A refused submit (stored 422, for example a lone surrogate), then a `submit` with `correctionOfOperationId` → 200. Exactly one `rejected-submission-correction` row links that revision to the refused operation, with the actor.
- **L10** A refused submit, a `draft-sync` with the reference (→ one row), then a `submit` with the same reference → 200 and still one row.
- **L11** Invalid references each give a stored 422 `INVALID_CORRECTION_REFERENCE` with the issue path `correctionOfOperationId`, and no revision is written: an unknown ID; an accepted outcome; a conflict outcome; a refused `sync-draft`; a refused submit with `AUDIT_ALREADY_SUBMITTED`; another actor's refusal; another task's refusal; an outcome already linked as `sync-conflict-revision`.
- **L12** A stale base with a valid reference → 409 (base check first). Replaying any L9–L12 request returns the stored bytes.
- **L13** Fingerprints of requests without the field equal their 8.1 values (a stored fixture fingerprint is recomputed). Adding the field to a replay is `key-reused`.
- **L14** Both `conflictOperationId` and `correctionOfOperationId` valid → one row of each type on the accepted revision.
- **L15** Migration 0011 → 0012 with `migrateThrough` on a database with audits and an 8.1 link keeps every row. UPDATE, DELETE and TRUNCATE on `audit_lineage_links` are still refused. An unknown `link_type` insert is refused.
- **L16** The lineage insert failure rolls back the revision and the outcome (seam `afterRevisionInsert`).

## Mobile store and engine

- **S5** v4 → v5 migration keeps every row and adds the column, table and trigger. Restart at v5 accepts. A v5 database missing `correction_drafts` is refused as incomplete, and nothing is deleted. A v6 database is refused. Version-pinned tests follow the bump, recorded as a build decision like 8.1.
- **C1** `createCorrectionDraft` on an open refusal: one correction row, the local draft = snapshot payload at `previous.revision + 1`, no new snapshot or item, the refused item and snapshot byte-identical.
- **C2** Each refusal reason (`stale` ×3: newer submit, already corrected, `AUDIT_ALREADY_SUBMITTED`; `open-conflict`; `unresolved`; `snapshot-unavailable`) writes nothing.
- **C3** A storage failure inside the transaction leaves every table as before (all or nothing).
- **C4** Stamping: after creation, `save` and `requestSubmission` items carry `correctionOperationId`. A superseding item inherits it. After an item carrying it is resolved `accepted`, new items carry none.
- **C5** `UPDATE correction_drafts` is refused, and the row survives.
- **C6** `requestSubmission` with NUL or a lone surrogate throws `SubmissionValidationError` with the domain issues and writes nothing. Outbox test line 244 still gets `SubmissionNotAllowedError`.
- **E6** The engine sends `correctionOfOperationId` from the item and omits it when null (fake transport asserts the request). A `rejected` outcome is recorded with its detail, and the run continues as before.
- **T5** The 7.3 adapter puts the field in the envelope only when set.
- **P1** Parity table (payload-validation.md): `parseGraphiePayload` and the domain agree on every structural case. Character cases stay readable on the device and are refused for `submit`.

## Derivation (`task-sync-state.test.ts`)

- **D3** Rows: refused submit → `acceptance-blocked`, `rejection` with code and issues, `canCorrect` true. `AUDIT_ALREADY_SUBMITTED` → `canCorrect` false. Corrected refusal → `draft`, `correction` set, `canSubmit` true. A later unresolved submit → `submission-pending` and `correction` null. That submit accepted → `submitted`. Refused again → a new `rejection` on the newer item. An open conflict takes precedence (8.1 rows unchanged). Every 7.2/8.1 row keeps its expectation.

## App render tests (`App.render.test.tsx`)

- **R29** A refused submit shows the blocked state, the code message, issue lines named `section › champ` without values, `rejectionOriginalKept` and `rulesGated`. The form is read-only. No Soumettre, no conflict text, no conflict action.
- **R30** « Créer un brouillon de correction » → « Brouillon de correction », the link line with date and time, editable form, field error text on the refused field.
- **R31** Full path: edit the field, Soumettre and confirm → pending read-only; accepted → « Soumis — accepté par le serveur ». The transport saw the reference.
- **R32** Creation while offline succeeds. Nothing is sent until online.
- **R33** Creation failure (store refusal) shows `correctionFailed`, keeps the panel, and nothing changes.
- **R34** `AUDIT_ALREADY_SUBMITTED` shows its message and no action.
- **R35** The correction's submission refused again → the panel returns with the new issues, and a second correction is possible.
- **R36** Local `SubmissionValidationError` → `submissionInvalid` with issue lines, the form stays editable, and no item exists.
- **X4** `rejectionIssueLines` unit tests: field path, table cell, unknown field, form-level path, unknown code, duplicates merged, catalogue order.
