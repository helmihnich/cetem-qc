# SRS requirement inventory — user decisions applied

Source: `03-exigences-srs-revise-v0.7.txt`; controlling clarification: user pasted decisions, 2026-09-24. C = source confirmed; D = source derived; P = source proposed (not binding). Overrides are explicit user decisions; dependencies must not be invented. Existing identifiers are preserved. SEC-011 occurs twice in the source; descriptive suffixes below distinguish occurrences without renumbering. FR-037 and FR-039 are absent; do not reconstruct them. There are 40 FR entries, 9 DR entries, 8 NFR entries, and 13 SEC entries (12 unique SEC IDs).

## Functional

| ID | Status | Requirement and observable detail | Override / dependency |
|---|---|---|---|
| FR-001 | C | Responsable/Employé email-password authentication; valid credentials enter role space; invalid credentials refused without identifying incorrect field. | Individual accounts; deactivated accounts cannot log in. |
| FR-002 | C | Responsable lists own team with first/last name, email, active/inactive status; excludes other teams. | — |
| FR-003 | C | Create employee with mandatory first name, surname, validated unique email; appears in team. | PoV account creation is required, not merely seeded accounts. |
| FR-004 | C | Temporary initial password permits activation only; mandatory first-use change before task access; temporary password then unusable. | User requires initial credentials/authentication and no expanded identity administration; source's confirmed onboarding mechanism remains traceable. |
| FR-005 | C | Deactivate employee without deleting history; refuse login/new assignment; historical tasks remain visible. | User additionally requires activate/deactivate; unfinished tasks stay visible for handling/reassignment. Exact reassignment handling unresolved. |
| FR-006 | C | Assignment selector contains active employees of own team only; excludes inactive, other teams, Responsable self. | — |
| FR-007 | C | Responsable creates quality-control task with stable unique ID, creator, creation date, initial draft state. | Employees cannot initiate unassigned audits. |
| FR-008 | C | Graphie mobile selectable; Graphie fixe visible disabled; Scopie unavailable; neither latter type can be created. | Phase 1 Graphie Mobile only. |
| FR-009 | C | Free-text establishment/service saved with task; establishment required; service presence follows approved form. | Required service rule depends on approved catalogue. |
| FR-010 | C | Assign to active employee in own team; creation cannot finalize without valid assignee; no self-assignment. | Unfinished task reassignment details unresolved. |
| FR-011 | D | Responsable task list includes ID, type, establishment, assignee, state, last-update date. | — |
| FR-012 | C | Responsable opens task and synchronized results; submitted fields, measurements, comments, calculations/verdicts read-only. | — |
| FR-013 | C | Read-only review of submitted audit and results; review access logged. | Employee does not select/submit deterministic insights: proposals/review belong to Responsable after submission. No approve/reject employee-work event. |
| FR-014 | C | Completion requires confirmed summary, separate human conform/nonconform decision, official report; completed record/report read-only. | Report designation/finalization completes software workflow; signature later. |
| FR-015 | C in SRS; unresolved source conflict | SRS requires in-app notification and email to employee account. | PoV excludes real notification integrations; user clarification requested, no silent channel decision. Assigned-task visibility remains confirmed. |
| FR-016 | C | Employee sees only assigned tasks; can open multiple active tasks. | No unassigned control initiation. |
| FR-017 | C | Touch-adapted Graphie Mobile form organized by tests; intelligible order, not literal paper reproduction. | Approved CETEM BH test/field catalogue. |
| FR-018 | C | Capture required equipment/instrument metadata, qualitative checks, quantitative measurements and comments, with approved units/formats/validation. | Mandatory fields and rules depend on approved catalogue. |
| FR-019 | C | Save/resume/edit/delete draft before submission; latest saved draft survives application restart; deletion requires confirmation. | Pending synchronization data preserved; no silent expiry/logout deletion. |
| FR-020 | C | Offline fill/save all sections of already synchronized task, including airplane mode. | Offline duration/security decisions unresolved. |
| FR-021 | C | Deferred draft/submission synchronization on reconnect; visible per-item state; failure retains data for retry. | Offline submission is pending synchronization; only successful server acceptance is authoritative. |
| FR-022 | C | Detect divergent draft versions; warn before overwrite; no silent overwrite. | Preserve local draft, warn, require reload/reconciliation before continued synchronization; single active editing tablet; no automatic field-level merge or multi-device collaboration. |
| FR-023 | C | Submit when blocking validations pass; record author/date; Responsable can see results. | Offline request stays pending; submitted/immutable state begins at server acceptance, with local data preserved until then. |
| FR-024 | D; reinforced C by user | Submitted version is read-only. | No in-place reopening/editing of submitted measurements: material error requires new independent audit record linked to original audit/task, preserving original. |
| FR-025 | C | Calculate means/deviations/other approved derived values; match approved test dataset, units, rounding. | Approved catalogue/reference dataset unavailable dependency; invent no formulas. |
| FR-026 | C | Individual test verdict from applicable formula/tolerance; correct at boundaries and normal/abnormal values. | No automatic overall machine-conformity decision; thresholds/inclusivity/N.A. and other rules require approved catalogue. |
| FR-027 | D | Responsable sees measured/calculated value, tolerance and verdict so explanation is understandable without code. | Employee also sees measurements, calculated values and individual tolerance results under user decision. |
| FR-028 | C | After submission, deterministic factual insight proposals; same inputs/rule version yield same proposals; show source. | Responsable workflow only; only explicitly defined insight rules; catalogue dependency. |
| FR-029 | C | Responsable selects/discards proposals after submission; retain actor/date/audit version; measurements immutable. | Zero selected/added insights valid for all-normal audit. |
| FR-030 | C | Responsable adds insight before summary generation; preserve text, optional justification, author/date. | No artificial insight required for finalization; general evidence attachments out of scope. |
| FR-031 | C | Responsable reviews immutable employee measures/comments and manages insights/summary until confirmation. | No separate approval/rejection of employee work. |
| FR-032 | C | Responsable requests AI draft using only audit data and selected/added insights; no autonomous conformity decision; retain model/date/requester/inputs. | In Phase 1; failed AI permits retry and manual summary continuation; empty insight selection allowed. |
| FR-033 | C | Responsable edits/confirms summary; preserve initial AI and final confirmed versions; no report finalization without confirmation. | Manual summaries need same confirmation; do not fabricate AI provenance for manual-only path. |
| FR-034 | C | After confirmed summary and machine decision, Responsable uploads externally produced PDF only; reject other types; retain metadata. | Source repeated 'summary confirmation' is editorial defect. Maximum PDF size and required metadata/template details unresolved. |
| FR-035 | D | One official report; record generated/uploaded origin; finalization requires confirmed summary and human machine decision; completed corrections require new control. | Both system Word and manual PDF paths in scope; official designation completes software workflow. Replacement record linked to original. |
| FR-036 | D | Authorized Responsable/Employé download correct official report from history, associated with correct task. | Historical access read-only. |
| FR-038 | C | After summary confirmation, Responsable directly decides machine conform/nonconform; no intermediate employee-work approval; AI does not decide. | No automatic overall decision by deterministic system either. |
| FR-040 | C | Authorized Responsable/Employé view completed controls read-only: data, insights, summary, machine decision, report. | Original erroneous audit preserved when replaced. |
| FR-041 | C | Printable generated report supports handwritten signature and expected signature zones; no electronic signature. | Hand signature outside software workflow; signed scan upload not required; template/signature fields unresolved. |
| FR-042 | C | Field audit save/use offline and later sync without data loss or duplication. | Override source's offline insights clause: employee needs offline entry/calculations/individual tolerance feedback, not deterministic insight review. |

## Data

| ID | Status | Requirement and observable detail | Override / dependency |
|---|---|---|---|
| DR-001 | D | Employee/task/submission/report unique stable IDs; no duplicates; references valid after closure. | Linked replacement audit must have independent record identity. |
| DR-002 | D | Document every formula/unit/tolerance/rounding rule and link to test; compare approved CETEM BH source; automated rule coverage. | Approved catalogue and reference dataset required. |
| DR-003 | D | Preserve numerical precision before display rounding; calculations use full precision where required. | Exact precision/rounding definitions depend on catalogue. |
| DR-004 | D | Reject invalid type/unit/range; identify invalid field; block submission until corrected. | Approved field/range/mandatory validation definitions required. |
| DR-005 | C; overridden | Actor/date traceability. | Replace obsolete approval identity/date with actor/date for submission, summary confirmation, machine decision, official report finalization/designation. No audit approval event. Exact report provenance fields unresolved. |
| DR-006 | C | Deactivation preserves associated tasks/submissions/reports accessible to authorized Responsable. | Unfinished tasks also remain visible. |
| DR-007 | D | Insight provenance distinguishes deterministic rule proposal from manual author; retain rule/author/date/text. | Source requires provenance in final report; user says exact mandatory report/provenance fields unresolved. Preserve provenance in system; final report representation awaits template decision. |
| DR-008 | D | Retain initial proposals, Responsable selection, manual additions; each summary's selected inputs traceable. | Empty selection is valid. |
| DR-009 | D | Retain AI draft, edited/confirmed summary, official report origin/metadata; versions/authors/dates/audit links available after closure. | Support manual summary without fictional AI draft. |

## Nonfunctional

| ID | Status | Requirement and observable detail | Override / dependency |
|---|---|---|---|
| NFR-001 | D | Saved offline draft survives normal close/application or tablet restart without network intact. | No silent deletion on logout/session expiry. |
| NFR-002 | D | Interrupted synchronization resumes/retries without duplicates; retry yields one coherent server version. | Pending records preserved and conflicts not silently overwritten. |
| NFR-003 | P | Proposed main web screens <3s p95 under acceptance load/normal connection: login, task list/detail. | Explicitly nonbinding until confirmed; test conditions unresolved. |
| NFR-004 | P | Proposed offline local save success acknowledgment <1s on supported tablets. | Explicitly nonbinding; device matrix/test conditions unresolved. |
| NFR-005 | P | Proposed report generation <30s for at least 95% of test reports; failure gives recoverable message. | Performance target nonbinding pending confirmation. |
| NFR-006 | P | Proposed support last two major versions of approved web browsers; define/test critical-flow matrix before acceptance. | Browser/tablet OS/device matrix unresolved. |
| NFR-007 | D | Log server/sync/report-generation failures with correlation ID; test failure discoverable without logging passwords/sensitive payload. | — |
| NFR-008 | C | Readable touch-operable tablet inputs and clear validation; critical flow no mandatory zoom or untouchable control. | Device matrix dependency. |

## Security

| ID / occurrence | Status | Requirement and observable detail | Override / dependency |
|---|---|---|---|
| SEC-001 | D | Named individual accounts, no shared accounts; actions attributable to unique user. | Replace obsolete 'approval' attribution with actual submission/summary/decision/report events. |
| SEC-002 | D | Enforce role permissions server-side; forged employee calls to Responsable functions denied. | — |
| SEC-003 | D | Responsable own-team employees/tasks/reports only; employee own assigned tasks only; cross-boundary denial reveals no requested data. | — |
| SEC-004 | D | Adaptive recognized salted password hashing; no plaintext storage/logging; no recoverable password; internal standard parameters. | Chosen internal standard/configuration not invented. |
| SEC-005 | D | TLS client-server traffic; refuse/safely redirect plaintext; no deployed authenticated HTTP endpoint. | — |
| SEC-006 | P; partly clarified | Session expiry after approved inactivity duration, invalidation on logout/deactivation, expired/revoked token rejected. | Exact offline duration/expiry unresolved; deactivation prevents authorized new work/sync once server knows; no silent draft deletion. |
| SEC-007 | D; partly unresolved | Protect local drafts using secure platform mechanisms; no plaintext in storage accessible to other applications. | Secure preservation confirmed; logout access/disposition UX-security decision unresolved, must not silently delete unsynchronized drafts. |
| SEC-008 | D | Server independently validates inputs/formats/sizes/permissions; invalid/unauthorized requests rejected without mutation. | PDF size/approved field definitions dependencies. |
| SEC-009 | D | No technical secrets/keys in source or client; repository/distributed app exposes no active secrets. | — |
| SEC-010 | P | Approved external document types/sizes, safe rename, scan before availability; reject forbidden/oversized/malicious files. | Applies to official PDF upload only; general evidence attachments excluded. PDF type confirmed; max size and precise security policy proposed/unresolved. |
| SEC-011 (security events) | D | Log failed logins, deactivations, authorization refusals, sensitive operations without exhaustive business edit log; date/type/actor-or-available-ID/result, no secrets. | Duplicate ID in source; preserve label rather than silently renumber. |
| SEC-012 | D | Temporary password cannot grant operational access before mandatory change and becomes unusable immediately after change. | Follows FR-004. |
| SEC-011 (AI control) | D | Generate summary only from authorized audit/insight data; never automatic decision; explicit Responsable confirmation; retain input, initial output, final version, model metadata. | Duplicate ID in source; constrained summary AI in Phase 1; manual fallback confirmed. |

## Existing validation IDs and external gates

- VAL-001: NFR-003–005 performance targets still proposed, not binding.
- VAL-002: approved browser/tablet OS/device matrix and test conditions unresolved.
- VAL-003: session/offline duration and logout handling unresolved; general attachment scope superseded by exclusion; only report PDF remains.
- VAL-004: approved CETEM BH field/calculation/control catalogue and reference dataset missing dependency. Do not invent formulas, inclusive limits, rounding, N.A., kVmax, K2, linearity or mandatory measurement fields.
- VAL-005: configurable official PDF maximum size unresolved.
- VAL-006: resolved by user: no signed scan reintegration required in Phase 1; signature happens after software completion.
- Approved Word report template and mandatory metadata/provenance/signature fields remain external/reference dependencies; preserve task/audit, Responsable, human conformity decision and finalization-date traceability meanwhile.
- Correction after source verification: CR-01–CR-07 are all present in the available PoV extract (lines 125–145). No missing-source dependency applies. Preserve the actual criteria; CR-14 is absent.
- Business acceptance role is CETEM BH business owner/Responsable representative; named approver unresolved. Documented 15-minute prepared-data scenario is intended demonstration, not newly imposed binding target.

## Source acceptance/traceability notes

SRS calls for tests linked to every confirmed/derived requirement, business fixtures at limits/normal/abnormal/invalid values, offline restart/reconnect/upload-failure/conflict coverage, and cross-employee/team/role authorization tests. Proposed requirements must be confirmed/amended/explicitly deferred before SRS approval. No binding performance pass/fail may be inferred meanwhile.

Generated Word is explicitly in SRS scope/actor description and FR-035 origin distinction, but there is no dedicated Word-generation FR row; retain traceability through FR-035/FR-041 and source scope, rather than repurposing a missing FR ID. Linked replacement control, employee activation/deactivation, manual AI fallback, and pending offline submission semantics are explicit user confirmations supplementing existing IDs; they are not inferred new functionality.


