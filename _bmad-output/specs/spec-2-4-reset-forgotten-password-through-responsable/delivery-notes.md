# Delivery notes

## Files expected to change

- `apps/api/src/db/migrations/0008_identity_password_resets.sql` (new)
- `apps/api/src/modules/team-access/employee-credentials.ts`: `resetOwnTeamEmployeePassword`
- `apps/api/src/modules/identity-auth/`: `responsable-password-reset.ts` (new) and export from `index.ts`
- `apps/api/src/scripts/reset-responsable-password.ts` (new), `apps/api/package.json` script
- `apps/api/src/index.ts`: route `POST /employees/:employeeId/password-reset`
- `apps/api/src/db/README.md`: operator section
- `packages/types/openapi/cetem-qc-v1.yaml`, `packages/types/src/generated/api-v1.ts` (generated), `packages/schemas/src/api/v1.ts` (only if a type alias is needed), `packages/api-client/src/v1.ts`
- `packages/i18n/src/fr.ts`
- `apps/web/src/app/api/employees/[employeeId]/password-reset/route.ts` (+ test), `apps/web/src/app/employee-management.tsx`, `apps/web/src/app/page.tsx`
- `apps/mobile/App.tsx`, `apps/mobile/App.render.test.tsx`
- Tests listed in [test-plan.md](test-plan.md)

## Pitfalls

- `index.ts` holds mojibake French strings in the `POST /employees` and `/credential` handlers (e.g. `AccÃ¨s`). Write all new strings as UTF-8. Fixing the old ones is allowed but not required.
- Keep the reset route after `v1.use(requireSession)` so the activation-only guard applies.
- Do not reuse `regenerateOwnTeamEmployeeCredential`. Its predicate (`must_change_password = true`) is Story 3.2's contract, and its tests must keep passing unchanged.
- Generate the credential outside the transaction, and never put it in any thrown error, log or audit field.
- `revokeAccountSessions` takes a `Pool`. Run the revoke SQL on the transaction client instead, so it rolls back with the rest.
- Web strings in `employee-management.tsx` lack accents (pre-existing). New strings use correct French accents.
- Sprint status: set `epic-2` back to `done` when this story is `done` (retrospective already done).

## Implementation notes (2026-10-03)

- Shared reset writes live in `identity-auth/responsable-password-reset.ts` (`applyPasswordReset`, `logPasswordReset`), exported from `identity-auth/index.ts` and reused by `resetOwnTeamEmployeePassword`, so both channels run the same hash/flag update, session revocation and audit insert on the transaction client.
- PostgreSQL tests: R1–R7 in `team-access/password-reset.postgres.test.ts`, C1–C4 in `identity-auth/responsable-password-reset.postgres.test.ts`, H1–H7 as subtests of one PostgreSQL case in `employee-routes.test.ts`.
- W3: the Responsable sign-in form moved to `apps/web/src/app/sign-in-form.tsx` (used by `page.tsx`) so it can be rendered statically. The web render test sets a global `React` because the web tsconfig keeps Next's `jsx: preserve`.
- `api-client` gained a test for `resetEmployeePassword`.
