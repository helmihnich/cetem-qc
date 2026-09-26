# SRS input reconciliation

**Verdict: reconciled with two small fidelity corrections recommended; no material workflow omission or unintended functionality found.** Compared full SRS v0.7 and the user's eleven overriding decisions against `prd.md` and `addendum.md`. User-deferred decisions remain deferred. The prior CR-01–07 absence claim was erroneous: all seven are present in the PoV, and the PRD correctly preserves them. The source inventory has been corrected accordingly.

## Complete ID accounting

- FR-001–014 and FR-016–023, FR-025–026, FR-028–034, FR-038, FR-040–042: all present as confirmed requirements, with explicit clarifications/overrides correctly incorporated. FR-011 is correctly derived rather than confirmed within that range.
- FR-015: explicitly accounted as unresolved source conflict (SRS confirmed in-app/email delivery versus PoV real-notification integration exclusion), OD-07. User clarification is pending; no channel was silently selected. Assigned-task availability remains confirmed.
- FR-024: source derived, elevated explicitly by user confirmation; correctly marked C, formerly D.
- FR-027: source derived plus user confirmation of employee-facing calculated/tolerance results; classification preserved.
- FR-035–036: derived, with report-generation paths explicitly confirmed; both Word and manual PDF remain present.
- FR-037 and FR-039: absent from source and correctly not invented.
- DR-001–004 and DR-007–009: derived and present; DR-005–006 confirmed and present. DR-005 obsolete approval event replaced by the four user-confirmed actor/date events. DR-007 report presentation correctly remains a template dependency while internal provenance remains required.
- NFR-001–002 and NFR-007: derived and present. NFR-008: confirmed and present. NFR-003–006: proposed and preserved in validation section, not binding.
- SEC-001–005, SEC-007–009, SEC-012 and both SEC-011 occurrences: derived and present, with explicit user-confirmed boundaries where relevant. Both SEC-011 security logging and AI-control occurrences remain distinguishable without renumbering.
- SEC-006: source proposed; PRD separates confirmed revocation/preservation boundaries from unresolved configuration. SEC-010: proposed, official-PDF-only scope, with file policy/size unresolved.
- VAL-001–005: mapped to unresolved performance/device/session/rules/PDF decisions or reference dependencies. VAL-006: correctly resolved by excluding signed-scan reintegration.

All 40 FR, 9 DR, 8 NFR and 13 SEC source entries are accounted for. No missing-ID reconstruction is needed.

## Recommended small corrections

1. **SEC-005 breadth:** SRS requires TLS for *all client-server communications*; PRD currently says authenticated traffic. Preserve the broader wording, including credential exchange/activation: “All client-server communications use TLS; plaintext connections are refused or safely redirected; no authenticated plaintext endpoint is deployed.” This avoids accidental narrowing of a derived security requirement.
2. **NFR-005 error behavior:** PRD preserves the proposed <30s/95% target but omits the source's recoverable report-generation error message. Restore this as part of the proposed requirement's observable behavior without making the performance target binding. Addendum describes general errors but not this specific report failure acceptance detail.

Neither correction changes the user-approved scope or requires reopening an unresolved decision.

## Important preserved boundaries

No employee-initiated control or work-approval step; server acceptance is the immutability point; pending offline data survives failure; conflict preserves both versions without automatic merging; replacements are independent linked records; employee sees calculations/tolerance feedback but does not review insights; normal audits allow zero retained insights; AI drafts only, with manual fallback and human confirmation; machine decision remains human; official designation ends software workflow. No invented formulas, report fields, session duration, PDF limit, acceptance authority or performance commitments. Existing temporary-password activation (FR-004/SEC-012) is preserved rather than silently removed.
