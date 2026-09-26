---
name: CETEM-BH Graphie Mobile â€” Phase 1 PoV
description: Calm professional quality-control interfaces for Responsable web and cross-platform EmployÃ© mobile.
status: final
updated: 2026-09-26
sources:
  - ../../prds/prd-cetem-qc-2026-09-24/prd.md
  - ../../prds/prd-cetem-qc-2026-09-24/addendum.md
  - ../../../../docs/product/Guide_Design_UI_UX_CETEM_BH.docx
  - ../../../../docs/product/Choix_de_la_Stack_Technologique_et_Benchmarking.docx
colors:
  background: '#F7F8FA'
  surface: '#FFFFFF'
  text: '#1F2933'
  secondary-text: '#667085'
  border: '#E4E7EC'
  primary: '#2563EB'
  primary-hover: '#1D4ED8'
  success: '#15803D'
  warning: '#B45309'
  error: '#B42318'
  information: '#0369A1'
typography:
  page:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
  section:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
  card-small:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '600'
  card-large:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
  table-small:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
  table-large:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
  metadata-small:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
  metadata-large:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
rounded:
  sm: 6px
  md: 8px
  lg: 10px
spacing:
  '1': 4px
  '2': 8px
  '4': 16px
  '6': 24px
components:
  app-shell:
    backgroundColor: '{colors.background}'
    textColor: '{colors.text}'
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  button-destructive:
    textColor: '{colors.error}'
  form-field:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  task-list:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  status-badge:
    textColor: '{colors.secondary-text}'
  sync-status:
    textColor: '{colors.secondary-text}'
  audit-sections:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  measurement-result:
    textColor: '{colors.text}'
  insight-item:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  summary-editor:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  conformity-decision:
    textColor: '{colors.text}'
  report-panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  history-record:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  alert-message:
    textColor: '{colors.text}'
  confirmation-dialog:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
  loading-state:
    textColor: '{colors.secondary-text}'
  empty-state:
    textColor: '{colors.secondary-text}'
---

## Brand & Style

**Finalized Phase 1 UX design specification for architecture handoff.** This document captures visual decisions; [EXPERIENCE.md](EXPERIENCE.md) defines behavior using the same 19 component names. External validation dependencies remain open and are carried into architecture and implementation. This is not a verified accessibility claim, an approved report template or a production readiness claim. The four approved key-screen references are recorded in EXPERIENCE.md and are the only mockup scope for Phase 1. No additional visual references are required; rendering remains an implementation/handoff artifact.

The [final PRD](../../prds/prd-cetem-qc-2026-09-24/prd.md) and the user's current instructions govern conflicts. Reuse the [existing UI/UX guide](../../../../docs/product/Guide_Design_UI_UX_CETEM_BH.docx), especially Â§Â§1â€“14; the [PRD addendum](../../prds/prd-cetem-qc-2026-09-24/addendum.md) records normalized visual direction. Detailed evidence is in [.working/existing-ux-extract.md](.working/existing-ux-extract.md), [.working/product-extract.md](.working/product-extract.md) and [.working/prd-extract.md](.working/prd-extract.md).

CETEM-BH should look like an operational quality-control tool: light, calm, structured, compact on desktop and readable by touch on tablet. Measurements, work state and traceable human decisions are the center. AI is discreet writing assistance. Neither chat nor futuristic decoration defines the interface. Preserve familiar French business terms: Responsable, EmployÃ©, Mes tÃ¢ches, Brouillon, RÃ©sumÃ©, Rapport officiel, Machine conforme and Machine non conforme. French source terminology is reused; a localization requirement is not inferred.

The source platform direction is separate Next.js/React Responsable web and React Native EmployÃ© mobile, sharing tokens and language without forcing shared rendered components ([technology source](../../../../docs/product/Choix_de_la_Stack_Technologique_et_Benchmarking.docx), Â§Â§1â€“6). This specifies no new stack choice or library inheritance.

**Decision status.** Palette, compact type ramp, 4/8 spacing grid, 6â€“10px radii, calm borders and separate platform patterns are reused source guidance. Exact component dimensions outside the source ranges, tablet font sizing, safe areas, orientation support, sidebar width, content maxima, breakpoints, pale semantic background colors, icon set, line heights and focus-ring geometry remain implementation and validation details. No unlisted values inherit from a silently chosen UI library. Specific screen composition proposals below are grouping guidance for implementation. Resolved OD-01 offline/logout policy, OD-02 submission/recovery policies and OD-07 email scope remain binding. Resolved OD-03 replacement and deactivation-task policies also remain binding. Resolved OD-09 provides one-time credential display/manual handover for the PoV. Resolved OD-10 governs summary reopening and dependent decision/report invalidation before finalization. Resolved OD-04/05/06/08 and the four-screen mock scope remain binding. DEP-01/02/03 and exact validation matrices remain external dependencies; do not reopen resolved decisions without a direct contradiction.

## Colors

Use {colors.background} for the app ground and {colors.surface} for forms, tables and bounded working areas. Primary text {colors.text} carries labels and results; {colors.secondary-text} carries supporting metadata. Borders {colors.border} are subtle 1px separators, not the only cue distinguishing an interactive control. These are the guide Â§2.1 values, not measured contrast results.

{colors.primary} marks the current action, links and keyboard focus; {colors.primary-hover} is its source-backed web hover state. {colors.success} supports success/confirmed/conforming labels, {colors.warning} attention and pending/review conditions, {colors.error} actionable error or nonconforming evidence, and {colors.information} informational context. Color must always accompany text and, where useful, an icon. Nonconformity is a valid business outcome, not an application failure or rejection of employee work.

Badges use a small dot or light background with dark readable text. Exact pale backgrounds are not supplied by the source and are deliberately absent from machine tokens; choose and measure them during screen design. Do not tint full table rows routinely. Neutral draft, blue submitted, amber review, green/red human conformity and restrained completed-state treatments reuse guide Â§5 after removing obsolete audit-approved/audit-rejected states. Network connectivity, save durability, transfer and submission need separate labels even if some share a color.

The [computed palette check](.working/palette-check.md) finds normal text contrast of 4.68:1 or higher for the supplied text/accent semantic colors on white and the app background. The pale border is only 1.24:1 on white and 1.17:1 on the app background, so it cannot be the sole identifying control boundary. An identifiable stronger boundary using an existing darker token is a proposed accessibility adaptation requiring rendered review. Final text/background, focus, disabled states and touch/readability still need screen measurement; these palette calculations do not establish overall WCAG conformance.

## Typography

Use the guide Â§2.2 recommended Inter family. Geist and IBM Plex Sans are documented alternatives, not simultaneous mixed-font defaults. Frontmatter preserves source sizes and weights. The small/large card, table and metadata tokens expose the source ranges rather than invent a single mandatory selection. Table 400/500 weight is also a source range; choose by content hierarchy.

Use {typography.page.fontSize} page headings and {typography.section.fontSize} section headings; body defaults to the source indicative {typography.body.fontSize}. Never introduce marketing-scale 40â€“60px dashboard titles. Text labels stay visible when a field is populated. Measured values, units, calculations and result labels must remain visually distinguishable; numbers and dates align consistently in web tables.

These compact source sizes principally establish the web direction. Tablet body/input/help sizes require OD-05 device evidence and touch/readability review; copying the 12â€“14px desktop metadata/body ramp onto tablet is not approved. Line height, font fallback/loading behavior, zoom/text scaling and long-label wrapping need verification during mockups and implementation; no exact values were supplied. Critical values, errors and sync labels must not be hidden by truncation. Do not invent business rounding or number formatting through visual typography decisions (DEP-01).

## Layout & Spacing

The guide Â§Â§2.3,3,7â€“8,12 establishes a 4/8px rhythm: {spacing.1}, {spacing.2}; groups are separated by {spacing.4}â€“{spacing.6}. The token names are bookkeeping for those source values. No new breakpoint, margin or column grid is claimed as approved.

**Responsable web.** Stable left navigation and light top bar; dense readable central working area. Use a table for task comparison, exposing ID, type, establishment, EmployÃ©, state and last update. Keep source guidance of roughly six to eight visible columns; detail belongs in the record. One task-creation form groups related labels/inputs instead of wrapping each input in a separate card. Annuler is secondary and CrÃ©er la tÃ¢che primary, together at bottom-right in the source desktop pattern. Scope permits team, tasks, audit work and history/report access; source dashboard counters, equipment management, settings and administration examples do not authorize new screens.

**Proposed web grouping:** task list as operational entry; Ã‰quipe for employee management; task/audit detail with identity header and areas for Mesures, Insights et rÃ©sumÃ©, DÃ©cision, Rapport and Historique. Whether these become tabs or sections and the exact navigation grouping remain implementation choices within this specification. Keep summary confirmation and human conformity visually separate, with no audit approval/rejection intermediary. In-app task visibility is sufficient for Phase 1; no email-delivery panel or notification success toast.

**Responsable credential handover (W1a).** Dedicated account-success/credential screen immediately after creation or explicit pre-first-login regeneration. Show account identity, readable/selectable temporary credential, prominent Shown only once notice, Copy action and explicit I have saved/shared the temporary credential acknowledgement before normal departure. Use existing form-field, button-secondary, button-primary and alert-message patterns. No credential in employee-detail/history/audit layouts and no show-existing-password control. After dismissal, no redisplay: regeneration uses the same one-time screen and invalidates the prior temporary credential. No email/SMS delivery status or communication-method tracking.

**EmployÃ© responsive cross-platform mobile surface.** Mes tÃ¢ches emphasizes reference, establishment/service, task state and a distinct sync indicator on Android smartphone/tablet and iPhone/iPad. The React Native control form is grouped by tests, with section progression and free revisiting rather than a rigid wizard. Phone layouts reflow vertically; larger tablet layouts may use multiple columns when this improves measurement work. Persistent identity and save/sync context must remain discoverable while entering long forms. Use comfortable separated touch targets, nearby units/help/validation and appropriate numeric keyboards; no mouse, hover or precise-pointer dependency. Autosave persists editable Draft locally, with a visible Save action distinct in label and placement from Submit; saving never changes the Draft lifecycle. Pending snapshots cannot be edited/autosaved. Support portrait phone and practical landscape tablet without making rotation necessary for normal completion. Exact Android/iOS/iPadOS versions, representative devices, touch dimensions, status placement and sticky behavior remain validation items; web sidebar/table density is not copied onto either mobile form factor.

**Source-backed form groups, pending DEP-01 catalogue validation:** intervention/establishment, equipment/tube/generator, measuring instruments, qualitative checks, quantitative tests, comments and pre-submission review ([product extraction](.working/product-extract.md)). The workbook/source extraction already supplies a traceable numerical baseline for extracted formulas, fixed divisors, signed percentages, repeated-kV, sortie reproducibility, rÃ©pÃ©tabilitÃ© and linÃ©aritÃ© (including 0.49); its blank initial-linearity baseline remains `#DIV/0!`. These groups are not a finalized field catalogue or mandatory sequence. Required-field marks, tolerance thresholds, special-value behavior and deterministic insight display must reflect confirmed CETEM rules only.

**Responsive boundary.** Reflow must preserve identity, entered values, actions and complete messages without mandatory zoom on Android smartphones/tablets and iPhone/iPad. Avoid fixed widths and rotation blockers. Validate the critical EmployÃ© journey on representative Android phone, Android tablet, iPhone and iPad viewports. Exact Android/iOS/iPadOS versions/devices and formal acceptance owner remain open before final PoV acceptance; no glove/outdoor-brightness requirement is claimed. This specification does not promise arbitrary unsupported mobile platforms, a replacement PWA or production browser compatibility.

## Elevation & Depth

Use spacing, white surfaces and 1px {colors.border} boundaries as the main hierarchy; the source prefers weak or absent shadows. Floating menus and attention dialogs may receive a restrained shadow. No numeric shadow token is invented. Flat content grouping is preferred over nested cards. Loading should leave recognizable page structure; no decorative motion or glass effects. Dialog backdrop/elevation details remain to be designed and measured rather than inheriting arbitrary library defaults (guide Â§Â§1,2.3,10,13).

## Shapes

Source radius range is {rounded.sm}â€“{rounded.lg}; ordinary card guidance specifically supplies {rounded.md}. This does not fix button/input/modal radius assignments. Keep consistent restrained corners and thin borders; no oversized pill containers. Fields use the source web height range of 40â€“44px, not a falsely finalized 42px midpoint. Tablet targets must be larger and adequately separated; exact dimensions await OD-05 and review. No card component is added to the shared behavioral inventory: card is a visual container treatment used by the domain components below.

## Components

All names below appear in EXPERIENCE. Frontmatter supplies only supported base colors; omitted size/padding/height/width/rounded/typography properties are deliberate unresolved detail. State and anatomy rules below complete the visual contract without inventing finalized values.

| Component | Anatomy and appearance | Variants/states and boundary |
|---|---|---|
| `app-shell` | App identity, role context, stable web navigation/light header, content on background token; mobile task/form context with reachable navigation. | Active web section clearly indicated; role spaces distinct. Responsive dimensions and tablet navigation details remain implementation/validation work under OD-05. |
| `button-primary` | Blue fill, white label, one dominant action per functional area; clear verb. | Web hover uses primary-hover. Visible keyboard focus required. Disabled/busy must include understandable context; exact geometry/colors unresolved. Submission label never implies server success before acknowledgment. |
| `button-secondary` | White surface, neutral label, thin grey border. | Secondary cancel/back/retry actions kept subordinate but legible. Retry is ordinary recovery, not destructive styling. W1a provides a clearly labeled Copy action for the currently displayed temporary credential; copy feedback never repeats the secret or claims delivery. |
| `button-destructive` | Red cue and explicit action text, reserved for genuine destruction such as confirmed draft deletion. | Not used to frame Machine non conforme as rejection. No ordinary delete, cancel-to-edit or modify action for a pending submission. Explicit conflict discard/reload under OD-02b requires confirmation and preserves the original pending snapshot until resolution completes; OD-01 preserves work on expiry/deactivation/logout; deliberate logout immediately ends offline authorization and requires successful online authentication before local access. |
| `form-field` | Persistent label, value/input, nearby unit/help and inline correction text; web source height 40â€“44px. | Empty/editing/invalid/read-only visibly distinct; invalid text uses error with explanation, preserves value. Required marks and validations only from approved rules. Tablet sizing open. |
| `task-list` | Web compact comparison table; tablet reference/type plus establishment/service, workflow label, separate sync indicator and Ouvrir affordance. | Empty/loading/error use corresponding shared components. Deactivated assignee remains explicitly labeled in team/task context; unfinished task shows Action required with a Responsable reassignment/recovery entry. Distinguish unstarted reassignment, synchronized-draft restart preserving attribution, and protected snapshots requiring resolution. Never imply server possession of tablet-only work or successful unspecified administrative recovery. No example analytics implied. |
| `status-badge` | Compact text plus small dot/icon or pale background. Draft neutral; accepted submission blue; review amber; human conformity explicit text. | Never Audit validÃ©/non validÃ©; both machine outcomes may be completed. Pending submission never styled/labeled accepted. Semantic pale fills unresolved. |
| `sync-status` | Connectivity label, local save acknowledgment/time, per-item transfer/submission state; icon plus text. | Distinguish unsaved, saving, locally saved, offline, sync pending, draft synchronized, submission pending, transferring, accepted, retryable error, conflict and authorization problem. Detailed state copy in EXPERIENCE. Local success cannot visually stand in for server acceptance. Lightweight Saving / Saved locally / Save failed feedback accompanies offline-capable autosave and visible Save; no success dialog per autosave. Draft not yet synchronized is secondary transfer information, not a Pending synchronization lifecycle badge. |
| `audit-sections` | Identity header, test-group navigation/progression and related input/result groups; free revisiting on tablet. | Pending audit locally read-only immediately after explicit submission request; no edit/cancel-to-edit controls, retry available. Display Submission pending synchronization until server acceptance transitions to Submitted. Failure preserves snapshot and read-only state. Non-conflict blockers show Acceptance blocked / NOT accepted and a safely communicated validation problem, with explicit Create correction draft. The new editable draft shows linkage to the preserved rejected attempt; never unlock/overwrite the original. No ordinary correction action on server-accepted evidence. Conflict pauses synchronization and submission retry until explicit resolution under OD-02b; original pending snapshot remains traceable until resolution completes. No employee insight-selection step. |
| `measurement-result` | Measured value and unit, derived numerical result and provenance/context; adjacent individual tolerance/verdict only where approved. | Source-derived regression values may be shown as calculation evidence; CETEM-approved acceptance status is separate. Illustrative Conforme/Non conforme or validation-error structure must not imply approved thresholds. Distinguish unavailable calculation/rule from pass/fail. No fabricated green/red verdicts, zero, N.A. or rounding; exact dependency-state presentation and submission effect gated by DEP-01/02. Overall machine decision elsewhere. |
| `insight-item` | Factual text, source/rule or manual author/date, retention selection; discreet Constat systÃ¨me/manual provenance label. | Selected/discarded and manual additions visible. Zero retained insights valid. No sparkle imagery, confidence score or evidence upload. |
| `summary-editor` | Draft text area, discreet assistance provenance when AI actually used, edit and explicit confirmation controls. | Empty/manual/AI drafting/AI failure/edited/confirmed distinguishable; manual entry remains visible and usable on AI failure. Before official designation show explicit Edit confirmed summary / Reopen summary and its consequences. Reopened summary is visibly Unconfirmed; previous version/confirmation stays historical. Previous conformity is no longer current, dependent report drafts marked Outdated/Superseded. Show no enabled reopen action after official designation. AI/manual origin does not alter these rules. |
| `conformity-decision` | Separate human decision area with exact Machine conforme and Machine non conforme labels, supporting decision actor/date. | Available only after summary confirmation; no preselected/inferred choice. Not visually part of AI editor; both outcomes remain ordinary valid completion paths. |
| `report-panel` | Distinct Word generation and manual PDF upload paths; selected document identity/origin, draft/official label and explicit official designation. | Manual PDF uses Selecting â†’ Uploading â†’ Validating â†’ Security scan â†’ Ready; show **Fichier PDF uniquement** and **Taille maximale : 20 Mo**, reject protected/encrypted/invalid/unsafe files, and keep scan incomplete/failure non-designatable. Ready is not official. Workflow is resolved: inspect either candidate, designate one official report downstream of current summary/conformity, then lock. Drafts become Outdated/Superseded after OD-10 reopening and must be regenerated/replaced; pre-finalization replacement preserves history. Report content/template, signature zones, naming and official-source equivalence remain DEP-03; no signed-scan UI required by PoV. |
| `history-record` | Task/audit identity, completed evidence, insights, confirmed summary, human decision and linked official report; predecessor/replacement relation when applicable. | Read-only for authorized role; correct report download. Show Replacement for Audit X / Replaced by Audit Y as traceability links, not changed business status. Only Responsable sees Create replacement control on server-accepted audit detail/history; EmployÃ© never sees it. New task uses normal creation/assignment layout. Original status/measurements remain unchanged. Keep previous drafts and authors visible when Responsable restarts work for another employee under OD-03; never visually relabel previous measurements as the new employee's work. |
| `alert-message` | Persistent or inline text naming the condition and available correction/retry; icon and semantic text, no color-only signal. | Offline, transfer failure, synchronization conflict, non-conflict Acceptance blocked, account/session restriction and AI/report failure remain distinct. Acceptance blocked offers Create correction draft without requiring Responsable intervention solely for validation rejection. Toast cannot be sole channel for actionable errors. Avoid sensitive payloads/technical jargon. Offline-access expiry and deliberate logout use a blocking online re-authentication surface: explain that preserved work is inaccessible until successful online authentication. Known deactivation shows access denied and preserved work awaiting explicit administrative recovery, not a retry that promises restored access. Do not reveal protected audit content on these blocked surfaces. |
| `confirmation-dialog` | Focused title, consequence, required context and clear action/escape labels. Conflict includes local/server dates. | For deletion and conflict attention, show current server metadata and local context. Conflict actions: keep local as a new synchronized revision/replacement draft, or explicitly discard local and reload server. Explain/confirm discard; retain original pending snapshot until resolution completes. No automatic merge or direct stale server overwrite. Focus behavior must be verified on rendered platform. |
| `loading-state` | Web short-load skeleton preserving structure; localized progress for save/sync/AI/report operations. | Do not block unrelated tablet work without a workflow reason. Busy is not success; exact animation/timing not supplied. |
| `empty-state` | Useful text describing absence plus an authorized relevant next action when one exists. | No assigned tasks, no retained insights and unavailable rule must not be conflated; zero retained insights is valid. No decorative AI illustration. |

Source coverage: Guide Â§Â§3â€“12 and [PRD](../../prds/prd-cetem-qc-2026-09-24/prd.md) Â§Â§4â€“7. All lifecycle gates and proposed recovery interactions belong to EXPERIENCE. The finalized visual reference scope is exactly four references: EmployÃ© responsive phone; EmployÃ© responsive tablet; EmployÃ© offline/save/submission state sequence or annotated state mock; and Responsable review-to-report. Use French user-facing copy. Phone/tablet show one cross-platform React Native EmployÃ© experience; the state reference must distinguish local save, synchronization and server acceptance; the Responsable reference must show AI assistance separate from human conformity and OD-10 outdated-report behavior. Supporting surfaces remain spine/component-only; no additional high-fidelity mocks are required.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Reuse supplied calm palette, compact web hierarchy and touch-adapted tablet groups. | Start a new visual identity, force desktop tables onto tablet or declare compact desktop sizing accessible there. |
| Keep network, durable local save, pending transfer and accepted submission visibly distinct. | Call an offline submission request Soumis/server-accepted; confuse the pending local read-only restriction with accepted immutability, or silently unlock it after failure. |
| Show numerical calculations only from defined rules and verdicts only with approved comparisons. | Infer tolerances, N.A., missing inputs, display rounding or overall conformity. |
| Present human summary confirmation, human conformity and official designation as distinct milestones. | Reintroduce employee-work validation/rejection states, buttons, report fields or events. |
| Keep manual summary entry first-class and zero-insight completion valid. | Require AI success or a fabricated insight to proceed. |
| Preserve errors/data visibly and accompany color with text. | Hide actionable failures in toasts, silently overwrite conflict versions or discard local work on logout. |
| Keep Phase 1 in-app assignments, Graphie Mobile only, generated Word/manual PDF and read-only authorized history. | Add actual email delivery, full administration, equipment inventory, evidence uploads or signed-scan workflows. |
| Carry OD and DEP gates into review, mockups and implementation. | Treat source visual examples as business approval or invent final token/device/policy defaults. |

For architecture handoff, carry the external dependencies and validation checks recorded in EXPERIENCE and DECISIONS. Verify every token reference, component parity, rendered contrast/readability/focus/touch behavior and required state appearance during implementation and acceptance; these checks do not reopen the finalized product/UX decisions.



