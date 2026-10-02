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
