# Test plan

All PostgreSQL cases use `withPostgresTestSchema` (Story 6.7 harness) and never import `db/pool.ts`. Use example.test emails, never real names.

## PostgreSQL — `team-access/employee-credentials.postgres.test.ts` (or a new `password-reset.postgres.test.ts`)

| ID | Case | Expect |
|---|---|---|
| R1 | Activated own-team Employé (`must_change_password=false`, live session) is reset | Credential returned; `verifyPassword(old)` false and `verifyPassword(new)` true; flag true; every prior session has `revoked_at`; one audit row (`channel='responsable'`, actor = Responsable) |
| R2 | Not-yet-activated Employé is reset | Same as R1; previous temporary credential no longer verifies |
| R3 | Deactivated own-team Employé | Inactive result; hash, flag, sessions and audit rows unchanged |
| R4 | Other team's Employé, Responsable id, own id, unknown uuid | Not-found result; nothing changed |
| R5 | Audit insert fails (e.g. forced constraint failure via a trigger installed in the test schema) | Rollback: old hash, flag and sessions intact; no audit row |
| R6 | Concurrent reset and deactivation | Final state consistent: either reset committed before deactivation, or 409 with no mutation |
| R7 | Migration 0008 | Table and CHECK exist; a `responsable` row without actor and an `operator` row with actor are both rejected |

## Routes — `apps/api/src/employee-routes.test.ts` (PostgreSQL route cases like the existing ones)

| ID | Case | Expect |
|---|---|---|
| H1 | Responsable resets an activated Employé | 200, `no-store`, body matches `employeeCredentialResponseSchema`; Employé's old bearer now gets 401; `POST /authenticate` with old password 401; with temporary credential 200 and `mustChangePassword: true`; `GET /employee/tasks` with that session 401; `POST /authenticate/password` succeeds and then `GET /employee/tasks` 200 |
| H2 | Employé session calls reset | 403 `FORBIDDEN`, no mutation |
| H3 | Activation-only Responsable session | 401, no mutation |
| H4 | Other team, own id, unknown and malformed ids | 404 `EMPLOYEE_NOT_FOUND`; other-team body equals unknown-id body |
| H5 | Deactivated own-team Employé | 409 `EMPLOYEE_INACTIVE` |
| H6 | Internal failure | 500 `INTERNAL_ERROR`; body has no credential |
| H7 | Log capture (stub `console.info/error/warn/log`) across H1–H6 | Exactly one `identity.password_reset` line, for H1; no captured output contains the credential, the `scrypt:` hash or the email |

## Operator CLI

| ID | Case | Expect |
|---|---|---|
| C1 | `resetResponsablePassword` on an active Responsable with a live session | Returns credential; flag true; sessions revoked; audit row `channel='operator'`, null actor; temporary credential signs in to an activation-only session |
| C2 | Unknown email, Employé email, inactive Responsable | Throws; nothing changed; no audit row |
| C3 | Email case and whitespace | `"  Owner@Example.TEST "` resolves the stored lowercase account |
| C4 | Script entry run as a child process with stdin email and `DATABASE_URL=postgresql://127.0.0.1:1/cetem_qc_test` (unreachable local port) | Exit code 1; stderr is exactly the generic message; output does not contain the email |

## Web

| ID | Case | Expect |
|---|---|---|
| W1 | Proxy route `password-reset/route.test.ts` | Cross-origin or missing Origin rejected and not forwarded; no cookie gives 401; forwards bearer and status; `no-store`; fetch failure gives 503 |
| W2 | `renderToStaticMarkup(<EmployeeManagement employees=[active, inactive] …/>)` | One « Réinitialiser le mot de passe » button, for the active Employé only; no « Regenerer » |
| W3 | Static render of the sign-in markup | Contains « Mot de passe oublié ? Contactez votre administrateur. » |

## Mobile

| ID | Case | Expect |
|---|---|---|
| M1 | `App.render.test.tsx` signed-out screen | Shows « Mot de passe oublié ? Contactez votre Responsable. » |
| M2 | Existing 401-on-online-check test still passes | Revoked session follows the reauthenticate-online path; drafts kept |

## Gates

`pnpm -r test` (0 failed, 0 skipped), `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
