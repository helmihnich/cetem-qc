import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";

export const LOCAL_DRAFT_SCHEMA_VERSION = 1;

export type GraphieDraftPayload = { catalogueId: string; catalogueVersion: string; schemaVersion: number; ruleId: string; ruleVersion: string; values: Record<string, string>; legacyContent?: string };

export type LocalDraft = {
  id: string;
  employeeId: string;
  taskId: string;
  payloadSchemaVersion: number;
  revision: number;
  payload: { content: string } | GraphieDraftPayload;
  createdAt: number;
  savedAt: number;
};

export type CachedSynchronizedTask = {
  employeeId: string;
  task: { id: string; establishment: string; service: string; createdAt: string };
  synchronizedAt: number;
};

export type OutboxKind = "sync-draft" | "submit";
export type OutboxStatus = "queued" | "in-flight" | "retry-paused" | "blocked" | "resolved";
export type OutboxOutcome = "accepted" | "rejected" | "conflict";

/** A durable synchronization operation, without its snapshot payload. */
export type OutboxItem = {
  operationId: string;
  idempotencyKey: string;
  employeeId: string;
  taskId: string;
  sequence: number;
  kind: OutboxKind;
  snapshotId: string;
  baseRevision: number;
  status: OutboxStatus;
  attemptCount: number;
  lastError: string | null;
  outcome: OutboxOutcome | null;
  outcomeMetadata: { serverRevision?: number; detail?: unknown } | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
};

export type NewOutboxOperation = {
  operationId: string;
  idempotencyKey: string;
  snapshotId: string;
  kind: OutboxKind;
  /** The saved draft envelope, stored as an insert-only snapshot. */
  snapshot: LocalDraft;
  createdAt: number;
};

export type OutboxTransition = { at: number } & (
  | { type: "attempt-start" }
  | { type: "retryable"; code: string; pause: boolean }
  | { type: "blocking"; code: string }
  | { type: "outcome"; outcome: OutboxOutcome; serverRevision?: number; detail?: unknown });

export type TaskSyncStatus = { hasPendingSubmission: boolean; unresolvedCount: number; lastOutcome: OutboxOutcome | null };

export type SubmissionRequest = { draft: LocalDraft; operation: OutboxItem };

export const isUnresolved = (item: OutboxItem) => item.status !== "resolved";

export class PendingSubmissionError extends Error {
  constructor() {
    super("A submission is pending for this task.");
    this.name = "PendingSubmissionError";
  }
}

export class SubmissionNotAllowedError extends Error {
  constructor() {
    super("This local draft cannot be submitted.");
    this.name = "SubmissionNotAllowedError";
  }
}

export class OutboxOperationNotFoundError extends Error {
  constructor() {
    super("Outbox operation not found or already resolved.");
    this.name = "OutboxOperationNotFoundError";
  }
}

export class LocalDraftPayloadCompatibilityError extends Error {
  constructor() {
    super("Saved local draft payload metadata is unsupported.");
    this.name = "LocalDraftPayloadCompatibilityError";
  }
}

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Object.values(value).every((item) => typeof item === "string");
}

export function parseLocalDraft(raw: string): LocalDraft {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") throw new Error("Corrupt local draft.");
  const draft = value as Record<string, unknown>;
  if (draft.payloadSchemaVersion !== LOCAL_DRAFT_SCHEMA_VERSION
    || typeof draft.id !== "string" || !draft.id
    || typeof draft.employeeId !== "string" || !draft.employeeId
    || typeof draft.taskId !== "string" || !draft.taskId
    || !Number.isSafeInteger(draft.revision) || Number(draft.revision) < 1
    || !Number.isSafeInteger(draft.createdAt) || !Number.isSafeInteger(draft.savedAt)
    || Number(draft.createdAt) < 0 || Number(draft.savedAt) < Number(draft.createdAt)
    || !draft.payload || typeof draft.payload !== "object" || Array.isArray(draft.payload)) {
    throw new Error("Corrupt or unsupported local draft.");
  }
  const payload = draft.payload as Record<string, unknown>;
  const isLegacy = typeof payload.content === "string" && Object.keys(payload).length === 1;
  if (!isLegacy && (typeof payload.catalogueId !== "string" || !payload.catalogueId
    || typeof payload.catalogueVersion !== "string"
    || !payload.catalogueVersion
    || !Number.isSafeInteger(payload.schemaVersion)
    || Object.keys(payload).some((key) => !["catalogueId", "catalogueVersion", "schemaVersion", "ruleId", "ruleVersion", "values", "legacyContent"].includes(key))
    || payload.catalogueId !== GRAPHIE_CALCULATION_IDENTITY.catalogueId
    || payload.catalogueVersion !== GRAPHIE_CALCULATION_IDENTITY.catalogueVersion
    || payload.schemaVersion !== GRAPHIE_CALCULATION_IDENTITY.schemaVersion
    || payload.ruleId !== GRAPHIE_CALCULATION_IDENTITY.ruleId
    || payload.ruleVersion !== GRAPHIE_CALCULATION_IDENTITY.ruleVersion
    || typeof payload.ruleId !== "string" || !payload.ruleId
    || typeof payload.ruleVersion !== "string" || !payload.ruleVersion
    || !isPlainStringRecord(payload.values)
    || (payload.legacyContent !== undefined && typeof payload.legacyContent !== "string"))) {
    throw new LocalDraftPayloadCompatibilityError();
  }
  return draft as unknown as LocalDraft;
}

export interface DraftRepository {
  read(employeeId: string, taskId: string): Promise<LocalDraft | null>;
  list(employeeId: string): Promise<LocalDraft[]>;
  save(employeeId: string, taskId: string, content: string | GraphieDraftPayload, expectedRevision?: number): Promise<LocalDraft>;
  delete(employeeId: string, taskId: string, expectedRevision: number): Promise<void>;
  /** Deletes the draft row for one employee and task without reading or parsing it (unreadable drafts only). */
  deleteUnreadable(employeeId: string, taskId: string): Promise<void>;
  cacheSynchronizedTask(employeeId: string, task: CachedSynchronizedTask["task"]): Promise<void>;
  replaceCachedSynchronizedTasks(employeeId: string, tasks: CachedSynchronizedTask["task"][]): Promise<void>;
  revokeCachedSynchronizedTask(employeeId: string, taskId: string): Promise<void>;
  listCachedSynchronizedTasks(employeeId: string): Promise<CachedSynchronizedTask[]>;
  /** Saves the payload and records an immutable submission snapshot plus a `submit` operation atomically. */
  requestSubmission(employeeId: string, taskId: string, payload: GraphieDraftPayload, expectedRevision?: number): Promise<SubmissionRequest>;
  listOutbox(employeeId: string): Promise<OutboxItem[]>;
  getTaskSyncStatus(employeeId: string, taskId: string): Promise<TaskSyncStatus>;
  readOutboxSnapshot(employeeId: string, operationId: string): Promise<LocalDraft>;
  recordOutboxTransition(employeeId: string, operationId: string, transition: OutboxTransition): Promise<OutboxItem>;
}

export interface DraftDatabase {
  read(employeeId: string, taskId: string): Promise<string | null>;
  list(employeeId: string): Promise<string[]>;
  /** Writes the draft and, when given, its outbox operation in one transaction. Refused while a submission is pending. */
  save(record: LocalDraft, expectedRevision?: number, operation?: NewOutboxOperation): Promise<void>;
  /** `record` is null when the stored draft is unchanged; the snapshot must then match the stored revision. */
  requestSubmission(record: LocalDraft | null, expectedRevision: number | undefined, operation: NewOutboxOperation): Promise<OutboxItem>;
  delete(employeeId: string, taskId: string, expectedRevision: number): Promise<void>;
  deleteUnreadable(employeeId: string, taskId: string): Promise<void>;
  cacheSynchronizedTask(record: CachedSynchronizedTask): Promise<void>;
  replaceCachedSynchronizedTasks(employeeId: string, records: CachedSynchronizedTask[]): Promise<void>;
  revokeCachedSynchronizedTask(employeeId: string, taskId: string): Promise<void>;
  listCachedSynchronizedTasks(employeeId: string): Promise<string[]>;
  listOutbox(employeeId: string, taskId?: string): Promise<OutboxItem[]>;
  readOutboxSnapshot(employeeId: string, operationId: string): Promise<string | null>;
  recordOutboxTransition(employeeId: string, operationId: string, transition: OutboxTransition): Promise<OutboxItem>;
}

export class DraftListCorruptionError extends Error {
  constructor(readonly drafts: LocalDraft[]) {
    super("One or more local drafts are corrupt or unsupported.");
    this.name = "DraftListCorruptionError";
  }
}

export function createDraftRepository(database: DraftDatabase, now: () => number, createId: () => string): DraftRepository {
  const queues = new Map<string, Promise<void>>();
  function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    queues.set(key, result.then(() => undefined, () => undefined));
    return result;
  }
  const scope = (employeeId: string, taskId: string) => `${employeeId}\u0000${taskId}`;
  async function assertNoPendingSubmission(employeeId: string, taskId: string) {
    const items = await database.listOutbox(employeeId, taskId);
    if (items.some((item) => item.kind === "submit" && isUnresolved(item))) throw new PendingSubmissionError();
  }
  async function readForWrite(employeeId: string, taskId: string, expectedRevision: number | undefined) {
    const raw = await database.read(employeeId, taskId);
    const previous = raw === null ? null : parseLocalDraft(raw);
    if (previous && (previous.employeeId !== employeeId || previous.taskId !== taskId)) throw new Error("Local draft scope mismatch.");
    if (expectedRevision !== undefined && (previous?.revision ?? 0) !== expectedRevision) throw new Error("Local draft changed. Reload before saving.");
    return previous;
  }
  function nextRecord(employeeId: string, taskId: string, previous: LocalDraft | null, payload: LocalDraft["payload"]): LocalDraft {
    const savedAt = Math.max(now(), previous?.savedAt ?? 0);
    return {
      id: previous?.id ?? createId(), employeeId, taskId,
      payloadSchemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
      revision: (previous?.revision ?? 0) + 1,
      payload, createdAt: previous?.createdAt ?? savedAt, savedAt,
    };
  }
  const newOperation = (kind: OutboxKind, snapshot: LocalDraft): NewOutboxOperation => ({
    operationId: createId(), idempotencyKey: createId(), snapshotId: createId(), kind, snapshot, createdAt: snapshot.savedAt,
  });
  return {
    async read(employeeId, taskId) {
      const raw = await database.read(employeeId, taskId);
      if (raw === null) return null;
      const draft = parseLocalDraft(raw);
      if (draft.employeeId !== employeeId || draft.taskId !== taskId) throw new Error("Local draft scope mismatch.");
      return draft;
    },
    async list(employeeId) {
      const drafts: LocalDraft[] = [];
      let corrupt = false;
      for (const raw of await database.list(employeeId)) {
        try {
          const draft = parseLocalDraft(raw);
          if (draft.employeeId !== employeeId) { corrupt = true; continue; }
          drafts.push(draft);
        } catch { corrupt = true; }
      }
      if (corrupt) throw new DraftListCorruptionError(drafts.sort((a, b) => b.savedAt - a.savedAt));
      return drafts.sort((a, b) => b.savedAt - a.savedAt);
    },
    async save(employeeId, taskId, content, expectedRevision) {
      return serialize(scope(employeeId, taskId), async () => {
        await assertNoPendingSubmission(employeeId, taskId);
        const previous = await readForWrite(employeeId, taskId, expectedRevision);
        const payload = typeof content === "string" ? { content } : content;
        if (JSON.stringify(previous?.payload) === JSON.stringify(payload)) return previous!;
        const record = nextRecord(employeeId, taskId, previous, payload);
        await database.save(record, previous?.revision, newOperation("sync-draft", record));
        return record;
      });
    },
    async requestSubmission(employeeId, taskId, payload, expectedRevision) {
      return serialize(scope(employeeId, taskId), async () => {
        await assertNoPendingSubmission(employeeId, taskId);
        // Only legacy content and drafts this app version cannot read are refused locally; the server validates.
        if (typeof payload !== "object" || payload === null || "content" in payload || payload.legacyContent !== undefined) throw new SubmissionNotAllowedError();
        const raw = await database.read(employeeId, taskId);
        let previous: LocalDraft | null = null;
        if (raw !== null) {
          try { previous = parseLocalDraft(raw); } catch { throw new SubmissionNotAllowedError(); }
        }
        if (previous && (previous.employeeId !== employeeId || previous.taskId !== taskId)) throw new Error("Local draft scope mismatch.");
        if (expectedRevision !== undefined && (previous?.revision ?? 0) !== expectedRevision) throw new Error("Local draft changed. Reload before saving.");
        const changed = JSON.stringify(previous?.payload) !== JSON.stringify(payload);
        const draft = changed ? nextRecord(employeeId, taskId, previous, payload) : previous!;
        if (changed) {
          try { parseLocalDraft(JSON.stringify(draft)); } catch { throw new SubmissionNotAllowedError(); }
        }
        const operation = await database.requestSubmission(changed ? draft : null, previous?.revision, newOperation("submit", draft));
        return { draft, operation };
      });
    },
    async delete(employeeId, taskId, expectedRevision) {
      return serialize(scope(employeeId, taskId), async () => {
        await assertNoPendingSubmission(employeeId, taskId);
        await database.delete(employeeId, taskId, expectedRevision);
      });
    },
    async deleteUnreadable(employeeId, taskId) {
      return serialize(scope(employeeId, taskId), async () => {
        await assertNoPendingSubmission(employeeId, taskId);
        await database.deleteUnreadable(employeeId, taskId);
      });
    },
    async cacheSynchronizedTask(employeeId, task) {
      const record: CachedSynchronizedTask = { employeeId, task: { ...task }, synchronizedAt: now() };
      await database.cacheSynchronizedTask(record);
    },
    async replaceCachedSynchronizedTasks(employeeId, tasks) {
      const synchronizedAt = now();
      await database.replaceCachedSynchronizedTasks(employeeId, tasks.map((task) => ({
        employeeId, task: { ...task }, synchronizedAt,
      })));
    },
    async revokeCachedSynchronizedTask(employeeId, taskId) {
      await database.revokeCachedSynchronizedTask(employeeId, taskId);
    },
    async listCachedSynchronizedTasks(employeeId) {
      const records: CachedSynchronizedTask[] = [];
      for (const raw of await database.listCachedSynchronizedTasks(employeeId)) {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object") throw new Error("Corrupt cached task metadata.");
        const record = value as CachedSynchronizedTask;
        if (record.employeeId !== employeeId || !record.task || typeof record.task.id !== "string"
          || typeof record.task.establishment !== "string" || typeof record.task.service !== "string"
          || typeof record.task.createdAt !== "string" || !Number.isSafeInteger(record.synchronizedAt)) {
          throw new Error("Corrupt cached task metadata.");
        }
        records.push(record);
      }
      return records;
    },
    async listOutbox(employeeId) {
      return database.listOutbox(employeeId);
    },
    async getTaskSyncStatus(employeeId, taskId) {
      const items = await database.listOutbox(employeeId, taskId);
      const unresolved = items.filter(isUnresolved);
      const lastResolved = items.filter((item) => !isUnresolved(item))
        .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0) || a.sequence - b.sequence).at(-1);
      return {
        hasPendingSubmission: unresolved.some((item) => item.kind === "submit"),
        unresolvedCount: unresolved.length,
        lastOutcome: lastResolved?.outcome ?? null,
      };
    },
    async readOutboxSnapshot(employeeId, operationId) {
      const raw = await database.readOutboxSnapshot(employeeId, operationId);
      if (raw === null) throw new OutboxOperationNotFoundError();
      const snapshot = parseLocalDraft(raw);
      if (snapshot.employeeId !== employeeId) throw new Error("Outbox snapshot scope mismatch.");
      return snapshot;
    },
    async recordOutboxTransition(employeeId, operationId, transition) {
      return database.recordOutboxTransition(employeeId, operationId, transition);
    },
  };
}
