# Web behavior (Responsable)

## Task list and detail

- Label the inactive assignee and show **Action required** on unfinished own-team tasks.
- Derive recovery category from authoritative task/audit/sync state. Keep `draft`, `submission pending`, `conflict`, `acceptance blocked`, and server `submitted` distinct.
- For unstarted work, offer explicit reassignment to an active own-team Employé with clear warning that a tablet may contain unsynchronized work.
- For synchronized drafts and 8.2 correction drafts, allow the Responsable to create a new recovery task/audit/draft for an active same-team successor. Explain that the source is preserved and any copied values remain attributed to the source through provenance.
- For pending/uncertain submissions, show **Resolution required** with no reassignment, delete, unlock, cancel, or retry-as-another-user action. Do not assume acceptance or rejection.
- For open conflicts, show **Resolution required** and preserve 8.1's recovery owner. Do not show reassignment as a way to resolve or unlock.
- For rejected correction work, keep the 8.2 lineage visible and offer separate recovery work, never in-place reassignment or reuse of its correction operation reference.
- For accepted evidence, use existing submitted status and 8.3 replacement action/lineage. The deactivated assignee does not disable replacement.
- For device-only unknown state, explain that the application cannot confirm tablet-only work and administrative recovery is unavailable in the PoV.

## Mutations and feedback

- Reassignment/restart is an explicit action with active same-team destination, confirmation, busy state, and success only after API acknowledgment.
- A stale state, inactive destination, permission failure, or network error leaves the form usable and writes no partial result. Refresh derived state after stale/409 responses.
- Do not expose cross-team task existence through error differences.
- French strings in `packages/i18n`; reuse existing status-badge, alert, confirmation, loading, and empty patterns.
- Acceptance UI tests must assert no recovery action on unauthorized roles and no duplicate 8.1–8.3 actions.
