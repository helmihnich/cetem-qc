# Workflow reconciliation — 2026-09-24

Compared full Workflow v0.4 extraction with prd.md and addendum.md using user decisions.

**Result:** PRD journeys/lifecycle follow Responsable assignment → field entry/calculations → accepted submission → Responsable insights → confirmed summary → human machine decision → official report. Offline pending semantics, preserved conflicting versions, no automatic merge, AI fallback, zero insights, deactivation handling, linked new control and read-only history accurately apply user overrides. AS-IS future-AI copy errors are not propagated.

**Source details compressed:** Workflow §7 allows regenerating/replacing a draft report before officialization; PRD/addendum distinguish draft and official but do not explicitly preserve this allowed pre-finalization behavior. Low-priority clarification: state draft Word can be regenerated/manual PDF replaced before designation, subject to existing confirmation/decision gates, if this is intended as retained source behavior. Do not invent post-final corrections.

**No blocking conflict:** WF-04 employee/pre-submission manual insight, submitted employee insight rows, old work decision and generic evidence attachment are correctly superseded. No rule requires an insight to manufacture completion. Exact summary changes after confirmation are explicitly unresolved; this is appropriate.

**Traceability:** DR-007–009 cover rule/source/manual authorship, selections/discards and AI inputs. Report representation and signature fields remain dependent on approved template; do not force every internal metadata field into report. Optional manual justification is consistent with SRS priority to be checked by its reviewer, despite workflow suggesting justification.

