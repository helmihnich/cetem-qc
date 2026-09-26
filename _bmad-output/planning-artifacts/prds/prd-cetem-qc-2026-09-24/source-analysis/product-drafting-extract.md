# Product drafting extract

Read in full: Vision v0.8 extracted text; PoV v0.5 extracted text; Workflow v0.4 extracted text; UML v0.3 extracted text and Figure 6 image. User decisions in pasted attachment override contradictory source passages. This is an authoring aid, not a new product specification.

## Confirmed scope and value

Phase 1 is a Graphie Mobile PoV demonstrating the complete employee-account/task-to-official-report workflow. It replaces paper entry, Excel re-entry and manual calculations with tablet data entry, explicit calculations/tolerance feedback, human review and constrained AI writing assistance. It is not production acceptance. Architecture should allow later operational evolution without introducing future features now.

- Responsable creates employee accounts, provides initial credentials through a mechanism still to design, activates/deactivates employees, creates/assigns tasks and monitors them. Email/password authentication; no SSO. Employees cannot initiate unassigned controls. Several active tasks per employee are allowed; Responsable self-assignment is excluded (Vision DEC-005/011/013/015).
- Fixed Graphie Mobile form: intervention/institution/service, equipment/tube/generator identity, measurement instruments, qualitative visual/mechanical checks, measurements and comments. Institution/service are free text (DEC-007/010). Exact fields and mandatory rules depend on approved catalogue.
- Covered performance families: voltage accuracy, voltage repeatability, Kerma reproducibility, linearity and beam geometry (PoV §4). No invented formula, threshold, inclusivity, rounding, N.A., kVmax or K2 rule.
- Field calculations and individual tolerance results work offline. One tablet actively edits each audit; local draft survives refresh/closure. Offline submission request is pending synchronization; only successful server acceptance establishes submitted status and immutability. Conflict preserves local data, warns, requires reload/reconciliation, and never silently overwrites. Automatic merge is excluded.
- Responsable reviews immutable submitted measurements/comments, selects/adds deterministic factual insights, requests an AI draft grounded in audit data and retained insights, edits and confirms it. Zero selected/added insights is valid for all-normal data. AI failure allows retry or manual summary followed by the same confirmation.
- Human machine conformity decision follows summary confirmation, independently from individual automatic verdicts. Both conformity outcomes can complete normally.
- Generated Word or uploaded manual PDF becomes the single official immutable report; final designation completes software workflow. Signature occurs afterward, outside workflow; no signed-scan requirement. History remains readable.
- Trace actor/date for submission, summary confirmation, human conformity decision and official report finalization/designation (DR-005 override). Do not create audit-approval event.
- Material measurement correction requires a new independent audit linked to original audit/task; preserve original history.

## Exclusions

Graphie fixe (visible disabled option in Vision), Scopie, generic form builder, automatic PDF generation, institution reference database, complete identity administration, SSO, multi-device collaborative sync, automatic field merging, automatic machine conformity, advanced AI beyond summary drafting, general audit/insight attachments, electronic signature, signed-scan reupload, complete audit logging, historic-paper migration, production rollout/hardening/availability commitments. No separate employee-work approval/rejection and no employee insight-selection workflow.

## Grounded journeys

1. Responsable creates an employee and assigns Graphie Mobile work; employee uses credentials, opens assigned work on tablet, captures identification/instruments/checks/measurements, sees calculated values and individual verdicts, saves and requests submission. On server acceptance, data freezes. Responsable reviews, retains/adds insights, generates/edits/confirms draft summary, makes machine conformity decision, generates/inspects/designates Word or uploads/designates manual PDF. Officialization ends the control.
2. Employee loses network during field entry; entry/calculations continue and draft survives interruption. Offline submission request remains pending with preserved local data. Reconnection synchronizes without loss/duplicates. Version conflict interrupts synchronization with warning and preserves draft until reload/reconciliation.
3. An individual test fails; Responsable reviews deterministic evidence, confirms summary, chooses machine non-conformity and still completes official report. Never describe a rejected employee audit.
4. AI is unavailable; Responsable retries or writes summary manually, confirms it, then continues human decision/report workflow. All-normal control may have zero retained insights.
5. Responsable discovers material submitted measurement error; frozen original stays in history and a new linked independent audit is performed. Deactivated employee cannot log in/start new work; tasks/history remain; unfinished tasks remain visible to Responsable for handling. Exact reassignment mechanism remains open.

## Actual PoV success IDs and evidence

IMPORTANT: complete extracted PoV contains CR-01 through CR-07. Earlier statement that their contents were absent is incorrect. No missing-document dependency should be asserted for those IDs. Actual numbering is CR-01–CR-13, CR-15–CR-16; CR-14 is absent and must not be invented.

| ID | Source criterion/evidence and user normalization |
|---|---|
| CR-01 | Cover necessary information across four reference-report pages; CETEM-BH field-by-field review. Depends on approved report/field catalogue. |
| CR-02 | Employee completes tablet demonstration without reverting to paper; timed observation. |
| CR-03 | Clearly flag required fields, invalid formats and missing measures; invalid-entry scenarios against approved field rules. |
| CR-04 | All reference-case calculations match CETEM-BH manually approved expected results; approved reference dataset. |
| CR-05 | Individual verdict matches approved rule; passing, failing and boundary cases per test. Not overall conformity automation. |
| CR-06 | Draft survives closing/refreshing app on same device; restore test. |
| CR-07 | Submitted measures/comments immutable; Responsable manages insights and summary before confirmation. Interpret submission as server acceptance. |
| CR-08 | AI summary grounded only in audit data and retained insights; compare recorded inputs with generated draft. |
| CR-09 | Manual PDF may be uploaded/designated official; reject other formats. |
| CR-10 | Closure blocked until official generated/uploaded report designation; exercise both branches. |
| CR-11 | Source says maximum 15 minutes using prepared data; USER OVERRIDE: intended demonstration scenario, not approved binding performance target. |
| CR-12 | CETEM-BH confirms evidence supports continuation to MVP; documented decision. No automatic production authorization. |
| CR-13 | Following confirmed summary, Responsable directly decides conformity; exercise both outcomes without work approval/rejection. Manual-summary fallback now also applicable. |
| CR-15 | Offline entry/save synchronize without loss/duplicates; cut and restore network. |
| CR-16 | Generated report printable with handwritten signature zones; print/preview evidence. Exact approved template/signature fields pending. |

Workflow validation IDs: WF-01 generated official conforming Word; WF-02 official manual PDF and invalid-format rejection; WF-03 discarded insight traceable but excluded from summary/report; WF-04 source wrongly says manual insight before submission and immutability afterward, superseded by Responsable post-submission authoring; WF-06 non-conforming completion; WF-07 read-only authorized history; WF-08 offline continuation/sync; WF-09 printable handwritten-signature layout. No WF-05 in source. PoV S1/S2 wording implying an automatic general conclusion must be normalized to individual results plus human decision. PoV S3 boundary/S4 missing data depend on approved rules; S5 restore; S6 Word; S7 insight/AI provenance; S8 PDF; S9 blocked closure; S11 offline. Do not invent S10.

## Conceptual entities and relations

UML Figure 6 shows User (id, name, role, account status) assigns/executes Task (id, status, due date, employee id); Task contains one Audit conceptually; Audit (id, status, control date, synchronization mode) concerns Equipment (brand/model/serial/service). Audit contains test results (test type, value, tolerance, verdict) and insights (text, provenance, selected flag, Responsable id). Audit receives Summary (AI draft, final text, confirmed flag, model, Responsable id) and has 0..1 official Report (origin, format, version, fingerprint, official flag).

Treat this as conceptual, not physical schema or a lifecycle demand that a draft must already contain a report/summary. Manual-summary fallback means an AI draft/model may be absent. Zero retained insights is valid. Add required actor/date events and original/replacement linkage as user-confirmed concepts. Preserve raw values, units, derived values, tolerances and verdicts rather than unstructured text alone (Vision §8). Workflow §6 supplies deterministic insight rule/source-data/result/system-author/date provenance and manual author/date/justification; no evidence attachment. Report traceability must at least identify task/audit, Responsable, conformity decision and finalization date; exact mandatory report/provenance fields remain external dependency.

## Open decisions and dependencies

- Approved CETEM-BH four-page report/field catalogue, calculation/control catalogue and approved numeric reference dataset. Need exact formulas/thresholds/boundaries/rounding/N.A./required measurements; draft example percentages are not approved rules.
- Approved Word template and mandatory report/provenance/signature fields; maximum manual PDF size.
- Offline session duration, expiry/logout security and UX behavior; local unsynchronized data cannot silently disappear. Secure tablet draft persistence required. Deactivation cannot instantly propagate to disconnected tablet, but future authorized server work/sync must be blocked once server knows.
- Exact unfinished-task reassignment behavior after deactivation.
- Device/OS/browser test matrix, conditions, named business acceptance authority. Business acceptance belongs to CETEM-BH business owner/Responsable representative. Proposed targets (<3s web p95, <1s local save, <30s report) are not binding until confirmed.
- NEW material conflict: Vision DEC-008 includes in-app and email assignment notifications; PoV §5 excludes real notifications/messaging integration. User has not explicitly resolved transport/delivery scope. Task availability to assigned employee is confirmed; notification service requirement must remain unresolved pending clarification, not silently included/excluded.
- AI service/model integration supports the in-scope draft feature; provider/configuration to determine in architecture, constrained factual inputs and fallback required. Model unavailability is not a completion blocker.

## Source defects not to propagate

Vision and PoV retain obsolete approval wording in older paragraphs. Workflow AS-IS table wrongly contains future AI steps, and TO-BE begins with employee creation of control; use paper/Excel/manual synthesis as current process and Responsable assignment as future initiation. PoV D-02 automatic overall conclusion is superseded by human decision; D-11 signed scan excluded; D-12 independent means separate linked record. Workflow manual-insight/employee-submitted insight rows and WF-04 obsolete. Technical production exclusion is not permission to skip required secure persistence, authentication, controlled access or reliable offline workflow.
