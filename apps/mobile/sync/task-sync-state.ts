import { isOpenConflict, isUnresolved, type ConflictResolution, type OutboxItem, type OutboxKind } from "../local-drafts/model";

export type TaskLifecycle = "draft" | "submission-pending" | "submitted" | "acceptance-blocked" | "conflict";
export type TransferState = "none" | "queued" | "in-flight" | "retry-paused" | "blocked"
  | "draft-synchronized" | "draft-rejected" | "draft-conflict";

/** What the conflict panel needs about the task's open conflicts. */
export type OpenConflictSummary = {
  items: { operationId: string; kind: OutboxKind; sequence: number }[];
  /** The `current` metadata stored with the newest 409, as known at conflict time. */
  detail: unknown;
  /** A conflicted or unresolved `submit` keeps its submission snapshot on the device. */
  hasPendingSnapshot: boolean;
};

export type TaskSyncState = {
  lifecycle: TaskLifecycle;
  transfer: TransferState;
  locked: boolean;
  canRetry: boolean;
  conflict: OpenConflictSummary | null;
  canSubmit: boolean;
};

const bySequence = (a: OutboxItem, b: OutboxItem) => a.sequence - b.sequence;

function unresolvedTransfer(item: OutboxItem): TransferState {
  return item.status === "resolved" ? "none" : item.status;
}

/** True when the item was created after the resolution: it is new and not covered by it. */
function createdAfter(item: OutboxItem, resolution: ConflictResolution): boolean {
  if (resolution.items.some((covered) => covered.operationId === item.operationId)) return false;
  // Every unresolved item at resolution time was withdrawn, so an unresolved item is a later one.
  return item.operationId === resolution.newOperationId || isUnresolved(item) || (item.resolvedAt ?? 0) > resolution.createdAt;
}

/**
 * Derives the presented state of one task from its durable outbox items and conflict resolutions (one
 * employee and task, any order). Only the latest `submit` item decides the lifecycle; a transport success
 * alone never makes a task submitted. An open conflict pauses the task until an explicit resolution.
 */
export function deriveTaskSyncState(items: readonly OutboxItem[], resolutions: readonly ConflictResolution[] = []): TaskSyncState {
  const sorted = [...items].sort(bySequence);
  const open = sorted.filter(isOpenConflict);
  if (open.length) {
    const pendingSubmit = sorted.some((item) => item.kind === "submit" && isUnresolved(item));
    const submitConflict = open.some((item) => item.kind === "submit") || pendingSubmit;
    const conflict: OpenConflictSummary = {
      items: open.map(({ operationId, kind, sequence }) => ({ operationId, kind, sequence })),
      detail: open.at(-1)!.outcomeMetadata?.detail ?? null,
      hasPendingSnapshot: submitConflict,
    };
    return submitConflict
      ? { lifecycle: "conflict", transfer: "none", locked: true, canRetry: false, conflict, canSubmit: false }
      : { lifecycle: "draft", transfer: "draft-conflict", locked: false, canRetry: false, conflict, canSubmit: false };
  }

  const latest = [...resolutions].sort((a, b) => a.createdAt - b.createdAt).at(-1);
  const discarded = latest?.choice === "discard-local" ? latest : undefined;
  if (discarded?.serverState === "submitted" && !sorted.some((item) => item.kind === "submit" && createdAfter(item, discarded))) {
    return { lifecycle: "submitted", transfer: "none", locked: true, canRetry: false, conflict: null, canSubmit: false };
  }

  // The 7.2 rules, without the conflicts an explicit resolution closed.
  const relevant = sorted.filter((item) => item.outcome !== "conflict");
  const submit = relevant.filter((item) => item.kind === "submit").at(-1);
  let lifecycle: TaskLifecycle = "draft";
  let transfer: TransferState = "none";
  if (submit && isUnresolved(submit)) {
    lifecycle = "submission-pending";
    // The engine sends a task's items in sequence order: an earlier attempted sync-draft that failed holds the submit back.
    transfer = unresolvedTransfer(relevant.find(isUnresolved) ?? submit);
  } else if (submit) {
    lifecycle = submit.outcome === "accepted" ? "submitted" : "acceptance-blocked";
  } else {
    const drafts = relevant.filter((item) => item.kind === "sync-draft");
    const pending = drafts.find(isUnresolved);
    const resolved = drafts.filter((item) => !isUnresolved(item)).at(-1);
    if (pending) transfer = unresolvedTransfer(pending);
    else if (resolved) transfer = resolved.outcome === "accepted" ? "draft-synchronized" : "draft-rejected";
    if (discarded && !sorted.some((item) => createdAfter(item, discarded))) transfer = "draft-synchronized";
  }
  return {
    lifecycle, transfer, locked: lifecycle !== "draft",
    canRetry: transfer === "retry-paused" || transfer === "blocked",
    conflict: null,
    canSubmit: lifecycle === "draft" && !sorted.some((item) => item.kind === "submit" && isUnresolved(item)),
  };
}
