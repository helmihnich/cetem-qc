# Test harness (CAP-1, CAP-2, CAP-3)

## Baseline (commit 23e5a0d)

| Package | `test` today | Not run | `typecheck` today |
|---|---|---|---|
| `apps/api` | `calculations.test.ts` only | 13 files: routes ×4, `shutdown`, `db/migrate`, `db/transaction`, `identity-auth` ×2, `team-access/employee-credentials`, 3 `*.postgres.test.ts` | `tsc --noEmit`, includes tests |
| `apps/mobile` | explicit list of all 10 files | — | excludes tests (non-goal) |
| `apps/web` | none | `api/session/route.test.ts`, `api/tasks/route.test.ts` | includes tests |
| `packages/domain` | `graphie-calculations.test.ts` | — | none |
| `packages/schemas` | none | `src/api/v1.test.ts` | none |
| `packages/api-client` | none | `src/v1.test.ts` | none |
| `packages/types` | none | `scripts/check-generated.test.mjs` | none |
| `packages/i18n` | no tests | — | none |
| `packages/config` | no TS | — | not applicable |

Run directly at baseline, all non-PostgreSQL files pass. The PostgreSQL tests (3 `*.postgres.test.ts` files plus 2 tests in `employee-routes.test.ts`) skip without `CETEM_QC_TEST_DATABASE_URL`. Trial `tsc` on packages shows real errors: `domain` test (`value` possibly undefined, fixture possibly undefined) and `api-client` test (`error` of type `unknown`).

## Test scripts (CAP-1)

- Each package with tests gets a `test` script that discovers files by pattern (Node 24 `--test` glob, quoted), scoped to its source folders, never `node_modules`. Keep existing flags: `--import tsx`, and mobile's `--experimental-test-module-mocks`.
- `apps/api` keeps `test:calculations`.
- Verification: compare `git ls-files 'apps/*' 'packages/*' | grep -E '\.test\.(ts|tsx|mjs)$'` with the files reported by `pnpm -r test`. Every file must be listed.

## PostgreSQL harness (CAP-2)

One shared helper under `apps/api/src/test-support/` (not shipped code; not imported by `src/index.ts`). Every PostgreSQL test uses it instead of its own guard, migration list and skip flag.

1. **Resolve URL.** `CETEM_QC_TEST_DATABASE_URL` if set, else `DATABASE_URL`. Neither set → throw `PostgreSQL tests need DATABASE_URL or CETEM_QC_TEST_DATABASE_URL (local Docker database)`. The test fails; it does not skip.
2. **Local guard.** URL host must be `localhost`, `127.0.0.1` or `::1`, else throw before any connection.
3. **Test database.** If the database name already matches `cetem_qc_test` or `cetem_qc_test_<suffix>`, use it. Otherwise connect to the given database once and run `CREATE DATABASE cetem_qc_test`, ignoring SQLSTATE `42P04` (parallel test files race), then use the same URL with path `/cetem_qc_test`. Nothing else runs against the source database.
4. **Isolated schema.** Each test creates a uniquely named schema and returns a pool scoped to it (`search_path` set on every checked-out client, as today's `scopedPool`).
5. **Migrations.** Apply all migrations with the production runner. Export the migration function from `apps/api/src/db/migrate.ts` without changing its behaviour. Keep `main()` behind an entry-point check so importing it neither connects nor runs. Hand-picked migration file lists in tests are removed.
6. **Cleanup.** `DROP SCHEMA … CASCADE` in `finally`, then end the pool. The `cetem_qc_test` database itself stays (empty of test schemas).
7. Tests that build the app inject their pool. `createApp()` must never fall back to `DATABASE_URL` in a test.

Unreachable server → connection error → the test fails.

## Package typecheck (CAP-3)

- `packages/{domain,schemas,types,api-client,i18n}`: add `tsconfig.json` extending `../config/tsconfig.base.json` with `include: ["src/**/*.ts"]`, plus `"typecheck": "tsc --noEmit"`. Add `typescript` and `@types/node` dev dependencies at the root's pinned versions (`6.0.3`, `24.10.1`) where resolution needs them.
- Fix the reported errors at the root: narrow possibly-undefined values with assertions, and type `catch` variables before reading properties. Do not use `any`, `@ts-ignore` or new `as never` casts. The existing `@ts-expect-error` lines in domain V4/V5 must now be real expectations: if one is unused, the gate fails, and the test is corrected, not deleted.
- `pnpm -r typecheck` (root script `pnpm -r --if-present typecheck`) then picks them up automatically.
