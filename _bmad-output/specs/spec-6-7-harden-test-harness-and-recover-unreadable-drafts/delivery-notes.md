# Delivery notes

## Files affected

| File | Change |
|---|---|
| `apps/api/package.json` | `test` discovers all `src/**/*.test.ts`; keep `test:calculations`. |
| `apps/api/src/test-support/*` | New PostgreSQL harness ([test-harness.md](test-harness.md)) and its H tests. |
| `apps/api/src/db/migrate.ts` | Export the migration function; guard `main()` so importing it has no side effects. |
| `apps/api/src/**/*.postgres.test.ts`, `apps/api/src/employee-routes.test.ts` | Use the harness; remove `{ skip: … }`, per-file guards and hand-picked migration lists. Assertions unchanged or stronger. |
| `apps/api/src/db/README.md` | Replace the manual `docker run` / `CETEM_QC_TEST_DATABASE_URL` section with the harness rules (DATABASE_URL, local guard, `cetem_qc_test`). |
| `apps/web/package.json` | `test` script for `src/**/*.test.ts`. |
| `apps/mobile/package.json` | `test` by pattern (keep `--experimental-test-module-mocks`). |
| `packages/{domain,schemas,api-client}/package.json` | `test` by pattern + `typecheck`; `tsconfig.json`. |
| `packages/types/package.json` | `test` running `scripts/*.test.mjs` + `typecheck`; `tsconfig.json`. |
| `packages/i18n/package.json` | `typecheck`; `tsconfig.json`. |
| `packages/domain/src/graphie-calculations.test.ts`, `packages/api-client/src/v1.test.ts` | Type fixes only. |
| `packages/schemas/src/api/v1.ts`, `packages/types/openapi/cetem-qc-v1.yaml`, `packages/types/src/generated/api-v1.ts` | Action item epic-4-2. |
| `apps/mobile/local-drafts/{model,authorized-drafts,sqlite-draft-database}.ts` | `deleteUnreadable` ([unreadable-drafts.md](unreadable-drafts.md)). |
| `apps/mobile/App.tsx` | Unreadable-delete action on both compatibility paths; form reset after any delete. |
| Mobile tests | M1–M10 ([test-plan.md](test-plan.md)). |
| `pnpm-lock.yaml` | Only if dev dependencies are added. |
| `_bmad-output/implementation-artifacts/epic-6-context.md` | CAP-6: in Technical Decisions, tolerances/suggested verdicts live in `packages/domain` calculations (6.6); `rule-evaluation` owns only unresolved rules. Add Story 6.7 to Stories. |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Action items per [action-items.md](action-items.md). Story status moves through the normal workflow. |
| `_bmad-output/implementation-artifacts/deferred-work.md` | Mark resolved: 5.6 « form keeps the deleted draft's values », 5.6 « Known limitation … Delete is hidden », 6.6 « Explicit delete is still available », 6.6 « apps/api test runs only the calculations suite », 6.6 « packages/domain … no typecheck », 6.6 « epic context … rule-evaluation ». Add: mobile test files are excluded from `apps/mobile` typecheck. |

Untouched: catalogue, rule identity, domain calculation logic, local draft envelope, gate scripts, `.env`.

## Done at spec time

- `epics.md`: Story 6.7 entry under Epic 6, after 6.6.
- `sprint-status.yaml`: `6-7-harden-the-test-harness-and-recover-unreadable-drafts: ready-for-dev`; `epic-6: in-progress`.

## Running PostgreSQL tests locally

`DATABASE_URL` must point at the local Docker PostgreSQL (e.g. `postgresql://cetem:cetem@127.0.0.1:5432/cetem_qc`, set in the shell, never committed). `pnpm -r test` then creates `cetem_qc_test` on first run.
