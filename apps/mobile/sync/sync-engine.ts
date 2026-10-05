import { isOpenConflict, isUnresolved, OutboxOperationNotFoundError, type DraftRepository, type LocalDraft, type OutboxItem, type OutboxKind, type OutboxTransition } from "../local-drafts/model";

export type SyncRequest = {
  operationId: string;
  idempotencyKey: string;
  kind: OutboxKind;
  employeeId: string;
  taskId: string;
  baseRevision: number;
  snapshot: LocalDraft;
  /** Keep-local lineage, sent only when the item carries it. */
  conflictOperationId?: string;
};

export type SyncResult =
  | { type: "accepted"; serverRevision: number; detail?: unknown }
  | { type: "rejected"; detail: unknown }
  | { type: "conflict"; serverRevision: number; detail: unknown }
  /** Network error, timeout, no response, HTTP 408/429/5xx. */
  | { type: "retryable"; code: string }
  /** 400, 401, 403, 404 (TASK_NOT_FOUND blocks only its task), 413, a reused idempotency key and anything unexpected. */
  | { type: "blocking"; code: string };

/** Implemented by the HTTP adapter in Story 7.3; tests use a fake. */
export interface SyncTransport {
  send(request: SyncRequest): Promise<SyncResult>;
}

export type SyncStore = Pick<DraftRepository, "listOutbox" | "readOutboxSnapshot" | "recordOutboxTransition">;

export type RunSummary = { attempts: number; resolved: number; paused: number; blocked: boolean };

/** Technical retry settings, not CETEM rules: 5 attempts per item per run, waiting 1, 2, 4 then 8 s between them. */
export const MAX_ATTEMPTS_PER_RUN = 5;
export const RETRY_WAITS_MS = [1000, 2000, 4000, 8000] as const;

/** Blocking codes that concern only one task (e.g. a reassigned task): that task stops, the run continues with the others. */
export const TASK_LEVEL_BLOCKING_CODES: readonly string[] = ["TASK_NOT_FOUND"];

type ItemResult = "resolved" | "gone" | "paused" | "skip-task" | "blocked" | "unauthorized";

function normalize(result: unknown): SyncResult {
  if (!result || typeof result !== "object") return { type: "blocking", code: "unexpected-response" };
  const value = result as Record<string, unknown>;
  const revision = (input: unknown) => Number.isSafeInteger(input) && Number(input) >= 0;
  if (value.type === "accepted" && revision(value.serverRevision)) return value as SyncResult;
  if (value.type === "conflict" && revision(value.serverRevision)) return value as SyncResult;
  if (value.type === "rejected") return value as SyncResult;
  if ((value.type === "retryable" || value.type === "blocking") && typeof value.code === "string") return value as SyncResult;
  // An unknown response is never treated as a definitive outcome.
  return { type: "blocking", code: "unexpected-response" };
}

export function createSyncEngine(options: {
  store: SyncStore;
  transport: SyncTransport;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  isAuthorized: (employeeId: string) => boolean | Promise<boolean>;
}) {
  const { store, transport, now, sleep, isAuthorized } = options;
  let active: { employeeId: string; promise: Promise<RunSummary>; followUp: boolean; followUpRetryBlocked: boolean } | null = null;

  /** Returns null when the item was deleted (explicit discard) or resolved meanwhile. */
  async function record(employeeId: string, operationId: string, transition: OutboxTransition): Promise<OutboxItem | null> {
    try {
      return await store.recordOutboxTransition(employeeId, operationId, transition);
    } catch (error) {
      if (error instanceof OutboxOperationNotFoundError) return null;
      throw error;
    }
  }

  async function sendItem(employeeId: string, item: OutboxItem, summary: RunSummary): Promise<ItemResult> {
    let snapshot: LocalDraft;
    try {
      snapshot = await store.readOutboxSnapshot(employeeId, item.operationId);
    } catch {
      // A missing or unreadable snapshot is kept untouched; the task waits for a fixed app version.
      const blocked = await record(employeeId, item.operationId, { type: "blocking", code: "snapshot-unreadable", at: now() });
      return blocked ? "skip-task" : "gone";
    }
    for (let attempt = 1; ; attempt++) {
      // Checked before every attempt: a logout, expiry or lock during the run stops it.
      if (!await isAuthorized(employeeId)) return "unauthorized";
      const current = await record(employeeId, item.operationId, { type: "attempt-start", at: now() });
      if (!current) return "gone";
      summary.attempts++;
      let result: SyncResult;
      try {
        result = normalize(await transport.send({
          operationId: current.operationId, idempotencyKey: current.idempotencyKey, kind: current.kind,
          employeeId, taskId: current.taskId, baseRevision: current.baseRevision, snapshot,
          ...(current.conflictOperationId ? { conflictOperationId: current.conflictOperationId } : {}),
        }));
      } catch {
        result = { type: "retryable", code: "transport-error" };
      }
      if (result.type === "retryable") {
        const pause = attempt >= MAX_ATTEMPTS_PER_RUN;
        if (!await record(employeeId, item.operationId, { type: "retryable", code: result.code, pause, at: now() })) return "gone";
        if (pause) { summary.paused++; return "paused"; }
        await sleep(RETRY_WAITS_MS[attempt - 1]!);
        continue;
      }
      if (result.type === "blocking") {
        if (!await record(employeeId, item.operationId, { type: "blocking", code: result.code, at: now() })) return "gone";
        return TASK_LEVEL_BLOCKING_CODES.includes(result.code) ? "skip-task" : "blocked";
      }
      const resolved = await record(employeeId, item.operationId, {
        type: "outcome", outcome: result.type, at: now(),
        serverRevision: result.type === "rejected" ? undefined : result.serverRevision, detail: result.detail,
      });
      if (!resolved) return "gone";
      summary.resolved++;
      return "resolved";
    }
  }

  async function execute(employeeId: string, retryBlocked: boolean): Promise<RunSummary> {
    const summary: RunSummary = { attempts: 0, resolved: 0, paused: 0, blocked: false };
    if (!await isAuthorized(employeeId)) return summary;
    const initial = (await store.listOutbox(employeeId)).filter(isUnresolved);
    const taskIds = [...new Set(initial.sort((a, b) => a.sequence - b.sequence).map((item) => item.taskId))];
    for (const taskId of taskIds) {
      for (;;) {
        // Reload each time: an accepted item may have moved the base revision of the next one.
        const taskItems = (await store.listOutbox(employeeId)).filter((item) => item.taskId === taskId && item.employeeId === employeeId);
        // An open conflict pauses its whole task, explicit retries included, until the Employé resolves it.
        if (taskItems.some(isOpenConflict)) break;
        const next = taskItems.filter(isUnresolved).sort((a, b) => a.sequence - b.sequence)[0];
        if (!next) break;
        // A blocked item holds its task back until an explicit retry; automatic runs leave it alone.
        if (!retryBlocked && next.status === "blocked") break;
        const result = await sendItem(employeeId, next, summary);
        if (result === "unauthorized") return summary;
        if (result === "blocked") { summary.blocked = true; return summary; }
        if (result === "paused" || result === "skip-task") break;
      }
    }
    return summary;
  }

  /**
   * One run at a time. A call for the same employee during an active run asks for exactly one follow-up run
   * (several calls still give one), and every caller's promise resolves after it with the combined summary.
   * Another employee's run starts after the active one. `retryBlocked: false` (automatic triggers) leaves
   * blocked items and their tasks waiting for an explicit retry.
   */
  function run(employeeId: string, options: { retryBlocked?: boolean } = {}): Promise<RunSummary> {
    const retryBlocked = options.retryBlocked ?? true;
    if (active?.employeeId === employeeId) {
      active.followUp = true;
      active.followUpRetryBlocked ||= retryBlocked;
      return active.promise;
    }
    if (active) return active.promise.then(() => run(employeeId, options), () => run(employeeId, options));
    const current = { employeeId, followUp: false, followUpRetryBlocked: false, promise: Promise.resolve() as unknown as Promise<RunSummary> };
    current.promise = (async () => {
      const total: RunSummary = { attempts: 0, resolved: 0, paused: 0, blocked: false };
      let includeBlocked = retryBlocked;
      do {
        current.followUp = false;
        current.followUpRetryBlocked = false;
        const summary = await execute(employeeId, includeBlocked);
        includeBlocked = current.followUpRetryBlocked;
        total.attempts += summary.attempts;
        total.resolved += summary.resolved;
        total.paused += summary.paused;
        total.blocked = summary.blocked;
      } while (current.followUp);
      return total;
    })().finally(() => { if (active === current) active = null; });
    active = current;
    return current.promise;
  }

  return { run };
}
