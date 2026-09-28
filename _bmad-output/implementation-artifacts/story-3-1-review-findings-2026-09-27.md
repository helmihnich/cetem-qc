# Story 3.1 Review Findings

Review target: Story 3.1, `View own-team employees` in `_bmad-output/planning-artifacts/epics.md`.

## Blocking findings

- [ ] [Review][Patch] Backfill the existing Responsable team during migration [`apps/api/src/db/migrations/0004_team_membership.sql`]
  - The migration adds `identity_teams` and `identity_accounts.team_id` but does not create a team for the already bootstrapped Responsable account. The migration runner applies this to populated installations too. Since the list query joins through `identity_teams.responsable_account_id`, an existing Responsable gets an empty roster even if employee membership data is later present. Add a data migration that creates that account's team and safely assigns existing profile/membership data; exercise the populated-upgrade path.
- [ ] [Review][Patch] Give a Responsable a reachable authenticated roster path in the web UI [`apps/web/src/app/page.tsx`]
  - The page calls `getSession()` and `listOwnTeamEmployees()`, but no web code calls `authenticate()` or restores a session token. The API client keeps its token only in a private in-memory variable, so the page remains in the sign-in state and the roster cannot be opened through this surface. Add a real sign-in/session path, or provide a clearly documented externally established session mechanism used by this UI, while retaining API authorization.

## Validation

- API route and identity/session/bootstrap tests: 23 passed.
- Schema/contract tests: 4 passed.
- OpenAPI generation and `contracts:check`: passed.
- Boundary tests/check: 8 tests passed; checker passed.
- Recursive workspace typechecks: passed.
- API build and web build: passed.
- `git diff --check`: passed (line-ending normalization warnings only).
- No live PostgreSQL migration integration run was performed.

Story remains in `review`; Stories 3.2 and 3.3 remain in `backlog`.
