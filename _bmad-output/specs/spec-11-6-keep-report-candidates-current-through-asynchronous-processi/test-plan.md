# Test plan — Story 11.6

Local PostgreSQL harness, `memory` storage, synthetic PDFs, scanner `none` or injected fake. Zero skipped. Extend the existing route test files (`report-candidate-routes`, `pdf-report-candidate-routes`, `official-report-routes` `.postgres.test.ts`); existing assertions stay unchanged. Use the 11.1 R15 pause seam (`reportCommandTestSeams`) to run changes between insert and completion.

## Route / command tests
- **A1** Generation paused; summary reopened before completion → outcome `outdated`, 409 `REPORT_INPUTS_CHANGED`, object kept and downloadable, designation 409 `REPORT_CANDIDATE_OUTDATED` (existing R15 stays green).
- **A2** Same with a conformity re-decision → `outdated`.
- **A3** Same with a newer accepted audit revision of the task (new submission, summary and decision possibly re-confirmed on it) → candidate bound to the old revision records `outdated`, never `ready`; list shows `outdated`; a fresh generation on the new revision is `ready` and designatable.
- **A4** Task unreadable for the Responsable at completion (seam) → `outdated`, object kept.
- **A5** Another candidate designated while generation is paused → outcome recorded, candidate reads `superseded`, designation → 409 `REPORT_ALREADY_OFFICIAL`; no new `ready`.
- **A6** Unchanged inputs → 201 `ready`, designatable (regression).
- **A7** Replay of the paused attempt after completion returns the stored `outdated` (409 `REPORT_INPUTS_CHANGED`) without a new row.
- **B1** PDF candidate `ready`; harness inserts a `threat` scan row → list reads `outdated`, designation 409 `REPORT_CANDIDATE_OUTDATED`, list status equals designation eligibility; the candidate and outcome rows are untouched.
- **B2** PDF candidate; harness inserts an `unavailable` scan row as the latest → `outdated` in list; a later `clean` row (rescan) → `ready` again and designatable.
- **B3** File with scan result arriving after an attach request started (fake scanner that resolves late; attach issued before scan finished) → attach 409 `REPORT_FILE_NOT_READY` until the scan is clean, no candidate row written early.
- **B4** An `official` PDF candidate stays `official` when its file later reads non-ready.
- **B5** `files` imports no `reports`; `reports` imports `files` only via its index (boundaries check).
- **C1** Row-count snapshots: only the outcome row (A1–A5) is written; no storage or scanner call in designation or in list; no write to `stored_files`, `stored_file_checks`, evidence, summaries, decisions, `tasks.updated_at`.
- **C2** Logs: only event, actor ID and class; no IDs, names, paths.

## Web render tests — `report-candidates-render.test.tsx`
- **W1** Generation in flight shows « Génération en cours… », controls disabled; completion 409 `REPORT_INPUTS_CHANGED` shows the French alert and the candidate « Obsolète — les données ont changé » without designation control.
- **W2** PDF candidate with status `outdated` (file not ready) shows no designation control and no « Prêt ».
- **W3** After a generate/attach/designate action the candidate list is re-read from the server (one extra GET) and a status changed meanwhile is displayed.
- **W4** No English text; all earlier 11.1–11.5 web tests pass unmodified.

## Gates
`pnpm -r test`, `pnpm -r typecheck`, `pnpm boundaries:check`, `pnpm contracts:check`, `git diff --check`.
