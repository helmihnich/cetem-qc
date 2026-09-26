# Architecture Spine Seam Review

Reviewed 2026-09-26 against the final PRD, UX `EXPERIENCE.md`, and `DECISIONS.md`.

## Verdict

**Changes requested.** The spine is coherent at its chosen altitude, but two ownership/state seams need explicit command and data invariants before implementation. Both could create misleading authorized history or allow an obsolete report to become Ready after a valid summary reopening.

## High findings

### H1 — Replacement lineage has two owners and no canonical cross-module invariant

**Evidence.** AD-3 assigns `tasks` task/assignment/**replacement metadata**, while `audits` owns audit history and lifecycle. AD-6 separately requires corrections, conflict revisions, and **replacements** to link to predecessors; the ER diagram expresses only an `AUDIT` self-link, while `TASK ||--|| AUDIT` fixes one task to one audit. The capability map also places replacement traceability in `audits`, `reports`, and `team-access`.

OD-03 requires an accepted audit replacement to create a *new independent task/audit* while retaining an original-task/audit link. It also requires correction drafts after a rejected submission and conflict-created revisions to remain distinct from a Responsable-created replacement.

**Failure path.** A compliant `tasks` implementation can create Task B with `replacesTaskId = Task A`; a compliant `audits` implementation can create Audit B without its own predecessor relation (or use the relation for a correction revision). History then yields different lineage depending on whether it follows task assignment or audit/report metadata. The inverse is also possible: an audit relationship exists without a task replacement relationship. Either result violates the traceable, unchanged original required by OD-03.

**Required spine change.** Define one typed immutable lineage model and one application command, for example `CreateReplacementControl`:

- specify the canonical records/keys for `replacement-control`, `rejected-submission-correction`, and `sync-conflict-revision`; do not represent these meanings by an untyped self-link;
- make the command atomically create the new task, audit, assignment, and both required predecessor links in one PostgreSQL transaction;
- name the owner of each relation and require projections/history/report queries to derive lineage from that canonical data;
- state whether an audit can have more than one task only for the explicitly defined restart/recovery path, or preserve the one-to-one invariant and create a new audit there too.

### H2 — Summary reopening and asynchronous report work can race into an obsolete Ready candidate

**Evidence.** AD-8 makes `summaries` reopen/confirmation and `reports` candidate freshness/designation owners. It says reopening marks dependent candidates outdated and designation checks a current confirmed summary, current decision, and a current Ready candidate. AD-9 makes file validation and malware scanning asynchronous provider work. UX W7 and UJ-1 require Word generation or PDF scanning to finish before Ready, and require drafts dependent on a reopened summary to stay Outdated/Superseded and be regenerated/replaced.

**Failure path.** Report candidate R begins Word generation or PDF scan using Summary V1 and Decision D1. `ReopenSummary` commits, invalidating D1 and marking R Outdated. The in-flight generator/scanner then reports success. A locally compliant reports/files handler changes R to Ready because the binary is valid; the summary module already correctly marked it outdated. Without a conditional completion rule, R has a valid-looking Ready state based on obsolete inputs and may be misclassified as “current” by a later query or designation flow.

**Required spine change.** Bind every candidate and each async job to immutable input identities: at least audit revision, summary-version ID, conformity-decision ID, plus a candidate generation/upload attempt ID. Completion must be an idempotent conditional application command that sets `Ready` only when those bindings still match the audit’s current eligible summary/decision and the candidate has not been invalidated. Otherwise retain the successful binary/scan evidence for history but leave the candidate `Outdated/Superseded` and non-designatable. `DesignateOfficialReport` must recheck the same bindings in its transaction, rather than relying on a generic Ready status.

