import assert from "node:assert/strict";
import test from "node:test";
import type { OutboxItem, OutboxOutcome, OutboxStatus } from "../local-drafts/model.js";
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
  assert.deepEqual(deriveTaskSyncState(items), { lifecycle, transfer, locked: lifecycle !== "draft", canRetry });
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
