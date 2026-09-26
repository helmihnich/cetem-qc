# Existing UX and technology source extraction

Extracted 2026-09-25 directly from DOCX `word/document.xml` paragraphs using .NET ZIP/XML. This is a source inventory, not a finalized UX specification.

## Authority

1. User instructions for this UX run and finalized `_bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md` govern scope and conflicts.
2. `docs/product/Guide_Design_UI_UX_CETEM_BH.docx` supplies useful visual and interaction decisions.
3. `docs/product/Choix_de_la_Stack_Technologique_et_Benchmarking.docx` supplies platform separation and technical direction.
4. PRD `addendum.md` corroborates normalized source interpretation.

## Reusable visual decisions — Guide §§1–2, 10–13

Calm, light, professional operational software; readable, compact, traceable and touch-adapted. White/light-grey grounds, thin borders and spacing rather than strong shadows. One primary accent plus semantic colors. Avoid gradients, neon, glow, glassmorphism, futuristic illustrations, oversized decorative cards, decorative animation, chat-first workflows and AI branding.

| Token | Source value |
|---|---|
| App background | #F7F8FA |
| Surface | #FFFFFF |
| Main text | #1F2933 |
| Secondary text | #667085 |
| Border | #E4E7EC |
| Primary, link, focus | #2563EB |
| Primary hover | #1D4ED8 |
| Success | #15803D |
| Warning | #B45309 |
| Error | #B42318 |
| Information | #0369A1 |

Inter recommended; Geist or IBM Plex Sans alternatives. Indicative hierarchy: page 24px/600, section 18px/600, card 15–16px/600, body 14px/400, table 13–14px/400–500, metadata 12–13px/400. Avoid 40–60px dashboard headings. Radii about 6–10px; 1px light-grey borders; low/no shadows except floating menus/dialogs; spacing 4/8px grid, 16–24px between functional groups. Source recommendations are not verified contrast compliance or approved tablet readability thresholds.

Components: blue primary button with white text and one dominant action per functional area; white/grey-border secondary; red reserved for genuinely destructive/critical refusal actions. White card, 1px border, 8px radius, little/no shadow. Compact badge, pale semantic background, darker text. Web input 40–44px high; larger touch areas on tablet, exact target dimensions unspecified. Dialogs for meaningful confirmations/conflicts/attention. Toasts only for brief acknowledgement, never sole actionable-error channel. Useful empty states plus action, no AI illustration. Skeletons for short web loading rather than full-screen spinner.

Never encode verdict/state only in color. Persistent field labels; visible web keyboard focus; readable tablet errors without zoom, generous spacing; explain corrections and preserve entered data. Shared vocabulary, tokens, statuses, icons and business rules; platform-specific presentation.

## Responsable web — Guide §§3, 6, 8–9, 14

Stable left sidebar and light top bar; clear current section. Business labels rather than AI terminology. Source examples of dashboard, equipment, settings and analytics are not feature authorization. PRD-authorized work is team/account management, tasks and assignment, submitted audit review, insights, summary, human conformity, report and history.

Task table: task ID, type, establishment, assignee, state, latest update; compact/scannable and comfortable rows, aligned numbers/dates, short state column, secondary actions in overflow. Six to eight visible columns at most is source advice; details belong in detail view. Search/filter only for actual volume needs. Dashboard source's 3–4 counters and sample values are illustrative, not required features.

Creation: grouped aligned fields rather than a card per input. Graphie Mobile executable; Graphie fixe visible disabled; Scopie unavailable (PRD supersedes generic source option visibility). Establishment and service free text, active own-team employee selector. Establishment required; unresolved requirements remain DEP-01. Source optional instructions field is not independently authorized by PRD. Secondary Annuler and primary Créer la tâche bottom-right, inline understandable errors.

Review header: audit/equipment/establishment/employee identity, status, latest update. Source proposed tabs: overview, measurements, insights/summary, report, history; grouping remains adaptable. Submitted measures/comments read-only. Display measured/calculated values, units, and only approved applicable tolerances/verdicts. Show factual insight source/provenance, retained/discarded state and manual insight. Discreet Constat système or Suggestion labels; summary may use Généré avec assistance IA. Source temperature example is illustrative and must not become a Graphie Mobile test.

Summary drafting/editing/explicit confirmation precedes separate human Machine conforme / Machine non conforme. AI component must not appear to decide conformity. Zero retained insights valid. AI retry/manual summary entry both allow completion. Report screen has Word generation and manual PDF upload; distinguish draft availability from official designation. Completed history read-only, correct official report downloadable by authorized user. Classic printable report appearance; detailed source report sections are candidates pending approved DEP-03 template, not requirements in themselves.

## Employé tablet — Guide §7, 11–14

Mes tâches: reference/type, establishment/service, compact workflow badge, separate sync icon plus text (synchronized/pending/error); Ouvrir or touchable row. Fixed Graphie Mobile form grouped by tests; visible progression without rigid wizard, revisit sections. Large inputs and well-separated targets. Unit, applicable tolerance and help close to field. Derived calculations and individual feedback available immediately/offline only where PRD authorizes rules. No invented thresholds, boundary rules, rounding or missing inputs.

Clear local draft save and visible synchronization status. Source offline banner: Hors ligne — les modifications sont enregistrées sur cet appareil. Wording must reflect a successful local save rather than falsely assure unsaved/failed data is already durable. Restore saved data after normal app/tablet restart. Reconnection shows per-item progress without needless blocking. Distinguish network state, local durability, transfer state and authoritative submission.

Required distinct conditions from PRD: editing/unsaved; locally saved draft; offline; pending draft synchronization; requested submission pending synchronization/server acceptance; successful authoritative submission; transfer failure retry; divergent-version conflict. Saved draft remains editable before submission except exact queued edit/cancel behavior is OD-02. Offline request is not a submitted audit; immutability begins only at successful server acceptance. Local data preserved until acceptance. Transfer retry cannot duplicate submission or lose local data.

Conflicts: preserve local and server versions, show dates/times of both, explain mismatch without jargon, halt affected synchronization until reload/reconciliation. Source suggests attention dialog; exact actions, recovery and pending-submission edit/cancel choices must be decided under OD-02, no auto field merge. Never silently overwrite. Employé has no insight selection/review workflow.

Source priority screens: login/activation, own tasks, task detail, test form, draft, pre-submission review, synchronization status, authorized history. Different screens may be areas/states, not necessarily separate routes.

## Superseded or nonbinding source material

- Remove Guide §3/5/9 audit validation/nonvalidation/rejection decisions, statuses, report fields and any work-approval event. Human conformity is separate from summary confirmation and can be nonconforming while completing normally.
- Source linear sequence beginning Machine does not authorize machine-management inventory or pre-task machine workflow.
- Source says measures/comments freeze after submission: interpret submission strictly as server acceptance, never button press/offline queue.
- Benchmark says AI is later: superseded by Phase 1 AI-assisted summary with manual fallback.
- Benchmark calls first version production: user/PRD Phase 1 PoV prevails; no production commitments.
- Examples of admin/settings/equipment screens, camera, notifications, attachments or benchmark future infrastructure do not expand PoV.
- No real assignment email delivery; in-app task visibility only. Credential delivery is still OD-09, do not imply invitation email.
- No signed-scan reintegration, electronic signature, arbitrary evidence upload, automatic PDF generation, machine conformity automation, cross-device collaborative editing or automatic merging.

## Platform direction — technology benchmark §§1–6, 8–10

Next.js/React/TypeScript Responsable web; React Native/TypeScript Employé tablet; Node.js/TypeScript API. Express initial API and Expo recommended, not new UX requirements. Share contracts, schema, calculation rules, terminology, API clients and conventions; retain separate visual components appropriate to desktop/tablet. Source does not establish PWA as replacement. Device/OS/browser validation matrix remains OD-05. No selected local persistence/sync implementation, AI provider or deployment stack. UX should specify outcomes rather than invent those choices. Technical performance/benchmark claims were not independently verified; no web research needed for this source inventory.

## Input and dependency register to carry forward

| PRD ID | User/business/security input still needed; UX consequence |
|---|---|
| OD-01 | Offline authentication/session duration and expiry/logout local-draft access/recovery. No invented timers or deletion. Security preservation already binding. |
| OD-02 | Pending-submission editing/cancellation and exact conflict reload/reconciliation controls. Core immediate UX question; do not silently freeze queued work as authoritative immutability. |
| OD-03 | Reassignment after deactivation; who initiates linked replacement audit and detailed linkage workflow. Preserve original and unfinished visibility, no invented transfer action. |
| OD-04 | PDF size/security handling. Do not invent size limits/scanning results. |
| OD-05 | Tablet devices/OS/orientation/browser matrix, test conditions and named acceptance authority. Existing guide does not fix these. |
| OD-06 | Proposed performance/compatibility targets need confirmation or explicit deferral. |
| OD-08 | Initial Responsable/team provisioning, no expanded administration UI. |
| OD-09 | Initial temporary credential handover; email integration not implied. |
| OD-10 | Summary change after confirmation and downstream decision/report effect. Do not invent reopening/reconfirmation/invalidation policy. |
| DEP-01 | Approved control/field catalogue, four-page reference, required flags, units/formats, tolerances/boundaries/comparisons, rounding/N.A., missing kVmax/K2 and insight rules. Existing formulas support calculations only; undefined verdict cannot be guessed. |
| DEP-02 | Approved normal/abnormal/invalid/boundary reference cases; calculations/verdicts cannot be declared accepted prematurely. |
| DEP-03 | Approved Word template, required content/provenance/signature fields and PDF expectations. Existing visual guide report layout not approved template. |

Visual direction can be reused without asking the user to redesign it. Exact tablet ergonomics depend on OD-05. Language localization, autosave trigger policy and any navigation additions are not fixed by these sources; distinguish design proposals from confirmed business rules. Keep finalization blocked on unresolved UX decisions that require user choice while allowing explicitly deferred/external dependencies to remain visible.
