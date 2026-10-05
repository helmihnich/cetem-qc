# Delivery notes and hand-offs

## Files expected to change

- `packages/types/openapi/cetem-qc-v1.yaml` and `src/generated/api-v1.ts`: the two operations, `SyncOperationRequest`, `SyncOperationAccepted`, `SyncOperationConflict`, `SyncOperationRejected`, the `GraphieDraftPayload` schema, and the new `ApiError` codes.
- `packages/schemas/src/api/v1.ts` (+ test): zod schemas typed against the generated contract.
- `packages/api-client/src/v1.ts` (+ test): the two methods ([mobile-transport.md](mobile-transport.md)).
- `packages/domain/src/graphie-catalogue.ts` (new, + test): the catalogue data moved from `apps/mobile/graphie-pov-catalogue.ts` (types, sections, fields, defaults, help texts) and `validateGraphiePayload`. Export it from `index.ts`. `apps/mobile/graphie-pov-catalogue.ts` keeps its exports (re-exports plus `parseGraphiePayload` and `createNewGraphieDraftValues`, unchanged in behaviour), so mobile imports do not change.
- `apps/api/src/db/migrations/0009_audits_and_sync.sql` ([data-model.md](data-model.md)).
- `apps/api/src/modules/audits/**`, `apps/api/src/modules/sync/**`, the public `tasks` query, and the routes in `apps/api/src/index.ts` ([server-command.md](server-command.md)).
- `apps/mobile/sync/app-sync-transport.ts`, `sync-engine.ts`, a formatter for the acceptance line, `App.tsx` (transport wiring, triggers, acceptance line), `packages/i18n/src/fr.ts` (`submittedAt`).
- Tests next to each file ([test-plan.md](test-plan.md)).

## Hand-offs

- **Story 7.4.** Refuse every API mutation of accepted evidence, for both roles. Keep the accepted snapshot (revision payload, results, identity, `submitted_by`, `accepted_at`, task link) readable for authorized review. The insert-only triggers from 7.3 are the database floor.
- **Story 8.1.** A conflict resolves the item with `detail` = `current` metadata. The server version is read from `audit_revisions` (latest revision). A keep-local revision is a new operation with a new key and base = the current revision.
- **Story 8.2.** A rejection resolves the item with `detail` = `{ code, issues }`. The correction draft becomes a new operation.
- **Story 8.4.** A reassigned task answers 404 `TASK_NOT_FOUND`. The item stays `blocked` and the run continues with other tasks.
- **Story 9.1.** Show the accepted state in the Responsable task list (the contract `state` is the constant `draft` today), and render W4 from `audit_revisions` and `audit_submissions`. Keep the identity/results invariant (6.4 deferred entry).
- **DEP-01/02.** When CETEM approves business validations, add them to `validateGraphiePayload` under a new rule or catalogue version, and update test D1.

## Deferred-work items this story resolves (mark them resolved in deferred-work.md at build time)

- 7.1 spec: there is no server command for `sync-draft` (now `POST …/draft-syncs`).
- 7.1 review: `TASK_NOT_ASSIGNED` blocks every task (task-level skip for `TASK_NOT_FOUND`).
- 7.2 review: a submission requested during an active run waited for the next trigger (follow-up run).
- 6.4 review, server side: identity and results stay consistent (CAP-6 invariant). The view-level check stays with 9.1.
- Sprint action item `epic-6-retro-item-15` (CAP-6).
