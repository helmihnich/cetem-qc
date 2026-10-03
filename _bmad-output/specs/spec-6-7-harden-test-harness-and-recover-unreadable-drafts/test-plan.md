# Test plan

All tests run under `pnpm -r test`. Never use `skip`, `only` or `todo`.

## H — Harness (apps/api, unit tests of the helper, no database needed)

| ID | Case | Expected |
|---|---|---|
| H1 | No `DATABASE_URL` and no `CETEM_QC_TEST_DATABASE_URL` | throws the « need DATABASE_URL » error (a failure, not a skip) |
| H2 | Host `db.example.com` or a Neon-style host | throws before any connection attempt (inject a connector spy: 0 calls) |
| H3 | `postgresql://u:p@127.0.0.1:5432/cetem_qc` | test URL path becomes `/cetem_qc_test`; host, port and credentials kept |
| H4 | `…/cetem_qc_test_abc` | used as is, no `CREATE DATABASE` |
| H5 | `CETEM_QC_TEST_DATABASE_URL` set alongside `DATABASE_URL` | the former wins |
| H6 | `CREATE DATABASE` fails with `42P04` | treated as success |
| H7 | Importing `db/migrate.ts` | does not connect and does not run `main()` |

## P — PostgreSQL (real local database)

| ID | Case | Expected |
|---|---|---|
| P1 | Existing suites: `employee-credentials.postgres`, `tasks.postgres`, `employee-tasks.postgres`, and the 2 PostgreSQL tests in `employee-routes.test.ts` | run through the harness, pass, 0 skipped |
| P2 | Migrations through the harness | `schema_migrations` in the test schema lists every `NNNN_*.sql` file; a second run applies nothing |
| P3 | Cleanup | after each test its schema is absent from `pg_namespace` |
| P4 | Isolation | no table is created or written in the source `cetem_qc` database (check `pg_tables`/row counts of `public` before and after, or assert that only the admin `CREATE DATABASE` ran there) |
| P5 | Action item epic-4-2 | `POST /tasks` with `\u0000` in `establishment` or `service` → 400 validation error and no task row; establishment `"   "` → 400 |

## S — Schema / contract

| ID | Case | Expected |
|---|---|---|
| S1 | `createTaskRequestSchema` with NUL in either field | rejected |
| S2 | establishment of whitespace only | rejected; `" Centre "` accepted |
| S3 | `contracts:check` | generated types match the updated OpenAPI |

## T — Typecheck

| ID | Case | Expected |
|---|---|---|
| T1 | `pnpm -r typecheck` | runs `typecheck` in domain, schemas, types, api-client, i18n and passes |
| T2 | Manual negative check (not committed) | a type error added to a package test file makes T1 fail |

## M — Mobile (`local-drafts.test.ts`, `sqlite-draft-database.test.ts`, `App.render.test.tsx`)

| ID | Case | Expected |
|---|---|---|
| M1 | Repository `deleteUnreadable` on a stored old-rule row | row gone; other employee/task rows and `synchronized_tasks` untouched |
| M2 | `deleteUnreadable` with no row | resolves |
| M3 | Authorization locked | rejects; row bytes unchanged |
| M4 | SQLite statement | deletes by `employee_id` + `task_id` only, in an exclusive transaction, with no `SELECT` first |
| M5 | App, online: old-rule `2.0.0`/`3` draft | notice + « Supprimer le brouillon local » → confirm → « Brouillon local supprimé. », paper defaults shown, Save enabled, repository row gone |
| M6 | App, cached offline open of a catalogue `1.0.0`/schema `2` draft | same action available and works offline |
| M7 | App, cancel | bytes unchanged, notice remains |
| M8 | App, delete failure | « Le brouillon local n’a pas pu être supprimé. Il est conservé. », bytes unchanged, Save still disabled |
| M9 | App, normal draft delete after editing | form shows `createNewGraphieDraftValues()`, not the deleted values (CAP-5) |
| M10 | App, generic storage failure | no delete action |

The existing tests that assert the compatibility notice keeps bytes stay unchanged and must still pass.
