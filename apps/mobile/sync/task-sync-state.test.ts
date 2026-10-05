import assert from "node:assert/strict";
import test from "node:test";
import type { ConflictResolution, CorrectionDraft, OutboxItem, OutboxOutcome, OutboxStatus } from "../local-drafts/model.js";
import { deriveTaskSyncState, type TaskLifecycle, type TransferState } from "./task-sync-state.js";

function item(sequence: number, kind: OutboxItem["kind"], status: OutboxStatus, outcome: OutboxOutcome | null = null, attemptCount = 0): OutboxItem {
  return {
    operationId: `op-${sequence}`, idempotencyKey: `key-${sequence}`, employeeId: "employee-1", taskId: "task-1",
    sequence, kind, snapshotId: `snap-${sequence}`, baseRevision: 0, status, attemptCount, lastError: null,
    outcome: status === "resolved" ? outcome : null, outcomeMetadata: null,
    createdAt: sequence, updatedAt: sequence, resolvedAt: status === "resolved" ? sequence : null,
  };
}

function expectState(items: OutboxItem[], lifecycle: TaskLifecycle, transfer: TransferState, canRetry = false) {
  const { conflict, canSubmit, rejection, correction, ...state } = deriveTaskSyncState(items);
  assert.deepEqual(state, { lifecycle, transfer, locked: lifecycle !== "draft", canRetry });
  // Story 8.1: a resolved conflict item without a resolution record is an open conflict.
  assert.equal(conflict === null, !items.some((entry) => entry.outcome === "conflict"));
  assert.equal(canSubmit, lifecycle === "draft" && transfer !== "draft-conflict");
  // Story 8.2: only an uncorrected refused submission carries a rejection; no correction exists in these rows.
  assert.equal(rejection === null, lifecycle !== "acceptance-blocked");
  assert.equal(correction, null);
}

test("S1 lifecycle rows: the latest submit item decides the lifecycle and the lock", () => {
  expectState([], "draft", "none");
  expectState([item(1, "submit", "queued")], "submission-pending", "queued");
  expectState([item(1, "submit", "in-flight", null, 1)], "submission-pending", "in-flight");
  expectState([item(1, "submit", "retry-paused", null, 5)], "submission-pending", "retry-paused", true);
  expectState([item(1, "submit", "blocked", null, 1)], "submission-pending", "blocked", true);
  expectState([item(1, "submit", "resolved", "accepted")], "submitted", "none");
  expectState([item(1, "submit", "resolved", "rejected")], "acceptance-blocked", "none");
  expectState([item(1, "submit", "resolved", "conflict")], "conflict", "none");
});

test("S1 transfer rows for a draft: unresolved sync-draft status, else the latest resolved outcome", () => {
  expectState([item(1, "sync-draft", "queued")], "draft", "queued");
  expectState([item(1, "sync-draft", "in-flight", null, 1)], "draft", "in-flight");
  expectState([item(1, "sync-draft", "retry-paused", null, 5)], "draft", "retry-paused", true);
  expectState([item(1, "sync-draft", "blocked", null, 1)], "draft", "blocked", true);
  expectState([item(1, "sync-draft", "resolved", "accepted")], "draft", "draft-synchronized");
  expectState([item(1, "sync-draft", "resolved", "rejected")], "draft", "draft-rejected");
  expectState([item(1, "sync-draft", "resolved", "conflict")], "draft", "draft-conflict");
  expectState([item(1, "sync-draft", "resolved", "rejected"), item(2, "sync-draft", "resolved", "accepted")], "draft", "draft-synchronized");
});

test("S2 the newest submit by sequence decides, whatever the input order", () => {
  const older = item(1, "submit", "resolved", "rejected");
  const newer = item(4, "submit", "queued");
  expectState([older, newer], "submission-pending", "queued");
  expectState([newer, older], "submission-pending", "queued");
  const accepted = item(7, "submit", "resolved", "accepted");
  expectState([accepted, newer, older], "submitted", "none");
});

test("S3 a draft's transfer state comes from its unresolved sync-draft with the lowest sequence", () => {
  const attempted = item(2, "sync-draft", "retry-paused", null, 5);
  const queued = item(3, "sync-draft", "queued");
  expectState([queued, attempted], "draft", "retry-paused", true);
  expectState([item(1, "sync-draft", "resolved", "accepted"), queued, item(2, "sync-draft", "in-flight", null, 1)], "draft", "in-flight");
});

test("S4 a pending submit next to an accepted sync-draft stays pending", () => {
  expectState([item(1, "sync-draft", "resolved", "accepted"), item(2, "submit", "queued")], "submission-pending", "queued");
  expectState([item(2, "submit", "in-flight", null, 1), item(1, "sync-draft", "resolved", "accepted")], "submission-pending", "in-flight");
});

test("S5 a failed earlier sync-draft that holds a pending submit back shows its failure and offers a retry", () => {
  expectState([item(1, "sync-draft", "retry-paused", null, 5), item(2, "submit", "queued")], "submission-pending", "retry-paused", true);
  expectState([item(2, "submit", "queued"), item(1, "sync-draft", "blocked", null, 1)], "submission-pending", "blocked", true);
  expectState([item(1, "sync-draft", "in-flight", null, 1), item(2, "submit", "queued")], "submission-pending", "in-flight");
});

// Story 8.1 — D2: open conflicts, closed conflicts and resolutions.

function conflictItem(sequence: number, kind: OutboxItem["kind"], resolutionId: string | null = null, detail: unknown = { revision: 2 }): OutboxItem {
  return { ...item(sequence, kind, "resolved", "conflict", 1), outcomeMetadata: { serverRevision: 2, detail }, conflictResolutionId: resolutionId };
}

function resolution(choice: ConflictResolution["choice"], serverState: ConflictResolution["serverState"], covered: OutboxItem[], createdAt: number, newOperationId: string | null = null): ConflictResolution {
  return {
    resolutionId: "resolution-1", employeeId: "employee-1", taskId: "task-1", choice, serverRevision: 2, serverState, newOperationId, createdAt,
    items: covered.map((entry) => ({ operationId: entry.operationId, role: "conflict" as const, kind: entry.kind, snapshotId: entry.snapshotId })),
  };
}

test("D2 an open submit conflict, or a draft conflict with a submit queued behind it, locks the task and pauses it", () => {
  const submitConflict = conflictItem(1, "submit", null, { revision: 3, state: "draft" });
  assert.deepEqual(deriveTaskSyncState([submitConflict]), {
    lifecycle: "conflict", transfer: "none", locked: true, canRetry: false, canSubmit: false,
    conflict: { items: [{ operationId: "op-1", kind: "submit", sequence: 1 }], detail: { revision: 3, state: "draft" }, hasPendingSnapshot: true },
    rejection: null, correction: null,
  });
  const behind = deriveTaskSyncState([item(2, "submit", "queued"), conflictItem(1, "sync-draft")]);
  assert.deepEqual([behind.lifecycle, behind.transfer, behind.locked, behind.canRetry, behind.canSubmit, behind.conflict?.hasPendingSnapshot], ["conflict", "none", true, false, false, true]);
});

test("D2 an open draft conflict keeps the draft editable but not submittable, with the newest 409 detail", () => {
  const state = deriveTaskSyncState([conflictItem(1, "sync-draft", null, { revision: 1 }), conflictItem(3, "sync-draft", null, { revision: 4 })]);
  assert.deepEqual(state, {
    lifecycle: "draft", transfer: "draft-conflict", locked: false, canRetry: false, canSubmit: false,
    conflict: { items: [{ operationId: "op-1", kind: "sync-draft", sequence: 1 }, { operationId: "op-3", kind: "sync-draft", sequence: 3 }], detail: { revision: 4 }, hasPendingSnapshot: false },
    rejection: null, correction: null,
  });
});

test("D2 closed conflicts are ignored: keep-local gives an editable draft with the new queued item", () => {
  const closed = conflictItem(1, "sync-draft", "resolution-1");
  const queued = item(2, "sync-draft", "queued");
  const keepLocal = resolution("keep-local", "draft", [closed], 10, queued.operationId);
  assert.deepEqual(deriveTaskSyncState([closed, queued], [keepLocal]), { lifecycle: "draft", transfer: "queued", locked: false, canRetry: false, conflict: null, canSubmit: true, rejection: null, correction: null });
  const closedSubmit = conflictItem(1, "submit", "resolution-1");
  assert.deepEqual(deriveTaskSyncState([closedSubmit, queued], [resolution("keep-local", "draft", [closedSubmit], 10, queued.operationId)]),
    { lifecycle: "draft", transfer: "queued", locked: false, canRetry: false, conflict: null, canSubmit: true, rejection: null, correction: null });
  const accepted = { ...item(2, "sync-draft", "resolved", "accepted"), resolvedAt: 20 };
  assert.equal(deriveTaskSyncState([closed, accepted], [keepLocal]).transfer, "draft-synchronized");
});

test("D2 discard-local reads as a synchronized draft until a later item exists", () => {
  const earlier = { ...item(1, "sync-draft", "resolved", "rejected"), resolvedAt: 5 };
  const closed = conflictItem(2, "submit", "resolution-1");
  const discard = resolution("discard-local", "draft", [closed], 10);
  assert.deepEqual(deriveTaskSyncState([earlier, closed], [discard]), { lifecycle: "draft", transfer: "draft-synchronized", locked: false, canRetry: false, conflict: null, canSubmit: true, rejection: null, correction: null });
  assert.equal(deriveTaskSyncState([earlier, closed, item(3, "sync-draft", "queued")], [discard]).transfer, "queued");
  const laterRejected = { ...item(3, "sync-draft", "resolved", "rejected"), resolvedAt: 30 };
  assert.equal(deriveTaskSyncState([earlier, closed, laterRejected], [discard]).transfer, "draft-rejected");
});

test("D2 discard-local of a submitted server version is accepted evidence, locked", () => {
  const closed = conflictItem(1, "submit", "resolution-1");
  assert.deepEqual(deriveTaskSyncState([closed], [resolution("discard-local", "submitted", [closed], 10)]),
    { lifecycle: "submitted", transfer: "none", locked: true, canRetry: false, conflict: null, canSubmit: false, rejection: null, correction: null });
  // A newer open conflict wins over any resolution.
  assert.equal(deriveTaskSyncState([closed, conflictItem(2, "sync-draft")], [resolution("discard-local", "submitted", [closed], 10)]).transfer, "draft-conflict");
});

// Story 8.2 — D3: refused submissions, correction drafts and their resubmission.

function refusedItem(sequence: number, code: string | null = "INVALID_PAYLOAD", issues: unknown = [{ path: "values.header.reportNumber", code: "unpaired-surrogate" }]): OutboxItem {
  return { ...item(sequence, "submit", "resolved", "rejected", 1), outcomeMetadata: { detail: code === null ? null : { code, issues } } };
}

function correctionOf(refused: OutboxItem, createdAt: number): CorrectionDraft {
  return {
    correctionId: `correction-${refused.operationId}`, employeeId: "employee-1", taskId: "task-1", rejectedOperationId: refused.operationId,
    rejectedSnapshotId: refused.snapshotId, rejectedAt: refused.resolvedAt!, draftRevision: 3, createdAt,
  };
}

test("D3 an uncorrected refused submission is acceptance-blocked with its code and issues; AUDIT_ALREADY_SUBMITTED cannot be corrected", () => {
  const refused = refusedItem(1);
  assert.deepEqual(deriveTaskSyncState([refused]), {
    lifecycle: "acceptance-blocked", transfer: "none", locked: true, canRetry: false, conflict: null, canSubmit: false, correction: null,
    rejection: { operationId: "op-1", code: "INVALID_PAYLOAD", issues: [{ path: "values.header.reportNumber", code: "unpaired-surrogate" }], canCorrect: true },
  });
  assert.equal(deriveTaskSyncState([refusedItem(1, "AUDIT_ALREADY_SUBMITTED", [])]).rejection?.canCorrect, false);
  // A missing or unreadable detail still qualifies; malformed issues are dropped.
  assert.deepEqual(deriveTaskSyncState([refusedItem(1, null)]).rejection, { operationId: "op-1", code: null, issues: [], canCorrect: true });
  assert.deepEqual(deriveTaskSyncState([refusedItem(1, "INVALID_PAYLOAD", [{ path: 3 }, "x", { path: "", code: "not-an-object" }])]).rejection?.issues, [{ path: "", code: "not-an-object" }]);
  // An unresolved item of the task (here a sync-draft) blocks the correction until it resolves.
  assert.equal(deriveTaskSyncState([refused, item(2, "sync-draft", "queued")]).rejection?.canCorrect, false);
  // A refused sync-draft keeps the 7.2 behaviour.
  assert.equal(deriveTaskSyncState([item(1, "sync-draft", "resolved", "rejected")]).rejection, null);
});

test("D3 a corrected refusal is an editable correction draft until a later submission, which then decides the lifecycle", () => {
  const refused = refusedItem(1);
  const correction = correctionOf(refused, 10);
  assert.deepEqual(deriveTaskSyncState([refused], [], [correction]), {
    lifecycle: "draft", transfer: "none", locked: false, canRetry: false, conflict: null, canSubmit: true, rejection: null,
    correction: { rejectedOperationId: "op-1", rejectedAt: 1 },
  });
  // Saves of the correction draft keep it a correction draft.
  const saved = deriveTaskSyncState([refused, item(2, "sync-draft", "resolved", "accepted")], [], [correction]);
  assert.deepEqual([saved.lifecycle, saved.transfer, saved.canSubmit, saved.correction?.rejectedOperationId], ["draft", "draft-synchronized", true, "op-1"]);
  // Soumettre: pending and read-only, no longer labelled as a correction draft.
  const pending = deriveTaskSyncState([refused, item(3, "submit", "queued")], [], [correction]);
  assert.deepEqual([pending.lifecycle, pending.locked, pending.canSubmit, pending.correction, pending.rejection], ["submission-pending", true, false, null, null]);
  assert.equal(deriveTaskSyncState([refused, item(3, "submit", "resolved", "accepted")], [], [correction]).lifecycle, "submitted");
  // Refused again: a new rejection on the newer item, correctable again.
  const again = refusedItem(3, "INVALID_PAYLOAD", [{ path: "values.header.etablissement", code: "nul-character" }]);
  assert.deepEqual(deriveTaskSyncState([refused, again], [], [correction]).rejection,
    { operationId: "op-3", code: "INVALID_PAYLOAD", issues: [{ path: "values.header.etablissement", code: "nul-character" }], canCorrect: true });
  const second = deriveTaskSyncState([again, refused], [], [correction, correctionOf(again, 20)]);
  assert.deepEqual([second.lifecycle, second.correction], ["draft", { rejectedOperationId: "op-3", rejectedAt: 3 }]);
});

test("D3 an open conflict takes precedence over a refusal and its correction", () => {
  const refused = refusedItem(1);
  const state = deriveTaskSyncState([refused, conflictItem(2, "sync-draft")], [], [correctionOf(refused, 10)]);
  assert.deepEqual([state.lifecycle, state.transfer, state.rejection, state.canSubmit], ["draft", "draft-conflict", null, false]);
  const submitConflict = deriveTaskSyncState([refusedItem(1), conflictItem(2, "submit")]);
  assert.deepEqual([submitConflict.lifecycle, submitConflict.rejection], ["conflict", null]);
});
