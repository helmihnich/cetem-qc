---
title: CETEM-BH Graphie Mobile — Phase 1 PoV PRD
status: final
created: 2026-09-24
updated: 2026-09-25
project: cetem-qc
readiness: Scope defined; specified business references and security decisions remain open
---

# CETEM-BH Graphie Mobile — Phase 1 PoV

## 1. Purpose and authority

Phase 1 demonstrates the complete Graphie Mobile control workflow, from employee account creation and task assignment to an official report. This is a Proof of Value (PoV), not a production launch. Architecture should permit later operational evolution without adding future functionality to this scope.

This PRD is for the CETEM-BH business representative and the UX, architecture, implementation and validation teams. It consolidates the seven documents in `docs/product` using the user's explicit scope and eleven clarification answers recorded on 2026-09-24. Those answers override conflicting source passages. The workbook `docs/product/CALCUL_graphie_01.xls` was supplied by CETEM BH and provides the explicitly defined formulas preserved in the derived source extraction. The derived Markdown specification does not imply CETEM BH review or approval. Technical recommendations and detailed visual guidance are preserved in [addendum.md](addendum.md).

**Readiness limitation:** explicitly defined workbook formulas authorize automatic numerical calculations under FR-025/026. The Product Owner has resolved DEP-01 for PoV form structure by deciding to use a project-defined, versioned Graphie Mobile catalogue based on the CETEM BH source workbook plus recognized IAEA/AAPM diagnostic-radiography QC guidance. This catalogue is not a CETEM BH-approved field catalogue. Unresolved business rules, calculation acceptance and report behavior remain gated by DEP-01R/DEP-02/DEP-03 as described in §10. Individual verdicts require an established acceptance threshold, boundary semantics and comparison rule. Security and configuration choices in section 9 remain unresolved; do not choose defaults silently.

### Requirement classification

- **C — Confirmed:** stated in the source as confirmed or explicitly confirmed by the user. User overrides are incorporated into the wording below.
- **D — Derived:** supporting requirements identified as derived in the SRS, or necessary acceptance consequences of confirmed behavior. They do not authorize additional product functionality.
- **P — Proposed:** draft validation/security targets awaiting confirmation; not binding acceptance thresholds.
- **Open decisions (§9):** business, security or configuration choices that remain unresolved.
- **Reference dependencies (§10):** external approved material needed to define or verify requirements.

Existing SRS identifiers are retained. FR-037 and FR-039 do not occur in the supplied SRS and are not filled in. The source uses SEC-011 twice; descriptive labels distinguish the security-events and AI-control requirements without renumbering them. User-confirmed additions are grouped with the relevant existing IDs and explicitly attributed where necessary.

## 2. Vision, users and boundaries

CETEM-BH currently records controls on paper and performs manual calculations or re-entry. The PoV should show that an Employé can perform the field control on a tablet, including without network access, and that a Responsable can turn the submitted evidence into a traceable official report. Calculations and factual insight proposals assist the work; the Responsable retains authority over the summary and final machine-conformity decision.

The **Responsable** needs to manage employees, assign controls, review submitted results, select/add insights, confirm a summary, decide machine conformity and finalize the report. The **Employé** needs to receive assigned work, enter and preserve field data, see calculated values and individual tolerance results, submit reliably and consult authorized history. A CETEM-BH business owner or Responsable-side representative evaluates the demonstration; the named acceptance authority is still open.

### In scope

Graphie Mobile only; minimal employee account lifecycle; Responsable-created and assigned tasks; a fixed tablet form; offline entry, saving and required calculations; synchronization and server-accepted submission; deterministic insight proposals after submission; constrained AI summary generation with manual fallback; human summary confirmation; separate human machine-conformity decision; generated Word or uploaded manual PDF; one official report; authorized read-only history and traceable replacement audits.

### Non-goals

Graphie fixe execution, Scopie, a generic form builder, an establishment reference database, complete identity administration or SSO, historical-paper migration, collaborative multi-device editing, automatic field-level merging, automatic overall machine-conformity decisions, advanced AI beyond summary drafting, automatic PDF generation, real email assignment notification delivery, general audit/insight evidence attachments, electronic signatures and signed-scan reintegration are outside Phase 1. A separate approval/rejection of employee work is removed from the workflow entirely. Production availability commitments and comprehensive production operations are not PoV acceptance promises; required authentication, secure storage, authorization and data preservation still apply.

## 3. Glossary and relationships

| Term | Meaning |
|---|---|
| Task | Responsable-created work assigned to one Employé who is active at assignment time and belongs to the Responsable's team; identifies the Graphie Mobile intervention. Multiple active tasks per Employé are allowed; later deactivation does not delete them. |
| Audit | The control record associated with a task: equipment and instrument information, qualitative checks, measurements, comments and calculated results. A replacement is a separate audit linked to its predecessor and task. |
| Draft | Locally or centrally saved audit data before authoritative server submission. |
| Pending synchronization | Local work, including an offline submission request, that has not yet been accepted by the server. It is not an authoritative submitted audit. |
| Submitted audit | Server-accepted audit version whose measurements and submitted comments are immutable. |
| Individual tolerance result | Result of applying an approved rule to an individual test. It is not the overall machine-conformity decision. |
| Deterministic insight | Factual observation generated by an explicitly defined rule from submitted audit data; retains its source and rule provenance. |
| Manual insight | Responsable-authored observation added during review, with author/date provenance. |
| Confirmed summary | Summary explicitly confirmed by the Responsable, whether AI-assisted and edited or written manually. |
| Machine-conformity decision | Separate human decision by the Responsable: Machine conforme or Machine non conforme. Either outcome can lead to completion. |
| Official report | The single generated Word or uploaded manual PDF designated as official for the completed control. Its origin and audit linkage are retained. |

These are domain concepts, not a prescribed database schema. Draft audits need not already have a summary or report. Zero retained insights is valid; a manual summary need not have an AI draft or model metadata.

## 4. User journeys and lifecycle

These journeys structure the user's supplied sequence and source workflows; they do not introduce invented personas or additional functions.

**UJ-1 — Assigned field control to official report.** The Responsable creates an employee account and assigns a Graphie Mobile task. The Employé activates the account, opens the assigned task on the tablet, enters the control data and checks calculated values and individual tolerance results where authorized under FR-025/026; unresolved rules remain DEP-01/02. Successful server submission freezes the measurements and comments. The Responsable reviews them, selects/adds insights, requests an AI draft, edits and confirms the summary, then makes the separate machine-conformity decision. The Responsable generates Word or uploads a manually produced PDF and designates the official report. This completes the software workflow; handwritten signing happens afterward.

**UJ-2 — Network interruption.** On a previously synchronized task, the Employé continues entering and saving data offline and sees calculations and tolerance feedback where authorized under FR-025/026; unresolved rules remain DEP-01/02. Saved work survives normal application/tablet restart. An offline submission request remains visibly pending until server acceptance. A failed transfer can be retried without loss or duplication. A version conflict preserves the local draft, warns the user and stops further synchronization pending reload/reconciliation.

**UJ-3 — Normal and nonconforming outcomes.** An all-normal audit may have zero selected/added insights; no artificial insight is required. An audit with failed individual tests is reviewed on its evidence. The Responsable confirms the summary and makes the overall machine decision; Machine non conforme is a normal completion outcome, not a rejection of employee work.

**UJ-4 — AI unavailable.** The Responsable can retry failed generation or write the summary manually. Manual text requires the same explicit confirmation before machine decision and report finalization. AI availability never blocks completion.

**UJ-5 — Material submitted error or employee deactivation.** A material measurement error requires a new, independently recorded audit linked to the original; the original remains preserved. Deactivation prevents new login/work and authorized server synchronization, while tasks/history remain. Unfinished tasks remain visible to the Responsable; exact reassignment handling is deferred to workflow design.

The required order is: assigned task → field draft → pending synchronization when necessary → server-accepted submission → Responsable review/insights → confirmed summary → human machine decision → official report/completed control. These are behavioral milestones, not a mandatory UI-state enumeration. There is no employee-work approval event. Pre-acceptance editability, recovery UX and other unsettled transitions are governed by §9, not implied by this sequence.

## 5. Functional requirements

Each row defines the required observable behavior; referenced open decisions limit only the unresolved portion. C/D labels preserve the source classification, with explicit user confirmations noted.

### 5.1 Accounts and assignment — UJ-1, UJ-5

| ID | Class | Requirement and acceptance consequence |
|---|---|---|
| FR-001 | C | Responsable and Employé authenticate with email/password into their role space. Invalid credentials are refused without revealing which credential failed; deactivated accounts cannot log in. |
| FR-002 | C | Responsable sees own-team employees with first name, surname, email and active/inactive status; other teams are excluded. |
| FR-003 | C | Responsable creates an employee with mandatory first name, surname and valid unique email. The employee appears in that team. |
| FR-004 | C | Initial temporary credentials permit activation only. First-use password replacement is mandatory before task access; the temporary password then becomes unusable. Delivery mechanism remains OD-09. |
| FR-005 | C + user clarification | Responsable activates/deactivates employees. Deactivation prevents new login, new assignment and future authorized server work/synchronization; it never deletes existing tasks or history. Unfinished tasks stay visible for handling under OD-03. A disconnected tablet cannot be assumed to learn deactivation immediately. |
| FR-006 | C | Assignment selection includes only active employees in the Responsable's team; excludes inactive employees, other teams and the Responsable. |
| FR-007 | C | Responsable creates a uniquely identified task with creator, creation date and initial draft state. Employé cannot initiate an unassigned control. |
| FR-008 | C | Graphie Mobile is executable; Graphie fixe is visible but disabled and Scopie is unavailable. Neither excluded control type can be created. |
| FR-009 | C | Establishment and service are recorded as free text. Establishment is required; other mandatory-field rules require an explicit project decision or stronger source. |
| FR-010 | C | A task cannot finish creation without assignment to an active employee in the same team; self-assignment is prohibited. |
| FR-011 | D | Responsable task list shows task ID, type, establishment, assignee, state and last-update date. |
| FR-015 | C, user clarification | Phase 1 requires in-app visibility of assigned tasks. Real email assignment notifications are deferred beyond the PoV; do not implement or test email delivery for Phase 1. Architecture must permit later notification channels without implementing them now. OD-07 is resolved. |
| FR-016 | C | Employé sees only own assigned tasks and can open multiple active tasks. |

### 5.2 Tablet control and synchronization — UJ-1, UJ-2

| ID | Class | Requirement and acceptance consequence |
|---|---|---|
| FR-017 | C + Product Owner PoV decision (2026-10-01) | Present a touch-adapted fixed Graphie Mobile form organized by the versioned project-defined PoV catalogue in a comprehensible order; literal replication of paper layout is not required. The catalogue uses workbook-derived content where present and generic structure informed by recognized IAEA/AAPM guidance; neither guidance-derived items nor the complete catalogue are represented as CETEM BH-approved requirements. |
| FR-018 | C + Product Owner PoV decision (2026-10-01) | Capture intervention, equipment, measuring-instrument, qualitative-check, measurement and comment fields defined in the versioned PoV catalogue. Catalogue entries identify provenance as CETEM_WORKBOOK, IAEA_GUIDANCE, AAPM_GUIDANCE or PROJECT_POV_DECISION. Units/formats are included only when source-supported or explicitly decided. Requiredness, ranges, allow-N.A., validation, tolerances, rounding, blank/zero behavior and conformity rules are not inferred from external guidance. |
| FR-019 | C | Before submission, Employé can save/resume/edit a draft and explicitly delete a draft after confirmation. Latest saved work survives normal application restart. This is not authorization to discard pending unsynchronized work on logout, expiry or transfer failure. |
| FR-020 | C | Every field-audit section of an already synchronized task can be filled and saved without connectivity, including airplane mode. Offline authentication policy remains OD-01. |
| FR-021 | C | Synchronize saved drafts and queued submission requests after reconnection, with visible per-item status. Failed transfers preserve data for retry. Offline submission is visibly pending, not submitted. |
| FR-022 | C | On divergent versions, preserve the local draft, warn and require reload/reconciliation before synchronization continues. Neither version is silently overwritten. One tablet actively edits an audit at a time; automatic field-level merging is not required. Recovery interaction remains OD-02. |
| FR-023 | C | Server accepts submission only after blocking validations succeed; record submitting actor/date and expose accepted results to the Responsable. Local data stays preserved until acceptance. |
| FR-024 | C, formerly D | On server acceptance, submitted measurements/comments become immutable. A material error requires a new independent audit record linked to the original audit/task, with its own measurements, timestamps, calculations and outcome. Preserve the original. |
| FR-042 | C, clarified | Offline entry remains available and later synchronizes without loss/duplication. Calculations and individual tolerance feedback remain available offline where authorized under FR-025/026; unresolved rules remain DEP-01/02. This does not require Employé insight review or offline AI. |

### 5.3 Calculations and Responsable review — UJ-1, UJ-3

The PoV identifies voltage accuracy, voltage repeatability, radiation-output reproducibility, radiation-output linearity and beam geometry as included test families. The source workbook supplied by CETEM BH defines calculations for voltage accuracy, repeated kV readings, output reproducibility/repeatability, linearity, Kerma/mAs, means and signed percentage deviations. Preserve its formulas and cell relationships as recorded in the [Graphie Calculation Rules — CETEM BH Source Extraction](../../../../docs/product/graphie-calculation-rules-source-extraction.md) and [formula inventory](source-analysis/calcul-graphie-01-formulas.md). This does not resolve unspecified thresholds, inclusive/exclusive boundaries, rounding, N.A., mandatory/optional fields, kVmax/K2 or an overall assessment rule. The latter is not authorization for automatic overall conformity: that decision remains human.

#### Project-defined PoV Graphie Mobile catalogue decision (2026-10-01)

CETEM BH will not provide a formal Graphie Mobile field catalogue. The Product Owner therefore resolves DEP-01 **for PoV form structure only**. Story 5.4 shall use a versioned, configuration-driven catalogue whose starting sections and test families are:

1. **Intervention:** control/intervention date; establishment; service/location; employee/technician; control context where justified; comments.
2. **Equipment:** manufacturer; model; serial number; equipment/type identification; generator identification where applicable; X-ray tube identification where applicable.
3. **Measuring instruments:** instrument; manufacturer; model; serial number; calibration information where applicable.
4. **Qualitative checks:** general condition; controls/display; cables/connectors where applicable; movement/locking where applicable; collimator/light-field observations where applicable; comments.
5. **Quantitative test families:** Exactitude de la tension (kV); Reproductibilité de la tension; Reproductibilité du rayonnement de sortie; Linéarité du rayonnement de sortie; Géométrie / faisceau.
6. **General comments:** free-text observations/comments.

The workbook source class may populate only information present or derived from `CALCUL_graphie_01.xls`; retain the existing Graphie Calculation Rules — CETEM BH Source Extraction unchanged as source-derived numerical evidence, not CETEM approval. IAEA/AAPM guidance may inform conventional metadata, intervention/control metadata, instrument metadata, qualitative checks and test-family organization. These are project-defined PoV catalogue items, not CETEM requirements. Catalogue/schema and field provenance use `CETEM_WORKBOOK`, `IAEA_GUIDANCE`, `AAPM_GUIDANCE` or `PROJECT_POV_DECISION` as applicable. Use versioned schema/configuration rather than distributing form structure through React Native components. All user-facing labels, section names, help and validation messages are French; technical identifiers/documentation may be English.

External guidance does not establish CETEM-specific or PoV business rules. Do not populate requiredness, numeric ranges, allow-N.A., tolerances, comparison operators, boundaries, rounding/precision, blank/zero behavior, incomplete-test behavior, kVmax, K2, initial-linearity baseline, deterministic insight rules or automatic conformity without an explicit Product Owner decision or stronger approved source. Overall machine conformity remains the Responsable's explicit human decision. This decision resolves the missing catalogue as a blocker to Story 5.4 form structure only; it does not resolve those rule questions or DEP-02/03.

| ID | Class | Requirement and acceptance consequence |
|---|---|---|
| FR-025 | C | Calculate derived values only where explicitly defined by CETEM BH, preserving the source workbook formulas, signed deviations, fixed divisors and dependencies. Do not replace its formulas or invent missing inputs, rounding or other rules. Workbook formats are display evidence, not a complete application rounding policy; unresolved rules and reference-case acceptance remain DEP-01/02. |
| FR-026 | C | Explicitly defined formulas authorize automatic numerical calculations only. Individual tolerance/pass-fail results require both the applicable formula and an explicitly established CETEM BH acceptance threshold, boundary semantics and comparison rule. The workbook supplies no explicit tolerance verdict rules; keep these unresolved and do not infer a verdict from a calculated value. Never infer an automatic overall machine-conformity decision. |
| FR-027 | D + user clarification | Display measured values and, where authorized under FR-025/026, calculated values, applicable tolerance and individual verdict understandably to the Responsable; unresolved rules remain DEP-01/02. Employé also sees entered values, calculations and individual results during field work. |
| FR-012 | C | Responsable opens own-team tasks and synchronized results; submitted data, measurements, comments and calculated results are read-only. |
| FR-013 | C, clarified | Review submitted audit data without editing it; log review access. This is review access, not approval/rejection of employee work. |
| FR-028 | C | After submission, propose factual deterministic insights for the Responsable using only explicitly defined rules. Same input and rule version yield the same proposals; show their source. |
| FR-029 | C | Responsable selects/discards proposals after submission; retain actor/date/audit-version trace. An all-normal audit may retain zero insights. |
| FR-030 | C | Responsable may add a manual insight before summary generation, retaining text, author/date and optional justification. General evidence attachments are excluded. |
| FR-031 | C, clarified | Responsable manages insights and summary before confirmation while submitted measurements/comments remain immutable. There is no separate employee-work approval. |

### 5.4 Summary and human decision — UJ-1, UJ-3, UJ-4

| ID | Class | Requirement and acceptance consequence |
|---|---|---|
| FR-032 | C + user clarification | On Responsable request, AI drafts a summary using only the audit data and selected/added insights. Retain requester/date, actual inputs and model provenance. AI does not add an autonomous conformity decision. Failure permits retry or manual summary entry; the workflow remains completable. |
| FR-033 | C + user clarification | Responsable can edit and explicitly confirm the summary. Preserve the initial AI output when present and the edited/confirmed text. Manual-only summaries use the same confirmation gate without fictitious AI provenance. Zero selected insights does not block confirmation; text may describe applicable results within tolerance when supported by the data. |
| FR-038 | C | Only after summary confirmation, Responsable explicitly decides Machine conforme or Machine non conforme. This is separate from individual tolerance results and summary confirmation, with no intermediate approval/rejection of employee work. |

### 5.5 Official report and history — UJ-1, UJ-3, UJ-5

| ID | Class | Requirement and acceptance consequence |
|---|---|---|
| FR-034 | C | After confirmed summary and human machine decision, Responsable can upload a manually produced PDF. Reject other formats. Retain origin and metadata; size limit and exact required fields await OD-04/DEP-03. |
| FR-035 | D; report paths confirmed | Support generation of Word as well as uploaded manual PDF and designate exactly one official report. Retain its origin. No completion before confirmed summary, human decision and official designation. Correcting a completed control requires a new linked audit, not editing its immutable record. Word generation is source scope, not a newly invented FR-037. |
| FR-014 | C | Official report finalization/designation completes the software workflow. Completed control and official report are read-only, for either machine-conformity outcome. Handwritten signature is not a completion gate. |
| FR-036 | D | Authorized Responsable/Employé can download the correct official report from history, linked to its task/audit. |
| FR-040 | C | Authorized history shows completed control data, insights, confirmed summary, machine decision and report read-only. Preserve originals when replacements are performed. |
| FR-041 | C, clarified | Generated Word is printable with approved handwritten-signature zones. No electronic signature and no required signed-scan upload. Exact template and signature fields await DEP-03. |

Minimum confirmed report traceability identifies the relevant task/audit, Responsable, machine-conformity decision and finalization date. Exact mandatory report fields and provenance presentation remain DEP-03; do not silently force every internal provenance field into the report or infer PDF-content automation.

Before official designation, the Responsable may regenerate a draft Word report or replace a draft uploaded PDF, as described in Workflow §7. Official designation freezes the chosen report; this does not authorize replacement of a completed control's official report.

## 6. Derived data and reliability requirements

| ID | Class | Required behavior |
|---|---|---|
| DR-001 | D | Stable unique employee/task/submission/report identifiers and valid references after closure; replacement audits have independent identity and explicit predecessor linkage. |
| DR-002 | D | Document and associate approved formula, unit, tolerance and rounding rules with each test; validate their implementation against approved reference cases. Use the workbook and extracted cell references for defined formulas; unresolved rule details and reference cases remain DEP-01/02 prerequisites for affected acceptance. |
| DR-003 | D | Preserve the precision needed by the approved calculation rules; do not substitute display-rounded values for calculation inputs unless explicitly required. |
| DR-004 | D | Identify invalid type/unit/range/required-field input and block submission until corrected according to approved rules. |
| DR-005 | C, user override | Retain actor/date for audit submission, summary confirmation, machine decision and official report finalization/designation. Do not create an audit-approval event. |
| DR-006 | C | Employee deactivation preserves related tasks, submissions and reports for authorized Responsable access. |
| DR-007 | D | Preserve insight text and provenance in the system: deterministic rule/source versus manual author, with relevant dates. Report representation remains DEP-03. |
| DR-008 | D | Retain initial proposals, selections/discards and manual additions; trace the actual inputs selected for each summary. Discarded proposals are not supplied as retained insight content. |
| DR-009 | D | Preserve AI draft when present, edited/confirmed summary, authors/dates, report origin and metadata, and audit associations after completion. |
| NFR-001 | D | Saved offline drafts survive normal application/tablet closure and restart without network access. |
| NFR-002 | D | Interrupted transfers can resume/retry without duplication; acceptance produces one coherent submitted version. |
| NFR-007 | D | Server, synchronization and report-generation failures can be diagnosed with correlation identifiers without logging passwords or sensitive payloads. |
| NFR-008 | C | Tablet inputs and validation are readable and touch-operable; the critical flow does not require mandatory zoom or inaccessible touch controls. Device verification awaits OD-05. |

Raw measurements, units, derived values, tolerances and individual verdicts remain structured and traceable. The PoV's minimum provenance and security logging do not expand into a complete business-edit audit system.

## 7. Security requirements and unresolved boundaries

| ID | Class | Requirement / boundary |
|---|---|---|
| SEC-001 | D | Individual named accounts; attribute actions to the actual user. No shared operational accounts. |
| SEC-002 | D | Enforce role authorization server-side; Employé requests for Responsable operations are refused. |
| SEC-003 | D | Enforce own-team access for Responsable and own-assignment access for Employé; unauthorized cross-team/task requests disclose no requested data. |
| SEC-004 | D | Use recognized adaptive salted password hashing; do not store/log plaintext or recoverable passwords. Implementation parameters belong to security design. |
| SEC-005 | D | Protect all client/server communications with TLS; refuse or safely redirect plaintext traffic, with no deployed authenticated plaintext endpoint. |
| SEC-006 | C boundary / P configuration | Deactivation/logout and rejected expired credentials cannot authorize future server operations. Offline duration, inactivity expiry and unsynchronized-draft logout behavior remain OD-01; do not invent timing. |
| SEC-007 | D + confirmed boundary | Securely preserve local drafts with platform security mechanisms; do not expose plaintext to other applications. Logout/session expiry must not silently delete unsynchronized data. Access/recovery policy remains OD-01. |
| SEC-008 | D | Validate inputs, formats, limits and permissions independently on the server; reject invalid/unauthorized requests without mutation. Business fields and PDF size require their approved definitions. |
| SEC-009 | D | Do not place technical secrets or active provider keys in source or the distributed client. |
| SEC-010 | P, PDF-only scope | Safe file handling, renaming/scanning and exact upload-security policy require security design confirmation under OD-04. PDF-only upload is confirmed; arbitrary evidence upload is excluded. |
| SEC-011 — security events | D | Log failed logins, deactivations, authorization refusals and sensitive operations with date/type/available actor/result, without secrets. |
| SEC-012 | D | Temporary password grants no task access before mandatory replacement and cannot be reused afterward. |
| SEC-011 — AI control | D | Only authorized audit data and retained insights feed generation; preserve actual inputs, draft, final text and model metadata when AI is used. Explicit human confirmation and human machine decision remain mandatory. |

No certification or compliance regime is asserted by this PRD. Applicable deployment/security choices require explicit design decisions; PoV status is not a waiver of the requirements above.

## 8. PoV validation and success

Business acceptance belongs to the CETEM-BH business owner/Responsable-side representative; the individual and test conditions await OD-05. Demonstrate both official-report paths, both machine-conformity outcomes, offline recovery and AI-failure fallback. The intended prepared-data demonstration is approximately 15 minutes (CR-11); this is not a newly approved hard time limit.

### Source acceptance criteria, normalized by user decisions

| Existing ID | Required evidence / classification |
|---|---|
| CR-01 | Field-by-field CETEM-BH confirmation that the necessary information from the four-page reference report is covered; DEP-01/03. |
| CR-02 | Employé completes the demonstrated tablet control without returning to the paper form. |
| CR-03 | Required-field, invalid-format and missing-measurement feedback works against the approved field rules. |
| CR-04 | Reference calculations match CETEM-BH approved expected results; DEP-02. |
| CR-05 | Individual verdicts match approved passing, failing and boundary cases for each included test. |
| CR-06 | Saved draft survives application closure/refresh on the same device. |
| CR-07 | After server acceptance, measurements/comments cannot be edited; Responsable can manage insights and summary before confirmation. |
| CR-08 | Compare captured AI inputs and generated draft: only audit data and retained insights ground the summary. |
| CR-09 | Manual PDF can become official; a non-PDF upload is refused. |
| CR-10 | Completion is blocked without official designation; demonstrate generated Word and uploaded PDF paths. |
| CR-11 | Intended 15-minute prepared-data demonstration; observe duration without treating it as a confirmed performance gate. |
| CR-12 | CETEM-BH records whether the evidence supports continuing toward an operational MVP. This does not authorize production launch. |
| CR-13 | After confirmed summary, directly exercise both human machine decisions, without employee-work approval/rejection. |
| CR-15 | Network cut/recovery proves offline entry/save and synchronization without loss or duplication. |
| CR-16 | Print/preview the Word report with approved handwritten-signature areas. |

CR-01–CR-07 are present in the supplied PoV and are retained. CR-14 is absent; no criterion is reconstructed for that number. Workflow examples that assign insight authorship to Employé or require work approval are superseded.

**Additional consequences of confirmed user decisions:** demonstrate manual summary completion after AI failure; normal audit completion with zero retained insights; preservation and warning on version conflict; linked replacement after a submitted measurement error; and deactivation without loss of historical/unfinished work. These are acceptance consequences, not new features or invented source CR identifiers.

**Counter-metrics and safeguards:** demonstration speed must not be achieved by dropping unsynchronized data, skipping approved calculation checks, fabricating insights, bypassing human confirmation/decision or omitting a report path. AI usage rate and insight count are not success targets: manual fallback and zero selected insights are valid results. Record failures and unresolved dependencies rather than treating a staged happy path as full acceptance.

### Proposed targets — not binding

| ID | Proposed source target | Confirmation needed |
|---|---|---|
| NFR-003 | Main web screens respond in under 3 seconds at p95. | Accepted load, network and measurement conditions. |
| NFR-004 | Local save acknowledges success in under 1 second. | Supported tablet and measurement conditions. |
| NFR-005 | Report generation completes in under 30 seconds for at least 95% of test reports; failure presents a recoverable error message. | Accepted report dataset, load and measurement conditions; confirm proposed failure-feedback behavior. |
| NFR-006 | Last two major versions of approved web browsers. | Actual browser/tablet OS/device matrix. |

SRS VAL-001/002 remain open validation items. Tests should link to applicable confirmed/derived IDs and cover normal, invalid and boundary inputs, offline restart/reconnect/retry/conflict, and role/team/task authorization. Missing reference data prevents rule acceptance; it must not be replaced with invented expected values.

## 9. Unresolved business, security and configuration decisions

Owners below are responsible roles for follow-up, not invented named appointees. An open item gates the affected design/implementation or acceptance claim; it does not silently add functionality or invalidate settled scope.

| ID | Decision still required | Owner role / revisit condition |
|---|---|---|
| OD-01 | Offline authentication duration, session expiry, logout access/recovery for unsynchronized drafts. Preserve securely; never silently delete; no bypass of server deactivation. SRS VAL-003/SEC-006–007. | Security + UX owners, before offline authentication/logout behavior is implemented or accepted. |
| OD-02 | Exact conflict reload/reconciliation interaction and local edit/cancel behavior while submission is pending. Preserve both versions, show pending status, no automatic merge and no authoritative submission before server acceptance. | Workflow/UX + architecture owners, before sync recovery design is finalized. |
| OD-03 | Handling/reassignment of unfinished tasks after deactivation and detailed task initiation/linkage for replacement audits. Original evidence remains immutable and replacements remain linked. | CETEM-BH business + workflow owners, before affected transitions are implemented. |
| OD-04 | Maximum PDF size (VAL-005), safe upload policy including proposed SEC-010 scanning/handling. | Business + security owners, before upload validation/acceptance. |
| OD-05 | Tablet OS/devices, browser matrix, exact test conditions, named business acceptance authority. | CETEM-BH acceptance + test owners, before demonstration acceptance. |
| OD-06 | Approve, revise or explicitly defer NFR-003–006 proposed targets. | Business acceptance + engineering owners, before using performance/compatibility pass/fail gates. |
| OD-07 (resolved 2026-09-25) | In-app task visibility is required. Real email assignment notifications are deferred beyond the PoV, with no Phase 1 email implementation or delivery tests. Preserve architectural ability to add notification channels later. | User decision; reflected in FR-015. Revisit only for post-PoV notification scope. |
| OD-08 | Initial Responsable/team provisioning needed to start the demonstration; no expanded administration UI is authorized. | Demonstration/technical owner, before environment setup. |
| OD-09 | Initial credential handover mechanism under FR-004, without assuming an invitation/email integration. | Workflow/security owners, before onboarding design. |
| OD-10 | Exact behavior if summary content must change after confirmation, including its effect on the subsequent decision/report sequence. No reopening or invalidation mechanism is assumed. | Business + workflow owners, before post-confirmation interactions are designed or implemented. |

AI provider/model and security configuration are architecture decisions constrained by authorized data, traceability and manual fallback; this PRD does not select a vendor or prescribe unapproved data-sharing terms.

## 10. External and reference-document dependencies

| ID | Required approved input | Affected requirements / consequence |
|---|---|---|
| DEP-01 (resolved for form structure by Product Owner decision, 2026-10-01) | CETEM BH has not supplied or approved a complete Graphie Mobile field catalogue. A versioned project-defined PoV catalogue, derived from workbook content and generic IAEA/AAPM diagnostic-radiography QC guidance, now defines the Story 5.4 form structure. Workbook-derived formulas and relationships remain only source-derived numerical evidence under the existing Graphie Calculation Rules — CETEM BH Source Extraction; they do not imply approval of that extraction. IAEA/AAPM-derived items are not CETEM-approved requirements. | FR-017–018 and Story 5.4 form structure: resolved for PoV; Story 5.4 no longer blocked by the missing CETEM catalogue. |
| DEP-01R (unresolved business rules, formerly the remaining portion of DEP-01) | Still requires explicit Product Owner decision or stronger source for mandatory/optional status, unspecified units/formats, tolerance thresholds, comparison operators and inclusive/exclusive boundaries, signed-versus-absolute verdict semantics, rounding/precision, blank/zero/N.A. behavior, incomplete-test behavior, kVmax, K2, initial-linearity baseline and deterministic insight rules. Repeated-kV extrema remain workbook literals; linearity initial mean O42 is blank, causing Q40 to display #DIV/0!; do not infer replacements. No automatic overall conformity. | FR-009, FR-023, FR-025–028; DR-002–004; VAL-004; affected calculation/verdict/insight/submission behavior only. Does not block Story 5.4 structure. |
| DEP-02 | CETEM-BH-approved reference dataset with expected numerical results and verdicts, including normal, abnormal, invalid and boundary cases. Workbook example values are preserved as formula evidence but do not close the complete dataset dependency or define tolerance verdicts. | CR-03–05 and rule verification. Calculations cannot be declared accepted without this evidence. |
| DEP-03 | Approved Word report template and mandatory content, provenance and handwritten-signature fields, including expectations for manually produced PDF. | FR-034–035/041, DR-007, CR-01/16. Minimum confirmed report linkage still applies; exact final report fidelity awaits approval. |

CETEM-BH's business representative supplies/approves these references before affected acceptance. DEP-01 form-structure resolution is a project Product Owner decision and must not be described as CETEM approval. Signed-scan reintegration (VAL-006) is resolved as excluded from Phase 1. There is no missing-CR-01–07 dependency: the criteria exist in the available PoV.

## 11. Source record and downstream use

Source files in `docs/product`: CETEM BH-supplied source calculation workbook `CALCUL_graphie_01.xls` (decision 7 update, 2026-09-25); Vision v0.8; SRS v0.7; PoV scope/criteria v0.5; Workflow AS-IS/TO-BE v0.4; Functional UML v0.3; Technology Stack and Benchmarking; UI/UX Design Guide. The user's 2026-09-24 scope clarification, [eleven answers and subsequent corrections](source-analysis/user-decisions.txt), including the 2026-09-25 extraction and notification decisions, take precedence over conflicting passages. Source version/date inconsistencies are editorial defects, not product decisions.

The [source-analysis folder](source-analysis/) retains extracts and requirement inventories; [.memlog.md](.memlog.md) records decisions and corrections. In particular, earlier analysis incorrectly described CR-01–07 as absent; the verified criteria in §8 supersede that finding. The [addendum](addendum.md) preserves technical/visual source detail without promoting navigation suggestions into new features.

Use this PRD for UX and architecture planning with the open decisions visible. Do not treat its creation as business acceptance, closure of missing references, approval of proposed performance targets or production readiness.
