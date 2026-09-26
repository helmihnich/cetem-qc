# Authoritative PRD UX extract

Source: [`prd.md`](../../../prds/prd-cetem-qc-2026-09-24/prd.md), final, updated 2026-09-25. Section references below identify authoritative passages. Extraction only; no new decisions. The PRD and current user instructions override conflicting older material. Its addendum and older product documents do not independently authorize features.

## Scope and authority (§§1–3)

Phase 1 demonstrates Graphie Mobile from employee creation/assignment to official report; it is a PoV, not production. Separate **Responsable web** (manage employees/tasks; inspect submitted evidence; insights; summary; human conformity; report/history) and **Employé tablet** (own assignments; fixed touch form; offline entry/save/calculations; reliable submission; authorized read-only history). PRD gives role names, no named human protagonists; do not invent real identities.

Included: minimal account lifecycle, assigned tasks, fixed form, offline work, synchronization, server-accepted submission, deterministic post-submission insights, assistance-only AI drafting with manual fallback, explicit summary confirmation, separate human machine conformity, generated Word OR uploaded manual PDF with exactly one official report, authorized history and linked replacement audits.

Excluded: executable Graphie fixe, Scopie, generic form builder, establishment database, full identity administration/SSO, paper migration, collaborative multi-device editing/automatic field merge, automatic overall conformity, advanced AI/offline AI, automatic PDF generation, real email task notifications, general evidence attachments, electronic signature/signed-scan reintegration, and **all employee-work approval/rejection**. Graphie fixe must appear disabled; Scopie unavailable (FR-008). In-app assigned-task visibility replaces real email delivery (FR-015).

## Exact journeys (§4)

1. **UJ-1 — Assigned field control to official report.** Create employee/account activation and password replacement → assigned task → tablet data/calculations where authorized → accepted submission freezes measurements/comments → Responsable evidence/insights → AI draft or manual summary, edit/confirm → distinct human machine decision → Word/manual PDF → official designation completes; handwritten signing later.
2. **UJ-2 — Network interruption.** Previously synchronized task remains fully usable offline; saved work survives restart; offline submission visibly pending; retry without loss/duplication; conflict preserves local draft, warns, and blocks synchronization pending reload/reconciliation.
3. **UJ-3 — Normal and nonconforming outcomes.** Zero retained insights is valid. Failed individual tests are evidence, not automatic machine verdict. Both Machine conforme and Machine non conforme are normal completion outcomes.
4. **UJ-4 — AI unavailable.** Retry or enter summary manually; same explicit confirmation; AI availability never blocks completion.
5. **UJ-5 — Material submitted error or employee deactivation.** New independent linked audit for material measurement error; preserve original. Deactivation prevents new login/work/authorized synchronization but preserves history and unfinished task visibility. Detailed handling remains open.

Required order: assignment → draft → pending synchronization when necessary → **server-accepted submission** → review/insights → confirmed summary → human machine decision → official report/completed. Milestones do not prescribe a complete state enum or resolve open transitions.

## Screen/behavior requirements by role (§5)

### Shared authentication and employee onboarding (FR-001–006; SEC-001–003/012)

Email/password, role space, generic invalid-credential refusal; inactive login refused. Responsable sees only own-team first name/surname/email/active state; creates required names and valid unique email; activation-only temporary credential forces replacement before tasks, then becomes unusable. Handover unresolved OD-09. Active/inactive control preserves tasks/history; disconnected tablet cannot immediately know deactivation. No shared accounts or cross-team disclosures.

### Responsable tasks (FR-006–011/015)

Task creation: unique ID/creator/date/initial draft; Graphie Mobile only executable; establishment required free text, service free text (other required rules unresolved); must assign active own-team employee, never self. Task list: ID, type, establishment, assignee, state, last update. Multiple active tasks per employee. No email-delivery UI or implied send confirmation.

### Employé tablet (FR-016–024/042; NFR-001/002/008)

Only own assigned tasks; no employee-created unassigned controls. Fixed test-organized touch form, not mandatory paper replica. Approved intervention/equipment/instrument metadata, qualitative checks, measurements/comments, units/validation await field catalogue. Before submission draft save/resume/edit and confirmed explicit deletion. All sections of already synchronized tasks work and save in airplane mode; authorized numerical calculations available offline. Save survives normal app/tablet restart; no mandatory zoom or inaccessible touch controls.

### Responsable evidence and insight review (FR-012/013/025–031)

Own-team synchronized results; accepted measurements/comments/calculated results read-only; review access logged, **not an approval event**. Show measured values, authorized derived values, and only approved tolerances/verdicts. Deterministic factual insight proposals only after submission and only from explicitly defined rules; provenance visible. Select/discard with actor/date/audit-version trace, zero selections valid. Add manual insight text with author/date and optional justification; no general attachments. Manage insights and summary before confirmation without editing submitted evidence.

### Summary and human decision (FR-032/033/038)

AI only on Responsable request, grounded only in audit data and retained insights; preserve actual input/requester/date/model provenance and initial generated draft. Edit and explicitly confirm. Always allow manual-only entry without fictitious AI metadata; failure retry/manual fallback. Zero retained insights does not block confirmation. **Only after confirmation**, explicit separate choice **Machine conforme** / **Machine non conforme**. Do not preselect/infer from calculations or AI. Post-confirmation summary changes unresolved OD-10.

### Report and history (FR-014/034–036/040/041)

After confirmed summary + human decision, generate Word OR upload manual PDF (reject non-PDF; exact size/security open). May regenerate draft Word or replace draft PDF **before designation**. Exactly one official report, origin/metadata/audit linkage preserved; official designation completes and freezes completed control/report for either conformity outcome. No signature gate, electronic signature or signed-scan upload. Generated Word printable with approved handwritten-signature zones, template pending DEP-03. Minimum traceability: task/audit, Responsable, machine decision, finalization date; don't force all internal provenance into report or invent PDF content checking. Authorized Responsable/Employé history shows completed data/insights/confirmed summary/decision/report read-only; download correct linked official report. Preserve originals and explicit predecessor linkage when replaced. Completed official report cannot be replaced in-place.

## Offline state distinctions and unresolved transitions (§§3–7,9)

| User-visible concept | Authoritative boundary | Open UX detail |
|---|---|---|
| Offline connectivity | All field sections of previously synchronized task remain available; approved calculations local | Offline authentication/session duration OD-01 |
| Locally saved draft | Durable saved work, editable pre-submission; distinguish from server submission | Save invocation/autosave policy not mandated; performance targets proposed only |
| Draft pending synchronization | Saved local work not yet synchronized; per-item status visible | Specific status vocabulary/layout |
| Submission pending synchronization | A queued request, **not submitted**, no authoritative immutability yet | Local edit/cancel while pending explicitly OD-02; do not silently freeze or allow mutable queued payload |
| Transfer failure/retry | Preserve local data until acceptance; no loss/duplication | Retry presentation; don't invent terminal disposal behavior |
| Successful server acceptance | Server blocking validations passed; actor/date retained; results exposed to Responsable; measurements/comments now immutable | Distinct acknowledged UI feedback |
| Version conflict | Preserve local draft and both versions, warn, stop sync until reload/reconciliation; no overwrite/automatic field merge | Exact safe compare/reload/reconciliation workflow OD-02 |
| Logout/expiry/deactivation | No unauthorized future server work; local unsynchronized data never silently deleted, secure retention | Offline access, secure recovery and duration OD-01; deactivated unfinished-task handling OD-03 |

Only one tablet actively edits an audit. Local save, synchronized draft and accepted submission must remain visibly distinct. A failed server validation is not acceptance; present correctable approved-field feedback while preserving local data. Do not rename conformity or acceptance as employee-work validation/rejection.

## Calculation and rule constraints (§5.3; DEP-01/02)

Included test families: voltage accuracy, voltage repeatability, Kerma reproducibility, linearity, beam geometry. Explicit supplied workbook formulas authorize numerical calculations only; preserve signed deviations, fixed divisors and dependencies. No invented inputs, rounding, N.A., thresholds or missing rules. Display formats do not establish rounding policy. Individual pass/fail requires formula **and established threshold, boundary semantics, comparison rule**; workbook provides no explicit tolerance verdict rules. Therefore do not show inferred green/red pass/fail badges. Overall conformity always human. Workbook repeated-kV extrema are literals; initial linearity mean O42 blank makes Q40 #DIV/0!; no inferred replacement. Source extraction is not CETEM approval. Approved reference cases needed before calculation/verdict acceptance claims.

## Explicit unresolved decisions to carry forward (§9)

| ID | User/owner input needed | UX consequence |
|---|---|---|
| OD-01 | Offline authentication duration, session expiry, logout/recovery of unsynchronized drafts (security + UX) | Can't finalize offline access/logout/expired session flows or timing |
| OD-02 | Conflict reload/reconciliation and pending submission edit/cancel (workflow/UX + architecture) | Can't silently choose queued-data or conflict recovery controls |
| OD-03 | Deactivated employee unfinished-task handling/reassignment and replacement audit initiation/linkage (business + workflow) | Can't assume reassignment mechanism, initiator or copy-forward behavior |
| OD-04 | Maximum PDF size and safe upload/scanning policy (business + security) | Upload limits/security validation copy remains parameterized |
| OD-05 | Tablet OS/devices/browser matrix, test conditions, named acceptance authority | Layout/device verification and acceptance not settled |
| OD-06 | Approve/revise/defer proposed NFR-003–006 | No binding <3s p95 screens, <1s saves, <30s 95% report generation, last-two-browser promise |
| OD-07 | Resolved: in-app tasks, email deferred | Do not reopen or design Phase 1 email delivery |
| OD-08 | Initial Responsable/team provisioning | Environment dependency; no expanded admin UI |
| OD-09 | Temporary credential handover | No assumed invitation/email integration |
| OD-10 | Summary changes after confirmation and effect on decision/report | No assumed reopen, rollback or invalidation mechanism |

## External dependencies (§10)

- **DEP-01:** remaining approved fields/control catalogue/four-page reference; mandatory/optional fields, units/formats, thresholds/boundaries/comparisons, rounding, N.A., kVmax/K2 and insight rules. Gating affected form validation, calculation/tolerance/insight presentation and submission acceptance. Supplied workbook formulas partially resolve numerical definitions only.
- **DEP-02:** CETEM-approved expected normal/abnormal/invalid/boundary numerical/verdict reference cases. Workbook examples don't close it. Gating rule acceptance, not permission to invent expected values.
- **DEP-03:** approved Word template, required content/provenance/signature fields and manual-PDF expectations. Minimum known linkage applies; final report fidelity remains gated.
- AI provider/model/security configuration: architecture decisions constrained by authorized input/traceability/manual fallback, not a UX vendor choice.

## UX validation consequences (§8)

Demonstrate both report paths and machine decisions; offline entry/save/restart/reconnect/retry/conflict without loss/duplication; pre/post acceptance immutability boundary; manual summary after AI failure; zero-insight completion; linked replacements; deactivation preservation; authorization boundaries. CR-01–07 exist; CR-14 absent. CR-11 ~15-minute prepared demo is intended, not hard approved gate. Counter-metrics: speed cannot justify data loss, fabricated insights, skipped checks/human gates/report path. AI usage and insight count are not success targets. Required/invalid/boundary tests await approved rules rather than invented criteria.

## Questions most material before UX finalization

1. Which pending-submission edit/cancel and conflict reconciliation experience should be adopted, with architecture constraints respected (OD-02)?
2. What secure offline expiry/logout/recovery policy and supported tablet environment can be authorized (OD-01/05)?
3. Who initiates replacement audits and how should unfinished tasks after deactivation be handled (OD-03)?
4. How are initial credentials handed over without implied email integration (OD-09)?
5. What happens if confirmed summary text needs correction before official completion (OD-10)?
6. Existing visual decisions should be reused; PRD itself does not choose brand tokens, named protagonists, save automation or a UI component system. User endorsement/supporting evidence needed, not invented final defaults.
