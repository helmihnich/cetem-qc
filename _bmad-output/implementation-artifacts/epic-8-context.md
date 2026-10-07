# Epic 8 Context: Conflict, Correction and Replacement Recovery

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Provide explicit recovery for synchronization conflicts, rejected submissions, accepted work that requires replacement, and unfinished work owned by a deactivated employee. Keep each recovery path distinct, preserve original authorship and historical evidence, and prevent stale or pending work from silently overwriting or changing authoritative records.

## Stories

- Story 8.1: Resolve a synchronization conflict explicitly
- Story 8.2: Create a correction draft after validation rejection
- Story 8.3: Create a Responsable-only replacement after acceptance
- Story 8.4: Handle unfinished tasks after employee deactivation

## Requirements & Constraints

- Recovery must be explicit and state-specific. A synchronization conflict, non-conflict validation rejection, server-accepted audit, and unfinished task after employee deactivation are separate outcomes with distinct actions and lineage.
- Never automatically reassign on employee deactivation. Preserve tasks, audits, accepted evidence, reports, and history; preserve the employee who authored existing measurements and comments.
- Work with no started audit may be reassigned only through an authorized Responsable action to an active employee on that Responsable’s team. For synchronized editable work, preserve its existing audit and attribution, then use a separate, attributable working audit/draft for the newly assigned employee. Do not transfer draft authorship or mutate copied historical evidence.
- Pending or immutable submissions are never automatically reassigned, modified, or deleted. Keep pending/uncertain submissions visibly unresolved until their existing sync outcome is known. Device-only work is not server-received; deactivation blocks sync as that employee. Any device-local administrative recovery is outside ordinary sync and outside the PoV recovery mechanism.
- Accepted evidence remains immutable. Only a Responsable may create a linked independent replacement after acceptance. Validation-rejected snapshots stay read-only while correction occurs in a linked draft. Conflict resolution never performs a field merge or direct stale overwrite.
- Enforce role, team, assignment, active-account, and state authorization on the server. Rejected recovery commands must not partially mutate original records.

## Technical Decisions

- Keep the modular-monolith module boundaries and server-authoritative command pattern. Protected resources require server-side authorization; multi-record recovery changes use a PostgreSQL transaction so failure leaves original work unchanged.
- Preserve typed lineage: `sync-conflict-revision` for a conflict-derived revision, `rejected-submission-correction` for a validation correction, `replacement-control` for an accepted-audit replacement, and a distinct `deactivated-assignee-recovery` relationship for recovery following deactivation. Do not conflate their state transitions.
- Maintain append-only attribution and recovery history with stable identifiers and actor/time provenance. Preserve source associations for copied values; a new working copy must not relabel prior measurements as newly authored.
- Mobile local storage and outbox remain durable through authorization loss and failures. Server revalidates authorization before sync; local-only records must not be represented as received or accepted by the server.
- Return typed validation, conflict, authorization, and retryable outcomes. A transport success alone is never authoritative acceptance. Use French user-facing copy and make recovery status and required action clear.

## UX & Interaction Patterns

Flag unfinished tasks after deactivation for an explicit Responsable decision. Show which work is unstarted, synchronized editable, pending/immutable, or known only on the device, with actions appropriate to that state. Preserve local work securely when the deactivated employee cannot access or synchronize it; do not imply that device-only data was recovered. Keep conflict resolution choices explicit and correction drafts separate from the preserved rejected attempt.

## Cross-Story Dependencies

Stories 8.1–8.4 build on durable synchronization, submission state, immutable accepted evidence, and assignment/team authorization from Epics 3, 4, and 7. The conflict and validation-correction paths remain separate from the post-acceptance replacement path. Story 8.4 must preserve all three existing recovery behaviors while adding deactivation-specific recovery and lineage.
