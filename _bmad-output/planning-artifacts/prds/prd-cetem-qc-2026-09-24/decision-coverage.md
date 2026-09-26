# Decision-log coverage audit

The user's scope clarification and all eleven supplied answers are represented below. This is a navigation aid for reviewing the append-only `.memlog.md`, not a replacement decision log or an additional approval.

| User decision | PRD coverage |
|---|---|
| Phase 1 PoV, complete Graphie Mobile workflow, AI draft in scope, no extra functionality, future evolution | §§1–2, UJ-1, FR-032–033; technology context in addendum |
| 1. Remove employee-work approval; trace four actual events | Lifecycle §4; FR-013/031/038; DR-005 |
| 2. Minimal real account operations, assigned tasks only, deactivation preservation | FR-001–010/016; DR-006; OD-03/09 |
| 3. One active tablet, pending offline submission, authoritative server acceptance, conflict preservation | FR-019–024/042; NFR-001–002; OD-02 |
| 4. Secure local drafts; session/logout policy unresolved; no silent deletion | SEC-006–007; OD-01 |
| 5. Independent but linked replacement; immutable original | FR-024/035/040; DR-001; UJ-5 |
| 6. Employee calculation feedback; Responsable insights after submission; zero insights valid | FR-027–033/042; UJ-3 |
| 7. CETEM BH source workbook formulas preserved; unspecified rules remain open; no automatic overall conformity | FR-018/025–028/038; DR-002–004; DEP-01/02 |
| 8. Official designation ends software workflow; two report routes; handwritten signature afterward | FR-014/034–036/041; report traceability paragraph; DEP-03; OD-04 |
| 9. AI retry/manual fallback with same confirmation | FR-032–033; UJ-4; SEC-011 AI control |
| 10. No general evidence attachments; official PDF remains | §2 exclusions; FR-030/034; SEC-010 |
| 11. Intended demonstration duration; nonbinding performance; open matrix/authority; preserve actual criteria | §8; OD-05/06; CR-01–13/15/16 |
| Separate confirmed/derived/open/reference categories; preserve SRS IDs | §1 classification; §§5–7 tables; §§9–10; source inventory |

The user's missing-criteria instruction was conditional. Rechecking established that CR-01–CR-07 exist; they are preserved rather than reconstructed. The correction was recorded in the log and communicated to the user.

The 2026-09-25 documentation correction is reflected in the source extraction, FR-025/026 and DEP-01: this is a derived specification, not CETEM BH approval of Markdown, and verdicts require a formula, threshold, boundary semantics and comparison rule. The notification decision is reflected in FR-015, resolved OD-07 and the addendum: in-app task visibility only for Phase 1; email delivery implementation and tests are deferred, with future architectural extension preserved.

No user decision is set aside. Detailed visual/technical source material is preserved in `addendum.md`. Business references and explicitly deferred security/configuration choices remain unresolved at the user's direction.
