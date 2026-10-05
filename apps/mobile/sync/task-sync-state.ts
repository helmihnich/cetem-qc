import {
  isOpenConflict, isUnresolved, NON_CORRECTABLE_REJECTION_CODE, rejectionCode,
  type ConflictResolution, type CorrectionDraft, type OutboxItem, type OutboxKind,
} from "../local-drafts/model";

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

export type RejectionIssue = { path: string; code: string };

/** The task's uncorrected refused submission, with its stored detail. */
export type RejectionSummary = { operationId: string; code: string | null; issues: RejectionIssue[]; canCorrect: boolean };

/** The correction draft currently worked on: set until a later submission exists. */
export type CorrectionSummary = { rejectedOperationId: string; rejectedAt: number };

export type TaskSyncState = {
  lifecycle: TaskLifecycle;
  transfer: TransferState;
  locked: boolean;
  canRetry: boolean;
  conflict: OpenConflictSummary | null;
  canSubmit: boolean;
  rejection: RejectionSummary | null;
  correction: CorrectionSummary | null;
};

const bySequence = (a: OutboxItem, b: OutboxItem) => a.sequence - b.sequence;

/** The stored `issues` of a rejected item; malformed entries are dropped. */
export function rejectionIssues(item: OutboxItem): RejectionIssue[] {
  const detail = item.outcomeMetadata?.detail;
  const issues = typeof detail === "object" && detail !== null ? (detail as { issues?: unknown }).issues : undefined;
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue): issue is RejectionIssue => typeof issue === "object" && issue !== null
    && typeof (issue as RejectionIssue).path === "string" && typeof (issue as RejectionIssue).code === "string")
    .map(({ path, code }) => ({ path, code }));
}

/** The latest correction while no `submit` item was created after its refused item, else null. */
function currentCorrection(sorted: readonly OutboxItem[], corrections: readonly CorrectionDraft[]): CorrectionSummary | null {
  const latest = [...corrections].sort((a, b) => a.createdAt - b.createdAt).at(-1);
  if (!latest) return null;
  const refused = sorted.find((item) => item.operationId === latest.rejectedOperationId);
  if (!refused || sorted.some((item) => item.kind === "submit" && item.sequence > refused.sequence)) return null;
  return { rejectedOperationId: latest.rejectedOperationId, rejectedAt: latest.rejectedAt };
}

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
 * alone never makes a task submitted. An open conflict pauses the task until an explicit resolution. A refused
 * submission blocks the task until a correction draft covers it.
 */
export function deriveTaskSyncState(
  items: readonly OutboxItem[],
  resolutions: readonly ConflictResolution[] = [],
  corrections: readonly CorrectionDraft[] = [],
): TaskSyncState {
  const sorted = [...items].sort(bySequence);
  const correction = currentCorrection(sorted, corrections);
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
      ? { lifecycle: "conflict", transfer: "none", locked: true, canRetry: false, conflict, canSubmit: false, rejection: null, correction }
      : { lifecycle: "draft", transfer: "draft-conflict", locked: false, canRetry: false, conflict, canSubmit: false, rejection: null, correction };
  }

  const latest = [...resolutions].sort((a, b) => a.createdAt - b.createdAt).at(-1);
  const discarded = latest?.choice === "discard-local" ? latest : undefined;
  if (discarded?.serverState === "submitted" && !sorted.some((item) => item.kind === "submit" && createdAfter(item, discarded))) {
    return { lifecycle: "submitted", transfer: "none", locked: true, canRetry: false, conflict: null, canSubmit: false, rejection: null, correction: null };
  }

  // The 7.2 rules, without the conflicts an explicit resolution closed and without corrected refused submissions.
  const corrected = new Set(corrections.map((entry) => entry.rejectedOperationId));
  const relevant = sorted.filter((item) => item.outcome !== "conflict");
  const latestSubmit = relevant.filter((item) => item.kind === "submit").at(-1);
  if (latestSubmit?.outcome === "rejected" && !corrected.has(latestSubmit.operationId)) {
    const code = rejectionCode(latestSubmit);
    return {
      lifecycle: "acceptance-blocked", transfer: "none", locked: true, canRetry: false, conflict: null, canSubmit: false, correction: null,
      rejection: {
        operationId: latestSubmit.operationId, code, issues: rejectionIssues(latestSubmit),
        canCorrect: code !== NON_CORRECTABLE_REJECTION_CODE && !sorted.some(isUnresolved),
      },
    };
  }
  const submit = relevant.filter((item) => item.kind === "submit" && !corrected.has(item.operationId)).at(-1);
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
    rejection: null,
    correction,
  };
}
