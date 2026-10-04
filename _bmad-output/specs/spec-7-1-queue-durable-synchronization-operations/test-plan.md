# Test plan

All tests run under `pnpm -r test` (mobile globs already cover `local-drafts/**` and new `sync/**` test files). Never use `skip`, `only` or `todo`. Fake transport, injected `now`/`sleep`/`createId`, and the SQLite test double. No network and no real client names.

## S — Schema

| ID | Case | Expected |
|---|---|---|
| S1 | Fresh database | Ends at version 3 with all five tables. |
| S2 | Seeded v2 database with draft and cached-task rows | Upgrades to v3. The rows are byte-identical, and no `DROP` or `DELETE` statement runs. |
| S3 | Version 3 with a missing outbox table | Startup throws « schema is incomplete ». Nothing is deleted. |
| S4 | Version 4 | Refused, as today. |

## O — Outbox writes (repository + SQLite store)

| ID | Case | Expected |
|---|---|---|
| O1 | First save | One draft revision 1, one `sync-draft` snapshot, and one `queued` item with two distinct UUIDs and base 0, all in one transaction. |
| O2 | The snapshot or item insert fails | The transaction rolls back. The previous draft, snapshot and items are unchanged, and `save` rejects. |
| O3 | Two saves, the first item never attempted | One unresolved `sync-draft` item, holding the second snapshot. |
| O4 | Two saves, the first item attempted | Two unresolved items in order. The first snapshot is unchanged. |
| O5 | Save with the same payload | No new item. |
| O6 | `requestSubmission` | Draft saved, plus a `submit` snapshot and item. A never-attempted `sync-draft` item is removed, and an attempted one is kept before it. |
| O7 | Save, delete or deleteUnreadable while a submit item is unresolved | `PendingSubmissionError`. Every row is unchanged. |
| O8 | Second `requestSubmission` while one is unresolved | Refused. |
| O9 | `requestSubmission` with `legacyContent`, or with an unparseable stored draft | `SubmissionNotAllowedError`. Nothing is written. |
| O10 | Delete with only unresolved `sync-draft` items | Draft and those items and snapshots are removed together. Resolved items are kept. |
| O11 | Employee scoping | B's `listOutbox` and `getTaskSyncStatus` see none of A's items. B's delete does not touch A's items. |
| O12 | Authorization wrapper | With offline authorization locked, the outbox reads and `requestSubmission` reject through `createAuthorizedDrafts`. |

## E — Engine (fake transport)

| ID | Case | Expected |
|---|---|---|
| E1 | `accepted` | Item `resolved` with its outcome. `task_sync_state.server_revision` is set. |
| E2 | `rejected` and `conflict` | Item `resolved` with outcome and metadata. The draft row is untouched. |
| E3 | Lost response, then `accepted` | Two sends with the same operation ID and key, and one outcome. |
| E4 | Always `retryable` | Exactly 5 sends, waits of 1/2/4/8 s, then `retry-paused` with `last_error`. Later items of the task are not sent. |
| E5 | New run after `retry-paused` | Sends again with the same key. `attempt_count` keeps growing. |
| E6 | `blocking` (403 `ACCOUNT_DEACTIVATED`) | Item `blocked`, the run stops, nothing is deleted. |
| E7 | Transport throws | Counts as `retryable`. |
| E8 | Order and rebase | Items 1 and 2 have the same base. 1 is accepted with revision 4, then 2 is sent with base 4. |
| E9 | Recording the outcome fails | Item stays unresolved. The next run sends it again. |
| E10 | `isAuthorized` false | No send. |
| E11 | Two concurrent `run` calls | One run, with no duplicate send. |
| E12 | An item left `in-flight` after a restart | Sent again with the same key. |

## P — Preservation

| ID | Case | Expected |
|---|---|---|
| P1 | Restart: a new repository and engine over the same database rows | Every unresolved item and snapshot is byte-identical. |
| P2 | Logout, expiry, and `revokeCachedSynchronizedTask` | Items and snapshots untouched. |
| P3 | App render: Save during the existing autosave flow | One `sync-draft` item exists for the task. The UI is unchanged, and the existing App render tests still pass. |
