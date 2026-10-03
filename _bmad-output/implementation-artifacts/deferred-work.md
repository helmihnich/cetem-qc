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
- source_spec: `_bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/SPEC.md`
  summary: Re-pin the Story 6.3 spec from catalogue `1.0.0` / schema `2` to `2.0.0` / `3` and list 5.6 plus the rule-set v2 story as dependencies.
  evidence: `spec-6-3-display-authorized-calculation-results-in-the-employe-form.md` still names the retired tuple (lines 8–9, 42, 112); delivery-notes.md asks for the re-pin. It edits another spec, so it is outside this review's fixes.
- source_spec: `_bmad-output/specs/spec-5-6-align-graphie-mobile-form-with-cetem-paper-form/SPEC.md`
  summary: Known limitation — a task whose stored draft is catalogue `1.0.0` / schema `2` cannot be used on that device: hydration fails, Save is disabled and Delete is hidden, because deletion needs the revision of a draft that can no longer be parsed.
  evidence: Accepted for the PoV (no deployed users; v1 drafts exist only on test devices and are cleared by resetting app data). Recommended fix: a confirmed « Supprimer le brouillon local » action on the compatibility notice, backed by a repository method that deletes an unparseable draft row for the employee/task scope.

## Deferred from: code review of spec-6-6-align-calculation-rules-with-the-official-cetem-paper-form (2026-10-03)

- source_spec: `_bmad-output/specs/spec-6-6-align-calculation-rules-with-cetem-paper-form/versioning-and-compatibility.md`
  summary: The compatibility table says « Explicit delete is still available » for a `2.0.0` / `3` draft stamped with the old rule, but the App hides Delete for any draft it cannot parse, the same limitation already accepted for v1 drafts in 5.6. Since 6.6 changes the rule tuple, the limitation now also covers every draft saved between 5.6 and 6.6.
  evidence: `apps/mobile/App.tsx:994` renders the delete button only when `activeDraft` is set, and a `GraphiePayloadCompatibilityError` leaves it unset. An added assertion in the new App render test failed with « expected button Supprimer le brouillon local ». The fix needs App.tsx, which 6.6 forbids; it is the same fix as the 5.6 entry above. The spec sentence should also be corrected.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-align-calculation-rules-with-the-official-cetem-paper-form.md`
  summary: `apps/api` `test` runs only the calculations suite, so `pnpm -r test` still skips the other 13 API test files (routes, auth, team-access, db, the Postgres suites).
  evidence: `apps/api/package.json` `test` = `test:calculations`. Before 6.6 no API test ran under `pnpm -r test`, so this is not a regression. Widening it needs a decision on the Postgres-dependent suites.
- source_spec: `_bmad-output/implementation-artifacts/spec-6-6-align-calculation-rules-with-the-official-cetem-paper-form.md`
  summary: `packages/domain` (like every package under `packages/`) has no `tsconfig.json` or `typecheck` script, so `pnpm -r typecheck` never checks `graphie-calculations.test.ts`. The `@ts-expect-error` lines in V4/V5 and the `as never` casts are unchecked. This was rejected #7 in the build triage; it is confirmed real and moved to defer.
  evidence: Domain source is type-checked only through consumers (api/mobile tsconfig). Fix: add a package tsconfig extending `packages/config/tsconfig.base.json` plus a `typecheck` script; doing it for one package only would be inconsistent.
- source_spec: `_bmad-output/implementation-artifacts/epic-6-context.md`
  summary: The epic context says `rule-evaluation` owns thresholds and boundaries, while the approved 6.6 spec places `GRAPHIE_TOLERANCES` / `judgeTolerance` / `suggestedVerdict` in the domain `calculations` module.
  evidence: The code follows calculation-functions.md (approved). The context doc's Technical Decisions should be updated to match; that is an agent-context edit, outside review fixes.
