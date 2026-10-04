import { isUnresolved, OutboxOperationNotFoundError, type DraftRepository, type LocalDraft, type OutboxItem, type OutboxKind, type OutboxTransition } from "../local-drafts/model";

export type SyncRequest = {
  operationId: string;
  idempotencyKey: string;
  kind: OutboxKind;
  employeeId: string;
  taskId: string;
  baseRevision: number;
  snapshot: LocalDraft;
};

export type SyncResult =
  | { type: "accepted"; serverRevision: number; detail?: unknown }
  | { type: "rejected"; detail: unknown }
  | { type: "conflict"; serverRevision: number; detail: unknown }
  /** Network error, timeout, no response, HTTP 408/429/5xx. */
  | { type: "retryable"; code: string }
  /** 401, 403 (including ACCOUNT_DEACTIVATED and TASK_NOT_ASSIGNED) and anything unexpected. */
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
  let active: { employeeId: string; promise: Promise<RunSummary> } | null = null;

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
        return await record(employeeId, item.operationId, { type: "blocking", code: result.code, at: now() }) ? "blocked" : "gone";
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

  async function execute(employeeId: string): Promise<RunSummary> {
    const summary: RunSummary = { attempts: 0, resolved: 0, paused: 0, blocked: false };
    if (!await isAuthorized(employeeId)) return summary;
    const initial = (await store.listOutbox(employeeId)).filter(isUnresolved);
    const taskIds = [...new Set(initial.sort((a, b) => a.sequence - b.sequence).map((item) => item.taskId))];
    for (const taskId of taskIds) {
      for (;;) {
        // Reload each time: an accepted item may have moved the base revision of the next one.
        const next = (await store.listOutbox(employeeId))
          .filter((item) => item.taskId === taskId && item.employeeId === employeeId && isUnresolved(item))
          .sort((a, b) => a.sequence - b.sequence)[0];
        if (!next) break;
        const result = await sendItem(employeeId, next, summary);
        if (result === "unauthorized") return summary;
        if (result === "blocked") { summary.blocked = true; return summary; }
        if (result === "paused" || result === "skip-task") break;
      }
    }
    return summary;
  }

  /** One run at a time: a call for the same employee during an active run returns that run's promise; another employee's run starts after it. */
  function run(employeeId: string): Promise<RunSummary> {
    if (active?.employeeId === employeeId) return active.promise;
    if (active) return active.promise.then(() => run(employeeId), () => run(employeeId));
    const promise = execute(employeeId).finally(() => { if (active?.promise === promise) active = null; });
    active = { employeeId, promise };
    return promise;
  }

  return { run };
}
