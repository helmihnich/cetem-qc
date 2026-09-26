# Product source extraction for UX — 2026-09-25

Authority: `_bmad-output/planning-artifacts/prds/prd-cetem-qc-2026-09-24/prd.md`, final, updated 2026-09-25. Supporting DOCX text read through existing `source-analysis` extractions and DOCX ZIP/XML structure inspected directly. All six embedded UML images were subsequently inspected visually; their reconciliation is recorded in `../reconcile-product-sources.md`. Visual guide and technology benchmarking are owned by the separate visual-source extraction.

## Supporting sources covered

- `docs/product/01-vision-et-perimetre-revise-v0.8.docx`: §§1–8, particularly §5 responsibilities, §6 role journeys, §10 decisions.
- `docs/product/03-exigences-srs-revise-v0.7.docx`: §3 FR-001–042, §§4–6 data/reliability/security, §8 unresolved validation.
- `docs/product/CETEM-BH_Workflow_Metier_AS-IS_TO-BE_v0.4.docx`: §§2–10 forms, lifecycle, insights, reports, exceptions, scenarios.
- `docs/product/CETEM-BH_Perimetre_PoV_Criteres_Reussite_v0.5.docx`: §§3–4 field/test families, §§7–10 acceptance and dependencies.
- `docs/product/CETEM-BH_Modelisation_Fonctionnelle_UML_v0.3.docx`: §§1–7 surrounding figure explanations.
- `docs/product/CALCUL_graphie_01.xls`: use `docs/product/graphie-calculation-rules-source-extraction.md` and its linked formula inventory; workbook not modified or reparsed.

## Reuse decisions consistent with final PRD

1. Two distinct workspaces: Responsable web for team, assigned work, read-only submitted evidence, insights, summary, machine decision, official report and history; Employé tablet for own assignments, field entry/calculations, saved work, synchronization/submission and authorized history. Vision §§5–6; UML §§1–2; PRD §§2,5.
2. Fixed Graphie Mobile form organized by test and usable by touch; do not replicate four-page paper layout literally. Candidate section grouping: intervention/establishment; equipment including tube and generator; measuring instruments; qualitative/visual/mechanical checks; quantitative tests; comments and submission review. These are source-backed information groups, not an approved exhaustive field catalogue. Vision §6.2; Workflow §2; PoV §§3–4; FR-017/018, DEP-01.
3. Graphie fixe visible but disabled, Scopie unavailable; establishment/service free text; task creation requires own-team active employee and cannot self-assign. No establishment database or generic form designer. FR-006–010.
4. Temporary password permits first-use activation only, then compulsory password replacement before tasks; handover mechanism unresolved. Team list minimum name, first name, email and active/inactive. Task list minimum ID/type/establishment/assignee/state/updated date. FR-001–011, OD-09.
5. Multiple active assignments per Employé; in-app visibility; open only previously synchronized tasks offline. Local save acknowledgment must be distinguishable from server draft synchronization and authoritative submission. Reopen saved draft after normal app/device restart. FR-016–024, NFR-001/002.
6. Preserve individual measurements, units, derived values and applicable rule provenance together. Distinguish numerical calculation, individual tolerance result and human overall machine decision. Required calculation feedback works offline where rule evidence permits. FR-025–028, DR-002/003.
7. Submitted evidence is read-only for both roles after successful server acceptance. Responsable selects/discards deterministic proposals and adds manual insights after submission, with provenance; zero retained insights is valid. No Employé insight selection workflow. FR-012/013, FR-028–031.
8. AI is an explicit optional assistance request; initial AI draft and edited text remain distinguishable, manual-only text has no invented AI provenance. Retry or write manually on failure; explicit summary confirmation is required whichever route was used. Separate human choice Machine conforme / Machine non conforme follows confirmation. Either outcome can complete. FR-032/033/038.
9. Report has two genuine paths: generate Word or upload manually produced PDF; inspect chosen file before official designation. Draft Word may be regenerated/draft PDF replaced before designation. Exactly one official report, frozen at designation; completion requires confirmed summary, machine decision and official report. Handwritten signature after printing does not gate software completion. Workflow §7; FR-014/034–036/040/041; DEP-03.
10. History is authorized and read-only and preserves original/replacement linkage. Material submitted error requires separate independent linked audit, not reopening old measurements or replacing completed official report. FR-024/035/040; OD-03 for initiation mechanics.

## Authoritative journey names (copy exactly)

| PRD ID and exact name | Principal UX emphasis | Supporting source |
|---|---|---|
| UJ-1 — Assigned field control to official report. | Account/assignment → tablet field draft → accepted submission → web review/insights → confirmed summary → human decision → official report. | Vision §6; SRS §3; Workflow §7; UML §3. |
| UJ-2 — Network interruption. | Local preservation, honest pending status, retry, server acceptance, conflict stops synchronization. | SRS FR-019–024/042 and NFR-001/002; Workflow WF-08. |
| UJ-3 — Normal and nonconforming outcomes. | Zero insights allowed; nonconformity is normal completion outcome. | UML §4; Workflow WF-01/02/06. |
| UJ-4 — AI unavailable. | Retry/manual text then same explicit confirmation gate. | Final PRD user clarification overrides source AI-only phrasing. |
| UJ-5 — Material submitted error or employee deactivation. | Preserve original evidence and unfinished tasks; exact replacement/reassignment flow remains open. | Workflow §7 uniqueness; SRS FR-005 and DR-006; final PRD OD-03. |

## Offline state distinctions the specification must retain

Connectivity is separate from per-audit save/sync/submission lifecycle. Offline does not imply lost work; online does not imply synchronized or submitted. Distinguish unsaved changes; saving locally; local save confirmed with time; locally saved draft awaiting sync; draft synchronized but not submitted; submission requested and awaiting sync; transfer in progress; server acceptance; recoverable transfer failure; version conflict; authorization/session problem. Only confirmed server acceptance can label audit submitted or freeze measurements/comments. A transfer success without acceptance cannot do so. Failed or conflicting transfer retains local data; no silent overwrite or automatic merge. Pending submission edit/cancel and reconciliation mechanics are deliberately OD-02, not settled source behavior. Offline authentication duration, logout access and recovery remain OD-01; never silently delete unsynchronized work. A deactivated disconnected tablet may not yet know its account status; server must refuse subsequent authorized sync, preserve local data and require policy-guided recovery.

## Conflicts / obsolete material NOT to restore

| Supporting passage | Final PRD precedence |
|---|---|
| Vision §4 stale approval wording, Workflow §4 “Décision sur le travail”, SRS old approval trace. | No audit/work validation or rejection screen/status/action/event. Review access is not approval. Human machine decision remains separate. |
| Vision DEC-008 / SRS FR-015 email assignment delivery. | PRD FR-015, OD-07 resolved: in-app visibility only; no real email implementation/testing. |
| PoV §5 excludes activation/account lifecycle and broader sync. | Final PRD includes minimal named accounts, activation, team/assignment and complete required offline/retry/conflict behavior. No full administration or collaborative multi-device editing. |
| Workflow §4 Employé creates control; §8 role ambiguity. | Employé opens assigned tasks only; Responsable creates and assigns tasks. |
| Workflow §5 evidence attachment; §6 manual proof / “Soumis” insight; WF-04 employee-era before-submission manual insight. | No general evidence upload; Responsable alone manages insights after accepted submission. |
| Sources saying data freeze merely “after submission”. | Only successful server acceptance freezes measurements/comments; offline request remains pending. |
| SRS FR-024 possible reopening later. | No reopening submitted evidence; independent linked replacement audit. |
| Workflow §9 “reload or merge”, Vision “confirm overwrite”. | Preserve both versions; stop sync for reload/reconciliation; no automatic merge or assumed discard/overwrite command. OD-02 open. |
| PoV D-02 general automatic conclusion / S1 conclusion proposed conforming. | Never infer overall conformity from tests or insights; human decision only. |
| Vision sample ±5/10/15% thresholds; PoV D-06 boundaries. | Not established executable tolerance rules. DEP-01 still needs per-test threshold, comparison and boundary semantics. |
| SRS FR-042 offline insights. | Offline field calculations as authorized; no Employé insight review or offline AI requirement. |
| UML/Workflow zero-insight question or signed-scan question. | Zero insights valid; signed-scan reintegration excluded. Do not reopen settled questions. |
| PoV CR-11 maximum 15 minutes; SRS NFR numerical targets. | Intended prepared-data demonstration ~15 minutes; performance/compatibility targets remain proposals OD-06. |
| UML RésuméIA model treated mandatory for every audit. | Manual summary permitted; draft audit need not have summary/report; no fake model metadata. |
| SRS DR-007 all provenance in final report. | Preserve system provenance; exact report representation depends on DEP-03. |

## Calculation UX boundaries

- Workbook signed percentages, fixed divisors 3/5 and explicit dependencies are authoritative numerical evidence; do not convert to absolute error or variable-count means.
- Repeated-kV extrema are supplied literals, not established MIN/MAX formulas. KVm_max is not the unresolved protocol kVmax.
- Output reproducibility percentages use normalized Kerma/mAs; repeatability percentages use raw Kerma mean. Show correct context and units, do not collapse them.
- Linearity preserves explicit 0.49 factor; no inferred distance formula. Initial baseline O42 is blank and Q40 displays #DIV/0!; do not manufacture zero, N.A. or passing result. Application missing/invalid/zero handling remains an external rule dependency.
- Number formats are display evidence, not approved rounding policy; preserve calculation precision.
- Workbook authorizes no individual verdicts or deterministic insight rules by itself. Expose unavailable rule/calculation context honestly without pretending a test passed. Exact wording/presentation can be UX, but required/optional handling and submission impact cannot be invented.

## User input / dependency register to carry forward

Immediate UX decisions needing user/business/security involvement before affected flows are final: OD-01 offline access duration and logout/session recovery; OD-02 pending-submission editing/cancellation and conflict reconciliation; OD-03 deactivated unfinished task reassignment and replacement audit initiation/linkage; OD-09 initial credential handover; OD-10 post-confirmation summary correction and downstream consequences. Ask for these with concrete options, distinguish UX recommendations from decisions, and allow explicit deferral with affected flows marked provisional.

OD-04 PDF size and security handling; OD-05 actual tablet/OS/browser matrix, test conditions and named acceptance owner; OD-06 proposed performance targets; OD-08 demonstration Responsable/team provisioning remain open and must not acquire silent defaults. OD-07 is closed, not a question.

DEP-01: approved remaining field catalogue/four-page reference, mandatory/optional fields, units/formats, tolerances/boundaries/comparison, rounding/N.A./invalid handling, kVmax/K2/linearity baseline and insight rules. DEP-02: business-approved numeric and verdict reference cases including boundaries. DEP-03: approved Word template, PDF expectations, exact mandatory report/provenance/signature fields. These require external business input, not a visual-design assumption. Unresolved formula or reference input must not be disguised as validated functionality.

## Source-supported validation evidence

Keep separate happy path for both report paths and both human machine decisions; zero insights/manual-only summary; offline entry/save/restart/reconnect/retry without duplication; pending vs accepted submission; conflict preservation; rejected authorization with data preservation; linked replacement; deactivation retaining tasks/history; role/team/task access; invalid fields only using approved rules. CR-01–07 exist; CR-14 is absent. Device touch usability and actual reference calculations remain gated by OD-05 and DEP-01/02/03 respectively.
