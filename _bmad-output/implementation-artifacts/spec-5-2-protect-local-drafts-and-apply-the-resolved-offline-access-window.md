---
title: 'Story 5.2: Protect local drafts and apply the resolved offline access window'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '1b4f99c10deb0b69e1da31d3251a6599a5e89a3f'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-09-30.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-5-1-open-assigned-work-across-supported-phone-and-tablet-form-factors.md'
---

<frozen-after-approval reason="approved Story 5.2 scope and policy">

## Intent

Implement Story 5.2 only: protect local work and enforce identity-bound offline authorization so interruptions do not expose or destroy field evidence.

## Boundaries & Constraints

**Always:** Use `expo-secure-store` behind a replaceable adapter for authorization metadata, identity binding and any local key material. The configurable PoV default is seven days from successful online authentication; only successful online authentication/re-authentication resets the window. Bind grants to account ID. Keep server token/session expiry separate. Revalidate current server authorization before protected server activity on reconnect. Logout, expiry, clock anomaly, corrupt state and known deactivation lock access while preserving local protected payload. On a backward wall-clock anomaly, fail closed without a generous tolerance; this is not protection from sophisticated clock manipulation. Android and iOS behavior must match. Use a small opaque fixture if needed; do not represent it as a product draft.

**Never:** Implement real draft UI/save/resume/delete/autosave (5.3), Graphie Mobile fields (5.4), offline editing (5.5), sync/outbox, submission, conflict handling, calculations, DEP-01 rules, insights/AI/conformity/reports, remote device management, or administrative data recovery. Do not store security state only in AsyncStorage. Do not claim JS exports verify native Keychain/Keystore behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Valid offline grant | Same identity, now before expiry | Offline authorized; restart, network loss, or server token expiry does not reset grant | Preserve grant on transient network error |
| Expiry boundary | now immediately before / exactly at / after expiry | Allow before; lock at and after; retain protected payload | Require online authentication |
| Logout / identity switch | Explicit logout, then another account signs in | Revoke old grant, preserve old payload, prevent other identity access | Fail closed if secure write/delete fails |
| Revalidation | Connectivity returns with a session | Check `/session`; preserve grant timestamp; inactive/invalid session blocks protected server activity | Require online sign-in when revalidation cannot authorize |
| Invalid metadata or clock | Missing/corrupt schema or now earlier than last trusted local time | Locked; data remains stored | Recover only through successful online authentication |

</frozen-after-approval>

## Code Map

- `apps/mobile/App.tsx` Ã¢â‚¬â€ current sign-in, activation, in-memory user, task fetch, logout; integrate secure grant hydration, auth transitions and reconnect revalidation without adding draft lifecycle.
- `packages/api-client/src/v1.ts`, `apps/api/src/index.ts`, and `apps/api/src/modules/identity-auth/sessions.ts` Ã¢â‚¬â€ existing `getSession()` revalidates current authorization. `GET /session` now distinguishes a live deactivated account (403 `ACCOUNT_DEACTIVATED`) from expired/revoked/unknown sessions (generic 401), without changing task-route denial behavior.
- `apps/mobile/app.json`, `apps/mobile/package.json`, `pnpm-lock.yaml` Ã¢â‚¬â€ Expo SDK 57 app/dependency configuration; install Expo-compatible SecureStore (and connectivity listener if required) with SDK-matched versions.
- `apps/mobile/offline-authorization-state.ts` Ã¢â‚¬â€ proposed pure policy/state transitions; inject clock and secure storage.
- `apps/mobile/offline-authorization-state.test.ts` and `apps/mobile/App.render.test.tsx` Ã¢â‚¬â€ deterministic boundary/lifecycle and rendered-flow coverage; preserve existing layout/task tests.
- `packages/i18n/src/fr.ts` Ã¢â‚¬â€ employee French strings for offline lock, revalidation, expired grant and account authorization denial.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` Ã¢â‚¬â€ set only Story 5.2 to `in-progress` when coding starts; Epic 5 remains in-progress and 5.3Ã¢â‚¬â€œ5.5 stay backlog.

## Tasks & Acceptance

**Execution:**
- [x] Implement validated identity-bound seven-day policy and fail-closed clock/state checks.
- [x] Add secure storage adapter and protected payload preservation boundary; transitions never delete protected payload.
- [x] Integrate launch, successful online authentication, password activation, logout, offline restart and reconnect revalidation into mobile auth flow.
- [x] Add deterministic state, storage and rendered-flow tests; run Android/iOS Expo JS exports and report native evidence separately.

**Acceptance Criteria:**
- Given successful online authentication, when offline before seven-day expiry as the same identity, then local protected access remains authorized across restart and transient network/token expiry.
- Given exact expiry, deliberate logout, another identity, corrupt metadata or backward clock movement, when protected access is checked, then access fails closed and protected data is preserved.
- Given successful online reauthentication, when current account authorization is active, then a new window is established for that identity; known inactive/invalid server authorization cannot access or synchronize.
- Given reconnect, when server revalidation has not succeeded, then protected server activity remains blocked; authorization timestamp is not reset by revalidation alone.

## Verification

**Commands:** `pnpm --filter @cetem-qc/mobile test` (31/31), recursive workspace typecheck, API authentication route tests (10/10), generated-contract check, boundary tests/check (8/8), Android/iOS Expo exports, and `git diff --check` all pass. Expo install check reports the pre-existing Expo patch mismatch: installed 57.0.25, expected 57.0.26; new SDK-compatible modules are SecureStore 57.0.4 and Network 57.0.2. Exports prove JavaScript bundling only. Native builds, installation, device launch, and physical Keychain/Keystore behavior remain unverified OD-05 evidence.

## Implementation Notes

Approval resolves the plan's five open decisions: SecureStore provider; identity-bound grant and payload isolation; fail-closed clock rollback with no tolerance; `/session` as revalidation boundary; no real drafts, only an opaque representative payload as needed. `EXPO_PUBLIC_OFFLINE_AUTHORIZATION_WINDOW_DAYS` configures policy duration; default is seven days and each grant snapshots its duration. SecureStore contains authorization metadata and small account-namespaced protected payloads; authorization transitions never remove payload keys. Expo docs describe encrypted Android SharedPreferences backed by Android Keystore and iOS Keychain, and warn that large values can be rejected. `/session` returns 403 `ACCOUNT_DEACTIVATED` only for a live, unrevoked token tied to an inactive account; expired/revoked/unknown sessions remain generic 401. Native behavior remains unverified until device testing.

Implementation verified on 2026-09-30: Android and iOS Metro exports bundle successfully; no native build, simulator/device launch, or physical secure-storage verification was performed. No drafts, autosave, form fields, sync, outbox, or submission were added.

## Spec Change Log

Planning checkpoint approved by user on 2026-09-30 with detailed implementation decisions. During implementation, the `/session` contract gained a specific deactivated-account response so the approved locked-deactivated state is actionable without conflating deactivation with ordinary token expiry.

## Review Triage Log

Fresh-context BMad Code Review completed on 2026-09-30. The five findings were patched and verified on 2026-09-30. Story remains in review pending a fresh-context review of the remediation.


### Review Findings

- [x] [Review][Patch] Enforce the OD-01 seven-day maximum and validate stored grant time invariants [apps/mobile/offline-authorization-state.ts:4] — `offlineAuthorizationWindowFromDays` and the service accept windows above seven days; stored grants also accept a future `authenticatedAt` later than `lastTrustedTime`, which can keep an otherwise valid grant authorized well beyond seven days.
- [x] [Review][Patch] Stop protected task requests when local authorization confirmation returns locked [apps/mobile/App.tsx:70] — `/session` success is followed by `confirmServerAuthorization`, but its locked/expired result is stored without throwing; `loadTasks` and task-detail callers then continue to server requests.
- [x] [Review][Patch] Keep valid local authorization when server-session revalidation is required [apps/mobile/App.tsx:78] — a `/session` 401 marks the grant revalidating and clears the user, and online startup with a persisted grant does the same. `readProtectedPayload` then denies access even though the grant has not expired; ordinary token expiry and app restart must not cancel local authorization. The API client token is memory-only, so a restarted app cannot revalidate the old session and must keep local access separate from server-work access.
- [x] [Review][Patch] Make logout revocation durable across concurrent checks and secure-store failures [apps/mobile/offline-authorization-state.ts:118] — an evaluation already awaiting storage can write the old grant after logout; if both the lock write and removal fail, the grant also remains persisted and can hydrate as authorized after restart.
- [x] [Review][Patch] Cover the successful-authentication-to-restart grant path at the App boundary [apps/mobile/App.render.test.tsx:130] — service tests cover grant creation and the restart test seeds metadata directly, so no rendered test checks that successful sign-in writes the grant subsequently used on offline restart.

Rejected findings:

  - The acceptance auditor's scenario that a valid API session token survives process restart is not reachable: `createApiClient` keeps the token only in its in-memory closure and App does not persist it. The separate local-grant access issue above was addressed in this remediation.
- The suggestion to reject malformed identities at the service boundary is not an actionable reachable path: its typed callers pass the server-authenticated employee identity, and stored identities are validated during parsing.

Review remediation: mobile tests pass 45/45, including app sign-in → remount without server session, local payload access during revalidation, protected-server-work denial, grant expiry preservation, grant metadata validation, and logout race/storage failures. Recursive workspace typechecks, API authentication tests 10/10, generated-contract check, boundary tests 8/8, boundary checker, Android/iOS Expo JavaScript exports, and git diff --check pass. Expo exports used --no-bytecode because Windows denied execution of hermesc.exe; they verify bundling only. expo install --check still reports expo 57.0.25 versus expected ~57.0.26; left as dependency hygiene. No API/server or product scope expansion was introduced. Epic 5 remains in-progress; Story 5.2 remains review; Stories 5.3–5.5 remain backlog.

### Final Fresh-Context Review (2026-09-30)

- Verdict: the App-level deactivation verification gap is resolved. The production deactivation branch in `apps/mobile/App.tsx:76-80` is exercised through a rendered App reconnect using a contract-shaped 403 `ACCOUNT_DEACTIVATED` response.
- [x] [Review][Patch] Cover known account deactivation through the rendered App flow [apps/mobile/App.render.test.tsx:352] — verified that revalidation persists `locked-deactivated`, clears the active employee screen, displays the French deactivation message, denies local payload reads while preserving its SecureStore value, issues no protected follow-up request, and remains locked after remount with a fresh authorization-service instance.
- Verification rerun during this review: focused App rendered tests 10/10; full mobile suite 46/46; recursive workspace typecheck; API auth 10/10; generated-contract check; boundary tests 8/8; boundary checker; Android and iOS Expo JS exports; and `git diff --check` all passed. Expo exports are bundling evidence only; native Keychain/Keystore behavior, native build/install, and device connectivity remain unverified. Expo 57.0.25 versus expected ~57.0.26 remains non-blocking dependency hygiene. No product defect was found and no product behavior changed; this patch adds rendered test coverage only.
- Sprint status remains Epic 5 `in-progress`, Story 5.2 `review`, Stories 5.3–5.5 `backlog`.

Rejected in final fresh-context review:

- `[acceptance-auditor] false` — Online startup after remount lacks the prior in-memory API token by design; the App preserves local grant access while requiring sign-in, and every protected server request still performs current `/session` revalidation. The Story does not require persisting the server token.
- `[edge-case-hunter] false` — A task endpoint rejection after `/session` succeeded does not revoke a still-valid offline grant; subsequent protected requests still pass through fresh revalidation. The cited path does not bypass server authorization or expose locked local payloads.
- `[blind-hunter] low, rejected` — Overlapping network callbacks may briefly present an older connectivity state, but service-level revocation checks still deny protected payload reads and server work is freshly gated. No protected-data bypass was demonstrated; a generation guard would add complexity for a rare presentation race.
- `[blind-hunter] false` — Grant creation follows a successful online authentication response, which is the event that starts the offline window; a later expired/revoked API token does not invalidate that grant under OD-01.
- `[blind-hunter] false` — `revalidateServerAuthorization` handles `ACCOUNT_DEACTIVATED` before propagating the error; the `loadTasks` catch does not undo the lock, user clear, or message.
- `[blind-hunter] false` — SecureStore failures thrown during revalidation prevent `runOnlyWhenOnlineAuthorized` from invoking the protected API callback; the outer callers fail closed.
- `[blind-hunter] false` — Clearing an identity-specific tombstone after another identity successfully authenticates does not authorize the old identity: only the currently persisted identity-bound grant can access its payload, and a later old-identity grant requires successful online authentication.
- `[blind-hunter] false` — A persisted lock can be replaced by `establishOnlineAuthorization` only after successful online authentication, which is the specified recovery path.
- `[blind-hunter] false` — Expired/deactivated/otherwise locked states clear `user`, hiding server task UI; protected payload reads independently re-evaluate authorization.
- `[blind-hunter] false` — Returning online/offline with a still-valid grant can retain in-memory task detail; that state does not bypass protected-payload checks or server-work revalidation, and local access within the grant is expected.
- `[blind-hunter] false` — A transient API/network failure evaluates and retains valid offline authorization while showing an unavailable/retry state; Story 5.2 does not require a synchronization or offline request queue.

### Final Closure Review (2026-09-30)

- Verdict: accepted. All six prior review findings are resolved; no blocking or medium findings remain.
- The rendered App test proves reconnect revalidation with contract-shaped 403 `ACCOUNT_DEACTIVATED`, user/session clearing, French deactivation feedback, local payload read denial with payload preservation, no protected follow-up request, and fail-closed remount through a fresh service instance.
- Policy and authorization checks confirm the seven-day cap and exact expiry, identity-bound local access, independent server-session lifetime, current server authorization before protected work, serialized/race-safe logout, and fail-closed corrupt/missing state. SecureStore is the authorization and protected-payload storage boundary; no secrets or payloads are logged.
- Scope remains Story 5.2 only: no real draft lifecycle, form fields, offline editing, autosave, sync/outbox, submission, calculation, insight, AI, conformity, or report behavior.
- Verification: rendered App tests 10/10; full mobile suite 46/46; API auth 10/10; recursive workspace typechecks; generated-contract check; boundary tests 8/8 and boundary checker; Android/iOS Expo JS exports; and `git diff --check` passed. Expo exports verify JavaScript bundling only. Native Keychain/Keystore behavior, native builds/install, simulator/device launch, and live-device connectivity remain unverified. Expo 57.0.25 versus expected 57.0.26 remains non-blocking dependency hygiene.
- Status: Epic 5 `in-progress`; Story 5.2 `done`; Stories 5.3–5.5 `backlog`. No Story 5.3 work was started.
