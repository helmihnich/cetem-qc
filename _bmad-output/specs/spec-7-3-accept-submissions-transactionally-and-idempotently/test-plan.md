# Test plan

All tests use `node:test`. API tests run through `withPostgresTestSchema` against the local Docker PostgreSQL, with zero skipped tests. Mobile tests use fake `fetch` / fake transports, the SQLite test double and the App render double. Names are synthetic (« Employé Test », « Établissement A »).

## Domain — `packages/domain/src/graphie-catalogue.test.ts` (CAP-5)

- V1: A valid catalogue `2.0.0` payload with blank values, unparseable readings (`"abc"`) and empty choices → `ok`. The values come back unchanged.
- V2: Each row of the validation table in [server-command.md](server-command.md) → its code and the issue path.
- V3: `legacyContent` is `ok` for `sync-draft` and `INVALID_PAYLOAD` for `submit`.
- V4: Parity. For the same inputs, mobile `parseGraphiePayload` throws exactly when `validateGraphiePayload` fails, legacy `{ content }` aside (mobile converts it locally, the server refuses it).
- V5: The field IDs and choice options exported from domain equal those of `GRAPHIE_MOBILE_POV_CATALOGUE` as seen by mobile (re-export, same object).

## Contracts — `packages/schemas`, `packages/api-client` (CAP-1, CAP-7)

- C1: The envelope schema rejects missing or extra keys, non-UUID IDs, a negative or non-integer `baseRevision`, and `localDraftRevision` 0.
- C2: The three outcome schemas parse the documented bodies and reject extra keys.
- C3: The client methods return `{ status, body }` for 200, 409 and 422 outcome bodies. They throw `ApiRequestError` for `IDEMPOTENCY_KEY_REUSED`, 400, 401, 403, 404, 500 and malformed bodies. They send the bearer token, the route and the JSON body.
- `pnpm contracts:check` passes with the regenerated types.

## API PostgreSQL — `apps/api/src/sync-routes.postgres.test.ts` (or split per module)

| ID | Scenario | Expected |
|---|---|---|
| A1 | Assigned Employé, no audit, `submit` base 0, valid payload | 200 `accepted`, `serverRevision` 1, `acceptedAt`, `acceptedBy` = session account, `submissionId`. Exactly 1 audit (`submitted`, rev 1), 1 revision (`submission`), 1 submission (`submitted_by` = actor), 1 outcome row |
| A2 | `sync-draft` base 0, then `sync-draft` base 1, then `submit` base 2 | revisions 1, 2, 3; audit `submitted`, rev 3; draft-sync revisions have `results` NULL |
| A3 | Replay of A1 with the same key and body | same status, `response` byte-equal; row counts unchanged |
| A4 | Two concurrent identical requests | one revision; both responses equal |
| A5 | Two concurrent different keys, same base | one 200, one 409; one revision |
| A6 | Same key, different payload; same key, other actor; same `operationId`, new key | 422 `IDEMPOTENCY_KEY_REUSED`; no stored outcome disclosed; nothing written |
| A7 | Base 0 when the current revision is 2 | 409 `conflict`, `serverRevision` 2, `current` = { 2, state, lastChangedAt, lastChangedBy }; only the outcome row is added; replay returns the same 409 |
| A8 | Each validation code (legacy, wrong rule version, unknown field, NUL, bad choice, legacyContent on submit) | 422 `rejected` with that code; no audit, revision or submission row; replay returns the same 422 |
| A9 | Blank fields and `"abc"` readings on a submit | 200; payload stored unchanged; results show `missing-input` / `invalid-input` |
| A10 | Any operation after an accepted submission | 422 `AUDIT_ALREADY_SUBMITTED`; still exactly 1 submission |
| A11 | No session / Responsable / task of another employee / unknown task / non-UUID | 401 / 403 / 404 / 404 / 404; nothing written; body has no task data |
| A12 | Malformed envelope; 300 kB body | 400 `VALIDATION_ERROR`, not stored; 413 `PAYLOAD_TOO_LARGE`, nothing written |
| A13 | Failure injected after the revision insert (test seam in the audits command) | 500; zero new rows in all four tables |
| A14 | Stored submission results | deep-equal to `calculateGraphieResults(identity, values)`; every result's identity equals the revision columns. Identity mismatch forced through a seam → 500, nothing written |
| A15 | `UPDATE` / `DELETE` on `audit_revisions`, `audit_submissions`, `sync_operation_outcomes` | raises |
| A16 | Migration 0008 → 0009 with existing tasks | rows kept; tables and triggers present |

Route-level non-PostgreSQL tests keep the existing pattern for the 401/403 paths if the file layout prefers it.

## DEP-01/02 claim pin (CAP-5)

- D1: A test documents that no required-field, range, unit or tolerance validation is applied (A9 passes with blank and invalid values). The DR-004 business validation claim stays blocked on DEP-01/02. When CETEM approves rules, this test is updated together with a new rule version.

## Mobile — adapter `apps/mobile/sync/app-sync-transport.test.ts` (CAP-7)

- T1: Each row of the mapping table in [mobile-transport.md](mobile-transport.md) produces the expected `SyncResult`, with a fake `fetch`. A 200 body without `outcome: "accepted"` → `blocking`, never `accepted`.
- T2: The envelope sent matches the `SyncRequest` (route per kind, same `operationId` and `idempotencyKey`, `localDraftRevision`, ISO `clientSavedAt`, payload unchanged).
- T3: A fetch that never resolves is aborted at 30 s (injected timer) → `retryable` `timeout`.

This file's 7.2 assertion « the real module returns `null` » is replaced by T1–T3. The approved 7.3 contract removes the `null` transport, so this is a contract change, not a weakened test.

## Mobile — engine `apps/mobile/sync/sync-engine.test.ts` (CAP-7)

- E1: Lost response. The fake transport records the request, then throws. The next attempt sends the same key, the server double replays 200, and exactly one `accepted` outcome is stored.
- E2: Task A answers `blocking` `TASK_NOT_FOUND`. A's item is `blocked`, task B's items are sent and resolved, and `summary.blocked` stays false. A `blocking` `HTTP_401` still stops the run.
- E3: Two `run()` calls during an active run → exactly one follow-up run. An item added during the first run is sent in the follow-up run.
- Every existing engine test passes unchanged.

## Mobile — App render `apps/mobile/App.render.test.tsx` (CAP-7, CAP-8)

- R15: Sign-in online with a queued item starts a run (fake transport receives it). Going offline then online starts another. `AppState` `active` starts another. A changed save starts one, and an unchanged save does not.
- R16: An accepted submit item with `detail.acceptedAt` renders « Soumission acceptée par le serveur le JJ/MM/AAAA à HH:MM. », with the expected value computed by the same local-time getters. Without `acceptedAt`, no line renders and the lifecycle label is unchanged.
- R17: Offline, or not `online-authorized`: no trigger sends anything.
- The 7.2 R7 test (« real module → no run ») is updated to the 7.3 contract: with the module mocked to a transport that is never called because the device is offline, the item stays `queued`. All other 7.2 R-tests pass unchanged.

## Gates

`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check` and `git diff --check` pass.
