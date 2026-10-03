# Reset mechanics (CAP-1…CAP-6)

## API — `POST /api/v1/employees/{employeeId}/password-reset`

- `operationId: resetEmployeePassword`, `bearerAuth`, no request body. Path `employeeId` is a uuid.
- Responses:

| Status | Code | When | French message |
|---|---|---|---|
| 200 | — | Reset done; body `EmployeeCredentialResponse`, `Cache-Control: no-store` | — |
| 401 | `AUTHENTICATION_FAILED` | No, expired or revoked session, or activation-only session (existing guard) | existing |
| 403 | `FORBIDDEN` | Session role is not `responsable` | « Action réservée au Responsable de l’équipe. » |
| 404 | `EMPLOYEE_NOT_FOUND` | Malformed id, unknown id, other team, role `responsable` (including self) | « Employé introuvable dans votre équipe. » |
| 409 | `EMPLOYEE_INACTIVE` | Own-team Employé with `is_active = false` | « Cet Employé est désactivé. Réactivez-le avant de réinitialiser son mot de passe. » |
| 500 | `INTERNAL_ERROR` | Anything else; nothing changed | « Une erreur est survenue. » |

- Register in `packages/types/openapi/cetem-qc-v1.yaml`, regenerate `packages/types/src/generated/api-v1.ts` (`pnpm contracts:generate`), reuse `employeeCredentialResponseSchema`, and add `resetEmployeePassword(employeeId)` to `packages/api-client/src/v1.ts`.

## Domain function — `resetOwnTeamEmployeePassword(pool, responsableAccountId, employeeId)`

In `apps/api/src/modules/team-access/employee-credentials.ts`. Generate and hash the credential before opening the transaction (same as regeneration). Then, inside `withTransaction`:

1. `SELECT … FROM identity_accounts employee JOIN identity_teams team ON employee.team_id = team.id WHERE employee.id = $1 AND team.responsable_account_id = $2 AND employee.role = 'employe' FOR UPDATE OF employee`. No row: return a not-found result. `is_active = false`: return an inactive result. Neither case writes anything.
2. `UPDATE identity_accounts SET password_hash = $hash, must_change_password = true WHERE id = $1`.
3. Revoke sessions. Same SQL as `revokeAccountSessions`, run on the transaction client.
4. `INSERT INTO identity_password_resets (account_id, reset_by_account_id, channel) VALUES ($1, $responsable, 'responsable')`.
5. After commit: log the event (below), then return `{ employee, temporaryCredential }`.

The route maps not-found to 404 and inactive to 409. Concurrent deactivation is serialized by the row lock.

## Migration `0008_identity_password_resets.sql`

```sql
CREATE TABLE identity_password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  reset_by_account_id uuid REFERENCES identity_accounts(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('responsable', 'operator')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((channel = 'responsable') = (reset_by_account_id IS NOT NULL))
);
CREATE INDEX identity_password_resets_account_idx ON identity_password_resets(account_id, created_at);
```

## Log line

One `console.info(JSON.stringify({ event: "identity.password_reset", channel, accountId, resetByAccountId }))` per committed reset (`resetByAccountId` is `null` for the operator). No email, name, credential or hash. Nothing is logged on denial. Errors are never logged with the credential in scope.

## Operator CLI — `reset:responsable-password`

- `apps/api/package.json`: `"reset:responsable-password": "tsx src/scripts/reset-responsable-password.ts"`.
- Module function `resetResponsablePassword(pool, email)` in `apps/api/src/modules/identity-auth/` (next to `bootstrap.ts`). It normalizes the email (trim, lower case), then in one transaction: lock the row `WHERE email = $1 AND role = 'responsable' AND is_active = true`, update the hash and set `must_change_password = true`, revoke sessions, and insert the audit row with `channel = 'operator'` and a null actor. After commit it logs the line and returns `{ email, temporaryPassword }`. No eligible row: throw and write nothing.
- The script follows `bootstrap-responsable.ts`. It prompts « Responsable email: » with readline and imports `db/pool.js` lazily. It prints `Temporary password reset for <email>. Hand over this temporary credential once:\n<credential>` and ends the pool. On any error it prints only `Responsable password reset failed. Check operator input and database connectivity.` and sets `process.exitCode = 1`.
- Documentation: add a section « Responsable password reset » after « First Responsable bootstrap » in `apps/api/src/db/README.md`. It covers running the command in a controlled operator terminal with `DATABASE_URL` from the runtime secret environment, not capturing the output, handing the credential over out of band, and what the Responsable sees at next login (forced replacement).

## Web

- Proxy route `apps/web/src/app/api/employees/[employeeId]/password-reset/route.ts`. It mirrors the `credential` route: `rejectCrossOriginMutation`, cookie to bearer, `no-store`, and 503 `SERVICE_UNAVAILABLE` on fetch failure.
- `employee-management.tsx`: for each active Employé, replace the « Regenerer… » button with « Réinitialiser le mot de passe ». Before calling, confirm with « Le mot de passe actuel de cet Employé et ses sessions ouvertes cesseront immédiatement de fonctionner. ». Success opens the existing hand-over dialog with the title « Mot de passe réinitialisé ». Account creation keeps « Compte créé ». On failure, show the API `error.message` for 404/409, otherwise « Le mot de passe n’a pas pu être réinitialisé. ». No credential is shown on failure.
- `page.tsx`: under the sign-in form, `<p>` with `fr.auth.forgotPasswordResponsable`.

## Mobile

- `App.tsx` sign-in form: `<Text>` with `fr.auth.forgotPasswordEmployee` under the sign-in button. No other mobile change. Existing 401 handling covers revoked sessions.

## i18n (`packages/i18n/src/fr.ts`, `auth`)

| Key | Text |
|---|---|
| `forgotPasswordResponsable` | « Mot de passe oublié ? Contactez votre administrateur. » |
| `forgotPasswordEmployee` | « Mot de passe oublié ? Contactez votre Responsable. » |

Web-only reset strings may live in `fr.employees` (e.g. `resetPassword`, `resetPasswordConfirm`, `passwordResetTitle`, `passwordResetFailed`) with the texts above.
