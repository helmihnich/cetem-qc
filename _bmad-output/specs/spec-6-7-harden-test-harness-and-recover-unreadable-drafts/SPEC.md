---
id: SPEC-6-7-harden-test-harness-and-recover-unreadable-drafts
story: 6.7
status: done
approved: 2026-10-03
baseline_commit: 23e5a0d
companions:
  - test-harness.md
  - unreadable-drafts.md
  - action-items.md
  - test-plan.md
  - delivery-notes.md
sources:
  - .automation/task.md
  - _bmad-output/implementation-artifacts/deferred-work.md
  - _bmad-output/implementation-artifacts/sprint-status.yaml
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 6.7 — Harden the test harness and recover unreadable local drafts

## Why

**Pain.** The pipeline gates are weaker than they look. `pnpm -r test` runs 1 of the 14 `apps/api` test files and none of the web, `api-client`, `schemas` or `types` tests. The PostgreSQL suites skip silently without `CETEM_QC_TEST_DATABASE_URL`. `pnpm -r typecheck` never checks `packages/*`, and real type errors already sit in the domain and api-client test files. On mobile, a draft stamped with an old catalogue or rule tuple blocks its task on that device: Save is disabled and Delete is hidden. After an explicit delete, the form still shows the deleted values. Every remaining story builds on these gates, so they must be real first.

**Story statement.** As the delivery team, we want every test and every package checked by the gates, and as an Employé, I want to discard a local draft the app can no longer read, so that later stories are verified for real and no task stays blocked on a device.

## Capabilities

Mechanics are in [test-harness.md](test-harness.md) (CAP-1…3), [unreadable-drafts.md](unreadable-drafts.md) (CAP-4, CAP-5) and [action-items.md](action-items.md) (CAP-7).

- **CAP-1** — Complete test run
  - **intent:** Every committed test file in every workspace package runs under `pnpm -r test`.
  - **success:** Each `*.test.ts`, `*.test.tsx` and `*.test.mjs` tracked by git under `apps/*` and `packages/*` appears in the `pnpm -r test` output (30 files at baseline: api 14, mobile 10, web 2, and 1 each in domain, schemas, types and api-client). Discovery is by pattern, so a new test file runs without editing a script. All pass.
- **CAP-2** — PostgreSQL test harness
  - **intent:** PostgreSQL-backed tests run against the local Docker database, on isolated migrated storage, and never touch any other database.
  - **success:** With `DATABASE_URL` set to the local Docker database, all PostgreSQL tests run with 0 skipped and pass. Each test migrates its own schema with the production migration runner and drops it afterwards. A non-local host is refused before connecting. A missing or unreachable database fails the run instead of skipping. The `cetem_qc` development data is never written.
- **CAP-3** — Package typecheck
  - **intent:** `pnpm -r typecheck` type-checks every TypeScript package under `packages/*`, including its test files.
  - **success:** `domain`, `schemas`, `types`, `api-client` and `i18n` each have a `typecheck` script that covers `src/**/*.ts`, test files included, under the shared strict base config. The existing errors are fixed in the code, not suppressed. A deliberate type error in a package test file makes the gate fail.
- **CAP-4** — Recover an unreadable local draft
  - **intent:** When the compatibility notice is shown, the Employé can discard that local draft after confirming, online or offline.
  - **success:** The notice shows « Supprimer le brouillon local ». Confirming deletes the one draft row for that employee and task without parsing it. The form then opens with fresh paper-form defaults and Save enabled, and the notice reads « Brouillon local supprimé. ». Cancelling, or a failed delete, keeps the stored bytes unchanged.
- **CAP-5** — Clean form after any explicit delete
  - **intent:** After any explicit draft delete, the form shows a new draft, not the deleted values.
  - **success:** After a successful delete (normal or unreadable), the form values equal `createNewGraphieDraftValues()`, legacy-content mode is off and the legacy text is empty.
- **CAP-6** — Epic 6 context matches Story 6.6
  - **intent:** The agent context names the right owner for tolerances.
  - **success:** `_bmad-output/implementation-artifacts/epic-6-context.md` states that the paper-form tolerances and per-test suggested verdicts (`GRAPHIE_TOLERANCES`, `judgeTolerance`) live in the `packages/domain` calculations module (Story 6.6). `rule-evaluation` keeps only the still-unresolved rules. Story 6.7 is listed under Stories.
- **CAP-7** — Action items triaged
  - **intent:** The open `action_items` in `sprint-status.yaml` reflect reality.
  - **success:** Each of the 13 items has the status and note given in [action-items.md](action-items.md). Items marked done are implemented or proven by named evidence. Open items carry a `note:` explaining why.

## Constraints

- Never delete, skip (`skip`/`only`/`todo`) or weaken a test, and never edit the gate scripts. Fix root causes.
- No test may connect to a non-local host or write to a database other than `cetem_qc_test*`. Tests inject their own pool and never import `apps/api/src/db/pool.ts`.
- The test database URL comes from the environment only. No credentials are committed.
- The unreadable-draft delete never parses the row and is scoped to one employee and one task. It goes through the same offline authorization wrapper and per-scope queue as the normal delete.
- UI text is French and reuses the existing `fr.employeeTasks` strings. The mobile app keeps working offline.
- No draft migration, and no change to the catalogue, rule identity, domain calculations or local draft envelope. The OpenAPI contract changes only for action item epic-4-2.

## Non-goals

- Type-checking mobile test files (`apps/mobile/tsconfig.json` excludes them). Recorded as a deferred item.
- Running the root `scripts/check-boundaries.test.ts` under `pnpm -r test`. It stays under `pnpm boundaries:test`.
- Deleting drafts that fail for reasons other than compatibility (corrupt JSON, storage unavailable).
- Web UI render-test infrastructure (needed by action item epic-4-1, which stays open).
- Native device, SQLCipher or Expo export evidence.
- Starting or provisioning Docker. The harness uses the database it is given.

## Success signal

With `DATABASE_URL` pointing at the local Docker PostgreSQL, `pnpm -r test` runs every tracked test file under `apps/*` and `packages/*` with 0 failures and 0 skipped tests. `pnpm -r typecheck` covers the 5 TypeScript packages. A mobile render test shows an old-rule draft being discarded from the compatibility notice and the form re-seeded. `boundaries:check`, `contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the brief, the code and the Product Owner decisions in the pipeline rules (no migration of old drafts, unreadable drafts can be deleted locally).

- The test database is `CETEM_QC_TEST_DATABASE_URL` when set. Otherwise it is derived from `DATABASE_URL` as the sibling database `cetem_qc_test` on the same server, created if absent. The `cetem_qc_test*` name guard and the per-test schema stay.
- Local means host `localhost`, `127.0.0.1` or `::1`.
- A missing or unreachable database fails the PostgreSQL tests (retro item epic-4-5: zero skipped PostgreSQL tests).
- `packages/config` has no TypeScript and gets no typecheck. The `.mjs` scripts in `packages/types` are run by tests but not type-checked.
- The unreadable delete applies only to `GraphiePayloadCompatibilityError` and `LocalDraftPayloadCompatibilityError`, on both the online and the cached offline open paths.
- This story makes the 6.6 sentence « Explicit delete is still available » true. The 6.6 spec is not edited.

## Open Questions

None.

## Implementation notes (2026-10-03)

Recorded during the build; no business rule was added.

- **Staged migrations.** `migrate(pool, { through })` gained an optional stop version (default: all files, behaviour unchanged). `tasks.postgres` and `employee-tasks.postgres` insert Responsables before `0004` and seed a task before `0007` to prove the backfills, so the harness offers `migrateThrough` and a `migrate({ through })` step instead of hand-picked SQL files.
- **Scoped pool.** The harness gives each test a real `pg` `Pool` whose connections start with `search_path` set to the test schema (`options: -c search_path=…`). This replaces the cast `scopedPool` wrappers.
- **CREATE DATABASE race.** Besides `42P04`, SQLSTATE `23505` (unique violation on `pg_database`, raised by concurrent `CREATE DATABASE`) also counts as « already exists ».
- **Stale assertion found by the harness.** The Story 3.3 PostgreSQL test expected `GET /session` to return 401 for a deactivated account. Story 5.2 deliberately changed this to 403 `ACCOUNT_DEACTIVATED` (approved spec, used by the mobile app). The test always skipped, so it was never updated. It now asserts 403 and the error code.
- **Package typecheck.** Under the shared strict base config, no type errors surfaced in the package test files, so no code change was needed. A deliberate error in `packages/schemas/src/api/v1.test.ts` made `pnpm -r typecheck` fail (T2, not committed).
- **Unreadable delete on the failure path.** If the discard fails, the compatibility notice is shown again next to « Le brouillon local n’a pas pu être supprimé. Il est conservé. ». This covers the offline path too, where the compatibility text first appeared as the error.

### Review Findings

Code review 2026-10-03 (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). 0 decision-needed, 7 patch (all applied), 3 defer, 13 rejected. All gates pass after the patches (`pnpm -r test`: 268 tests, 0 failures, 0 skipped).

- [x] [Review][Patch] The local-only guard could be bypassed with `?host=` or `?hostaddr=`, because `pg-connection-string` lets query parameters override the URL host. Such URLs are now refused, with H2 cases. [apps/api/src/test-support/postgres.ts:47]
- [x] [Review][Patch] If `pool.end()` rejected, `DROP SCHEMA` was skipped and the test schema leaked. The drop now runs in its own `finally`. [apps/api/src/test-support/postgres.ts:125]
- [x] [Review][Patch] Nothing proved that running `db/migrate.ts` still calls `main()`. Added H8, which runs it as the entry point and expects « Database migration failed ». [apps/api/src/test-support/postgres.test.ts]
- [x] [Review][Patch] Nothing tested the CAP-5 reset of legacy-content mode. Added M9b, which deletes a legacy-content draft and checks that the legacy field is gone, the paper defaults are back and the next save is structured. A mutation test confirmed that M9b fails without the reset. [apps/mobile/App.render.test.tsx]
- [x] [Review][Patch] No test covered the `23505` CREATE DATABASE race code. Added it to H6. [apps/api/src/test-support/postgres.test.ts]
- [x] [Review][Patch] `tasks.postgres.test.ts` mixed Latin-1 and UTF-8 text with CRLF and LF line endings, so « préexistant » was read as U+FFFD. Re-saved as UTF-8 with LF. [apps/api/src/modules/tasks/tasks.postgres.test.ts]
- [x] [Review][Patch] Discovery was not fully by pattern. `local-drafts/*.test.tsx` and web `*.test.tsx` were not matched. The globs are now `local-drafts/**/*.test.{ts,tsx}` and `src/**/*.test.{ts,tsx}`. [apps/mobile/package.json, apps/web/package.json]
- [x] [Review][Defer] NUL is still accepted in free-text fields other than task establishment/service. [packages/schemas/src/api/v1.ts] — deferred: outside the epic-4-2 scope, and it changes the contract of other operations.
- [x] [Review][Defer] No automated check of CAP-1/CAP-3 coverage (tracked test files vs `pnpm -r test` output, negative typecheck). — deferred: needs a gate decision; gate scripts are not edited here.
- [x] [Review][Defer] `test_<uuid>` schemas left by killed runs are never removed. [apps/api/src/test-support/postgres.ts] — deferred: cleanup at startup must not race with test files running in parallel, so it needs a design.

Rejected:
- `false`: the root `scripts/check-boundaries.test.ts` is not under `pnpm -r test`. It is an explicit Non-goal and runs under `pnpm boundaries:test`.
- `false`: changing the 3.3 assertion from 401 to 403 « weakens » a test. Story 5.2 (approved) set 403 `ACCOUNT_DEACTIVATED`. The new assertion also checks the code, so it is stronger, and the change is recorded in the Implementation notes.
- `false`: removing the per-suite « schema removed » checks weakens the suites. The harness now owns schema lifetime, and P3 checks the drop centrally, including after a failure.
- `false`: `db:migrate` may no longer run. It was checked directly, and H8 now pins it.
- `low`: the unreadable-delete button reads `draftDeletingRef` during render. This matches the existing Save/Delete buttons, and M8 proves that a retry is possible after a failure.
- `low`: the App test SQLite mock tells the two DELETE statements apart by the substring "revision". The real SQL and its revision guard are covered in `sqlite-draft-database.test.ts`.
- `low`: OpenAPI `maxLength: 200` applies to the raw string, while the runtime trims first. The schema `description` says « Trimmed before validation »; a 200-character limit with padding on both sides is not an everyday input.
- `low`: tests that use paths relative to `apps/api` (`src/db/migrations`, H7/H8) need that working directory. The package scripts always run there, which is the repository convention.
- `low`: P4 only asserts that nothing was sent when `adminUrl` is undefined. That case cannot reach the source database by construction.
- `low`: P4 checks a separate `ensureTestDatabase` call, not the cached real path. The spec allows this, and both use the same function.
- `low`: the package typecheck has no `noUncheckedIndexedAccess`. CAP-3 requires the shared strict base config, which this meets. Stricter flags would be a repository-wide decision.
- `low`: no new `typescript`/`@types/node` dev dependencies. They resolve from the workspace root, and `pnpm -r typecheck` passes.
- `low`: the spec scenarios « authorization lost while pending » and « confirmation dropped on user, screen or task change » have no dedicated test. The guards reuse `redactDraftIfAuthorizationLost` and the existing screen-scope checks, which are already covered for the normal delete.
