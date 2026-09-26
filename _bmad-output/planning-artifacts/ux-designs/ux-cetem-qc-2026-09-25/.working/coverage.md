# BMAD Pass 1 mechanical coverage — 2026-09-26

Scope: required distillation/coverage only, not optional multi-lens validation. Checked current DESIGN.md and EXPERIENCE.md against prd-extract.md, supporting extracts and the skill's Pass 1 categories. Both spines correctly remain `awaiting-user-decisions`.

## 1. Flow coverage

All five PRD §4 titles occur verbatim in EXPERIENCE Key Flows. Each has an explicitly illustrative named protagonist (Salma/Sami), numbered steps, a marked climax and failure path:

- UJ-1 — Assigned field control to official report.
- UJ-2 — Network interruption.
- UJ-3 — Normal and nonconforming outcomes.
- UJ-4 — AI unavailable.
- UJ-5 — Material submitted error or employee deactivation.

Requirements are grouped into these journeys rather than inventing a journey for each FR. Account activation/team/assignment, tablet entry, local persistence, sync/submission, calculations, review/insights, manual/AI summary, separate human conformity, both report paths, authorized history, replacement and deactivation are represented. UJ-5 correctly does not invent replacement initiation/reassignment. Added only factual PRD §5.5–6 minimum report linkage/signature-zone and actor/date detail to EXPERIENCE's dependency section.

## 2. Token completeness

DESIGN frontmatter defines colors, typography, rounded, spacing and all component entries. Eleven color tokens have concrete hexadecimal values. EXPERIENCE references `{colors.primary}`, `{colors.error}` and `{typography.body.fontSize}`; each resolves. DESIGN token references resolve to its frontmatter. Source palette contrast evidence and weak-border limitation are explicitly documented, without claiming rendered accessibility compliance. Undecided tablet dimensions, breakpoints and pale semantic backgrounds remain intentionally absent rather than fabricated.

## 3. Component coverage

Automated table extraction confirms **19 DESIGN rows = 19 EXPERIENCE rows**, with no set differences:

`app-shell`, `button-primary`, `button-secondary`, `button-destructive`, `form-field`, `task-list`, `status-badge`, `sync-status`, `audit-sections`, `measurement-result`, `insight-item`, `summary-editor`, `conformity-decision`, `report-panel`, `history-record`, `alert-message`, `confirmation-dialog`, `loading-state`, `empty-state`.

Each has visual anatomy/states in DESIGN and substantive behavior in EXPERIENCE. No separate card component is implied: DESIGN explicitly defines card as a visual container treatment.

## 4. IA state coverage

All **13 IA surfaces** occur in State Patterns, with legitimate grouped rows W2–W3 and T2–T3: A1; W1, W2, W3, W4, W5, W6, W7; T1, T2, T3, T4; H1. Shared visible-focus and safe permission-refusal rules apply globally. Empty/loading/error/offline treatments are covered as relevant; Responsable offline editing and offline report availability are explicitly not promised.

Tablet table separates unsaved, saving, locally saved, offline, uncached task, draft sync pending/synchronized, submission pending, transfer, server accepted, failed/unknown acknowledgment, approved server validation failure, conflict, local save failure and expiry/logout/deactivation. Immutable accepted evidence is distinguished from queued intent. Neither pending edit/cancel nor conflict recovery is silently chosen. No work approval/rejection or real email behavior is restored.

## 5. Reference coverage

All current Markdown links in both spines resolve locally. Imports is empty; there are no mockups/wireframes folders or visual artifacts to reconcile. Consequently there are no orphan visual files, but **visual coverage is deliberately incomplete**: every IA surface is spine-only. EXPERIENCE Finalization and Visual Coverage accurately records pending mock selection/rendering and user coverage confirmation.

## Open gaps carried forward

- User/policy decisions OD-01/02/03/04/05/06/08/09/10 remain explicit; OD-07 is resolved and not reopened.
- External approved field/rule, reference dataset and report template dependencies DEP-01/02/03 remain explicit. Formula evidence never becomes a tolerance verdict rule or automatic conformity.
- Save/autosave trigger, language scope, exact tablet/layout choices and mock scope remain undecided. No final implementation readiness claim is appropriate.
- Optional reviewer gate, rendered key-screen verification, visual-coverage confirmation and final polish remain workflow steps after user input; none was run or implied by this mechanical pass.

Outcome: source scope is represented and document mechanics support a user decision checkpoint. Remaining gaps are acknowledged policy/reference/visual-finalization dependencies, not silently completed requirements.
