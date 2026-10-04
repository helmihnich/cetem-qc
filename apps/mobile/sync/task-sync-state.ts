import { isUnresolved, type OutboxItem } from "../local-drafts/model";

export type TaskLifecycle = "draft" | "submission-pending" | "submitted" | "acceptance-blocked" | "conflict";
export type TransferState = "none" | "queued" | "in-flight" | "retry-paused" | "blocked"
  | "draft-synchronized" | "draft-rejected" | "draft-conflict";
export type TaskSyncState = { lifecycle: TaskLifecycle; transfer: TransferState; locked: boolean; canRetry: boolean };

const bySequence = (a: OutboxItem, b: OutboxItem) => a.sequence - b.sequence;

function unresolvedTransfer(item: OutboxItem): TransferState {
  return item.status === "resolved" ? "none" : item.status;
}

/**
 * Derives the presented state of one task from its durable outbox items (one employee and task, any order).
 * Only the latest `submit` item decides the lifecycle; a transport success alone never makes a task submitted.
 */
export function deriveTaskSyncState(items: readonly OutboxItem[]): TaskSyncState {
  const sorted = [...items].sort(bySequence);
  const submit = sorted.filter((item) => item.kind === "submit").at(-1);
  let lifecycle: TaskLifecycle = "draft";
  let transfer: TransferState = "none";
  if (submit && isUnresolved(submit)) {
    lifecycle = "submission-pending";
    // The engine sends a task's items in sequence order: an earlier attempted sync-draft that failed holds the submit back.
    transfer = unresolvedTransfer(sorted.find(isUnresolved) ?? submit);
  } else if (submit) {
    lifecycle = submit.outcome === "accepted" ? "submitted" : submit.outcome === "rejected" ? "acceptance-blocked" : "conflict";
  } else {
    const drafts = sorted.filter((item) => item.kind === "sync-draft");
    const pending = drafts.find(isUnresolved);
    const resolved = drafts.filter((item) => !isUnresolved(item)).at(-1);
    if (pending) transfer = unresolvedTransfer(pending);
    else if (resolved) transfer = resolved.outcome === "accepted" ? "draft-synchronized" : resolved.outcome === "rejected" ? "draft-rejected" : "draft-conflict";
  }
  return { lifecycle, transfer, locked: lifecycle !== "draft", canRetry: transfer === "retry-paused" || transfer === "blocked" };
}
