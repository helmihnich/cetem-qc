# Required automated test plan

## API and PostgreSQL

- Inactive assignee remains on own-team list and unfinished recovery projection is correct for unstarted, synchronized draft, pending, conflict, rejected, accepted, and replacement states.
- Responsable own-team boundary for every recovery read/write; Employee, foreign Responsable, unknown/malformed IDs denied without cross-team disclosure.
- Only active same-team Employé is eligible. Inactive, wrong-role, wrong-team, or concurrently deactivated destination is refused without writes.
- Initial assignment and every reassignment append exactly one history row with task, prior/new employee, Responsable actor, reason, and timestamp; current assignment changes atomically; cancellation/refusal adds none.
- Simultaneous/stale requests, source-state changes, failures after writes begin, and retry-after-timeout produce no partial writes or duplicate event/successor.
- Source tasks, audit revisions, outcomes, snapshots, submissions, and lineage are unchanged after each recovery command.
- Synchronized draft recovery creates a new task/audit/draft with immutable `deactivated-assignee-recovery`; source work and authorship are unchanged; copied fields retain source revision/field provenance.
- Correction recovery preserves `rejected-submission-correction`, does not reassign in place, creates separate successor work, and adds `deactivated-assignee-recovery` without reusing the old correction operation reference.
- Pending/uncertain state has no reassignment, deletion, unlock, or success/failure assumption, including after timeout or inactive-auth response.
- Migration upgrade tests preserve all existing task/assignment/audit/sync/history rows; immutable history rejects mutation.

## Web

- State matrix renders inactive assignee/action-required and routes to the appropriate recovery owner.
- Unstarted reassignment success, cancel, server refusal, inactive destination, stale state, network error, and repeated click.
- Pending/uncertain shows resolution-required with no reassign/delete/unlock/cancel/retry-as-another-user controls; conflict remains 8.1; correction recovery is distinct and preserves both lineages; accepted work delegates to 8.3 replacement.
- Tablet-only warning never claims no local data or server receipt.
- Existing cross-team list/action hiding and 8.3 accepted replacement rendering remain intact.

## Mobile/offline

- Deactivation/auth failure blocks access and sync but preserves encrypted local data, snapshots, outbox rows, references, and actor IDs.
- Switching identity cannot enumerate or consume another employee's data.
- Pending submit remains immutable and is never resubmitted under successor identity.
- Offline expiry/logout and known-deactivation behavior regression coverage.

## Gates

Run repository standard test/typecheck/contract/boundary checks when implementation is authorized. Never delete, skip, weaken, or repurpose existing tests to make recovery pass. Keep synthetic identities and payload values. No new tests are run as part of this specification-only task.
