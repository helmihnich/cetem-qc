# Action-item triage (CAP-7)

Apply in `_bmad-output/implementation-artifacts/sprint-status.yaml` `action_items`: set `status` and add a one-line `note:` to every item. IDs are abbreviated (`epic-4-retro-item-N…` → epic-4-N).

| Item | Action (short) | Result | Note / work |
|---|---|---|---|
| epic-4-1 | Refresh Responsable task list after creation + composed test | **open** | Needs a web render-test harness that does not exist; out of scope (non-goal). |
| epic-4-2 | Reject NUL in task text; align OpenAPI establishment with trim-then-non-empty | **implement → done** | `packages/schemas` create-task schema rejects `\u0000` in `establishment` and `service` (400 validation error, never a PostgreSQL 500). OpenAPI `CreateTaskRequest`: `establishment` gets a pattern requiring a non-whitespace character and no NUL; `service` gets a no-NUL pattern. Regenerate types (`contracts:check` clean). Tests: schema test + one API route test per field. |
| epic-4-3 | OpenAPI-first + typed-client tests for Epic 5 HTTP operations | **done** | Epic 5 is closed; `contracts:check` and the now-running `api-client`/`schemas` tests enforce it. |
| epic-4-4 | Direct API authorization + PostgreSQL integration for predicates | **done** | Existing route and PostgreSQL tests now run under `pnpm -r test` (CAP-1, CAP-2). |
| epic-4-5 | Migration tests reproduce production upgrade; zero skipped PostgreSQL tests | **done** | Harness migrates with the production runner, and PostgreSQL tests fail instead of skipping (CAP-2). |
| epic-4-6 | Local persistence tests (durable save, failure preservation, restart, deletion, offline authorization, no silent overwrite) | **done** | Covered by `apps/mobile/local-drafts/local-drafts.test.ts` (remount, failed save/delete, revision guard, authorization lock) plus CAP-4 tests. |
| epic-4-7 | Overlapping/out-of-order state and rendered-flow tests | **open** | Standing review rule for future mobile stories, not a one-off task. |
| epic-4-8 | Pre-review verification record (boundaries, typechecks, builds, Expo exports, diff check) | **open** | Gates now cover boundaries, recursive typecheck and diff check; builds and Expo exports are still not recorded. |
| epic-4-9 | Keep DEP-01 portions blocked; Epic 6/7 out of Epic 5 | **done** | Epic 5 closed; superseded by Story 5.6 and 6.6 PO decisions. |
| epic-5-10 | Persist Story 5.5 spec and closure evidence | **open** | No 5.5 spec in `implementation-artifacts`; reconstructing closure evidence is documentation work beyond this story. |
| epic-5-11 | Maintain delayed-operation authorization race coverage | **open** | Ongoing maintenance rule. |
| epic-5-12 | Source-formula regression fixtures before 6.1 | **done** | `packages/domain/src/graphie-calculations.source-regression.ts` (Stories 6.1 and 6.6). |
| epic-5-13 | Native builds, SQLCipher, seeded-v1 migration evidence | **open** | Needs physical devices; tracked for Story 12.9. |

Statuses use the file's vocabulary (`open` / `in-progress` / `done`).
