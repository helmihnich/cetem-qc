---
id: SPEC-2-4-reset-forgotten-password-through-responsable
story: 2.4
status: done
approved: 2026-10-03
baseline_commit: 64c1e3f
companions:
  - reset-mechanics.md
  - test-plan.md
  - delivery-notes.md
sources:
  - .automation/task.md
  - .automation/rules.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete contract for what to build, test and validate.

# Story 2.4 — Reset a forgotten password through the Responsable (no email)

## Why

**Pain.** An activated user who forgets their password is locked out for good. Story 3.2 regeneration only works before activation, and it leaves sessions open. The web shows « Régénérer » for every active Employé, so for activated ones it fails with 404. There is no email server, and a Responsable has no recovery path at all.

**Story statement.** As a Responsable, I want to reset the password of an Employé in my team, and as a PoV operator, I want to reset a Responsable's password from the server. A forgotten password then becomes a one-time temporary credential that must be replaced at the next login.

## Capabilities

Mechanics (endpoint, transaction, audit, CLI, copy) are in [reset-mechanics.md](reset-mechanics.md).

- **CAP-1** — Responsable resets an Employé password
  - **intent:** A Responsable resets the password of an active Employé of their own team, before or after activation.
  - **success:** `POST /api/v1/employees/{employeeId}/password-reset` returns 200 with the employee and a new temporary credential, once, with `Cache-Control: no-store`. In one transaction, the stored hash changes, `must_change_password` becomes true, and all of the Employé's unrevoked sessions are revoked. The old password then fails. The temporary credential signs in to an activation-only session, and the Story 2.3 replacement works with it.
- **CAP-2** — One-time hand-over on the web
  - **intent:** The Responsable sees the credential once, through the Story 3.2 hand-over dialog.
  - **success:** Each active Employé in the web roster has « Réinitialiser le mot de passe ». It asks for confirmation, then opens the existing hand-over dialog with the title « Mot de passe réinitialisé ». The dialog keeps copy, the acknowledgement and the disabled « Terminer » until acknowledged. After dismissal the credential is never shown again. Inactive Employés get no reset button.
- **CAP-3** — Operator resets a Responsable password
  - **intent:** An operator on the server resets a Responsable's password without the web or email.
  - **success:** `pnpm --filter @cetem-qc/api reset:responsable-password` asks for the email, prints a new temporary credential once, sets `must_change_password`, and revokes all of that Responsable's sessions. An unknown, inactive or non-Responsable email changes nothing. The command exits non-zero with one generic message that never repeats the input. `apps/api/src/db/README.md` documents the command.
- **CAP-4** — Forgotten-password hints
  - **intent:** The login screens tell users who to contact.
  - **success:** Below the web Responsable login form: « Mot de passe oublié ? Contactez votre administrateur. ». Below the mobile Employé login form: « Mot de passe oublié ? Contactez votre Responsable. ». Both strings come from `packages/i18n`.
- **CAP-5** — Reset audit without secrets
  - **intent:** Each reset is traceable to who did it, and never exposes the secret.
  - **success:** Each successful reset writes one `identity_password_resets` row in the same transaction: target account, actor (the Responsable, or null for the operator), channel and time. After commit, one structured log line is written with ids and channel only. Neither the row nor any log or error output contains the credential, its hash or the email. A failed or denied reset writes no row.
- **CAP-6** — Server-side authorization
  - **intent:** Only the Employé's own Responsable can reset, and the server enforces it.
  - **success:** An Employé session gets 403 `FORBIDDEN`. An activation-only session gets 401. Another team's Employé, a Responsable id, the caller's own id, an unknown id or a malformed id all get 404 `EMPLOYEE_NOT_FOUND`, with the same body as an unknown id. A deactivated Employé of the Responsable's own team gets 409 `EMPLOYEE_INACTIVE`. No denial changes any hash, flag, session or audit row.

## Constraints

- The credential is generated with `generateTemporaryCredential`, stored only as a scrypt hash, and returned once. It is never logged, persisted in clear, or shown again.
- Hash and flag update, session revocation and audit insert are one transaction. If any write fails, the old password and sessions keep working and no audit row exists.
- Role and team come from the live session. The request never carries a team. The new route sits behind the `requireSession` default-deny guard.
- No email or SMS. The Story 2.3 activation flow, the 8-hour session duration and the OD-01 7-day mobile offline window stay unchanged.
- UI text is French and comes from `packages/i18n`. Mobile keeps working offline, and local drafts are never deleted by a reset.
- Every new HTTP operation goes into OpenAPI, generated types, Zod schemas and `api-client` together (Epic 2 retrospective).

## Non-goals

- Self-service reset, email or SMS links, security questions.
- A web screen for operators or for managing Responsables (OD-08).
- Choosing or showing the new password for the user. The server always generates it.
- Password expiry, lockout or rate limiting.
- Pushing the revocation to an offline mobile device. It takes effect at the device's next online check (OD-01).
- Showing activation state in the employee list, and retiring the `/credential` regenerate endpoint (both stay as they are).
- General security-event logging for other operations (Story 12.2).

## Success signal

With `DATABASE_URL` on the local Docker PostgreSQL, PostgreSQL and route tests prove the following. An activated Employé is reset by their Responsable. Their old password and old session stop working. The temporary credential reaches an activation-only session, and the Story 2.3 replacement restores normal access. Cross-team, deactivated, Employé-role and activation-only attempts are refused without mutation. The CLI test shows the same for a Responsable, and that a bad email gives the generic failure. Captured log output never contains the credential. Mobile and web render tests show the two login hints and the roster reset button. `pnpm -r test`, `pnpm -r typecheck`, `boundaries:check`, `contracts:check` and `git diff --check` pass.

## Confirmed decisions

These follow from the brief, the current code and the Product Owner decision in the pipeline rules (« Forgotten password: reset by the Responsable (Employé) or an operator CLI (Responsable). No email server. »).

- The PO decision replaces the UX line « do not extend this into an unspecified post-activation password-reset workflow » (EXPERIENCE.md, OD-09).
- A new endpoint `POST /employees/{employeeId}/password-reset` (`resetEmployeePassword`) returns the existing `EmployeeCredentialResponse`. The Story 3.2 `/credential` endpoint and its tests are not changed.
- The web replaces « Régénérer le mot de passe temporaire » with « Réinitialiser le mot de passe ». Reset covers both cases (before and after activation) and also invalidates the previous temporary credential. Story 3.2's regeneration therefore stays available through reset, without adding activation state to the list contract.
- A deactivated own-team Employé gets 409 `EMPLOYEE_INACTIVE`. The Responsable already sees that Employé in the roster, so a separate code discloses nothing. All other ineligible targets get the 404 used for an unknown id.
- Audit is a new table `identity_password_resets` (migration `0008`) plus one JSON log line. There is no logging framework yet, and AD-11 asks for structured logs with an event kind and no secrets.
- Mobile follows OD-01. Server revocation works like losing the server token: offline access in the 7-day window continues until the next online check. That check returns 401, and the existing « reauthenticate online » path asks for sign-in with the temporary credential. Local data is kept.
- The CLI acts only on an active `responsable` account. It reads the email from a prompt, not from argv, so the email stays out of shell history. Same pattern as `bootstrap:responsable`.
- The web UI is tested by static rendering with `react-dom/server`. Click-through render infrastructure stays open (action item epic-4-1).

## Open Questions

None.

## Code review (2026-10-03)

Four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). No blocking finding.

**Patched**
- The web reset click handler had no behavioural test (W2 is static markup only). The request/response mapping moved to the exported `requestPasswordReset` in `employee-management.tsx`; new tests W4–W6 in `password-reset-render.test.tsx` cover URL and method, the success title, 404/409 message pass-through, the generic fallback for other statuses, and a network failure.
- On 404/409 the roster is now refreshed, so a stale row (Employé deactivated or moved) loses its reset button.
- The hand-over dialog after a reset said « remplacé à la première connexion », which is wrong for an activated Employé. Reset now uses `fr.employees.passwordResetSubtitle` (« … à la prochaine connexion. »). Account creation keeps its text.
- The network-failure message was a hard-coded string; it now uses `fr.api.unavailable`. A `null` error body no longer throws inside the handler.

**Deferred** (see `deferred-work.md`): the still-live `/credential` endpoint bypasses the reset audit and revocation (kept by this spec's decisions); the CLI success path is not run end to end (harness limitation).

**Rejected**
- CLI confirmation prompt / refusing non-TTY output: the CLI behaviour is fixed by reset-mechanics.md; not a defect.
- scrypt before the lookup (CPU cost on 404/409): the spec requires hashing outside the transaction; rate limiting is a non-goal.
- 500 handler logs nothing: matches the spec rule and the existing routes; no defect in behaviour.
- Proxy `decodeURIComponent` / non-JSON upstream mapped to 503, and the copied proxy code: same as the existing `/credential` and `/status` proxies the spec asks to mirror; malformed cookies are only set by this app.
- Responsable deactivated mid-request: there is no Responsable deactivation (OD-08), and `requireSession` checks the live session.
- Response building failing after commit, CLI `pool.end()` failing after printing, stdin EOF: not reachable in normal use; the credential is already printed in the CLI case.
- OpenAPI lacks the `Cache-Control` header and the 404 detail: consistent with the other credential operations; behaviour is tested by H1/H4.
- No index on `reset_by_account_id`: the DDL is the spec's; table is tiny and accounts are never deleted (RESTRICT).
- Mobile path after reset: covered by the existing 401-on-online-check test (M2).
- « Compte cree » fallback without accents: pre-existing text, allowed by the delivery notes.
