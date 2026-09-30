---
title: 'Story 5.1: Open assigned work across supported phone and tablet form factors'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-retro-2026-09-30.md'
---

## Intent

Implement Story 5.1 only. An authenticated EmployÃ© can open assigned task context in one responsive Expo/React Native experience on Android phone, Android tablet, iPhone, and iPad. Keep the existing authorized task list and read-only overview behavior identical across form factors.

## Acceptance Criteria

Authoritative criteria from `_bmad-output/planning-artifacts/epics.md`, Story 5.1:

1. Given an authenticated employee with one or more assigned tasks, when they open a task on Android/iOS phone or tablet layouts, the responsive Expo experience preserves the same task behavior and authorization across platforms.
2. Phone content reflows vertically and tablet space can present useful grouped context without requiring hover, mouse, or rotation.
3. Representative Android phone/tablet and iPhone/iPad form factors are included in validation; exact OS/device versions remain an acceptance-matrix item.

## Boundaries and Constraints

- Reuse the Story 4.3 assigned task list and authorized read-only task overview; preserve API assignment isolation and stale/out-of-order detail response protection.
- Use deterministic viewport width input to choose phone versus tablet presentation. Keep the phone layout vertically reflowed. On tablet, group the same task context into useful columns while preserving reading order and full values.
- Keep touch-operated controls visible and usable without hover or mouse. Scrolling, not rotation, provides access to content and actions.
- Add no server/business state, API/contract changes, or local field-work persistence.
- Preserve French user-facing copy.
- Record validation evidence separately for Android phone, Android tablet, iPhone, and iPad. Expo JavaScript exports mean bundling only; they do not prove native build/install/device launch/connectivity. Exact OS/device versions remain open under OD-05.
- Do not modify Epic 4 retrospective follow-ups unless a direct blocker is found.

## Explicitly Out of Scope

Stories 5.2 (offline authorization/local protection), 5.3 (draft save/resume/delete), 5.4 (Graphie Mobile catalogue), 5.5 (offline editing), synchronization/outbox, submission/acceptance, calculations, DEP-01-dependent fields/rules, and all Epic 6+ behavior.

## Code Map

- `apps/mobile/App.tsx`: responsive task list/detail composition and touch controls.
- `apps/mobile/employee-task-layout.ts`: deterministic viewport-to-layout/content-width rules.
- `apps/mobile/App.render.test.tsx`: rendered App flows at phone/tablet widths with API-client boundary mocks.
- `apps/mobile/employee-task-layout.test.ts`: phone/tablet boundary, padded phone width, tablet cap, and narrow-landscape behavior.
- `apps/mobile/package.json`, `pnpm-lock.yaml`, and `apps/mobile/tsconfig.json`: minimal renderer dependency, focused test command, and TypeScript test-file exclusion.
- `apps/mobile/employee-task-list-state.test.ts` and `employee-task-detail-state.test.ts`: existing state behavior; extend for cross-layout equivalence if a shared presentation/state model requires it.
- `_bmad-output/implementation-artifacts/sprint-status.yaml`: Epic 5 and Story 5.1 move to `in-progress` for implementation, then Story 5.1 to `review` after developer verification. Stories 5.2+ remain `backlog`.

## Test Plan

- Deterministic viewport tests for phone widths, tablet threshold, grouped tablet content width, and a narrow landscape phone without rotation dependence.
- Rendered/list-detail flow tests: task list â†’ open assigned task â†’ read-only overview, on phone and tablet presentation; same task data and access behavior in both layouts.
- Loading, empty, error and retry states remain visible/actionable in both layouts; touch controls are operable without hover/mouse.
- Preserve and run stale/out-of-order detail request tests.
- No API authorization or PostgreSQL changes are expected because no server behavior changes.
- Developer verification: mobile tests/typecheck, workspace typechecks and applicable builds/Expo exports plus `git diff --check`. Report platform evidence by the four categories and state exactly what was exercised.

## Implementation Notes

- `apps/mobile/employee-task-layout.ts` selects a phone layout below 768 logical pixels and tablet layout at or above that width. Phone content uses available width and a vertical list/detail flow. Tablet content is capped at 960 logical pixels and uses grouped task cards and two-column task metadata.
- `apps/mobile/App.tsx` uses React Native `useWindowDimensions`, so layout updates with viewport changes without requiring rotation. Existing API calls, assignment authorization, sign-in, task lifecycle labels, stale-response invalidation, and in-memory-only task state remain unchanged. Interactive rows/buttons retain touch targets of at least 56/48 logical pixels and do not depend on hover.
- `getEmployeeTaskPresentation` keeps the same task IDs and selected authorized task independent of phone/tablet width.
- No API, OpenAPI, Zod, generated type, database, or persistence changes were required.

## Developer Verification

- Mobile TypeScript check: passed.
- Focused mobile tests: superseded by review remediation below.
- Recursive workspace typechecks (API, web, mobile): passed.
- `git diff --check`: passed; Git reported only working-copy LF-to-CRLF normalization warnings.
- Expo Android JavaScript export: passed with `--no-bytecode` (Metro bundled 576 modules). Initial default export could not execute Windows `hermesc.exe` due to permission denied; disabling bytecode allowed the JavaScript export.
- Expo iOS JavaScript export: passed with `--no-bytecode` (Metro bundled 679 modules).
- Android phone: deterministic 390 logical-pixel viewport test only; no emulator or device launch.
- Android tablet: deterministic 1024 logical-pixel viewport test only; no emulator or device launch.
- iPhone: iOS JavaScript bundle plus deterministic phone viewport test; no simulator or device launch.
- iPad: iOS JavaScript bundle plus deterministic tablet viewport test; no simulator or device launch.
- No native build, installation, physical-device launch, native-module behavior, or live-device connectivity was performed. Exact OS/device versions and formal acceptance matrix remain open under OD-05.

## Review Handoff

Story 5.1 implementation and developer verification are complete. Status is `review`; do not mark `done` until a fresh-context BMad Code Review is complete. Epic 5 is `in-progress`; Stories 5.2+ remain `backlog`.

## Review Finding Remediation

- **Rendered responsive flow (medium):** Added `App.render.test.tsx` using `react-test-renderer` 19.2.3, matching the existing React version. Node's built-in experimental module mocking supplies React Native host primitives and deterministic `useWindowDimensions` widths while rendering the actual `App` component; the API client is mocked at its package boundary. Phone tests cover 390 px list, vertical task stack, opening read-only detail, Back, delayed loading, error, retry success, and padded width. Tablet tests cover 1024 px task grid and grouped detail metadata, same task ID/data and flow, plus delayed loading, error, retry success. Empty state is rendered at both widths. Existing generation-guard tests remain included. No simulator/device is required.
- **Padded phone width (low):** `getEmployeeTaskContentWidth` subtracts both 20 px horizontal gutters for every viewport, floors at zero, and then applies the existing tablet cap. The rendered phone assertion proves 390 px = 20 px + 350 px content + 20 px.
- **Rendered-test setup:** Added only `react-test-renderer` 19.2.3. The test command uses Node 22's experimental module mocking to avoid adding Jest or a larger React Native Testing Library stack. React currently emits its deprecation warning for `react-test-renderer`; the tests pass and retain explicit App rendering.

### Remediation verification

- `pnpm --filter @cetem-qc/mobile test`: 14/14 passed, zero skipped (5 App-rendered tests and 9 helper/state regression tests). Covers stale/out-of-order responses and return-to-list invalidation.
- Mobile TypeScript check and recursive workspace typechecks: passed.
- Android and iOS Expo exports with `--no-bytecode`: passed; JavaScript bundling evidence only. The original Hermes executable permission limitation remains documented above.
- `git diff --check`: passed.
- Native build/install/device launch and live-device connectivity remain unverified; exact OD-05 device/OS acceptance details remain open.

Story remains `review`; Epic 5 remains `in-progress`; Stories 5.2â€“5.5 remain `backlog`.

## Review Findings

- [x] [Review][Patch] Verify the rendered responsive task flow â€” resolved by `App.render.test.tsx`, which renders App at 390 px and 1024 px, drives list â†’ detail â†’ back, loading/error/retry, and empty states at both widths, and checks the same task identity/detail labels. **Severity: medium verification gap.**
- [x] [Review][Patch] Size responsive content within the padded viewport â€” resolved by gutter-aware `getEmployeeTaskContentWidth` and the rendered 390 px assertion: 20 px gutter + 350 px content + 20 px gutter. **Severity: low visual layout defect.**

### Rejected

- Tablet reading order finding â€” **false**. The heading and detail children remain in source order, and `flexWrap` places the detail children in that same row-major order; the acceptance criteria do not require a different grouping order.
- Invalid viewport width handling â€” **false**. The function is called with `useWindowDimensions().width`, which supplies the live native window width; arbitrary zero, negative, or non-finite values are not an input path established by this implementation.
- Missing touch-target sizing evidence â€” **false**. The task rows have `minHeight: 56`, and buttons and text inputs have `minHeight: 48` in `App.tsx` styles.
- Stale detail response after returning to the list â€” **false**. The Back handler invalidates pending detail work and explicitly sets loading to false; the stale request then returns at the `!result.current` guard without changing state.

### Final Closure Review (2026-09-30)

- Verdict: accepted; both prior findings are resolved and no blocking or medium findings remain.
- Rendered flow: `App.render.test.tsx` renders the actual App with React Native host primitives and deterministic 390 px/1024 px viewport dimensions. It verifies assigned list, phone vertical layout, tablet grouping, selected-task detail, back navigation, loading, error, retry recovery, and empty states. API calls are mocked at the typed-client package boundary; the App navigation and presentation logic execute in the renderer.
- Gutter sizing: effective content width is `max(0, viewportWidth - 40)` before the tablet 960 px cap. At 390 px this is 20 + 350 + 20; 430 px yields 390 px content. Narrow widths do not produce negative widths.
- Story 4.3: same assigned-task typed API methods and server authorization boundary remain in use. Assignment isolation, read-only details, request generation guards, list invalidation, and task-bound retry are unchanged.
- Scope: no API/contract/business/server-state or field-work-persistence changes; later Epic 5 and Epic 6+ behavior remains absent.
- Test dependency: `react-test-renderer` 19.2.3 is a mobile devDependency matching React 19.2.3. It is excluded from production dependencies/bundles. Its deprecation warning and Node experimental module-mocking warning are non-blocking testing follow-ups.
- Verification rerun: mobile tests 14/14 passed with zero skips; recursive API/web/mobile typechecks passed; `git diff --check` passed with only LF-to-CRLF normalization notices. The recorded Android/iOS Expo JS exports remain bundling evidence only and were not rerun in this closure review.
- Native builds, installation, simulator/device launch/rendering, live-device API connectivity, and exact OD-05 OS/device acceptance remain unverified evidence items; they are not Story 5.1 blockers under the authoritative acceptance criteria.
- Status: Story 5.1 `done`; Epic 5 `in-progress`; Stories 5.2–5.5 `backlog`.
