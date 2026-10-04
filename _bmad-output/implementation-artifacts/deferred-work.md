- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-establish-pnpm-workspace-and-application-skeleton.md`
  summary: Make the API development host configurable for access from a physical mobile device or container.
  evidence: The Express skeleton binds to loopback; cross-device reachability is not required by Story 1.1 and should be decided with the first mobile-to-API development flow.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-establish-pnpm-workspace-and-application-skeleton.md`
  summary: Separate Express app construction from listener startup when API behavior and tests are introduced.
  evidence: The current minimal API entry point starts listening on import; no API tests or importable integration surface are required by Story 1.1.

## Deferred from: code review of SPEC-5-6 (2026-10-02)

- source_spec: `_bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/SPEC.md`
  summary: After an explicit draft delete, the form keeps the deleted draft's values on screen and does not re-seed the paper defaults until the task is reopened.
  evidence: `confirmDraftDelete` in `apps/mobile/App.tsx` resets draft metadata and legacy content but not `formValues`/`formValuesRef`; this predates Story 5.6, which only added seeding on open.
  resolved: Story 6.7 (2026-10-03) — every successful explicit delete (normal or unreadable) resets the form to `createNewGraphieDraftValues()`, legacy mode off, legacy text empty; App render test M9.
- source_spec: `_bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/SPEC.md`
  summary: Re-pin the Story 6.3 spec from catalogue `1.0.0` / schema `2` to `2.0.0` / `3` and list 5.6 plus the rule-set v2 story as dependencies.
  evidence: `spec-6-3-display-authorized-calculation-results-in-the-employe-form.md` still names the retired tuple (lines 8–9, 42, 112); delivery-notes.md asks for the re-pin. It edits another spec, so it is outside this review's fixes.
  resolved: Story 6.3 spec refresh (2026-10-04) — canonical spec `_bmad-output/specs/spec-6-3-display-calculation-results-in-employe-form/` pins `graphie-mobile-pov` `2.0.0` / schema `3` / `cetem-paper-form` `2.0.0` and depends on 5.6 and 6.6; the old file now points to it.
- source_spec: `_bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/SPEC.md`
  summary: Known limitation — a task whose stored draft is catalogue `1.0.0` / schema `2` cannot be used on that device: hydration fails, Save is disabled and Delete is hidden, because deletion needs the revision of a draft that can no longer be parsed.
  evidence: Accepted for the PoV (no deployed users; v1 drafts exist only on test devices and are cleared by resetting app data). Recommended fix: a confirmed « Supprimer le brouillon local » action on the compatibility notice, backed by a repository method that deletes an unparseable draft row for the employee/task scope.
  resolved: Story 6.7 (2026-10-03) — the compatibility notice offers a confirmed « Supprimer le brouillon local » backed by `deleteUnreadable(employeeId, taskId)` (no parse, employee/task scope), online and offline; App render tests M5–M8.

## Deferred from: code review of spec-6-6-align-calculation-rules-with-the-official-cetem-paper-form (2026-10-03)

- source_spec: `_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/versioning-and-compatibility.md`
  summary: The compatibility table says « Explicit delete is still available » for a `2.0.0` / `3` draft stamped with the old rule, but the App hides Delete for any draft it cannot parse, the same limitation already accepted for v1 drafts in 5.6. Since 6.6 changes the rule tuple, the limitation now also covers every draft saved between 5.6 and 6.6.
  evidence: `apps/mobile/App.tsx:994` renders the delete button only when `activeDraft` is set, and a `GraphiePayloadCompatibilityError` leaves it unset. An added assertion in the new App render test failed with « expected button Supprimer le brouillon local ». The fix needs App.tsx, which 6.6 forbids; it is the same fix as the 5.6 entry above. The spec sentence should also be corrected.
  resolved: Story 6.7 (2026-10-03) — same fix as the 5.6 entry; the 6.6 sentence « Explicit delete is still available » is now true (the 6.6 spec is not edited).
- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-align-calculation-rules-with-the-official-cetem-paper-form.md`
  summary: `apps/api` `test` runs only the calculations suite, so `pnpm -r test` still skips the other 13 API test files (routes, auth, team-access, db, the Postgres suites).
  evidence: `apps/api/package.json` `test` = `test:calculations`. Before 6.6 no API test ran under `pnpm -r test`, so this is not a regression. Widening it needs a decision on the Postgres-dependent suites.
  resolved: Story 6.7 (2026-10-03) — every package `test` script discovers its test files by pattern; PostgreSQL suites run through the local-only harness in `apps/api/src/test-support/postgres.ts` with 0 skipped.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-align-calculation-rules-with-the-official-cetem-paper-form.md`
  summary: `packages/domain` (like every package under `packages/`) has no `tsconfig.json` or `typecheck` script, so `pnpm -r typecheck` never checks `graphie-calculations.test.ts`. The `@ts-expect-error` lines in V4/V5 and the `as never` casts are unchecked. This was rejected #7 in the build triage; it is confirmed real and moved to defer.
  evidence: Domain source is type-checked only through consumers (api/mobile tsconfig). Fix: add a package tsconfig extending `packages/config/tsconfig.base.json` plus a `typecheck` script; doing it for one package only would be inconsistent.
  resolved: Story 6.7 (2026-10-03) — `domain`, `schemas`, `types`, `api-client` and `i18n` have a `tsconfig.json` (shared strict base) and a `typecheck` script covering `src/**/*.ts`, tests included. No type errors surfaced under the shared base config, so no code change was needed; the V4/V5 `@ts-expect-error` lines are now checked.
- source_spec: `_bmad-output/implementation-artifacts/epic-6-context.md`
  summary: The epic context says `rule-evaluation` owns thresholds and boundaries, while the approved 6.6 spec places `GRAPHIE_TOLERANCES` / `judgeTolerance` / `suggestedVerdict` in the domain `calculations` module.
  evidence: The code follows calculation-functions.md (approved). The context doc's Technical Decisions should be updated to match; that is an agent-context edit, outside review fixes.
  resolved: Story 6.7 (2026-10-03) — `epic-6-context.md` Technical Decisions now place tolerances and suggested verdicts in the `packages/domain` calculations module.

## Deferred from: Story 6.7 (2026-10-03)

- source_spec: `_bmad-output/specs/spec-6-7-harden-test-harness-and-recover-unreadable-drafts/SPEC.md`
  summary: Mobile test files are excluded from the `apps/mobile` typecheck (`apps/mobile/tsconfig.json` excludes `*.test.ts(x)`), so type errors in mobile tests are not caught by `pnpm -r typecheck`.
  evidence: Non-goal of Story 6.7. Including them needs typings for the `node:test` module mocks and the react-test-renderer harness used by `App.render.test.tsx`.

## Deferred from: code review of 6-7-harden-the-test-harness-and-recover-unreadable-drafts (2026-10-03)

- source_spec: `_bmad-output/specs/spec-6-7-harden-test-harness-and-recover-unreadable-drafts/SPEC.md`
  summary: Free-text fields other than task `establishment`/`service` (employee `firstName`, `surname`, `email`, …) still accept NUL, which PostgreSQL text columns reject with a 500 instead of a 400 validation error.
  evidence: Action item epic-4-2 scoped the NUL rejection to task creation (`withoutNul` in `packages/schemas/src/api/v1.ts`). Extending it changes the OpenAPI contract for other operations, so it needs its own story.
- source_spec: `_bmad-output/specs/spec-6-7-harden-test-harness-and-recover-unreadable-drafts/test-harness.md`
  summary: Nothing checks CAP-1 and CAP-3 automatically. No script compares `git ls-files '*.test.*'` with the `pnpm -r test` output, and the "a deliberate type error fails the gate" proof (T2) was done by hand.
  evidence: If a package loses its `test`/`typecheck` script, or a glob misses a new folder, the gates go quiet again. A small guard script needs a gate decision, because the gate scripts must not be edited here.
- source_spec: `_bmad-output/specs/spec-6-7-harden-test-harness-and-recover-unreadable-drafts/test-harness.md`
  summary: A killed test run (Ctrl-C, crash, timeout) leaves its `test_<uuid>` schema in `cetem_qc_test`. Nothing removes old schemas.
  evidence: `withPostgresTestSchema` drops its schema in `finally`, which does not run when the process is killed. Removing old schemas at startup must not race with test files running in parallel, so it needs a design (for example, an age threshold).

## Deferred from: code review of 2-4-reset-a-forgotten-password-through-the-responsable (2026-10-03)

- source_spec: `_bmad-output/specs/spec-2-4-reset-forgotten-password-through-responsable/SPEC.md`
  summary: The Story 3.2 `POST /employees/{employeeId}/credential` endpoint and its web proxy are still live but no longer called by the UI. They replace a not-yet-activated Employé's password without revoking sessions and without an `identity_password_resets` row or `identity.password_reset` log line.
  evidence: The approved 2.4 spec keeps this endpoint unchanged (Confirmed decisions; Non-goal « retiring the `/credential` regenerate endpoint »). Retiring it, or routing it through `applyPasswordReset`, changes the public contract and needs its own story.
- source_spec: `_bmad-output/specs/spec-2-4-reset-forgotten-password-through-responsable/test-plan.md`
  summary: The operator CLI success path is never run end to end. C4 only spawns the script against an unreachable database; C1–C3 call `resetResponsablePassword` directly, so nothing checks that the script prints a credential that verifies, with exit code 0.
  evidence: The spawned child would need to reach the per-test schema created by `withPostgresTestSchema`, which the harness does not support yet (it would need a search_path or schema env hook in `db/pool.ts`).

## Deferred from: code review of 6-3-display-authorized-calculation-results-in-the-employe-form (2026-10-04)

- source_spec: `_bmad-output/specs/spec-6-3-display-calculation-results-in-employe-form/input-parsing-and-mapping.md`
  summary: `parseGraphieReading` accepts only ASCII digits (`\d` without the `u` flag). Readings typed with Arabic-Indic digits (U+0660–U+0669) or the Arabic decimal separator (U+066B) would be shown as « Valeur numérique invalide », and the dependent results would be unavailable.
  evidence: Unverified (would be medium). To settle it, check whether the `decimal-pad` keyboards on the target Android/iOS devices can emit those characters in an Arabic locale. Accepting them changes the approved input grammar, so it needs a spec update.

## Deferred from: code review of 6-4-display-authorized-calculation-results-in-responsable-review (2026-10-04)

- source_spec: `_bmad-output/specs/spec-6-4-display-calculation-results-in-responsable-review/review-view.md`
  summary: `GraphieCalculationReview` does not check that `evidence.identity` matches the identity the `evidence.results` snapshot was calculated under. A supported identity paired with old-rule results would show « Version de règle non prise en charge » next to a supported identity, and an old identity paired with current-rule results would show verdicts with no warning.
  evidence: Not reachable today. No producer exists yet, and `calculateGraphieResults` builds the results from that same identity. Stories 7.3/7.4 (server snapshot) and 9.1 (W4 wiring) should keep identity and results consistent, either with a server invariant or with a view-level check.

## Deferred from: code review of SPEC-6-5-separate-regression-and-acceptance-fixtures (2026-10-04)

- source_spec: `_bmad-output/specs/spec-6-5-separate-regression-and-acceptance-fixtures/fixture-categories.md`
  summary: `runApprovedAcceptanceFixture` accepts an empty or partial `expected.values`, so an approved case can pass on its verdict alone, and result paths it omits are never compared.
  evidence: Not reachable today because the dataset is empty. What counts as a complete expectation depends on the shape of the CETEM-signed dataset (DEP-02).
- source_spec: `_bmad-output/specs/spec-6-5-separate-regression-and-acceptance-fixtures/fixture-categories.md`
  summary: Keys in an approved case's `values` are not checked against the paper-form field IDs of its test. A typo becomes `missing-input` instead of failing the guard.
  evidence: Add the check when the first CETEM dataset is entered. The field IDs are in `graphie-inputs.ts`.
- source_spec: `_bmad-output/specs/spec-6-5-separate-regression-and-acceptance-fixtures/fixture-categories.md`
  summary: `assertApprovedFixtures` requires ids to be unique across the whole dataset. If two CETEM approval documents number their cases the same way, the ids would clash, and the doc forbids renumbering.
  evidence: Depends on how CETEM numbers its cases. If needed, key uniqueness on `(documentRef, id)`.

## Deferred from: Story 7.1 spec (2026-10-04)

- source_spec: `_bmad-output/specs/spec-7-1-queue-durable-synchronization-operations/SPEC.md`
  summary: No story in `epics.md` owns the server command that receives `sync-draft` outbox operations (FR-021 « Synchronize saved drafts », AD-5 « synchronized editable drafts »). Story 7.3 covers only submission acceptance.
  evidence: Story 7.1 queues `sync-draft` items behind a transport port. Without a server command they stay `queued` on the device, which is safe but means drafts never synchronize. The 7.3 author or the Product Owner should place it in 7.3 or in a new story (see delivery-notes.md).

## Deferred from: code review of spec-7-1-queue-durable-synchronization-operations (2026-10-04)

- source_spec: `_bmad-output/specs/spec-7-1-queue-durable-synchronization-operations/sync-engine.md`
  summary: Every `blocking` result stops the whole run, including task-level codes such as `TASK_NOT_ASSIGNED`. The blocked item has the lowest sequence, so each later run stops on it again and the employee's other tasks never sync.
  evidence: The spec lists `TASK_NOT_ASSIGNED` as blocking. Story 7.3 (HTTP mapping) or 8.4 (deactivation/unassignment) should map task-level refusals to a per-task skip.
- source_spec: `_bmad-output/specs/spec-7-1-queue-durable-synchronization-operations/outbox-model.md`
  summary: After a `conflict` outcome, later unresolved items of the same task keep the stale base revision and will predictably conflict as well.
  evidence: Only `accepted` moves later items' base revision. Conflict recovery is Story 8.1.
