# PRD addendum — source-backed technology and UX direction

This addendum preserves technical and interface detail from the supplied technology benchmark and UI/UX guide. It does not add product features or constitute a new architecture decision. User-confirmed Phase 1 decisions override older source wording. Technology claims below describe the supplied source; no external benchmark verification was performed.

## Technology direction

The technology document explicitly selects TypeScript across the product, Next.js/React for the Responsable web interface, React Native for the employee mobile/tablet application and Node.js for the backend REST API. The UX guide repeats this platform direction. The rationale is a small team's delivery speed, shared skills, understandable code and later evolution. The PoV deliverables' generic wording about a responsive web application does not establish a replacement PWA architecture; the actual demonstration device/OS/client setup remains to be confirmed.

The document recommends Express for the initial API, Expo unless a concrete native SDK requires another workflow, pnpm workspaces, Zod or equivalent validation, OpenAPI/shared or generated TypeScript types, and unit/integration/component testing within the TypeScript ecosystem. These are source recommendations for architecture to carry forward or explicitly revisit, not invented functional requirements. No database engine, hosting provider, object-storage provider, offline persistence technology, synchronization protocol or AI model/provider is selected by these sources.

Suggested repository shape is `apps/web`, `apps/mobile`, `apps/api`, with shared type/schema/API-client/config packages. Share domain contracts, validation, calculation rules, API clients and conventions; retain platform-specific presentation. A lightweight monorepo is suggested, not a demand for complex build orchestration.

Source implementation guidance includes strict TypeScript, server-side authentication/authorization, validation at API boundaries, centralized error handling, modular services/repositories where justified, object storage for uploaded reports, and CI checks for types/lint/tests/builds. Offline local calculations must match approved server rules; the selected architecture must support the user-confirmed preservation, synchronization, conflict and submission semantics.

AI summary generation is required in this PoV despite the technology document's obsolete “later” wording. Its suggested service boundary remains useful: keep provider-specific generation replaceable, use bounded asynchronous calls and failure handling, and allow the Responsable's manual summary to complete the workflow. Queues, workers, horizontal replication, read replicas and expanded production operations are future scaling options, not PoV deliverables.

Source risks to retain in architecture decisions: uncontrolled dependency upgrades; Next.js client/server and caching complexity; React Native library/device compatibility; CPU-intensive work blocking API request processing; excessive presentation sharing; unnecessary monorepo complexity. The benchmark scores are subjective project-weighted assessments, not empirical capacity guarantees or PoV acceptance thresholds. Its reference to “first production version” does not change the user's PoV-only objective.

## Visual direction

Use a light, professional, calm interface organized around tasks, audits, measurements, insights, human review and reports. AI is a secondary writing aid. Avoid decorative gradients, neon/glow, oversized decorative cards, marketing-size headings, chat as the primary workflow and unexplained confidence scores.

The supplied palette recommends background `#F7F8FA`, surfaces `#FFFFFF`, main text `#1F2933`, secondary text `#667085`, borders `#E4E7EC`, primary/focus `#2563EB` (hover `#1D4ED8`), success `#15803D`, warning `#B45309`, error `#B42318`, information `#0369A1`. These are design recommendations, not approved contrast-test results.

Inter is recommended, with Geist or IBM Plex Sans alternatives. Indicative sizes are 24px page titles, 18px section titles, 15–16px card titles, 14px body, 13–14px tables and 12–13px metadata. Use thin borders, approximately 6–10px radii, restrained shadows and a 4/8px spacing grid with 16–24px between functional groups. Detailed responsive/accessibility sizing belongs in UX specifications.

## Calculation and decision boundaries

Numerical calculations and individual verdicts have separate prerequisites: explicitly defined formulas authorize automatic numerical calculations only. Individual tolerance/pass-fail results additionally require an explicitly established CETEM BH acceptance threshold, boundary semantics and comparison rule for the applicable formula. The source extraction does not supply those missing rules or imply CETEM BH approval of the derived Markdown. Final machine conformity remains a human decision by the Responsable.

## Responsable web experience

The source favors stable left navigation and a light top bar, dense readable tables and a clear active section. Navigation labels remain business terms. Proposed navigation/dashboard examples must not be interpreted as authorization for new equipment-management, settings, analytics or administration modules beyond existing requirements.

Task lists should expose relevant task reference, type, establishment, employee, state and update time. Task creation groups related fields; institution/service remain free text, available control is Graphie Mobile, employee selection is limited to active team members, and errors appear next to fields in understandable language. Avoid unnecessary search/filter or dashboard expansion merely because examples appear in the design guide.

Audit review presents audit/equipment/institution/employee identity and state, read-only submitted measures/comments, calculated values, applicable tolerance and individual verdict. Insights show factual source/provenance, retained/discarded state and manual additions. Summary has editable draft and explicit human confirmation. The subsequent human machine-conformity action must remain visibly separate from AI assistance. The old “validate/reject audit” buttons, statuses and report fields in the guide are removed.

The report view supports Word generation or manual PDF upload and official designation. It must clearly distinguish available draft report from official final report. History is readable without modifying completed controls. No signed scan or general evidence-attachment UI belongs in Phase 1.

## Employee tablet experience

“My tasks” shows reference/type, establishment/service, compact workflow state and a synchronization indicator using icon plus text. Form sections follow tests rather than reproducing paper layout. Allow movement between sections where field work requires it; a rigid wizard is not prescribed. Use generous touch targets and clearly group inputs, units, tolerances, help, calculated results and individual verdicts.

Make local saving and synchronization status visible. The source's offline message explains that changes are stored on this device. Distinguish local draft, submission requested/pending synchronization, synchronization failure/conflict and authoritative submitted state; do not show offline submission request as final server submission. Preserve entered data when showing errors.

Conflict presentation should identify divergent versions with their timestamps and explain the required reload/reconciliation without technical jargon. The user-confirmed PoV does not provide automatic field merging. Do not introduce the employee's insight-review/selection workflow: deterministic proposals are for the Responsable after accepted submission.

## Feedback, accessibility and reusable components

Use a text label with a small badge/point for state; never convey conformity or errors through color alone. Use one dominant action per functional area, restrained secondary actions and clear inline errors. Transient toasts cannot be the sole place to show an error requiring action. Reserve dialogs for conflicts, meaningful confirmation and decisions requiring attention.

Persistent field labels, sufficient contrast, visible web keyboard focus, usable tablet touch areas and readable messages without zoom are source-backed usability expectations. Share terminology, status meanings, design tokens and business rules across platforms without forcing identical components. Web favors tables; tablet favors field-entry progression and continuity offline. Exact touch dimensions, formal accessibility target and device matrix are not supplied as approved acceptance values.

## Source corrections and unresolved details

- Remove all obsolete work-approval/rejection states and fields; summary confirmation, human conformity and report designation remain distinct.
- Do not promote the guide's illustrative temperature example into a Graphie Mobile test or requirement.
- Do not promote dashboard sample numbers, optional navigation entries or hypothetical camera/native capabilities into functionality.
- Keep exact report template/mandatory provenance/signature fields and PDF upload limit unresolved. The guide's example report sections are useful input for the approved template, not the missing approval itself.
- Notification scope is resolved by the user: Phase 1 requires in-app task visibility; real email assignment notifications are deferred beyond the PoV. Do not implement or test email delivery in Phase 1. Architecture must permit adding notification channels later without building them now.
- The PoV's device/OS/browser/client validation configuration and security policy for offline duration/logout remain open. Secure draft preservation and no silent loss are already required.

Sources: `docs/product/Choix_de_la_Stack_Technologique_et_Benchmarking.docx` and `docs/product/Guide_Design_UI_UX_CETEM_BH.docx` as represented by their complete extracted text in this PRD's `source-analysis` directory; user Phase 1 clarification and eleven supplied decisions take precedence.
