# Technology and UX source findings

Sources read completely: `Choix_de_la_Stack_Technologique_et_Benchmarking.docx` and `Guide_Design_UI_UX_CETEM_BH.docx`. Extracted paragraph text is saved alongside this file. Checked corresponding latest Vision/SRS passages for the material workflow conflict.

## Material conflict: audit validation/rejection remains in UX
- UX §3: "validation de l’audit, décision de conformité".
- UX §3.3 Decisions row: "Valider / non valider l’audit ; puis Machine conforme / non conforme"; emphasis says these are "deux décisions distinctes".
- UX §5 lists Audit validé / Audit non validé.
- UX §9 report Decision row requires "Validation de l’audit + conformité machine".
- Latest SRS revision history says "Suppression de la validation ou du rejet du travail"; §2 role and FR-039 use direct machine conformity after confirmed summary.
- Latest Vision states "Il n’existe pas d’étape de validation ou de rejet du travail de l’Employé", but its own report scope row still says "Après validation de l’audit".
- Ask whether the latest direct-conformity workflow should replace all stale audit validation/rejection states, actions and report fields. User's described workflow strongly supports this, but requested explicit clarification of other material conflicts.

## Unresolved or scope-sensitive points
- UX §7.3 says a divergence dialog shows timestamps and "les actions autorisées", but does not define authorized actions or who may select them. Vision/SRS prohibit silent overwrite; product policy still needs clarification if no other source supplies it.
- UX §3.1 navigation suggests Équipements, Paramètres, dashboard, separate Audits lists. §3.2 proposes metrics; §14 calls Dashboard a priority screen. Treat these as design proposals, not automatic extra functional scope; user explicitly prohibits adding functionality. Equipment registry/settings CRUD is not established by these labels.
- Technology §4.2 touts one mobile codebase for iOS and Android and §8 recommends testing both; no hard target-platform requirement follows. Confirm actual PoV tablet OS/device as an acceptance constraint if absent elsewhere, without assuming both platforms are deliverables.
- Technology §10 says initial workflow should continue with AI disabled/replaced. This is a proposed resilience capability, not clearly a Phase 1 acceptance requirement; decide what the human workflow does if summary service fails only if not specified elsewhere.

## Already resolved by user; do not ask again
- Technology §1 defers AI summary generation ("ultérieurement"); user explicitly puts constrained AI draft summaries into Phase 1.
- Technology §9 calls stack the "première version de production"; user explicitly sets PoV target while retaining evolution path.

## Consistent, not conflicts
- UX §9 includes either generated Word or uploaded externally prepared PDF, manual signature, official read/download report, immutable completed audits. Do not infer automatic PDF generation or electronic signatures.
- UX §7.2 requires local offline drafts and immediate derived values/verdicts. This supports offline calculation, but offline deterministic insight generation is not explicitly settled by this guide.
- UI appearance, font alternatives, styling and framework recommendations are design/architecture work; no need to burden user with these before PRD.
