export const LOCAL_DRAFT_SCHEMA_VERSION = 1;

export type GraphieDraftPayload = { catalogueId: string; catalogueVersion: string; schemaVersion: number; values: Record<string, string>; legacyContent?: string };

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
    || Object.keys(payload).some((key) => !["catalogueId", "catalogueVersion", "schemaVersion", "values", "legacyContent"].includes(key))
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
}

export interface DraftDatabase {
  read(employeeId: string, taskId: string): Promise<string | null>;
  list(employeeId: string): Promise<string[]>;
  save(record: LocalDraft, expectedRevision?: number): Promise<void>;
  delete(employeeId: string, taskId: string, expectedRevision: number): Promise<void>;
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
        const raw = await database.read(employeeId, taskId);
        const previous = raw === null ? null : parseLocalDraft(raw);
        if (previous && (previous.employeeId !== employeeId || previous.taskId !== taskId)) throw new Error("Local draft scope mismatch.");
        if (expectedRevision !== undefined && (previous?.revision ?? 0) !== expectedRevision) throw new Error("Local draft changed. Reload before saving.");
        const payload = typeof content === "string" ? { content } : content;
        if (JSON.stringify(previous?.payload) === JSON.stringify(payload)) return previous!;
        const savedAt = Math.max(now(), previous?.savedAt ?? 0);
        const record: LocalDraft = {
          id: previous?.id ?? createId(), employeeId, taskId,
          payloadSchemaVersion: LOCAL_DRAFT_SCHEMA_VERSION,
          revision: (previous?.revision ?? 0) + 1,
          payload, createdAt: previous?.createdAt ?? savedAt, savedAt,
        };
        await database.save(record, previous?.revision);
        return record;
      });
    },
    async delete(employeeId, taskId, expectedRevision) {
      return serialize(scope(employeeId, taskId), () => database.delete(employeeId, taskId, expectedRevision));
    },
  };
}
