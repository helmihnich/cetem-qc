import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import test, { mock } from "node:test";
import { EMPLOYEE_CONTENT_HORIZONTAL_GUTTER } from "./employee-task-layout.js";
import { createOfflineAuthorizationService } from "./offline-authorization-state.js";
import { runOnlyWhenOnlineAuthorized } from "./server-work-authorization.js";
import { GRAPHIE_MOBILE_POV_CATALOGUE, createNewGraphieDraftValues } from "./graphie-pov-catalogue.js";
import { fr } from "@cetem-qc/i18n";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import type { SyncRequest, SyncResult, SyncTransport } from "./sync/sync-engine.js";

const runtime = globalThis as typeof globalThis & {
  __mobileTestWidth?: number;
  __mobileTestApi?: MockApi;
  __recoverySeed?: unknown;
  __secureValues?: Map<string, string>;
  __networkListener?: (state: { isConnected?: boolean; isInternetReachable?: boolean }) => void;
  __networkOnline?: boolean;
  __sessionAvailable?: boolean;
  __sessionFailure?: { status: number; code: string };
  __testNow?: number;
  __draftRows?: Map<string, string>;
  __cachedTaskRows?: Map<string, string>;
  __outboxRows?: Map<string, OutboxTestRow>;
  __snapshotRows?: Map<string, { employee_id: string; payload_json: string }>;
  __employeeId?: string;
  __holdDraftWrite?: Promise<void>;
  __draftWriteStarted?: () => void;
  __holdDraftRead?: Promise<void>;
  __draftReadStarted?: () => void;
  __holdDraftReadByTask?: Map<string, Promise<void>>;
  __draftReadStartedByTask?: Map<string, () => void>;
  __holdTaskListByEmployee?: Map<string, Promise<void>>;
  __taskListStartedByEmployee?: Map<string, () => void>;
  __holdTaskDetailById?: Map<string, Promise<void>>;
  __taskDetailStartedById?: Map<string, () => void>;
  __cacheWriteFailure?: boolean;
  __revokedTaskIds?: Set<string>;
  __failTaskDetailById?: Set<string>;
  __assignedTasksByEmployee?: Map<string, Task[]>;
  __failTaskListForEmployee?: Set<string>;
  __failDraftList?: boolean;
  __failDraftDelete?: boolean;
  __syncTransport?: SyncTransport | null;
  __appStateListeners?: Set<(state: string) => void>;
  __failOutboxList?: boolean;
  __failOutboxInsert?: boolean;
  __syncStateRows?: Map<string, number>;
  __resolutionRows?: Map<string, Record<string, unknown>>;
  __resolutionItemRows?: Map<string, Record<string, unknown>>;
  __correctionRows?: Map<string, Record<string, unknown>>;
  __failCorrectionInsert?: boolean;
};
type OutboxTestRow = {
  operation_id: string; idempotency_key: string; employee_id: string; task_id: string; sequence: number; kind: string;
  snapshot_id: string; base_revision: number; status: string; attempt_count: number; last_error: string | null;
  outcome: string | null; outcome_json: string | null; created_at: number; updated_at: number; resolved_at: number | null;
  conflict_operation_id?: string | null;
  correction_operation_id?: string | null;
};
let testUuid = 0;
/** Story 8.2 correction drafts table (insert-only) for the App double. */
function correctionStatement(kind: "first" | "all" | "run", sql: string, params: unknown[]): { handled: boolean; value?: unknown } {
  if (!sql.includes("correction_drafts")) return { handled: false };
  runtime.__correctionRows ??= new Map();
  if (kind === "run" && sql.includes("INSERT INTO correction_drafts")) {
    if (runtime.__failCorrectionInsert) throw new Error("correction write failed");
    const [correction_id, employee_id, task_id, rejected_operation_id, rejected_snapshot_id, rejected_at, draft_revision, created_at] = params;
    runtime.__correctionRows.set(String(correction_id), { correction_id, employee_id, task_id, rejected_operation_id, rejected_snapshot_id, rejected_at, draft_revision, created_at });
    return { handled: true, value: { changes: 1, lastInsertRowId: 1 } };
  }
  if (kind === "all") {
    const rows = [...runtime.__correctionRows.values()].filter((row) => row.employee_id === params[0] && (!sql.includes("task_id = ?") || row.task_id === params[1]));
    return { handled: true, value: rows.sort((a, b) => Number(a.created_at) - Number(b.created_at)) };
  }
  throw new Error(`Unsupported correction statement in the App double: ${sql}`);
}
/** Story 8.1 conflict resolution tables (insert-only) for the App double. */
function resolutionStatement(kind: "first" | "all" | "run", sql: string, params: unknown[]): { handled: boolean; value?: unknown } {
  if (!/INSERT INTO conflict_resolution|FROM conflict_resolution/.test(sql) || sql.includes("FROM outbox_operations")) return { handled: false };
  runtime.__resolutionRows ??= new Map();
  runtime.__resolutionItemRows ??= new Map();
  if (kind === "run" && sql.includes("INSERT INTO conflict_resolutions")) {
    const [resolution_id, employee_id, task_id, choice, server_revision, server_state, new_operation_id, created_at] = params;
    runtime.__resolutionRows.set(String(resolution_id), { resolution_id, employee_id, task_id, choice, server_revision, server_state, new_operation_id, created_at });
  } else if (kind === "run" && sql.includes("INSERT INTO conflict_resolution_items")) {
    const [operation_id, resolution_id, employee_id, role, itemKind, snapshot_id] = params;
    runtime.__resolutionItemRows.set(String(operation_id), { operation_id, resolution_id, employee_id, role, kind: itemKind, snapshot_id });
  } else if (kind === "all") {
    const source = sql.includes("FROM conflict_resolution_items") ? runtime.__resolutionItemRows : runtime.__resolutionRows;
    return { handled: true, value: [...source.values()].filter((row) => row.employee_id === params[0]) };
  } else throw new Error(`Unsupported conflict resolution statement in the App double: ${sql}`);
  return { handled: true, value: { changes: 1, lastInsertRowId: 1 } };
}
// Minimal outbox tables for the App double; the real SQL is exercised in local-drafts and sync tests.
function outboxStatement(kind: "first" | "all" | "run", sql: string, params: unknown[]): { handled: boolean; value?: unknown } {
  const resolution = resolutionStatement(kind, sql, params);
  if (resolution.handled) return resolution;
  const correction = correctionStatement(kind, sql, params);
  if (correction.handled) return correction;
  if (!/outbox_operations|audit_snapshots|task_sync_state/.test(sql)) return { handled: false };
  if (kind !== "run" && sql.includes("FROM outbox_operations")) {
    // The outbox reads join the covering conflict resolution (Story 8.1).
    const result = outboxRows(kind, sql, params);
    const withResolution = (row: OutboxTestRow) => {
      const covered = runtime.__resolutionItemRows?.get(row.operation_id);
      return {
        ...row, conflict_operation_id: row.conflict_operation_id ?? null, conflict_resolution_id: covered?.role === "conflict" ? covered.resolution_id : null,
        correction_operation_id: row.correction_operation_id ?? null,
      };
    };
    const value = result.value as OutboxTestRow | OutboxTestRow[] | null | undefined;
    if (!result.handled || !value || !("operation_id" in value || Array.isArray(value))) return result;
    return { handled: true, value: Array.isArray(value) ? value.map(withResolution) : withResolution(value) };
  }
  return outboxRows(kind, sql, params);
}
function outboxRows(kind: "first" | "all" | "run", sql: string, params: unknown[]): { handled: boolean; value?: unknown } {
  runtime.__outboxRows ??= new Map();
  runtime.__snapshotRows ??= new Map();
  runtime.__syncStateRows ??= new Map();
  const outbox = runtime.__outboxRows;
  const snapshots = runtime.__snapshotRows;
  const [employeeId, second] = params.map(String);
  if (kind === "run") {
    if (sql.includes("INSERT INTO audit_snapshots")) {
      snapshots.set(String(params[0]), { employee_id: String(params[1]), payload_json: String(params[5]) });
    } else if (sql.includes("INSERT INTO outbox_operations")) {
      if (runtime.__failOutboxInsert) throw new Error("outbox write failed");
      const [operation_id, idempotency_key, employee_id, task_id, sequence, kind, snapshot_id, base_revision, created_at, updated_at, conflict_operation_id, correction_operation_id] = params;
      outbox.set(String(operation_id), {
        operation_id: String(operation_id), idempotency_key: String(idempotency_key), employee_id: String(employee_id), task_id: String(task_id),
        sequence: Number(sequence), kind: String(kind), snapshot_id: String(snapshot_id), base_revision: Number(base_revision), status: "queued",
        attempt_count: 0, last_error: null, outcome: null, outcome_json: null, created_at: Number(created_at), updated_at: Number(updated_at), resolved_at: null,
        conflict_operation_id: conflict_operation_id === undefined || conflict_operation_id === null ? null : String(conflict_operation_id),
        correction_operation_id: correction_operation_id === undefined || correction_operation_id === null ? null : String(correction_operation_id),
      });
    } else if (sql.includes("DELETE FROM outbox_operations")) outbox.delete(employeeId!);
    else if (sql.includes("DELETE FROM audit_snapshots")) snapshots.delete(employeeId!);
    else if (sql.includes("INSERT INTO task_sync_state")) runtime.__syncStateRows.set(`${employeeId}/${second}`, Number(params[2]));
    else if (sql.includes("UPDATE outbox_operations SET status = 'in-flight'")) {
      const row = outbox.get(String(params[1]))!;
      Object.assign(row, { status: "in-flight", attempt_count: row.attempt_count + 1, updated_at: Number(params[0]) });
    } else if (sql.includes("UPDATE outbox_operations SET status = 'resolved'")) {
      Object.assign(outbox.get(String(params[4]))!, { status: "resolved", outcome: String(params[0]), outcome_json: String(params[1]), resolved_at: Number(params[2]), updated_at: Number(params[3]) });
    } else if (sql.includes("UPDATE outbox_operations SET status = ?")) {
      Object.assign(outbox.get(String(params[3]))!, { status: String(params[0]), last_error: String(params[1]), updated_at: Number(params[2]) });
    } else if (sql.includes("UPDATE outbox_operations SET base_revision")) {
      const [revision, at, employee, task, sequence, base] = params;
      for (const row of outbox.values()) {
        if (row.employee_id === employee && row.task_id === task && row.status !== "resolved" && row.sequence > Number(sequence) && row.base_revision === base) {
          Object.assign(row, { base_revision: Number(revision), updated_at: Number(at) });
        }
      }
    }
    else throw new Error(`Unsupported outbox statement in the App double: ${sql}`);
    return { handled: true, value: { changes: 1, lastInsertRowId: 1 } };
  }
  if (runtime.__failOutboxList && kind === "all" && sql.includes("ORDER BY sequence")) throw new Error("outbox read failed");
  if (sql.includes("FROM audit_snapshots WHERE snapshot_id = ?")) {
    const snapshot = snapshots.get(employeeId!);
    return { handled: true, value: snapshot && snapshot.employee_id === second ? { payload_json: snapshot.payload_json } : null };
  }
  if (sql.includes("correction_operation_id = ?")) {
    const linked = [...outbox.values()].find((row) => row.employee_id === employeeId && row.task_id === second
      && row.correction_operation_id === String(params[2]) && row.outcome === "accepted");
    return { handled: true, value: linked ? { operation_id: linked.operation_id } : null };
  }
  const rows = [...outbox.values()].filter((row) => row.employee_id === employeeId).sort((a, b) => a.sequence - b.sequence);
  if (sql.includes("MAX(sequence)")) return { handled: true, value: { next_sequence: Math.max(0, ...[...outbox.values()].map((row) => row.sequence)) + 1 } };
  if (sql.includes("FROM task_sync_state")) {
    const revision = runtime.__syncStateRows!.get(`${employeeId}/${second}`);
    return { handled: true, value: revision === undefined ? null : { server_revision: revision } };
  }
  if (sql.includes("JOIN audit_snapshots")) {
    const row = rows.find((item) => item.operation_id === second);
    return { handled: true, value: row ? { payload_json: snapshots.get(row.snapshot_id)?.payload_json } : null };
  }
  if (sql.includes("operation_id = ?")) return { handled: true, value: rows.find((item) => item.operation_id === second) ?? null };
  let matches = sql.includes("task_id = ?") ? rows.filter((row) => row.task_id === second) : rows;
  if (sql.includes("kind = 'submit'")) matches = matches.filter((row) => row.kind === "submit");
  if (sql.includes("kind = 'sync-draft'")) matches = matches.filter((row) => row.kind === "sync-draft");
  if (sql.includes("status <> 'resolved'")) matches = matches.filter((row) => row.status !== "resolved");
  if (sql.includes("attempt_count = 0")) matches = matches.filter((row) => row.attempt_count === 0);
  return { handled: true, value: kind === "first" ? matches[0] ?? null : matches };
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("react-native", {
  namedExports: {
    ActivityIndicator: "ActivityIndicator",
    AppState: {
      addEventListener: (_type: string, listener: (state: string) => void) => {
        runtime.__appStateListeners ??= new Set();
        runtime.__appStateListeners.add(listener);
        return { remove: () => { runtime.__appStateListeners?.delete(listener); } };
      },
    },
    Pressable: "Pressable",
    SafeAreaView: "SafeAreaView",
    ScrollView: "ScrollView",
    StyleSheet: { create: (styles: unknown) => styles },
    Text: "Text",
    TextInput: "TextInput",
    useWindowDimensions: () => ({ width: runtime.__mobileTestWidth ?? 390, height: 844, scale: 1, fontScale: 1 }),
    View: "View",
  },
});
mock.module("expo-network", {
  namedExports: {
    getNetworkStateAsync: async () => ({ isConnected: runtime.__networkOnline, isInternetReachable: runtime.__networkOnline }),
    addNetworkStateListener: (listener: (state: { isConnected?: boolean; isInternetReachable?: boolean }) => void) => {
      runtime.__networkListener = listener;
      return { remove: () => { runtime.__networkListener = undefined; } };
    },
  },
});
mock.module("expo-secure-store", {
  namedExports: {
    getItemAsync: async (key: string) => runtime.__secureValues?.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { runtime.__secureValues?.set(key, value); },
    deleteItemAsync: async (key: string) => { runtime.__secureValues?.delete(key); },
  },
});
mock.module("expo-crypto", { namedExports: {
  getRandomBytesAsync: async (size: number) => new Uint8Array(size).fill(7),
  randomUUID: () => `test-uuid-${++testUuid}`,
} });
mock.module("expo-sqlite", { namedExports: {
  openDatabaseAsync: async () => {
    runtime.__draftRows ??= new Map();
    const rows = runtime.__draftRows;
    const key = (employeeId: string, taskId: string) => `${employeeId}/${taskId}`;
    const db = {
      execAsync: async () => undefined,
      getFirstAsync: async (sql: string, ...params: string[]) => {
        const outboxResult = outboxStatement("first", sql, params);
        if (outboxResult.handled) return outboxResult.value;
        if (sql.includes("user_version")) return { user_version: 2 };
        if (sql.includes("sqlite_master")) return { name: sql.includes("synchronized_tasks") ? "synchronized_tasks" : "local_drafts" };
        if (sql.includes("payload_json")) {
          const taskId = String(params[1] ?? "");
          const taskGate = runtime.__holdDraftReadByTask?.get(taskId);
          if (taskGate) { runtime.__draftReadStartedByTask?.get(taskId)?.(); await taskGate; }
          if (runtime.__holdDraftRead) { runtime.__draftReadStarted?.(); await runtime.__holdDraftRead; }
        }
        const row = rows.get(key(params[0]!, params[1]!));
        if (!row) return null;
        const parsed = JSON.parse(row) as { payload_json?: string; revision?: number; id?: string; createdAt?: number; savedAt?: number };
        // The identity columns read by a correction or a discard-local write (Stories 8.1/8.2).
        if (sql.includes("draft_id")) return { revision: parsed.revision, draft_id: parsed.id, created_at: parsed.createdAt, saved_at: parsed.savedAt };
        return sql.includes("payload_json") ? { payload_json: parsed.payload_json ?? row } : { revision: parsed.revision ?? (JSON.parse(parsed.payload_json ?? row) as { revision: number }).revision };
      },
      getAllAsync: async (sql: string, employeeId: string, ...rest: string[]) => {
        const outboxResult = outboxStatement("all", sql, [employeeId, ...rest]);
        if (outboxResult.handled) return outboxResult.value;
        if (runtime.__failDraftList) throw new Error("list failed");
        if (sql.includes("synchronized_tasks")) return [...(runtime.__cachedTaskRows ?? new Map()).entries()]
          .filter(([key]) => key.startsWith(`${employeeId}/`))
          .map(([, raw]) => raw)
          .map((raw) => JSON.parse(raw) as { task_json: string; synchronized_at: number })
          .map((row) => ({ task_json: row.task_json, synchronized_at: row.synchronized_at }));
        return [...rows.values()].filter((raw) => (JSON.parse(raw) as { employeeId: string }).employeeId === employeeId).map((payload_json) => ({ payload_json }));
      },
      runAsync: async (sql: string, ...params: (string | number)[]) => {
        const outboxResult = outboxStatement("run", sql, params);
        if (outboxResult.handled) return outboxResult.value;
        if (sql.includes("DELETE FROM synchronized_tasks")) {
          const [employeeId, taskId] = params.map(String);
          for (const key of runtime.__cachedTaskRows?.keys() ?? []) {
            if (key.startsWith(`${employeeId}/`) && (!taskId || key === `${employeeId}/${taskId}`)) runtime.__cachedTaskRows?.delete(key);
          }
        } else if (sql.includes("INSERT INTO synchronized_tasks")) {
          if (runtime.__cacheWriteFailure) throw new Error("cache write failed");
          runtime.__cachedTaskRows ??= new Map();
          const [employeeId, taskId, taskJson, synchronizedAt] = params;
          runtime.__cachedTaskRows.set(`${employeeId}/${taskId}`, JSON.stringify({ task_json: taskJson, synchronized_at: synchronizedAt }));
        } else if (sql.includes("INSERT INTO local_drafts")) {
          const writeGate = runtime.__holdDraftWrite;
          if (writeGate) { runtime.__draftWriteStarted?.(); await writeGate; }
          const [employeeId, taskId, id, payloadSchemaVersion, revision, createdAt, savedAt, payloadJson] = params;
          const expectedRevision = params[8];
          const previous = rows.get(key(String(employeeId), String(taskId)));
          if (previous) {
            const currentRevision = (JSON.parse(previous) as { revision: number }).revision;
            if (currentRevision !== expectedRevision) return { changes: 0, lastInsertRowId: 0 };
          } else if (expectedRevision !== 0) return { changes: 0, lastInsertRowId: 0 };
          const record = JSON.parse(String(payloadJson));
          rows.set(key(String(employeeId), String(taskId)), JSON.stringify({ ...record, id, employeeId, taskId, payloadSchemaVersion, revision, createdAt, savedAt }));
        } else if (sql.includes("DELETE FROM local_drafts")) {
          if (runtime.__failDraftDelete) throw new Error("delete failed");
          const [employeeId, taskId, revision] = params;
          const current = rows.get(key(String(employeeId), String(taskId)));
          // Without a revision parameter the statement is the unconditional unreadable-draft delete.
          const matches = current !== undefined && (!sql.includes("revision") || (JSON.parse(current) as { revision: number }).revision === revision);
          if (matches) { rows.delete(key(String(employeeId), String(taskId))); return { changes: 1, lastInsertRowId: 1 }; }
          return { changes: 0, lastInsertRowId: 0 };
        }
        return { changes: 1, lastInsertRowId: 1 };
      },
      withExclusiveTransactionAsync: async (operation: (tx: unknown) => Promise<void>) => {
        const before = new Map(rows);
        const cacheBefore = new Map(runtime.__cachedTaskRows);
        const outboxBefore = new Map([...(runtime.__outboxRows ?? new Map<string, OutboxTestRow>())].map(([id, row]) => [id, { ...row }]));
        const snapshotsBefore = new Map(runtime.__snapshotRows);
        const syncStateBefore = new Map(runtime.__syncStateRows);
        const resolutionsBefore = new Map(runtime.__resolutionRows);
        const resolutionItemsBefore = new Map(runtime.__resolutionItemRows);
        const correctionsBefore = new Map(runtime.__correctionRows);
        try { await operation(db); } catch (error) {
          rows.clear(); for (const [id, value] of before) rows.set(id, value);
          runtime.__cachedTaskRows = new Map(cacheBefore);
          runtime.__outboxRows = outboxBefore;
          runtime.__snapshotRows = snapshotsBefore;
          runtime.__syncStateRows = syncStateBefore;
          runtime.__resolutionRows = resolutionsBefore;
          runtime.__resolutionItemRows = resolutionItemsBefore;
          runtime.__correctionRows = correctionsBefore;
          throw error;
        }
      },
      closeAsync: async () => undefined,
    };
    return db;
  },
} });
mock.module("@cetem-qc/api-client/v1", {
  namedExports: {
    ApiRequestError: class ApiRequestError extends Error {
      constructor(message: string, readonly status = 401, readonly code = "AUTHENTICATION_FAILED") { super(message); }
    },
    createApiClient: () => runtime.__mobileTestApi,
  },
});
// The real module is the HTTP adapter (Story 7.3, tested in sync/app-sync-transport.test.ts). Here a test installs a
// fake transport per mount; without one, the double provides none and no run starts.
mock.module("./sync/app-sync-transport.js", { namedExports: { createAppSyncTransport: () => runtime.__syncTransport ?? null } });
let App: typeof import("./App.js")["default"] | undefined;
async function loadApp() {
  App ??= (await import("./App.js")).default;
}

interface Task {
  id: string;
  establishment: string;
  service: string;
  createdAt: string;
}

interface MockApi {
  authenticate: () => Promise<{ user: { id: string; email: string; displayName: string; role: "employe"; mustChangePassword: false } }>;
  listAssignedEmployeeTasks: () => Promise<{ tasks: Task[] }>;
  getAssignedEmployeeTask: (id: string) => Promise<{ task: Task }>;
  getSession: () => Promise<{ user: { id: string; role: "employe" } }>;
  logout: () => Promise<void>;
  /** Story 8.1: the current server version; absent unless a test installs it. */
  getEmployeeTaskAuditVersion?: (taskId: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
  getEmployeeTaskRecoverySeed: (taskId: string) => Promise<{ recovery: unknown | null }>;
  listCalls: number;
  sessionCalls: number;
  detailCalls: string[];
}

const firstTask: Task = {
  id: "00000000-0000-4000-8000-000000000051",
  establishment: "Centre hospitalier Nord",
  service: "Radiologie",
  createdAt: "2026-09-30T10:00:00.000Z",
};
const secondTask: Task = {
  id: "00000000-0000-4000-8000-000000000052",
  establishment: "Centre hospitalier Sud",
  service: "Urgences",
  createdAt: "2026-09-30T11:00:00.000Z",
};
const thirdTask: Task = {
  id: "00000000-0000-4000-8000-000000000053",
  establishment: "Centre hospitalier Est",
  service: "Imagerie",
  createdAt: "2026-09-30T12:00:00.000Z",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function installMocks() {
  runtime.__recoverySeed = undefined;
  runtime.__mobileTestWidth = 390;
  runtime.__secureValues = new Map();
  runtime.__draftRows = new Map();
  runtime.__cachedTaskRows = new Map();
  runtime.__outboxRows = new Map();
  runtime.__snapshotRows = new Map();
  runtime.__syncStateRows = new Map();
  runtime.__resolutionRows = new Map();
  runtime.__resolutionItemRows = new Map();
  runtime.__correctionRows = new Map();
  runtime.__failCorrectionInsert = false;
  runtime.__employeeId = "employee-1";
  runtime.__holdDraftRead = undefined;
  runtime.__holdDraftWrite = undefined;
  runtime.__holdDraftReadByTask = new Map();
  runtime.__draftReadStartedByTask = new Map();
  runtime.__holdTaskListByEmployee = new Map();
  runtime.__taskListStartedByEmployee = new Map();
  runtime.__holdTaskDetailById = new Map();
  runtime.__taskDetailStartedById = new Map();
  runtime.__cacheWriteFailure = false;
  runtime.__revokedTaskIds = new Set();
  runtime.__failTaskDetailById = new Set();
  runtime.__assignedTasksByEmployee = new Map();
  runtime.__failTaskListForEmployee = new Set();
  runtime.__draftReadStarted = undefined;
  runtime.__draftWriteStarted = undefined;
  runtime.__failDraftList = false;
  runtime.__failDraftDelete = false;
  runtime.__syncTransport = undefined;
  runtime.__failOutboxList = false;
  runtime.__failOutboxInsert = false;
  runtime.__networkOnline = true;
  runtime.__sessionAvailable = true;
  const api: MockApi = {
    authenticate: async () => ({ user: { id: runtime.__employeeId ?? "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false } }),
    listAssignedEmployeeTasks: async () => {
      api.listCalls++;
      const employeeId = runtime.__employeeId ?? "employee-1";
      const gate = runtime.__holdTaskListByEmployee?.get(employeeId);
      if (gate) { runtime.__taskListStartedByEmployee?.get(employeeId)?.(); await gate; }
      if (runtime.__failTaskListForEmployee?.has(employeeId)) throw new Error("task list unavailable");
      return { tasks: runtime.__assignedTasksByEmployee?.get(employeeId) ?? (employeeId === "employee-2" ? [thirdTask] : [firstTask, secondTask]) };
    },
    getAssignedEmployeeTask: async (id) => {
      api.detailCalls.push(id);
      const employeeId = runtime.__employeeId ?? "employee-1";
      const assignedAtRequest = !runtime.__revokedTaskIds?.has(id) && (employeeId !== "employee-2" || id === thirdTask.id);
      const gate = runtime.__holdTaskDetailById?.get(id);
      if (gate) { runtime.__taskDetailStartedById?.get(id)?.(); await gate; }
      if (runtime.__failTaskDetailById?.has(id)) throw new Error("task detail unavailable");
      if (!assignedAtRequest) {
        const { ApiRequestError: MockApiRequestError } = await import("@cetem-qc/api-client/v1");
        throw new MockApiRequestError("task assignment revoked", 403, "TASK_NOT_ASSIGNED");
      }
      return { task: id === secondTask.id ? secondTask : id === thirdTask.id ? thirdTask : firstTask };
    },
    getEmployeeTaskRecoverySeed: async () => ({ recovery: runtime.__recoverySeed ?? null }),
    getSession: async () => {
      api.sessionCalls++;
      if (runtime.__sessionFailure) {
        const { ApiRequestError: MockApiRequestError } = await import("@cetem-qc/api-client/v1");
        throw new MockApiRequestError("account deactivated", runtime.__sessionFailure.status, runtime.__sessionFailure.code);
      }
      if (!runtime.__sessionAvailable) {
        const { ApiRequestError: MockApiRequestError } = await import("@cetem-qc/api-client/v1");
        throw new MockApiRequestError("session expired", 401, "AUTHENTICATION_FAILED");
      }
      return { user: { id: runtime.__employeeId ?? "employee-1", role: "employe" } };
    },
    logout: async () => { runtime.__sessionAvailable = false; },
    listCalls: 0,
    sessionCalls: 0,
    detailCalls: [],
  };
  runtime.__mobileTestApi = api;
  return api;
}

function findText(tree: ReactTestRenderer, value: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.type === "Text" && node.children.join("") === value)[0];
}

function hasStyle(node: ReactTestInstance, key: string) {
  const style = node.props.style;
  return (Array.isArray(style) ? style : [style]).some((item) => item && typeof item === "object" && key in item);
}

function findButton(tree: ReactTestRenderer, title: string): ReactTestInstance {
  const button = tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === title).length > 0)[0];
  assert.ok(button, `expected button ${title}`);
  return button;
}

async function waitForButton(tree: ReactTestRenderer, title: string) {
  for (let tick = 0; tick < 20; tick++) {
    const button = tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === title).length > 0)[0];
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return findButton(tree, title);
}

function findInput(tree: ReactTestRenderer, label: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.type === "TextInput" && node.props.accessibilityLabel === label)[0];
}

function findChoice(tree: ReactTestRenderer, accessibleLabel: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === accessibleLabel)[0];
}

async function signIn(tree: ReactTestRenderer) {
  const fields = tree.root.findAll((node) => node.type === "TextInput");
  await act(async () => { fields[0]!.props.onChangeText("employee@example.test"); });
  await act(async () => { fields[1]!.props.onChangeText("correct-password"); });
  await act(async () => {
    runtime.__sessionAvailable = true;
    findButton(tree, "Se connecter").props.onPress();
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getMainCard(tree: ReactTestRenderer) {
  return tree.root.findAll((node) => node.type === "View" && Array.isArray(node.props.style) && node.props.style.some((style: unknown) => style && typeof style === "object" && "borderRadius" in style))[0]!;
}

function findTaskRow(tree: ReactTestRenderer, establishment: string) {
  return tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === establishment).length > 0)[0]!;
}

test("M1 signed-out screen tells the Employé to contact their Responsable for a forgotten password", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  assert.ok(findText(tree, fr.auth.employeeTitle));
  assert.ok(findText(tree, "Mot de passe oublié ? Contactez votre Responsable."));
  await act(async () => { tree.unmount(); });
});

test("phone App renders task list, opens read-only detail, retries failures and returns to list within padded width", async () => {
  await loadApp();
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);

  assert.ok(findText(tree, "Mes tâches"));
  assert.ok(findText(tree, firstTask.establishment));
  const rootStyle = tree.root.findAll((node) => node.type === "ScrollView")[0]!.props.contentContainerStyle;
  assert.equal(rootStyle[0].paddingHorizontal, 20);
  const content = tree.root.findAll((node) => node.type === "View" && node.props.style?.width === 350)[0];
  assert.ok(content, "390px viewport leaves a 350px content area after 20px gutters");
  assert.equal(content!.props.style.width + EMPLOYEE_CONTENT_HORIZONTAL_GUTTER * 2, runtime.__mobileTestWidth);

  const listGrid = tree.root.findAll((node) => node.type === "View" && hasStyle(node, "gap") && (Array.isArray(node.props.style) ? node.props.style : [node.props.style]).some((style) => style?.gap === 12))[0];
  assert.ok(listGrid, "phone task list uses its vertical gap container");
  assert.equal(getMainCard(tree).findAll((node) => node.type === "View" && hasStyle(node, "flexDirection") && (Array.isArray(node.props.style) ? node.props.style : [node.props.style]).some((style) => style?.flexDirection === "row")).length, 0);

  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, firstTask.id));
  assert.ok(findText(tree, "Brouillon"));
  assert.deepEqual(api.detailCalls, [firstTask.id]);
  assert.ok(findButton(tree, "Retour à Mes tâches"));
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  assert.ok(findText(tree, "Mes tâches"));
  await act(async () => { tree.unmount(); });
});

test("Story 8.4 hydrates a new successor draft with source and per-field provenance", async () => {
  await loadApp();
  const api = installMocks();
  const copiedField = "header.reportNumber";
  runtime.__recoverySeed = {
    recoveryId: "00000000-0000-4000-8000-000000000061",
    source: { taskId: "00000000-0000-4000-8000-000000000062", auditId: "00000000-0000-4000-8000-000000000063", revision: 2,
      employee: { id: "previous-employee", displayName: "EmployÃƒÂ© source" } },
    seed: { revision: 1, payload: { ...GRAPHIE_CALCULATION_IDENTITY, values: { [copiedField]: "R-49" } } },
    provenance: [{ destinationField: `values.${copiedField}`, sourceField: `values.${copiedField}`,
      sourceTaskId: "00000000-0000-4000-8000-000000000062", sourceAuditId: "00000000-0000-4000-8000-000000000063", sourceRevision: 2, origin: "copied-from-recovery-source" }],
  };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 150)); });
  assert.equal(api.detailCalls.at(-1), firstTask.id);
  assert.ok(runtime.__draftRows!.has(`employee-1/${firstTask.id}`));
  assert.equal(findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields[0]!.labelFr)?.props.value, "R-49");
  assert.ok(findText(tree, "Brouillon initial crÃ©Ã© Ã  partir du travail synchronisÃ© de EmployÃ© source, tÃ¢che 00000000-0000-4000-8000-000000000062, rÃ©vision 2."));
  assert.ok(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes("Valeur initiale copiÃ©e du travail synchronisÃ© antÃ©rieur")).length > 0);
  const local = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { employeeId: string; recoveryProvenance: { sourceEmployeeId: string } };
  assert.equal(local.employeeId, "employee-1");
  assert.equal(local.recoveryProvenance.sourceEmployeeId, "previous-employee");
  await act(async () => { tree.unmount(); });
});

test("legacy notes and structured context survive save and restart independently; choice options are selectable", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, JSON.stringify({
    id: "legacy-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 1, createdAt: 10, savedAt: 20,
    payload: { content: "old legacy notes" },
  }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const legacy = findInput(tree, "Contenu conservé du brouillon précédent");
  const context = findInput(tree, "N° rapport");
  assert.equal(legacy?.props.value, "old legacy notes");
  assert.equal(context?.props.value, "");
  const choiceField = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!.fields[0]!;
  await act(async () => { findButton(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!.labelFr).props.onPress(); });
  const optionButtons = tree.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith(`${choiceField.labelFr}: `));
  assert.deepEqual(optionButtons.map((node) => node.props.accessibilityLabel), choiceField.options!.map((option) => `${choiceField.labelFr}: ${option}`));
  assert.equal(findInput(tree, choiceField.labelFr), undefined, "choice fields do not expose arbitrary text input");
  const selectedOption = choiceField.options![1]!;
  const selectedButton = findChoice(tree, `${choiceField.labelFr}: ${selectedOption}`)!;
  await act(async () => { selectedButton.props.onPress(); });
  const selectedAfterTap = findChoice(tree, `${choiceField.labelFr}: ${selectedOption}, sélectionné`)!;
  assert.equal(selectedAfterTap.props.accessibilityState.selected, true);
  assert.ok(selectedAfterTap.findAll((node) => node.type === "Text" && node.children.join("").includes("sélectionné")).length > 0);
  await act(async () => { findButton(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.labelFr).props.onPress(); });
  const resumedLegacy = tree.root.findAll((node) => node.type === "TextInput" && String(node.props.accessibilityLabel ?? "").startsWith("Contenu conserv"))[0]!;
  const resumedContext = findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr)!;
  await act(async () => { resumedLegacy.props.onChangeText("edited legacy notes"); resumedContext.props.onChangeText("current structured context"); });
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { catalogueId: string; catalogueVersion: string; schemaVersion: number; ruleId: string; ruleVersion: string; values: Record<string, string>; legacyContent?: string } };
  assert.deepEqual(
    { catalogueId: saved.payload.catalogueId, catalogueVersion: saved.payload.catalogueVersion, schemaVersion: saved.payload.schemaVersion, ruleId: saved.payload.ruleId, ruleVersion: saved.payload.ruleVersion },
    { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
  );
  assert.equal(saved.payload.legacyContent, "edited legacy notes");
  assert.equal(saved.payload.values["header.reportNumber"], "current structured context");
  assert.equal(saved.payload.values[choiceField.id], selectedOption);
  await act(async () => { tree.unmount(); });

  runtime.__secureValues = new Map();
  runtime.__draftRows = new Map([[key, JSON.stringify(JSON.parse(runtime.__draftRows!.get(key)!))]]);
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "edited legacy notes");
  assert.equal(findInput(tree, "N° rapport")?.props.value, "current structured context");
  await act(async () => { findButton(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!.labelFr).props.onPress(); });
  assert.equal(findChoice(tree, `${choiceField.labelFr}: ${selectedOption}, sélectionné`)?.props.accessibilityState.selected, true);
  await act(async () => { tree.unmount(); });
});

test("malformed saved form metadata shows compatibility state and retains stored bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const encryptedRow = JSON.stringify({
    id: "future-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 2, createdAt: 10, savedAt: 20,
    payload: { content: "do not reinterpret malformed metadata", catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: {} },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__draftRows!.set(key, encryptedRow);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, "Ce brouillon utilise une version de formulaire non prise en charge. Il est conservé sans modification."));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => String(node.props.value ?? "").includes("do not reinterpret")), false);
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  assert.equal(runtime.__draftRows.get(key), encryptedRow);
  await act(async () => { tree.unmount(); });
});

test("employee saves locally, remounts offline to resume, and confirms or cancels local draft deletion", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const content = findInput(tree, "N° rapport");
  assert.ok(content);
  await act(async () => { content!.props.onChangeText("opaque local work"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  assert.ok(findText(tree, "Enregistré localement"), "autosave acknowledges after commit");
  await act(async () => { content!.props.onChangeText("explicit save captured version"); });
  let startWrite!: () => void;
  let releaseWrite!: () => void;
  const writeStarted = new Promise<void>((resolve) => { startWrite = resolve; });
  runtime.__holdDraftWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
  runtime.__draftWriteStarted = startWrite;
  await act(async () => {
    const saving = findButton(tree, "Enregistrer").props.onPress() as Promise<boolean>;
    await writeStarted;
    content!.props.onChangeText("newer edit while save is pending");
    releaseWrite();
    assert.equal(await saving, true);
  });
  runtime.__holdDraftWrite = undefined;
  runtime.__draftWriteStarted = undefined;
  assert.ok(findText(tree, "Enregistré localement"));
  assert.equal(runtime.__draftRows?.size, 1);
  assert.match([...runtime.__draftRows!.values()][0]!, /newer edit while save is pending/);
  assert.match(runtime.__secureValues?.get("cetem-qc.local-drafts.database-key.v1") ?? "", /^[0-9a-f]{64}$/);
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Reprendre le brouillon local"));
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const resumed = findInput(tree, "N° rapport");
  assert.equal(resumed?.props.value, "newer edit while save is pending");
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  assert.ok(findText(tree, "Supprimer ce brouillon local ? Cette action est définitive."));
  await act(async () => { findButton(tree, "Annuler").props.onPress(); });
  assert.equal(runtime.__draftRows?.size, 1);
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows?.size, 0);
  assert.ok(findText(tree, "Brouillon local supprimé."));
  await act(async () => { tree.unmount(); });
});

test("continues an online-cached task across sections offline and resumes it without server calls", async () => {
  await loadApp();
  installMocks();
  const api = runtime.__mobileTestApi!;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.equal(runtime.__cachedTaskRows!.size, 2, "the successful online task-list response is cached locally");
  const callsBeforeOffline = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const callsAfterOfflineStartup = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, firstTask.id));
  assert.ok(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes("Hors ligne")).length > 0);
  const context = findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr)!;
  await act(async () => { context.props.onChangeText("offline continuation"); });
  const qualitative = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!;
  await act(async () => { findButton(tree, qualitative.labelFr).props.onPress(); });
  const choice = qualitative.fields.find((field) => field.type === "choice")!;
  const option = choice.options![0]!;
  await act(async () => { findChoice(tree, `${choice.labelFr}: ${option}`)!.props.onPress(); });
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  assert.equal(api.listCalls, callsAfterOfflineStartup.list, "offline task navigation does not reload the task list");
  assert.deepEqual(api.detailCalls, callsAfterOfflineStartup.details, "offline task navigation does not call task detail");
  assert.equal(runtime.__draftRows!.size, 1);
  await act(async () => { tree.unmount(); });

  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr)?.props.value, "offline continuation");
  await act(async () => { findButton(tree, qualitative.labelFr).props.onPress(); });
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityState?.selected === true && String(node.props.accessibilityLabel ?? "").startsWith(`${choice.labelFr}: ${option}`)).length, 1);
  assert.deepEqual(api.detailCalls, callsAfterOfflineStartup.details, "offline cached task navigation makes no task-detail requests");
  await act(async () => { tree.unmount(); });
});

test("offline timer autosave commits locally without API calls and survives restart", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  const api = runtime.__mobileTestApi!;
  const callsBeforeOffline = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const callsAfterOfflineStartup = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const field = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((item) => item.id === "header.reportNumber")!;
  await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("timer saved offline"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  const key = `employee-1/${firstTask.id}`;
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values[field.id], "timer saved offline");
  assert.ok(findText(tree, fr.employeeTasks.savedLocally), "local acknowledgement follows the durable autosave");
  assert.deepEqual({ list: api.listCalls, session: api.sessionCalls, details: api.detailCalls }, callsBeforeOffline);
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = true;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findInput(tree, field.labelFr)?.props.value, "timer saved offline");
  assert.deepEqual(api.detailCalls, [firstTask.id], "only online draft resume revalidates task assignment");
  await act(async () => { tree.unmount(); });
  runtime.__networkOnline = false;
});

test("P3 autosave records one durable sync-draft outbox item per task without changing the editor", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const field = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((item) => item.id === "header.reportNumber")!;
  await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("first autosave"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("second autosave"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  assert.ok(findText(tree, fr.employeeTasks.savedLocally), "the existing local acknowledgement is unchanged");
  const items = [...runtime.__outboxRows!.values()].filter((row) => row.employee_id === "employee-1" && row.task_id === firstTask.id);
  assert.deepEqual(items.map((row) => ({ kind: row.kind, status: row.status, attempts: row.attempt_count })), [{ kind: "sync-draft", status: "queued", attempts: 0 }],
    "the never-attempted item of the first autosave is superseded by the second");
  assert.notEqual(items[0]!.operation_id, items[0]!.idempotency_key);
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { values: Record<string, string> } };
  const snapshot = JSON.parse(runtime.__snapshotRows!.get(items[0]!.snapshot_id)!.payload_json) as { revision: number; payload: { values: Record<string, string> } };
  assert.equal(saved.revision, 2, "both autosaves committed");
  assert.equal(snapshot.revision, saved.revision);
  assert.deepEqual(snapshot.payload, saved.payload);
  assert.equal(snapshot.payload.values[field.id], "second autosave");
  await act(async () => { tree.unmount(); });
});

test("offline timer autosave still locks and preserves protected data after authorization expiry", async () => {
  await loadApp();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  try {
    installMocks();
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    const api = runtime.__mobileTestApi!;
    const callsBeforeOffline = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
    await act(async () => { tree.unmount(); });
    runtime.__networkOnline = false;
    await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
    const field = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((item) => item.id === "header.reportNumber")!;
    await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("must not autosave after expiry"); });
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    assert.equal(runtime.__draftRows!.has(`employee-1/${firstTask.id}`), false, "expired authorization prevents the timer write");
    assert.ok(findText(tree, "Connexion Employé"), "authorization loss redacts the editor");
    assert.deepEqual({ list: api.listCalls, session: api.sessionCalls, details: api.detailCalls }, callsBeforeOffline);
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("online resume rechecks the cached task assignment before hydrating the draft", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "online-draft", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1,
    payload: { content: "authorized cached draft" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id], "online draft resume revalidates through task detail");
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "authorized cached draft");
  await act(async () => { tree.unmount(); });
});

test("revoked online task assignment hides the cached form and preserves the encrypted draft", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "revoked-draft", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1,
    payload: { content: "protected revoked draft" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  runtime.__assignedTasksByEmployee!.set("employee-1", [firstTask]);
  runtime.__revokedTaskIds!.add(firstTask.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id]);
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent"), undefined, "form content is not hydrated before online authorization");
  assert.ok(findText(tree, fr.employeeTasks.taskNoLongerAssigned));
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), original, "denial does not delete or rewrite protected local data");
  await act(async () => { tree.unmount(); });
});

test("online TASK_NOT_ASSIGNED revokes cached context, preserves the draft, and denies a later offline open", async () => {
  await loadApp();
  installMocks();
  const originalDraft = JSON.stringify({
    id: "revoked-online-resume", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 4, payload: { content: "preserve these measurements" }, createdAt: 10, savedAt: 40,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, originalDraft);
  runtime.__revokedTaskIds!.add(firstTask.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`));

  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id]);
  assert.equal(findInput(tree, fr.employeeTasks.legacyDraftContent), undefined, "denied content is not hydrated");
  assert.ok(findText(tree, fr.employeeTasks.taskNoLongerAssigned));
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "only the denied task context is revoked");
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft, "revocation leaves the complete Story 5.3 record unchanged");

  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === firstTask.id).length > 0).length, 0, "revoked draft is not resumable offline");
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === firstTask.establishment).length > 0).length, 0, "revoked task is absent from the offline task list");
  assert.ok(findText(tree, fr.employeeTasks.offlineDraftPreserved));
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id], "denied offline work issues no second detail request");
  await act(async () => { tree.unmount(); });
});

test("generic online task-detail failure retains cached authorization and draft for offline use", async () => {
  await loadApp();
  installMocks();
  const originalDraft = JSON.stringify({
    id: "transient-resume", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 2, payload: { content: "transient failure preserves this" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, originalDraft);
  runtime.__failTaskDetailById!.add(firstTask.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, fr.employeeTasks.detailError));
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "unknown failure does not revoke cached context");
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);

  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findInput(tree, fr.employeeTasks.legacyDraftContent), "valid offline access still resumes after a transient error");
  assert.equal(runtime.__cachedTaskRows!.get(`employee-1/${firstTask.id}`) !== undefined, true);
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);
  await act(async () => { tree.unmount(); });
});

test("stale TASK_NOT_ASSIGNED response revokes only its originating task after an account switch", async () => {
  await loadApp();
  installMocks();
  const employeeTwoDraft = JSON.stringify({
    id: "employee-two-draft", employeeId: "employee-2", taskId: thirdTask.id,
    payloadSchemaVersion: 1, revision: 1, payload: { content: "employee two evidence" }, createdAt: 10, savedAt: 20,
  });
  const employeeOneDraft = JSON.stringify({
    id: "employee-one-pending-revocation", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 1, payload: { content: "employee one evidence" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, employeeOneDraft);
  runtime.__draftRows!.set(`employee-2/${thirdTask.id}`, employeeTwoDraft);
  runtime.__assignedTasksByEmployee!.set("employee-1", [firstTask, secondTask]);
  runtime.__assignedTasksByEmployee!.set("employee-2", [thirdTask]);
  runtime.__revokedTaskIds!.add(firstTask.id);
  const detailGate = deferred();
  let detailStarted!: () => void;
  const detailStartedPromise = new Promise<void>((resolve) => { detailStarted = resolve; });
  runtime.__holdTaskDetailById!.set(firstTask.id, detailGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, detailStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await detailStartedPromise; });

  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, fr.auth.logout).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__employeeId = "employee-2";
  await signIn(tree);
  assert.ok(findText(tree, thirdTask.establishment), "employee two is the current screen before the stale response returns");
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { detailGate.resolve(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.ok(findText(tree, thirdTask.establishment), "the stale response does not replace the current employee's screen");
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "the authoritative denial revokes only its originating task");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${secondTask.id}`), "another task for the first employee remains unchanged");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-2/${thirdTask.id}`), "the current employee's cache is untouched");
  assert.equal(runtime.__draftRows!.get(`employee-2/${thirdTask.id}`), employeeTwoDraft, "another employee's draft remains unchanged");
  assert.ok(!findText(tree, firstTask.establishment));
  await act(async () => { tree.unmount(); });
});

test("offline cached open revalidates a reconnect race and withholds a revoked draft", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "reconnect-revoked", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 2,
    payload: { content: "must remain protected" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const gate = deferred();
  let readStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, gate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, readStarted);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await readStartedPromise; });
  runtime.__revokedTaskIds!.add(firstTask.id);
  runtime.__networkOnline = true;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  await act(async () => { gate.resolve(); for (let tick = 0; tick < 15; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id], "reconnect routes the pending open through current task authorization");
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent"), undefined);
  assert.equal(findText(tree, "must remain protected"), undefined);
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), original, "denial preserves the encrypted local draft");
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "revoked authorization removes only the task context");
  assert.ok(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes(fr.employeeTasks.taskNoLongerAssigned)).length > 0, JSON.stringify(tree.root.findAll((node) => node.type === "Text").map((node) => node.children.join(""))));
  await act(async () => { tree.unmount(); });
});

test("offline cached open may hydrate after reconnect only when current task authorization succeeds", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "reconnect-authorized", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 2,
    payload: { content: "authorized after reconnect" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const gate = deferred();
  let readStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, gate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, readStarted);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await readStartedPromise; });
  runtime.__networkOnline = true;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  await act(async () => { gate.resolve(); for (let tick = 0; tick < 15; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id]);
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "authorized after reconnect");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "authorized task context remains available");
  await act(async () => { tree.unmount(); });
});

test("navigation to another task wins while reconnect authorization is pending", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "stale-reconnect", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1,
    payload: { content: "stale reconnect content" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  const readGate = deferred();
  const detailGate = deferred();
  let readStarted!: () => void;
  let detailStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  const detailStartedPromise = new Promise<void>((resolve) => { detailStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, readGate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, readStarted);
  runtime.__holdTaskDetailById!.set(firstTask.id, detailGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, detailStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await readStartedPromise; });
  runtime.__networkOnline = true;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  await act(async () => { readGate.resolve(); await detailStartedPromise; });
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findTaskRow(tree, secondTask.establishment).props.onPress(); for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  detailGate.resolve();
  await act(async () => { for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, secondTask.id), "the current task remains selected after the late reconnect response");
  assert.equal(findText(tree, firstTask.id), undefined);
  assert.equal(findText(tree, "stale reconnect content"), undefined);
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), original);
  await act(async () => { tree.unmount(); });
});

test("task-cache write failure warns but does not strand an authorized online editor", async () => {
  await loadApp();
  installMocks();
  runtime.__cacheWriteFailure = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findText(tree, fr.employeeTasks.taskCacheFailed), "the list reports failed offline-context persistence");
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const editor = findInput(tree, "N° rapport");
  assert.equal(editor?.props.editable, true, "authorized server task and draft hydration complete despite the cache warning");
  assert.ok(findText(tree, fr.employeeTasks.taskCacheFailed));
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "failed cache write is not represented as offline availability");
  await act(async () => { tree.unmount(); });
});

test("successful authoritative refresh revokes omitted offline context and preserves its local draft", async () => {
  await loadApp();
  installMocks();
  const originalDraft = JSON.stringify({
    id: "preserved-revoked-draft", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 3, payload: { content: "preserved evidence" }, createdAt: 10, savedAt: 30,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, originalDraft);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  runtime.__assignedTasksByEmployee!.set("employee-1", [secondTask]);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual([...runtime.__cachedTaskRows!.keys()], ["employee-1/" + secondTask.id], "successful server omission reconciles only task context");
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft, "the local draft bytes and revision are preserved");

  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findText(tree, firstTask.establishment), undefined, "the revoked task is no longer offered as offline work");
  assert.equal(findText(tree, firstTask.id), undefined, "the preserved draft is not presented as resumable without authorized task context");
  assert.ok(findText(tree, fr.employeeTasks.offlineDraftPreserved));
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);
  await act(async () => { tree.unmount(); });
});

test("authoritative task refresh updates retained context and a failed refresh does not revoke cache", async () => {
  await loadApp();
  installMocks();
  const changedTask = { ...firstTask, service: "Service actualisé" };
  runtime.__assignedTasksByEmployee!.set("employee-1", [changedTask]);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  let cachedRow = JSON.parse(runtime.__cachedTaskRows!.get(`employee-1/${firstTask.id}`)!) as { task_json: string };
  assert.equal((JSON.parse(cachedRow.task_json) as Task).service, changedTask.service);
  const priorCache = new Map(runtime.__cachedTaskRows);
  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__failTaskListForEmployee!.add("employee-1");
  await signIn(tree);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__cachedTaskRows, priorCache, "unknown refresh outcome never destructively reconciles task context");
  assert.ok(findText(tree, changedTask.establishment));
  await act(async () => { tree.unmount(); });
});

test("a stale employee task-list response cannot reconcile another account cache", async () => {
  await loadApp();
  installMocks();
  const firstGate = deferred();
  let firstStarted!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  runtime.__holdTaskListByEmployee!.set("employee-1", firstGate.promise);
  runtime.__taskListStartedByEmployee!.set("employee-1", firstStarted);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { await firstRequestStarted; });
  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__employeeId = "employee-2";
  runtime.__holdTaskListByEmployee!.delete("employee-1");
  await signIn(tree);
  assert.ok(runtime.__cachedTaskRows!.has(`employee-2/${thirdTask.id}`));
  runtime.__holdTaskListByEmployee!.delete("employee-1");
  await act(async () => { firstGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(runtime.__cachedTaskRows!.has(`employee-2/${thirdTask.id}`), "late employee A response cannot remove employee B context");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "the stale request cannot reconcile any account after logout");
  await act(async () => { tree.unmount(); });
});

test("later task open wins when an earlier online task detail resolves last", async () => {
  await loadApp();
  installMocks();
  const firstGate = deferred();
  const secondGate = deferred();
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondRequestStarted = new Promise<void>((resolve) => { secondStarted = resolve; });
  runtime.__holdTaskDetailById!.set(firstTask.id, firstGate.promise);
  runtime.__holdTaskDetailById!.set(secondTask.id, secondGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, firstStarted);
  runtime.__taskDetailStartedById!.set(secondTask.id, secondStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await firstRequestStarted; });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findTaskRow(tree, secondTask.establishment).props.onPress(); await secondRequestStarted; });
  runtime.__holdTaskDetailById!.delete(secondTask.id);
  await act(async () => { secondGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, secondTask.id), "task B finishes and becomes the selected detail");
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { firstGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, secondTask.id), "late task A response cannot replace task B");
  assert.equal(findText(tree, firstTask.id), undefined);
  await act(async () => { tree.unmount(); });
});

test("offline cached-task navigation ignores an earlier delayed draft read", async () => {
  await loadApp();
  installMocks();
  for (const [task, content] of [[firstTask, "offline A"], [secondTask, "offline B"]] as const) {
    runtime.__draftRows!.set(`employee-1/${task.id}`, JSON.stringify({
      id: `draft-${task.id}`, employeeId: "employee-1", taskId: task.id, payloadSchemaVersion: 1, revision: 1,
      payload: { content }, createdAt: 10, savedAt: 20,
    }));
  }
  const firstGate = deferred();
  const secondGate = deferred();
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const firstReadStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondReadStarted = new Promise<void>((resolve) => { secondStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, firstGate.promise);
  runtime.__holdDraftReadByTask!.set(secondTask.id, secondGate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, firstStarted);
  runtime.__draftReadStartedByTask!.set(secondTask.id, secondStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  const callsBeforeOffline = [...runtime.__mobileTestApi!.detailCalls];
  runtime.__networkOnline = false;
  await act(async () => { for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findButton(tree, firstTask.id), "draft row remains available while offline");
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, secondTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  runtime.__holdDraftReadByTask!.delete(secondTask.id);
  await act(async () => { firstGate.resolve(); secondGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "offline B");
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id, secondTask.id], "task details were fetched only for the initial online cache population");
  await act(async () => { tree.unmount(); });
});

test("employee switch hides prior cache while loading and ignores its late detail response", async () => {
  await loadApp();
  installMocks();
  const oldTaskGate = deferred();
  const newListGate = deferred();
  let oldTaskStarted!: () => void;
  let newListStarted!: () => void;
  const oldTaskRequestStarted = new Promise<void>((resolve) => { oldTaskStarted = resolve; });
  const newListRequestStarted = new Promise<void>((resolve) => { newListStarted = resolve; });
  runtime.__holdTaskDetailById!.set(firstTask.id, oldTaskGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, oldTaskStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`));
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await oldTaskRequestStarted; });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__employeeId = "employee-2";
  runtime.__holdTaskListByEmployee!.set("employee-2", newListGate.promise);
  runtime.__taskListStartedByEmployee!.set("employee-2", newListStarted);
  await signIn(tree);
  await act(async () => { await newListRequestStarted; });
  assert.equal(findText(tree, firstTask.establishment), undefined, "employee A's cached context is hidden while B's list loads");
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { oldTaskGate.resolve(); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findText(tree, firstTask.establishment), undefined, "late employee A response cannot repopulate B's view");
  runtime.__holdTaskListByEmployee!.delete("employee-2");
  await act(async () => { newListGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, thirdTask.establishment));
  assert.equal(findText(tree, firstTask.establishment), undefined);
  await act(async () => { tree.unmount(); });
});

test("hydration keeps an existing draft read-only until its committed revision is known", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({
    id: "committed-draft", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 7,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0", values: { "header.reportNumber": "durable content" } },
    createdAt: 10, savedAt: 20,
  }));
  let beginRead!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { beginRead = resolve; });
  runtime.__holdDraftRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  runtime.__draftReadStarted = beginRead;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await readStarted; });
  const editor = () => findInput(tree, "N° rapport")!;
  assert.equal(editor().props.editable, false);
  assert.equal(editor().props.value, "");
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  await act(async () => { editor().props.onChangeText("too early"); });
  releaseRead();
  runtime.__holdDraftRead = undefined;
  runtime.__draftReadStarted = undefined;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(editor().props.editable, true);
  assert.equal(editor().props.value, "durable content");
  await act(async () => { editor().props.onChangeText("revision seven updated"); await findButton(tree, "Enregistrer").props.onPress(); });
  const committed = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { values: Record<string, string> } };
  assert.equal(committed.revision, 8, "the hydrated revision is used as the save base");
  assert.equal(committed.payload.values["header.reportNumber"], "revision seven updated");
  await act(async () => { tree.unmount(); });
});

test("late hydration from a previous task cannot replace the newer selected draft", async () => {
  await loadApp();
  installMocks();
  for (const [taskId, id, content] of [[firstTask.id, "draft-a", "content A"], [secondTask.id, "draft-b", "content B"]]) {
    runtime.__draftRows!.set(`employee-1/${taskId}`, JSON.stringify({ id, employeeId: "employee-1", taskId, payloadSchemaVersion: 1, revision: 1, payload: { content }, createdAt: 10, savedAt: 20 }));
  }
  let beginRead!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { beginRead = resolve; });
  runtime.__holdDraftRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  runtime.__draftReadStarted = beginRead;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await readStarted; });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  runtime.__holdDraftRead = undefined;
  runtime.__draftReadStarted = undefined;
  await act(async () => { findButton(tree, secondTask.id).props.onPress(); for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.accessibilityLabel === "Contenu du brouillon local"), false, "the next selection stays unavailable while the earlier serialized read is pending");
  releaseRead();
  await act(async () => { for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const editor = findInput(tree, "Contenu conservé du brouillon précédent");
  assert.equal(editor?.props.value, "content B");
  await act(async () => { tree.unmount(); });
});

test("delete confirmation is cleared on navigation and cannot target the next draft", async () => {
  await loadApp();
  installMocks();
  for (const [taskId, id, content] of [[firstTask.id, "draft-a", "content A"], [secondTask.id, "draft-b", "content B"]]) {
    runtime.__draftRows!.set(`employee-1/${taskId}`, JSON.stringify({ id, employeeId: "employee-1", taskId, payloadSchemaVersion: 1, revision: 1, payload: { content }, createdAt: 10, savedAt: 20 }));
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  assert.ok(findText(tree, "Supprimer ce brouillon local ? Cette action est définitive."));
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  await act(async () => { findButton(tree, secondTask.id).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findText(tree, "Supprimer ce brouillon local ? Cette action est définitive."), undefined);
  assert.ok(runtime.__draftRows!.has(`employee-1/${firstTask.id}`));
  assert.ok(runtime.__draftRows!.has(`employee-1/${secondTask.id}`));
  await act(async () => { tree.unmount(); });
});

test("confirmed delete cancels a scheduled autosave so deleted content stays deleted", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "draft-a", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "old content" }, createdAt: 10, savedAt: 20 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const editor = findInput(tree, "Contenu conservé du brouillon précédent")!;
  await act(async () => { editor.props.onChangeText("pending autosave content"); });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  assert.equal(runtime.__draftRows!.has(`employee-1/${firstTask.id}`), false);
  await act(async () => { tree.unmount(); });
});

test("delete serializes behind an in-flight explicit save and preserves the newer revision", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "draft-a", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "old content" }, createdAt: 10, savedAt: 20 }));
  let beginWrite!: () => void;
  let releaseWrite!: () => void;
  const writeStarted = new Promise<void>((resolve) => { beginWrite = resolve; });
  runtime.__holdDraftWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
  runtime.__draftWriteStarted = beginWrite;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const editor = findInput(tree, "Contenu conservé du brouillon précédent")!;
  await act(async () => { editor.props.onChangeText("explicitly saved version"); });
  let saving!: Promise<boolean>;
  await act(async () => { saving = findButton(tree, "Enregistrer").props.onPress() as Promise<boolean>; await writeStarted; });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); });
  releaseWrite();
  runtime.__holdDraftWrite = undefined;
  runtime.__draftWriteStarted = undefined;
  await act(async () => { assert.equal(await saving, true); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const stillCommitted = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { values: Record<string, string> } };
  assert.equal(stillCommitted.revision, 2);
  assert.equal(stillCommitted.payload.legacyContent, "explicitly saved version");
  assert.ok(findText(tree, "Le brouillon local n’a pas pu être supprimé. Il est conservé."));
  await act(async () => { tree.unmount(); });
});

test("corrupt draft rows preserve valid resume entries and show a storage error", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "good", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "valid" }, createdAt: 10, savedAt: 20 }));
  runtime.__draftRows!.set("employee-1/corrupt", JSON.stringify({ employeeId: "employee-1", taskId: "corrupt", payloadSchemaVersion: 999 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findButton(tree, firstTask.id), "the valid draft remains available for resume");
  assert.ok(findText(tree, "Le brouillon local est indisponible. Vos données protégées sont conservées."));
  assert.ok(runtime.__draftRows!.has("employee-1/corrupt"), "the malformed encrypted record is preserved");
  await act(async () => { tree.unmount(); });
});

test("complete draft list failure renders storage error distinctly from an empty list", async () => {
  await loadApp();
  installMocks();
  runtime.__failDraftList = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findText(tree, "Le brouillon local est indisponible. Vos données protégées sont conservées."));
  assert.ok(findButton(tree, "Réessayer"), "the failed list offers an explicit retry");
  await act(async () => { tree.unmount(); });
});

test("authorization expiry during save locks the editor, redacts text and preserves the encrypted row", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "draft-a", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "protected hydrated text" }, createdAt: 10, savedAt: 20 }));
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
    assert.ok(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "protected hydrated text"));
    const editor = findInput(tree, "Contenu conservé du brouillon précédent")!;
    await act(async () => { editor.props.onChangeText("new plaintext edit"); });
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { await findButton(tree, "Enregistrer").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(findText(tree, "La période d'accès hors ligne a expiré. Connectez-vous en ligne pour accéder aux données locales protégées."));
    assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "protected hydrated text" || node.props.value === "new plaintext edit"), false);
    assert.equal(JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!).payload.content, "protected hydrated text");
    await signIn(tree);
    await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
    assert.ok(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "protected hydrated text"), "a fresh grant restores authorized resume");
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("phone App keeps loading, error and retry states actionable", async () => {
  await loadApp();
  const api = installMocks();
  let rejectDetail!: (error: Error) => void;
  let attempt = 0;
  api.getAssignedEmployeeTask = (id) => {
    api.detailCalls.push(id);
    attempt++;
    if (attempt === 1) return new Promise((_resolve, reject) => { rejectDetail = reject; });
    return Promise.resolve({ task: firstTask });
  };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(tree.root.findAll((node) => node.type === "ActivityIndicator").length, 1);
  await act(async () => { rejectDetail(new Error("temporary unavailable")); });
  assert.ok(findText(tree, "Cette tâche n'a pas pu être chargée."));
  await act(async () => { findButton(tree, "Réessayer").props.onPress(); });
  assert.equal(attempt, 2);
  assert.ok(findText(tree, firstTask.id));
  await act(async () => { tree.unmount(); });
});

test("tablet App keeps the same task authorization flow while grouping the same read-only details", async () => {
  await loadApp();
  const api = installMocks();
  runtime.__mobileTestWidth = 1024;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findText(tree, "Mes tâches"));
  assert.ok(findText(tree, firstTask.establishment));
  assert.ok(tree.root.findAll((node) => node.type === "View" && hasStyle(node, "flexWrap")).length > 0);

  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, firstTask.id));
  assert.ok(findText(tree, "Brouillon"));
  assert.deepEqual(api.detailCalls, [firstTask.id]);
  const details = tree.root.findAll((node) => node.type === "View" && hasStyle(node, "columnGap"));
  assert.ok(details.length > 0, "tablet detail metadata uses grouped columns");
  const detailLabels = ["Identifiant", "Type", "Établissement", "Service", "État", "Créée le"];
  for (const label of detailLabels) assert.ok(findText(tree, label), `expected shared detail label ${label}`);
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  assert.ok(findText(tree, "Mes tâches"));
  await act(async () => { tree.unmount(); });
});

test("tablet detail failure leaves visible retry control usable", async () => {
  await loadApp();
  installMocks();
  runtime.__mobileTestWidth = 1024;
  const api = runtime.__mobileTestApi!;
  let attempt = 0;
  let resolveDetail!: (value: { task: Task }) => void;
  api.getAssignedEmployeeTask = (id) => {
    api.detailCalls.push(id);
    attempt++;
    if (attempt === 1) return new Promise((resolve) => { resolveDetail = resolve; });
    if (attempt === 2) return Promise.reject(new Error("temporary unavailable"));
    return Promise.resolve({ task: firstTask });
  };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(tree.root.findAll((node) => node.type === "ActivityIndicator").length, 1);
  await act(async () => { resolveDetail({ task: firstTask }); });
  assert.ok(findText(tree, firstTask.id));
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, "Cette tâche n'a pas pu être chargée."));
  await act(async () => { findButton(tree, "Réessayer").props.onPress(); });
  assert.equal(attempt, 3);
  assert.ok(findText(tree, firstTask.id));
  await act(async () => { tree.unmount(); });
});

test("empty assigned-task state renders on phone and tablet", async () => {
  await loadApp();
  for (const width of [390, 1024]) {
    const api = installMocks();
    runtime.__mobileTestWidth = width;
    api.listAssignedEmployeeTasks = async () => { api.listCalls++; return { tasks: [] }; };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    assert.ok(findText(tree, "Aucune tâche ne vous est attribuée pour le moment."));
    await act(async () => { tree.unmount(); });
  }
});

test("offline restart restores the same employee's authorization and logout preserves protected payload", async () => {
  await loadApp();
  installMocks();
  const now = Date.now();
  runtime.__networkOnline = false;
  runtime.__secureValues!.set("cetem-qc.offline-authorization.v1", JSON.stringify({
    schemaVersion: 1,
    status: "grant",
    identity: { id: runtime.__employeeId ?? "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false },
    authenticatedAt: now - 60_000,
    lastTrustedTime: now - 60_000,
    policyWindowMs: 7 * 24 * 60 * 60 * 1000,
  }));
  runtime.__secureValues!.set("cetem-qc.protected-payload.v1.employee-1", "opaque-protected-evidence");

  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Accès hors ligne autorisé. Les données locales protégées restent disponibles pendant la période prévue."));
  assert.ok(findText(tree, "Aucune tâche synchronisée n'est disponible hors ligne. Les données locales protégées ne sont pas supprimées."));
  assert.equal(runtime.__mobileTestApi!.listCalls, 0, "offline hydration does not call protected task endpoints");

  const sessionCallsBeforeReconnect = runtime.__mobileTestApi!.sessionCalls;
  runtime.__networkOnline = true;
  await act(async () => {
    runtime.__networkListener?.({ isConnected: true, isInternetReachable: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(runtime.__mobileTestApi!.sessionCalls > sessionCallsBeforeReconnect, "reconnect revalidates the current server session");
  assert.equal(findText(tree, "Accès hors ligne autorisé. Les données locales protégées restent disponibles pendant la période prévue."), undefined);

  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); });
  assert.ok(findText(tree, "Connexion Employé"));
  assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "opaque-protected-evidence");
  await act(async () => { tree.unmount(); });
});

test("App sign-in grant survives remount with no server session and protects server-work boundary", async () => {
  await loadApp();
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);

  const grantKey = "cetem-qc.offline-authorization.v1";
  const persistedGrant = JSON.parse(runtime.__secureValues!.get(grantKey) ?? "null") as { status?: string; identity?: { id?: string } } | null;
  assert.equal(persistedGrant?.status, "grant", "successful App sign-in persists authorization through SecureStore");
  assert.equal(persistedGrant?.identity?.id, "employee-1");

  const { expoSecureKeyValueStore } = await import("./offline-authorization-storage.js");
  const localStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
  await localStore.writeProtectedPayload("employee-1", "evidence-created-through-the-App-grant");
  const listCallsBeforeRestart = api.listCalls;
  runtime.__sessionAvailable = false;
  runtime.__networkOnline = true;
  await act(async () => { tree.unmount(); });
  await act(async () => {
    tree = create(<App />);
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.ok(findText(tree, "Une connexion en ligne est nécessaire pour vérifier votre compte. Connectez-vous pour continuer."));
  assert.equal(await localStore.readProtectedPayload("employee-1"), "evidence-created-through-the-App-grant");
  assert.equal(api.listCalls, listCallsBeforeRestart, "remount without a server session does not refetch protected server work");

  let serverTaskCalls = 0;
  await assert.rejects(runOnlyWhenOnlineAuthorized(async () => {
    try {
      await api.getSession();
      return await localStore.confirmServerAuthorization("employee-1");
    } catch {
      return localStore.beginRevalidation("employee-1");
    }
  }, async () => { serverTaskCalls++; return "unexpected"; }));
  assert.equal(serverTaskCalls, 0);
  await act(async () => { tree.unmount(); });
});

test("App locks and preserves protected work when reconnect revalidation reports account deactivation", async () => {
  await loadApp();
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);

  const { expoSecureKeyValueStore } = await import("./offline-authorization-storage.js");
  const localStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
  await localStore.writeProtectedPayload("employee-1", "preserved-deactivated-evidence");
  assert.equal(await localStore.readProtectedPayload("employee-1"), "preserved-deactivated-evidence");
  assert.equal(api.listCalls, 1, "sign-in made one authorized list request before deactivation was reported");

  runtime.__sessionFailure = { status: 403, code: "ACCOUNT_DEACTIVATED" };
  const callsBeforeRevalidation = api.listCalls;
  const sessionCallsBeforeRevalidation = api.sessionCalls;
  assert.ok(runtime.__networkListener, "the rendered App is subscribed to connectivity changes");
  await act(async () => {
    runtime.__networkListener?.({ isConnected: true, isInternetReachable: true });
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.ok(api.sessionCalls > sessionCallsBeforeRevalidation, "reconnect revalidates through the App session call");
  assert.equal(api.listCalls, callsBeforeRevalidation, "no protected follow-up task request runs after deactivation is known");
  assert.equal(api.detailCalls.length, 0);
  assert.ok(findText(tree, "Votre compte a été désactivé. Les données locales protégées sont conservées et restent verrouillées."));
  assert.ok(findText(tree, "Connexion Employé"), "the App clears the active employee screen and returns to sign-in");
  assert.equal(findText(tree, "Mes tâches"), undefined, "the authorized task screen is no longer accessible through the App UI");
  assert.equal(await localStore.readProtectedPayload("employee-1"), null, "the real authorization service denies payload access after deactivation");
  assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "preserved-deactivated-evidence");
  const persistedLock = JSON.parse(runtime.__secureValues!.get("cetem-qc.offline-authorization.v1") ?? "null") as { status?: string } | null;
  assert.equal(persistedLock?.status, "locked-deactivated", "the deactivated lock is persisted through SecureStore");

  runtime.__networkOnline = false;
  await act(async () => { tree.unmount(); });
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Connexion Employé"), "remount does not restore the deactivated employee session");
  assert.equal(findText(tree, "Mes tâches"), undefined);
  const restartedStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
  assert.equal((await restartedStore.hydrate()).status, "locked-deactivated", "a fresh service instance restores the persisted deactivation lock");
  assert.equal(await restartedStore.readProtectedPayload("employee-1"), null);
  assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "preserved-deactivated-evidence");
  assert.equal(api.listCalls, callsBeforeRevalidation, "remount after known deactivation issues no protected server request");
  await act(async () => { tree.unmount(); });
  delete runtime.__sessionFailure;
});

test("App sign-in grant expires after remount while its protected payload remains stored", async () => {
  await loadApp();
  const api = installMocks();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    const { expoSecureKeyValueStore } = await import("./offline-authorization-storage.js");
    const localStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
    await localStore.writeProtectedPayload("employee-1", "expires-but-is-preserved");
    runtime.__networkOnline = false;
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { tree.unmount(); });
    await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(findText(tree, "La période d'accès hors ligne a expiré. Connectez-vous en ligne pour accéder aux données locales protégées."));
    assert.equal(await localStore.readProtectedPayload("employee-1"), null);
    assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "expires-but-is-preserved");
    assert.equal(api.listCalls, 1, "the restart did not issue a protected server request");
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("expired local grant blocks task fetch even when the server session remains valid", async () => {
  await loadApp();
  const api = installMocks();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    assert.equal(api.listCalls, 1);
    const sessionCallsBefore = api.sessionCalls;
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => {
      findTaskRow(tree, firstTask.establishment).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(api.sessionCalls > sessionCallsBefore, "the still-valid server session was revalidated");
    assert.deepEqual(api.detailCalls, [], "locked local authorization stops before the protected task endpoint");
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

// Story 5.6: paper-form sections, tables and defaults.
function sectionOf(id: string) {
  return GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === id)!;
}

async function goToSection(tree: ReactTestRenderer, id: string) {
  await act(async () => { findButton(tree, sectionOf(id).labelFr).props.onPress(); });
}

function findSectionHeading(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((node) => node.type === "Text" && node.props.accessibilityRole === "header" && node.children.join("") === label)[0];
}

async function openFirstTaskAfterRestart() {
  runtime.__secureValues = new Map();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  return tree;
}

for (const [layout, width] of [["phone", 390], ["tablet", 1024]] as const) {
  test(`${layout} section navigation reaches all 11 paper sections, ending with « Contrôle effectué par »`, async () => {
    await loadApp();
    installMocks();
    runtime.__mobileTestWidth = width;
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
    assert.equal(GRAPHIE_MOBILE_POV_CATALOGUE.sections.length, 11);
    for (const section of GRAPHIE_MOBILE_POV_CATALOGUE.sections) {
      await goToSection(tree, section.id);
      assert.ok(findSectionHeading(tree, section.labelFr), `expected heading ${section.labelFr}`);
    }
    assert.equal(GRAPHIE_MOBILE_POV_CATALOGUE.sections.at(-1)!.labelFr, "Contrôle effectué par");
    assert.ok(findInput(tree, "Nom et prénom"));
    assert.ok(findInput(tree, "Qualité"));
    assert.ok(findInput(tree, "Date de contrôle"));
    for (const forbidden of ["Conforme", "À signaler", "Non vérifié", "concluant", "Conclusion générale", "Contrôle approuvé par", "Signature"]) {
      assert.equal(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes(forbidden)).length, 0, forbidden);
    }
    await act(async () => { tree.unmount(); });
  });
}

test("phone tables render one labelled group per row with unit-labelled decimal inputs; tablet lays cells out in a row", async () => {
  await loadApp();
  installMocks();
  runtime.__mobileTestWidth = 390;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const isTouchTarget = (style: unknown) => (Array.isArray(style) ? style : [style]).flat().some((item) => item && typeof item === "object" && (item as { minHeight?: number }).minHeight! >= 44);
  for (const option of tree.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith("Nature de l'intervention: "))) {
    assert.ok(isTouchTarget(option.props.style), "choice buttons are at least 44 pt");
  }
  const deviceGrids = [
    ["equipment", ["Équipement", "Tube à rayons X", "Générateur HT"], ["Marque", "Modèle", "N° de série", "D.M.S"]],
    ["instruments", ["KVp mètre", "Dosimètre", "Mètre-ruban"], ["Marque", "Modèle", "N° de série"]],
  ] as const;
  for (const [sectionId, devices, attributes] of deviceGrids) {
    await goToSection(tree, sectionId);
    for (const device of devices) {
      const group = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === device)[0];
      assert.ok(group, `expected one group per device: ${device}`);
      assert.deepEqual(group!.findAll((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel), attributes.map((attribute) => `${device} — ${attribute}`));
    }
  }
  await goToSection(tree, "repeatability");
  for (const row of [1, 2, 3, 4, 5]) {
    const group = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === `Mesure ${row}`)[0];
    assert.ok(group, `expected row group Mesure ${row}`);
    assert.ok(group!.findAll((node) => node.type === "Text" && node.children.join("") === `Mesure ${row}`).length > 0);
    assert.equal(group!.findAll((node) => node.type === "TextInput").length, 3);
    assert.equal((Array.isArray(group!.props.style) ? group!.props.style : [group!.props.style]).some((item: { flexDirection?: string } | false) => item && item.flexDirection === "row"), false, "phone rows stack their inputs");
  }
  const measured = findInput(tree, "Mesure 2 — kV mesuré (kV)");
  assert.ok(measured);
  assert.equal(measured!.props.keyboardType, "decimal-pad");
  assert.ok(findInput(tree, "Mesure 5 — Kerma (mGy)"));
  assert.ok(findText(tree, "Kerma (mGy)"), "units are visible on the input label");
  assert.ok(findText(tree, "La mesure du kerma sera utilisée par la suite pour le contrôle de la reproductibilité et la répétabilité du rayonnement de sortie."));
  assert.equal(findInput(tree, "mAs (mAs)")?.props.keyboardType, "decimal-pad");
  assert.ok(findInput(tree, "mA max/2 (mA)"));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput" && /Kerma/.test(String(node.props.accessibilityLabel))).length, 5, "Kerma is entered once per repeatability row only");
  await goToSection(tree, "voltageAccuracy");
  for (const label of ["KV min", "KV", "KV max"]) assert.ok(findInput(tree, `${label} — kV affiché (kV)`), label);
  await goToSection(tree, "linearity");
  for (const row of [1, 2, 3]) assert.ok(findInput(tree, `Mesure ${row} — Kerma (dét) (mGy)`));
  const inputLabels = tree.root.findAll((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel);
  assert.deepEqual(inputLabels.slice(-3), ["mA max/2 (mA)", "DFC (distance foyer–chambre) (m)", "Commentaire"]);
  for (const input of tree.root.findAll((node) => node.type === "TextInput")) {
    assert.ok(isTouchTarget(input.props.style), "touch target is at least 44 pt");
    if (!input.props.multiline) assert.equal(input.props.keyboardType, "decimal-pad", String(input.props.accessibilityLabel));
  }
  await act(async () => { tree.unmount(); });

  installMocks();
  runtime.__mobileTestWidth = 1024;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await goToSection(tree, "repeatability");
  const tabletRow = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === "Mesure 1")[0]!;
  assert.ok((Array.isArray(tabletRow.props.style) ? tabletRow.props.style : [tabletRow.props.style]).some((item: { flexDirection?: string } | false) => item && item.flexDirection === "row"));
  assert.ok(findInput(tree, "Mesure 1 — kV mesuré (kV)"));
  await act(async () => { tree.unmount(); });
});

test("a new draft shows paper defaults that persist across restart, and a cleared default stays empty", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  assert.ok(findChoice(tree, "Nature de l'intervention: Demande ponctuelle"));
  await goToSection(tree, "instruments");
  for (const row of ["KVp mètre", "Dosimètre"]) {
    assert.equal(findInput(tree, `${row} — Marque`)?.props.value, "Fluke Biomedical");
    assert.equal(findInput(tree, `${row} — Modèle`)?.props.value, "8000");
    assert.equal(findInput(tree, `${row} — N° de série`)?.props.value, "105991");
  }
  for (const attribute of ["Marque", "Modèle", "N° de série"]) assert.equal(findInput(tree, `Mètre-ruban — ${attribute}`)?.props.value, "");
  await goToSection(tree, "voltageAccuracy");
  assert.deepEqual(["KV min", "KV", "KV max"].map((row) => findInput(tree, `${row} — kV affiché (kV)`)?.props.value), ["50", "70", ""]);
  await goToSection(tree, "linearity");
  assert.deepEqual([1, 2, 3].map((row) => findInput(tree, `Mesure ${row} — mAs (mAs)`)?.props.value), ["10", "", ""]);
  await goToSection(tree, "lightField");
  assert.deepEqual(["kV (kV)", "mAs (mAs)", "D.F.R (distance foyer–récepteur) (m)"].map((label) => findInput(tree, label)?.props.value), ["70", "4", "1"]);
  assert.equal(runtime.__draftRows!.has(key), false, "seeding alone does not write a draft");
  await goToSection(tree, "repeatability");
  assert.deepEqual([1, 2, 3, 4, 5].map((row) => findInput(tree, `Mesure ${row} — kV affiché (kV)`)?.props.value), ["70", "70", "70", "70", "70"]);
  await act(async () => { findInput(tree, "Mesure 3 — kV affiché (kV)")!.props.onChangeText(""); });
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["voltage.repeatability.row3.kvDisplayed"], "");
  assert.equal(saved.payload.values["instruments.dosimeter.brand"], "Fluke Biomedical");
  assert.equal(saved.payload.values["header.interventionNature"], "Convention");
  await act(async () => { tree.unmount(); });

  tree = await openFirstTaskAfterRestart();
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  await goToSection(tree, "repeatability");
  assert.deepEqual([1, 2, 3, 4, 5].map((row) => findInput(tree, `Mesure ${row} — kV affiché (kV)`)?.props.value), ["70", "70", "", "70", "70"]);
  await goToSection(tree, "instruments");
  assert.equal(findInput(tree, "KVp mètre — Marque")?.props.value, "Fluke Biomedical");
  await act(async () => { tree.unmount(); });
});

test("a new draft opened offline from the cached task list is seeded with the paper defaults", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows!.has(key), false);
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  await goToSection(tree, "instruments");
  assert.deepEqual(["Marque", "Modèle", "N° de série"].map((attribute) => findInput(tree, `KVp mètre — ${attribute}`)?.props.value), ["Fluke Biomedical", "8000", "105991"]);
  await goToSection(tree, "repeatability");
  assert.equal(findInput(tree, "Mesure 1 — kV affiché (kV)")?.props.value, "70");
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["header.interventionNature"], "Convention");
  assert.equal(saved.payload.values["instruments.kvpMeter.serial"], "105991");
  await act(async () => { tree.unmount(); });
});

test("table cells and light-field gaps survive save, restart and resume as exact strings", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const entries: [string, string, string][] = [
    ["voltageAccuracy", "KV max — kV affiché (kV)", "90"],
    ["voltageAccuracy", "KV min — kV mesuré (kV)", "49,2"],
    ["repeatability", "Mesure 2 — kV mesuré (kV)", "69,7"],
    ["repeatability", "Mesure 5 — Kerma (mGy)", "0.123"],
    ["repeatability", "mAs (mAs)", "20"],
    ["linearity", "Mesure 3 — Kerma (dét) (mGy)", "1,308"],
    ["linearity", "DFC (distance foyer–chambre) (m)", "0,7"],
    ["lightField", "Écart 1 (mm)", "2"],
    ["lightField", "Écart 4 (mm)", "-1,5"],
    ["equipment", "Tube à rayons X — Marque", "Varian"],
    ["controlPerformedBy", "Date de contrôle", "2026-10-02"],
  ];
  for (const [section, label, value] of entries) {
    await goToSection(tree, section);
    const input = findInput(tree, label);
    assert.ok(input, label);
    await act(async () => { input!.props.onChangeText(value); });
  }
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["voltage.repeatability.row2.kvMeasured"], "69,7");
  assert.equal(saved.payload.values["lightField.gap4"], "-1,5");
  assert.equal(saved.payload.values["equipment.tube.brand"], "Varian");
  await act(async () => { tree.unmount(); });

  tree = await openFirstTaskAfterRestart();
  for (const [section, label, value] of entries) {
    await goToSection(tree, section);
    assert.equal(findInput(tree, label)?.props.value, value, label);
  }
  await act(async () => { tree.unmount(); });
});

test("visual and mechanical checks offer N.A / Oui / Non touch buttons with exposed, persisted selection", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await goToSection(tree, "visual");
  for (const field of sectionOf("visual").fields) {
    const options = tree.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith(`${field.labelFr}: `));
    assert.deepEqual(options.map((node) => node.props.accessibilityLabel), ["N.A", "Oui", "Non"].map((option) => `${field.labelFr}: ${option}`), "blank is the initial unanswered state");
    assert.equal(options.some((node) => node.props.accessibilityState.selected), false, field.id);
  }
  await act(async () => { findChoice(tree, "Intégrité de l'appareil, bon état des couvercles: Oui")!.props.onPress(); });
  await act(async () => { findChoice(tree, "Intégrité de l'appareil, bon état des couvercles: Oui, sélectionné")!.props.onPress(); });
  assert.equal(findChoice(tree, "Intégrité de l'appareil, bon état des couvercles: Oui, sélectionné"), undefined, "tapping the selected option returns to unanswered");
  assert.equal(tree.root.findAll((node) => node.type === "TextInput" && node.props.multiline).length, 0, "no comment field in visual checks");
  await act(async () => { findChoice(tree, "Propreté générale: N.A")!.props.onPress(); });
  await goToSection(tree, "mechanical");
  await act(async () => { findChoice(tree, "Contrôle des freins: Non")!.props.onPress(); });
  const selected = findChoice(tree, "Contrôle des freins: Non, sélectionné")!;
  assert.equal(selected.props.accessibilityState.selected, true);
  assert.ok(selected.findAll((node) => node.type === "Text" && node.children.join("").includes("sélectionné")).length > 0);
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["visual.integrity"], "");
  await act(async () => { tree.unmount(); });

  tree = await openFirstTaskAfterRestart();
  await goToSection(tree, "mechanical");
  assert.equal(findChoice(tree, "Contrôle des freins: Non, sélectionné")?.props.accessibilityState.selected, true);
  assert.equal(findChoice(tree, "Contrôle des mouvements: Oui, sélectionné"), undefined);
  await goToSection(tree, "visual");
  assert.equal(findChoice(tree, "Propreté générale: N.A, sélectionné")?.props.accessibilityState.selected, true);
  await act(async () => { tree.unmount(); });
});

test("a stored catalogue 1.0.0 / schema 2 draft shows the compatibility notice, renders no values and keeps its bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = JSON.stringify({
    id: "v1-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 4, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "intervention.contexte": "v1 context", "voltage.accuracy": "49.2", "qualitative.0": "Conforme" } },
  });
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => ["v1 context", "49.2", "Fluke Biomedical", "Convention"].includes(String(node.props.value ?? ""))), false);
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityState?.selected === true && String(node.props.accessibilityLabel ?? "").includes(":")).length, 0);
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  await act(async () => { tree.unmount(); });
});

test("a stored catalogue 2.0.0 / schema 3 draft stamped with the old workbook rule shows the compatibility notice and keeps its bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = JSON.stringify({
    id: "old-rule-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 3, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "header.reportNumber": "old rule report", "voltage.accuracy.row1.kvMeasured": "49.2" } },
  });
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => ["old rule report", "49.2"].includes(String(node.props.value ?? ""))), false);
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  await act(async () => { tree.unmount(); });
});

const unreadableDraftRows = {
  oldRule: (taskId: string) => JSON.stringify({
    id: "old-rule-form", employeeId: "employee-1", taskId,
    payloadSchemaVersion: 1, revision: 3, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "header.reportNumber": "old rule report", "voltage.accuracy.row1.kvMeasured": "49.2" } },
  }),
  catalogueV1: (taskId: string) => JSON.stringify({
    id: "v1-form", employeeId: "employee-1", taskId,
    payloadSchemaVersion: 1, revision: 4, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "intervention.contexte": "v1 context", "voltage.accuracy": "49.2" } },
  }),
};
const reportNumberLabel = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr;

function hasButton(tree: ReactTestRenderer, title: string) {
  return tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === title).length > 0).length > 0;
}

async function assertPaperDefaultsShown(tree: ReactTestRenderer) {
  const defaults = createNewGraphieDraftValues();
  assert.equal(findInput(tree, reportNumberLabel)?.props.value, defaults["header.reportNumber"] ?? "");
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  await goToSection(tree, "instruments");
  assert.equal(findInput(tree, "KVp mètre — Marque")?.props.value, defaults["instruments.kvpMeter.brand"]);
  await goToSection(tree, "header");
}

async function assertResultsLiveAfterDiscard(tree: ReactTestRenderer) {
  await goToSection(tree, "voltageAccuracy");
  const input = findInput(tree, "KV min — kV mesuré (kV)");
  assert.ok(input, "KV min — kV mesuré (kV)");
  await act(async () => { input!.props.onChangeText("49,2"); });
  const block = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === fr.graphieResults.tests.voltageAccuracy)[0];
  assert.ok(block, "the re-seeded form shows calculated results");
  assert.ok(block!.findAll((node) => node.type === "Text").some((node) => node.children.join("") === "KV min — écart : -1,5999999999999945 %"));
  await goToSection(tree, "header");
}

test("M5 online: an old-rule draft is discarded from the compatibility notice and the form is re-seeded", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = unreadableDraftRows.oldRule(firstTask.id);
  runtime.__draftRows!.set(key, storedRow);
  runtime.__draftRows!.set(`employee-1/${secondTask.id}`, unreadableDraftRows.oldRule(secondTask.id));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.confirmDeleteDraft));
  assert.equal(runtime.__draftRows!.get(key), storedRow, "asking for confirmation does not touch storage");
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(runtime.__draftRows!.has(key), false, "the unreadable row is deleted");
  assert.ok(runtime.__draftRows!.has(`employee-1/${secondTask.id}`), "another task's draft is untouched");
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable), undefined);
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, false);
  await assertPaperDefaultsShown(tree);
  await assertResultsLiveAfterDiscard(tree);
  await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { revision: number; payload: { ruleId: string; values: Record<string, string> } };
  assert.equal(saved.revision, 1, "a fresh draft starts after the unreadable one is gone");
  assert.equal(saved.payload.ruleId, "cetem-paper-form");
  assert.equal(saved.payload.values["header.interventionNature"], "Convention");
  await act(async () => { tree.unmount(); });
});

test("M6 offline: a cached catalogue 1.0.0 / schema 2 draft can be discarded without a connection", async () => {
  await loadApp();
  const api = installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });

  runtime.__draftRows!.set(key, unreadableDraftRows.catalogueV1(firstTask.id));
  runtime.__networkOnline = false;
  const detailCalls = [...api.detailCalls];
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(runtime.__draftRows!.has(key), false);
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable), undefined);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, false);
  await assertPaperDefaultsShown(tree);
  await assertResultsLiveAfterDiscard(tree);
  assert.deepEqual(api.detailCalls, detailCalls, "the offline discard makes no server call");
  await act(async () => { tree.unmount(); });
});

test("M7 cancelling the unreadable-draft discard keeps the bytes and the notice", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = unreadableDraftRows.oldRule(firstTask.id);
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.cancel).props.onPress(); });
  assert.equal(findText(tree, fr.employeeTasks.confirmDeleteDraft), undefined);
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(findButton(tree, fr.employeeTasks.deleteDraft).props.disabled, false);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  await act(async () => { tree.unmount(); });
});

test("M8 a failed unreadable-draft delete reports the failure and keeps the bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = unreadableDraftRows.oldRule(firstTask.id);
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  runtime.__failDraftDelete = true;
  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Le brouillon local n’a pas pu être supprimé. Il est conservé."));
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);
  assert.equal(findButton(tree, fr.employeeTasks.deleteDraft).props.disabled, false, "the discard can be retried");
  await act(async () => { tree.unmount(); });
});

test("M9 after an explicit delete of a normal draft the form shows a new draft, not the deleted values", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await act(async () => { findInput(tree, reportNumberLabel)!.props.onChangeText("value to delete"); });
  await act(async () => { findChoice(tree, "Nature de l'intervention: Demande ponctuelle")!.props.onPress(); });
  await goToSection(tree, "instruments");
  await act(async () => { findInput(tree, "KVp mètre — Marque")!.props.onChangeText("Autre marque"); });
  await goToSection(tree, "header");
  await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), true); });
  assert.ok(runtime.__draftRows!.has(key));

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows!.has(key), false);
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "value to delete"), false);
  await assertPaperDefaultsShown(tree);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.has(key), false, "the reset form is not autosaved as a new draft");
  await act(async () => { tree.unmount(); });
});

test("M9b after an explicit delete of a legacy-content draft the form leaves legacy mode", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, JSON.stringify({
    id: "legacy-to-delete", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 2, payload: { content: "legacy text to delete" }, createdAt: 10, savedAt: 20,
  }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(findInput(tree, fr.employeeTasks.legacyDraftContent)?.props.value, "legacy text to delete");

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows!.has(key), false);
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(findInput(tree, fr.employeeTasks.legacyDraftContent), undefined, "legacy-content mode is off");
  await assertPaperDefaultsShown(tree);
  await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { content?: string; ruleId: string } };
  assert.equal(saved.payload.content, undefined, "the next save stores a structured draft, not the legacy text");
  assert.equal(saved.payload.ruleId, "cetem-paper-form");
  await act(async () => { tree.unmount(); });
});

test("M10 a generic draft storage failure offers no discard action", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, "{not json");
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftStorageUnavailable));
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
  assert.equal(runtime.__draftRows!.get(key), "{not json");
  await act(async () => { tree.unmount(); });
});

// Story 6.3 — calculated results in the Employé form. Readings are workbook source-regression values, not CETEM acceptance cases.
const results = fr.graphieResults;

function resultBlock(tree: ReactTestRenderer, heading: string) {
  return tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === heading)[0];
}

function blockTexts(tree: ReactTestRenderer, heading: string): string[] {
  const block = resultBlock(tree, heading);
  assert.ok(block, `expected result block ${heading}`);
  return block!.findAll((node) => node.type === "Text").map((node) => node.children.join(""));
}

async function typeInto(tree: ReactTestRenderer, entries: readonly (readonly [string, string, string])[]) {
  for (const [section, label, value] of entries) {
    await goToSection(tree, section);
    const input = findInput(tree, label);
    assert.ok(input, label);
    await act(async () => { input!.props.onChangeText(value); });
  }
}

async function openNewFormOffline() {
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });
  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  return { tree, calls: () => [api.listCalls, api.sessionCalls, api.detailCalls.length] };
}

async function openFirstTaskOnline(width = 390) {
  installMocks();
  runtime.__mobileTestWidth = width;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  return tree;
}

const accuracyReadings = [
  ["voltageAccuracy", "KV min — kV mesuré (kV)", "49,2"],
  ["voltageAccuracy", "KV — kV mesuré (kV)", "69,6"],
  ["voltageAccuracy", "KV max — kV affiché (kV)", "120"],
  ["voltageAccuracy", "KV max — kV mesuré (kV)", "119,8"],
] as const;
const repeatabilityReadings = [
  ...["69,7", "69,6", "69,7", "69,6", "69,7"].map((value, index) => ["repeatability", `Mesure ${index + 1} — kV mesuré (kV)`, value] as const),
  ...["2,677", "2,708", "2,705", "2,708", "2,705"].map((value, index) => ["repeatability", `Mesure ${index + 1} — Kerma (mGy)`, value] as const),
];
const linearityReadings = [
  ["linearity", "DFC (distance foyer–chambre) (m)", "0,7"],
  ["linearity", "Mesure 2 — mAs (mAs)", "40"],
  ["linearity", "Mesure 3 — mAs (mAs)", "160"],
  ...["0,672", "2,708", "11"].map((value, index) => ["linearity", `Mesure ${index + 1} — Kerma (dét) (mGy)`, value] as const),
] as const;
const lightFieldReadings = ["2", "-3", "1", "-4"].map((value, index) => ["lightField", `Écart ${index + 1} (mm)`, value] as const);
const allReadings = [...accuracyReadings, ...repeatabilityReadings, ...linearityReadings, ...lightFieldReadings];
const resultSections = [
  ["voltageAccuracy", [results.tests.voltageAccuracy]],
  ["repeatability", [results.tests.voltageRepeatability, results.tests.outputRepeatability]],
  ["linearity", [results.tests.outputLinearity]],
  ["lightField", [results.tests.lightFieldCorrespondence]],
] as const;

test("R1 offline new form: one kV mesuré shows its écart, provenance and an unavailable verdict without any server call", async () => {
  await loadApp();
  const { tree, calls } = await openNewFormOffline();
  const before = calls();
  await typeInto(tree, [accuracyReadings[0]]);
  const texts = blockTexts(tree, results.tests.voltageAccuracy);
  assert.ok(texts.includes("KV min — écart : -1,5999999999999945 %"), texts.join("\n"));
  assert.ok(texts.includes("KV max — écart : Indisponible — mesure manquante"));
  assert.ok(texts.includes("— Verdict indisponible : mesure manquante"));
  const verdictLabel = resultBlock(tree, results.tests.voltageAccuracy)!.findAll((node) => node.type === "Text" && node.children.join("").startsWith("— Verdict indisponible"))[0]!.props.accessibilityLabel;
  assert.equal(verdictLabel, "Verdict suggéré : indisponible — mesure manquante");
  assert.ok(texts.includes("Tolérance : |écart| ≤ 10 %"));
  assert.equal(texts.find((text) => text.startsWith("Règle ")), "Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 2, Exactitude de la tension");
  assert.ok(texts.includes(results.responsableDecides));
  assert.deepEqual(calls(), before, "no API call while typing or calculating");
  await act(async () => { tree.unmount(); });
});

test("R2 R3 R10 voltage accuracy suggests Conforme within 10 % and Non conforme at 11 %, with spelled-out verdict labels", async () => {
  await loadApp();
  const tree = await openFirstTaskOnline();
  await typeInto(tree, accuracyReadings);
  let texts = blockTexts(tree, results.tests.voltageAccuracy);
  assert.ok(texts.includes("✓ Conforme (suggestion)"), texts.join("\n"));
  assert.ok(texts.includes("Tolérance : |écart| ≤ 10 %"));
  assert.ok(texts.includes("KV — écart : -0,5714285714285796 %"));
  const verdict = () => resultBlock(tree, results.tests.voltageAccuracy)!.findAll((node) => node.type === "Text" && /\(suggestion\)$/.test(node.children.join("")))[0]!;
  assert.equal(verdict().props.accessibilityLabel, "Verdict suggéré : conforme");

  await typeInto(tree, [["voltageAccuracy", "KV max — kV mesuré (kV)", "133,2"]]);
  texts = blockTexts(tree, results.tests.voltageAccuracy);
  assert.ok(texts.includes("✗ Non conforme (suggestion)"), texts.join("\n"));
  assert.ok(!texts.includes("✓ Conforme (suggestion)"));
  assert.equal(verdict().props.accessibilityLabel, "Verdict suggéré : non conforme");
  await act(async () => { tree.unmount(); });
});

test("R4 R5 R6 repeatability, linearity and light-field blocks show their values, tolerances and verdicts", async () => {
  await loadApp();
  const tree = await openFirstTaskOnline();
  await typeInto(tree, [...repeatabilityReadings, ...linearityReadings, ...lightFieldReadings]);

  await goToSection(tree, "repeatability");
  const voltage = blockTexts(tree, results.tests.voltageRepeatability);
  assert.ok(voltage.includes("kV mesuré moy : 69,66 kV"), voltage.join("\n"));
  assert.ok(voltage.includes("kV mesuré min : 69,6 kV"));
  assert.ok(voltage.includes("kV mesuré max : 69,7 kV"));
  assert.ok(voltage.includes("Écart min / moy : -0,08613264427218242 %"));
  assert.ok(voltage.includes("Tolérance : |écart| ≤ 5 %"));
  assert.ok(voltage.includes("✓ Conforme (suggestion)"));
  const output = blockTexts(tree, results.tests.outputRepeatability);
  assert.ok(output.includes("Kerma moy : 2,7006 mGy"), output.join("\n"));
  assert.equal(output.filter((text) => /^Mesure [1-5] — écart : -?\d/.test(text)).length, 5);
  assert.ok(output.includes("Mesure 1 — écart : -0,8738798785455107 %"));
  assert.ok(output.includes("Tolérance : |écart| < 10 %"));
  assert.ok(output.includes("Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 3, Reproductibilité et répétabilité"));
  const blockHeadings: string[] = [results.tests.voltageRepeatability, results.tests.outputRepeatability];
  const order = tree.root.findAll((node) => node.type === "TextInput" || (node.type === "View" && blockHeadings.includes(node.props.accessibilityLabel)))
    .map((node) => String(node.props.accessibilityLabel));
  assert.ok(order.indexOf("Mesure 5 — Kerma (mGy)") < order.indexOf(results.tests.voltageRepeatability), "blocks sit below the table");
  assert.ok(order.indexOf(results.tests.voltageRepeatability) < order.indexOf(results.tests.outputRepeatability));
  assert.ok(order.indexOf(results.tests.outputRepeatability) < order.indexOf("Commentaire — répétabilité de la tension"), "blocks sit before the comment fields");

  await goToSection(tree, "linearity");
  const linearity = blockTexts(tree, results.tests.outputLinearity);
  assert.ok(linearity.includes("K2 : 0,03326283333333333 mGy/mAs"), linearity.join("\n"));
  assert.equal(linearity.filter((text) => /^Mesure [1-3] — écart : -?\d/.test(text)).length, 3);
  assert.equal(linearity.filter((text) => /^Mesure [1-3] — Kerma \(1m\) : .* mGy · K1 : .* mGy\/mAs$/.test(text)).length, 3);
  assert.ok(linearity.includes("Tolérance : |écart| < 15 %"));
  assert.ok(linearity.includes("✓ Conforme (suggestion)"));

  await goToSection(tree, "lightField");
  const light = blockTexts(tree, results.tests.lightFieldCorrespondence);
  assert.ok(light.includes("Σ|écarts| : 10 mm"), light.join("\n"));
  assert.ok(light.includes("Résultat : 1 % de la D.F.R"));
  assert.ok(light.includes("— Verdict indisponible : aucune tolérance imprimée sur le formulaire officiel"));
  assert.equal(light.some((text) => text.startsWith("Tolérance")), false);
  assert.ok(light.includes("Règle cetem-paper-form 2.0.0 — formulaire CETEM, page 4, Géométrie du faisceau — correspondance champ lumineux / champ de rayons X"));
  await act(async () => { tree.unmount(); });
});

test("R7 an unparseable number keeps its raw text, shows a field hint and an unavailable result, and still saves", async () => {
  await loadApp();
  const tree = await openFirstTaskOnline();
  await typeInto(tree, [["voltageAccuracy", "KV min — kV mesuré (kV)", "abc"]]);
  const input = findInput(tree, "KV min — kV mesuré (kV)")!;
  assert.equal(input.props.value, "abc");
  assert.match(String(input.props.accessibilityHint), /Valeur numérique invalide/);
  const fieldTexts = input.parent!.findAll((node) => node.type === "Text").map((node) => node.children.join(""));
  assert.ok(fieldTexts.includes(results.invalidNumber), "hint is shown under the input");
  assert.equal(tree.root.findAll((node) => node.type === "Text" && node.children.join("") === results.invalidNumber).length, 1);
  const texts = blockTexts(tree, results.tests.voltageAccuracy);
  assert.ok(texts.includes("KV min — écart : Indisponible — valeur numérique invalide"), texts.join("\n"));
  assert.ok(texts.includes("— Verdict indisponible : valeur numérique invalide"));
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["voltage.accuracy.row1.kvMeasured"], "abc");
  await act(async () => { tree.unmount(); });
});

test("R8 results are not saved and reappear identically after save, restart offline and resume", async () => {
  await loadApp();
  let tree = await openFirstTaskOnline();
  await typeInto(tree, allReadings);
  const snapshot = async () => {
    const all: Record<string, string[]> = {};
    for (const [section, headings] of resultSections) {
      await goToSection(tree, section);
      for (const heading of headings) all[heading] = blockTexts(tree, heading);
    }
    return all;
  };
  const before = await snapshot();
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { payload: { values: Record<string, string> } };
  assert.deepEqual(saved.payload.values, {
    ...createNewGraphieDraftValues(),
    "voltage.accuracy.row1.kvMeasured": "49,2", "voltage.accuracy.row2.kvMeasured": "69,6",
    "voltage.accuracy.row3.kvDisplayed": "120", "voltage.accuracy.row3.kvMeasured": "119,8",
    ...Object.fromEntries(["69,7", "69,6", "69,7", "69,6", "69,7"].map((value, index) => [`voltage.repeatability.row${index + 1}.kvMeasured`, value])),
    ...Object.fromEntries(["2,677", "2,708", "2,705", "2,708", "2,705"].map((value, index) => [`voltage.repeatability.row${index + 1}.kerma`, value])),
    "output.linearity.dfc": "0,7", "output.linearity.row2.mas": "40", "output.linearity.row3.mas": "160",
    "output.linearity.row1.kerma": "0,672", "output.linearity.row2.kerma": "2,708", "output.linearity.row3.kerma": "11",
    "lightField.gap1": "2", "lightField.gap2": "-3", "lightField.gap3": "1", "lightField.gap4": "-4",
  }, "only the typed strings and paper defaults are stored; no derived keys or reformatted values");
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(await snapshot(), before);
  for (const [section, label, value] of allReadings) {
    await goToSection(tree, section);
    assert.equal(findInput(tree, label)?.props.value, value, label);
  }
  await act(async () => { tree.unmount(); });
});

test("R9 no screen states an overall conformity and every block defers the final decision to the Responsable", async () => {
  await loadApp();
  const tree = await openFirstTaskOnline();
  const check = async () => {
    for (const section of GRAPHIE_MOBILE_POV_CATALOGUE.sections) {
      await goToSection(tree, section.id);
      const texts = tree.root.findAll((node) => node.type === "Text").map((node) => node.children.join(""));
      for (const forbidden of ["Machine conforme", "Appareil conforme", "Conclusion générale", "concluant", "tests conformes", "tests réussis"]) {
        assert.equal(texts.some((text) => text.includes(forbidden)), false, `${section.id}: ${forbidden}`);
      }
      const headings: readonly string[] = resultSections.find(([id]) => id === section.id)?.[1] ?? [];
      assert.equal(texts.filter((text) => text === results.responsableDecides).length, headings.length, section.id);
      for (const heading of headings) {
        for (const line of blockTexts(tree, heading)) {
          assert.doesNotMatch(line, / : (0|N\.A|)( (%|kV|mGy|mGy\/mAs|mm|% de la D\.F\.R))?$/, `${heading}: ${line}`);
          if (line.includes("Indisponible")) assert.match(line, /Indisponible — \S/, line);
        }
      }
    }
  };
  await check();
  await typeInto(tree, allReadings);
  await check();
  await act(async () => { tree.unmount(); });
});

test("R11 a draft stamped with the old rule keeps the compatibility notice and renders no result block", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, unreadableDraftRows.oldRule(firstTask.id));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  for (const [section, headings] of resultSections) {
    await goToSection(tree, section);
    for (const heading of headings) assert.equal(resultBlock(tree, heading), undefined, heading);
    assert.equal(findText(tree, results.responsableDecides), undefined);
  }
  await act(async () => { tree.unmount(); });
});

test("R11 an unsupported-version result is presented as no block", async () => {
  await loadApp();
  const { presentGraphieResult } = await import("./graphie-test-result.js");
  const { calculateGraphieResults } = await import("./graphie-calculation-service.js");
  const { GRAPHIE_CALCULATION_IDENTITY } = await import("@cetem-qc/domain");
  const oldRule = { ...GRAPHIE_CALCULATION_IDENTITY, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0" };
  const values = Object.fromEntries(allReadings.map(([, , value], index) => [`unused.${index}`, value]));
  const calculated = calculateGraphieResults(oldRule, values);
  for (const name of Object.keys(calculated) as (keyof typeof calculated)[]) {
    assert.equal(presentGraphieResult(name, calculated[name]), undefined, name);
  }
});

test("R12 tablet layout renders every result block in full, without truncation", async () => {
  await loadApp();
  const tree = await openFirstTaskOnline(1024);
  await typeInto(tree, [...accuracyReadings, ...linearityReadings]);
  for (const [section, headings] of resultSections) {
    await goToSection(tree, section);
    for (const heading of headings) {
      const block = resultBlock(tree, heading);
      assert.ok(block, heading);
      assert.equal(block!.findAll((node) => node.type === "TextInput").length, 0, "blocks are read-only");
      for (const text of block!.findAll((node) => node.type === "Text")) {
        assert.equal(text.props.numberOfLines, undefined);
        assert.equal(text.props.ellipsizeMode, undefined);
      }
    }
  }
  await goToSection(tree, "voltageAccuracy");
  assert.ok(blockTexts(tree, results.tests.voltageAccuracy).includes("KV max — écart : -0,16666666666666904 %"));
  await act(async () => { tree.unmount(); });
});

// Story 7.2 — synchronization and submission state, derived from durable outbox rows.
const reportField = () => GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((item) => item.id === "header.reportNumber")!;
const graphiePayload = (values: Record<string, string>) => ({
  catalogueId: GRAPHIE_CALCULATION_IDENTITY.catalogueId, catalogueVersion: GRAPHIE_CALCULATION_IDENTITY.catalogueVersion,
  schemaVersion: GRAPHIE_CALCULATION_IDENTITY.schemaVersion, ruleId: GRAPHIE_CALCULATION_IDENTITY.ruleId,
  ruleVersion: GRAPHIE_CALCULATION_IDENTITY.ruleVersion, values,
});

async function settle(ticks = 20) {
  for (let tick = 0; tick < ticks; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function seedDraft(taskId: string, values: Record<string, string> = createNewGraphieDraftValues()) {
  const draft = { id: `draft-${taskId}`, employeeId: "employee-1", taskId, payloadSchemaVersion: 1, revision: 1, createdAt: 10, savedAt: 20, payload: graphiePayload(values) };
  runtime.__draftRows!.set(`employee-1/${taskId}`, JSON.stringify(draft));
  return draft;
}

function seedOutbox(taskId: string, sequence: number, kind: "sync-draft" | "submit", status: string, outcome: string | null = null) {
  const operationId = `seed-op-${taskId}-${sequence}`;
  const snapshotId = `seed-snapshot-${taskId}-${sequence}`;
  const snapshot = { id: `draft-${taskId}`, employeeId: "employee-1", taskId, payloadSchemaVersion: 1, revision: 1, createdAt: 10, savedAt: 20, payload: graphiePayload(createNewGraphieDraftValues()) };
  runtime.__snapshotRows!.set(snapshotId, { employee_id: "employee-1", payload_json: JSON.stringify(snapshot) });
  runtime.__outboxRows!.set(operationId, {
    operation_id: operationId, idempotency_key: `seed-key-${taskId}-${sequence}`, employee_id: "employee-1", task_id: taskId, sequence, kind,
    snapshot_id: snapshotId, base_revision: 0, status, attempt_count: status === "queued" ? 0 : 1, last_error: null,
    outcome: status === "resolved" ? outcome : null, outcome_json: status === "resolved" ? "{}" : null,
    created_at: sequence, updated_at: sequence, resolved_at: status === "resolved" ? sequence : null,
  });
}

const submitRows = (taskId: string) => [...runtime.__outboxRows!.values()].filter((row) => row.task_id === taskId && row.kind === "submit");
const syncLine = (tree: ReactTestRenderer, label: string) => findText(tree, `${fr.employeeTasks.syncStatus}: ${label}`);
const allTexts = (tree: ReactTestRenderer) => tree.root.findAll((node) => node.type === "Text").map((node) => node.children.join(""));
type FakeResponse = SyncResult | "throw" | { ok: true };
function fakeTransport(responses: FakeResponse[], fallback: FakeResponse) {
  const transport = {
    sent: [] as SyncRequest[],
    responses,
    fallback,
    async send(request: SyncRequest): Promise<SyncResult> {
      transport.sent.push(structuredClone(request));
      const response = transport.responses.shift() ?? transport.fallback;
      if (response === "throw") throw new Error("network down");
      return response as SyncResult;
    },
  };
  return transport;
}

async function openFirstTask(tree: ReactTestRenderer) {
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await settle(); });
}

async function requestSubmission(tree: ReactTestRenderer) {
  await act(async () => { findButton(tree, fr.employeeTasks.submit).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); await settle(); });
}

test("Story 7.2 R1 the task detail shows lifecycle, synchronization, connectivity and local save as separate derived lines", async () => {
  await loadApp();
  // `submittable` defaults to !locked; an open conflict pauses Soumettre while the draft stays editable (Story 8.1).
  type Case = { rows: [kind: "sync-draft" | "submit", status: string, outcome?: string][]; state: string; transfer?: string; alert?: boolean; retry?: boolean; locked?: boolean; submittable?: boolean };
  const cases: Case[] = [
    { rows: [], state: fr.employeeTasks.draft, transfer: fr.employeeTasks.notSynchronized },
    { rows: [["sync-draft", "queued"]], state: fr.employeeTasks.draft, transfer: fr.employeeTasks.syncQueued },
    { rows: [["sync-draft", "resolved", "accepted"]], state: fr.employeeTasks.draft, transfer: fr.employeeTasks.draftSynchronized },
    { rows: [["sync-draft", "resolved", "rejected"]], state: fr.employeeTasks.draft, transfer: fr.employeeTasks.draftSyncRejected, alert: true },
    { rows: [["sync-draft", "resolved", "conflict"]], state: fr.employeeTasks.draft, transfer: fr.employeeTasks.syncConflict, alert: true, submittable: false },
    { rows: [["sync-draft", "retry-paused"]], state: fr.employeeTasks.draft, transfer: fr.employeeTasks.syncFailed, alert: true, retry: true },
    { rows: [["sync-draft", "blocked"], ["submit", "queued"]], state: fr.employeeTasks.submissionPending, transfer: fr.employeeTasks.syncBlocked, alert: true, retry: true, locked: true },
    { rows: [["submit", "queued"]], state: fr.employeeTasks.submissionPending, transfer: fr.employeeTasks.syncQueued, locked: true },
    { rows: [["submit", "in-flight"]], state: fr.employeeTasks.submissionPending, transfer: fr.employeeTasks.syncInFlight, locked: true },
    { rows: [["submit", "retry-paused"]], state: fr.employeeTasks.submissionPending, transfer: fr.employeeTasks.syncFailed, alert: true, retry: true, locked: true },
    { rows: [["submit", "blocked"]], state: fr.employeeTasks.submissionPending, transfer: fr.employeeTasks.syncBlocked, alert: true, retry: true, locked: true },
    { rows: [["sync-draft", "resolved", "accepted"], ["submit", "resolved", "accepted"]], state: fr.employeeTasks.submitted, locked: true },
    { rows: [["submit", "resolved", "rejected"]], state: fr.employeeTasks.acceptanceBlocked, locked: true },
    { rows: [["submit", "resolved", "conflict"]], state: fr.employeeTasks.syncConflict, locked: true },
  ];
  for (const item of cases) {
    installMocks();
    item.rows.forEach(([kind, status, outcome], index) => seedOutbox(firstTask.id, index + 1, kind, status, outcome ?? null));
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await openFirstTask(tree);
    const label = `${item.state} / ${item.transfer ?? "no line"}`;
    const stateDetail = tree.root.findAll((node) => node.type === "View" && node.findAll((child) => child.type === "Text" && child.children.join("") === fr.employeeTasks.state).length > 0
      && node.findAll((child) => child.type === "Text" && child.children.join("") === item.state).length > 0)[0];
    assert.ok(stateDetail, `« État » shows ${label}`);
    const syncLines = allTexts(tree).filter((text) => text.startsWith(`${fr.employeeTasks.syncStatus}: `));
    if (item.transfer) {
      assert.deepEqual(syncLines, [`${fr.employeeTasks.syncStatus}: ${item.transfer}`], label);
      assert.equal(syncLine(tree, item.transfer)!.props.accessibilityRole, item.alert ? "alert" : "summary", label);
    } else assert.deepEqual(syncLines, [], `resolved submissions need no synchronization line: ${label}`);
    assert.ok(findText(tree, `${fr.employeeTasks.connectivity}: ${fr.employeeTasks.online}`));
    assert.equal(allTexts(tree).filter((text) => text.startsWith(`${fr.employeeTasks.localPersistence}: `)).length, 1, label);
    assert.ok(allTexts(tree).every((text) => !text.includes("Dernier état serveur") && !text.includes("synchronisé ;")), label);
    assert.equal(hasButton(tree, fr.employeeTasks.retrySync), Boolean(item.retry), label);
    assert.equal(hasButton(tree, fr.employeeTasks.submit), item.submittable ?? !item.locked, label);
    assert.equal(findInput(tree, reportField().labelFr)!.props.editable, !item.locked, label);
    assert.equal(Boolean(findText(tree, fr.employeeTasks.readOnlyPending)), Boolean(item.locked), label);
    await act(async () => { tree.unmount(); });
  }
});

test("Story 7.2 R2 Soumettre offline asks for confirmation, records one submit item and stays read-only after a restart", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });
  runtime.__networkOnline = false;
  try {
    await act(async () => { tree = create(<App />); await settle(1); });
    await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); await settle(100); });
    assert.ok(findText(tree, `${fr.employeeTasks.connectivity}: ${fr.employeeTasks.offline}`));

    await act(async () => { findButton(tree, fr.employeeTasks.submit).props.onPress(); });
    assert.ok(findText(tree, fr.employeeTasks.confirmSubmit));
    await act(async () => { findButton(tree, fr.common.cancel).props.onPress(); await settle(); });
    assert.equal(findText(tree, fr.employeeTasks.confirmSubmit), undefined);
    assert.equal(submitRows(firstTask.id).length, 0, "cancelling writes nothing");
    assert.equal(runtime.__draftRows!.size, 0, "cancelling writes no draft");

    const field = reportField();
    await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("R2-offline-report"); });
    await requestSubmission(tree);
    const rows = submitRows(firstTask.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.status, "queued");
    const draft = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { values: Record<string, string> } };
    assert.equal(draft.payload.values[field.id], "R2-offline-report", "confirming flushed the pending edit");
    const snapshot = JSON.parse(runtime.__snapshotRows!.get(rows[0]!.snapshot_id)!.payload_json) as { revision: number; payload: unknown };
    assert.deepEqual({ revision: snapshot.revision, payload: snapshot.payload }, { revision: draft.revision, payload: draft.payload });
    assert.ok(findText(tree, fr.employeeTasks.submissionPending));
    assert.ok(syncLine(tree, fr.employeeTasks.syncQueued));
    assert.equal(findInput(tree, field.labelFr)!.props.editable, false);
    assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);
    await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), false); });
    assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
    assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
    assert.ok(findText(tree, fr.employeeTasks.readOnlyPending));
    await act(async () => { tree.unmount(); });

    await act(async () => { tree = create(<App />); await settle(1); });
    await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); await settle(100); });
    assert.ok(findText(tree, fr.employeeTasks.submissionPending), "the restart shows the same durable state");
    assert.equal(findInput(tree, field.labelFr)!.props.value, "R2-offline-report");
    assert.equal(findInput(tree, field.labelFr)!.props.editable, false);
    assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
    assert.equal(submitRows(firstTask.id).length, 1);
    await act(async () => { tree.unmount(); });
  } finally {
    runtime.__networkOnline = true;
  }
});

test("Story 7.2 R3 a double or repeated confirmation creates one submit item", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { findButton(tree, fr.employeeTasks.submit).props.onPress(); });
  await act(async () => {
    const submit = findButton(tree, fr.employeeTasks.submit);
    const confirm = findButton(tree, fr.common.confirm);
    confirm.props.onPress();
    confirm.props.onPress();
    submit.props.onPress();
    confirm.props.onPress();
    await settle();
  });
  assert.equal(submitRows(firstTask.id).length, 1);
  assert.ok(findText(tree, fr.employeeTasks.submissionPending));
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R4 a retryable transfer keeps the data, offers a retry and sends the same idempotency key until accepted", async () => {
  await loadApp();
  installMocks();
  const transport = fakeTransport([], { type: "retryable", code: "HTTP_503" });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R4-report"); });
  await requestSubmission(tree);
  const [row] = submitRows(firstTask.id);
  const snapshotBefore = runtime.__snapshotRows!.get(row!.snapshot_id)!.payload_json;
  // Five attempts with the engine's technical waits of 1, 2, 4 and 8 seconds.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 15_600)); await settle(); });
  assert.equal(transport.sent.length, 5);
  assert.ok(transport.sent.every((request) => request.idempotencyKey === row!.idempotency_key && request.kind === "submit"));
  assert.equal(submitRows(firstTask.id)[0]!.status, "retry-paused");
  assert.equal(runtime.__snapshotRows!.get(row!.snapshot_id)!.payload_json, snapshotBefore, "the snapshot is unchanged by the failure");
  assert.ok(findText(tree, fr.employeeTasks.submissionPending));
  assert.equal(syncLine(tree, fr.employeeTasks.syncFailed)?.props.accessibilityRole, "alert");
  assert.equal(findText(tree, fr.employeeTasks.submitted), undefined);

  transport.fallback = { type: "accepted", serverRevision: 3 };
  await act(async () => { findButton(tree, fr.employeeTasks.retrySync).props.onPress(); await settle(); });
  assert.equal(transport.sent.length, 6);
  assert.equal(transport.sent[5]!.idempotencyKey, transport.sent[0]!.idempotencyKey);
  assert.ok(findText(tree, fr.employeeTasks.submitted));
  assert.equal(allTexts(tree).filter((text) => text.startsWith(`${fr.employeeTasks.syncStatus}: `)).length, 0);
  assert.equal(hasButton(tree, fr.employeeTasks.retrySync), false);
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R5 a non-union success, a thrown send or being online never renders the task as submitted", async () => {
  await loadApp();
  installMocks();
  const transport = fakeTransport([{ ok: true }, "throw"], { ok: true });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await requestSubmission(tree);
  assert.equal(transport.sent.length, 1);
  assert.ok(findText(tree, fr.employeeTasks.submissionPending));
  assert.equal(syncLine(tree, fr.employeeTasks.syncBlocked)?.props.accessibilityRole, "alert");
  await act(async () => { findButton(tree, fr.employeeTasks.retrySync).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 1_200)); await settle(); });
  assert.equal(transport.sent.length, 3, "the thrown send is retried, then the non-union success blocks again");
  assert.ok(findText(tree, fr.employeeTasks.submissionPending));
  assert.equal(findText(tree, fr.employeeTasks.submitted), undefined);
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await settle(); });
  assert.ok(findText(tree, fr.employeeTasks.submissionPending), "connectivity alone changes nothing");
  assert.equal(findText(tree, fr.employeeTasks.submitted), undefined);
  assert.equal(submitRows(firstTask.id)[0]!.status, "blocked");
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R6 retry does not send while offline or when the stored authorization is no longer valid", async () => {
  await loadApp();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  try {
    installMocks();
    seedOutbox(firstTask.id, 1, "submit", "blocked");
    const transport = fakeTransport([], { type: "accepted", serverRevision: 1 });
    runtime.__syncTransport = transport;
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await act(async () => { tree.unmount(); });

    runtime.__networkOnline = false;
    await act(async () => { tree = create(<App />); await settle(1); });
    await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); await settle(100); });
    await act(async () => { findButton(tree, fr.employeeTasks.retrySync).props.onPress(); await settle(); });
    assert.equal(transport.sent.length, 0, "no send while offline");
    assert.ok(findText(tree, fr.auth.offlineUnavailable));
    assert.ok(syncLine(tree, fr.employeeTasks.syncBlocked));
    await act(async () => { tree.unmount(); });

    // A fresh online session whose stored grant then expires.
    installMocks();
    seedOutbox(firstTask.id, 1, "submit", "blocked");
    runtime.__syncTransport = transport;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await openFirstTask(tree);
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { findButton(tree, fr.employeeTasks.retrySync).props.onPress(); await settle(); });
    assert.equal(transport.sent.length, 0, "no send without a valid online authorization");
    assert.ok(findText(tree, fr.auth.reauthenticateOnline));
    assert.equal(runtime.__outboxRows!.get(`seed-op-${firstTask.id}-1`)!.status, "blocked");
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("Story 7.2 R7 (7.3 contract) offline, the transport is never called and the submission stays queued on the device", async () => {
  await loadApp();
  installMocks();
  const transport = fakeTransport([], { type: "accepted", serverRevision: 1 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); await settle(); });
  await requestSubmission(tree);
  const [row] = submitRows(firstTask.id);
  assert.deepEqual({ status: row!.status, attempts: row!.attempt_count }, { status: "queued", attempts: 0 });
  assert.equal(transport.sent.length, 0);
  assert.ok(findText(tree, fr.employeeTasks.submissionPending));
  assert.equal(syncLine(tree, fr.employeeTasks.syncQueued)?.props.accessibilityRole, "summary");
  assert.equal(hasButton(tree, fr.employeeTasks.retrySync), false);
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R8 every task list row shows its derived lifecycle instead of a fixed label", async () => {
  await loadApp();
  installMocks();
  runtime.__assignedTasksByEmployee!.set("employee-1", [firstTask, secondTask, thirdTask]);
  seedDraft(firstTask.id);
  seedOutbox(firstTask.id, 1, "submit", "queued");
  seedOutbox(secondTask.id, 2, "submit", "resolved", "accepted");
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { await settle(); });
  const pending = `${fr.employeeTasks.submissionPending} · ${fr.employeeTasks.syncQueued}`;
  assert.ok(findText(tree, `${firstTask.service} · ${pending}`));
  assert.ok(findText(tree, `${secondTask.service} · ${fr.employeeTasks.submitted}`));
  assert.ok(findText(tree, `${thirdTask.service} · ${fr.employeeTasks.draft}`));
  const resumable = findTaskRow(tree, firstTask.id);
  assert.equal(resumable.findAll((node) => node.type === "Text" && node.children.join("") === pending).length, 1, "the resumable draft row shows the derived state");
  const cachedSecond = tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === secondTask.establishment).length > 0)
    .filter((node) => node.findAll((child) => child.type === "Text" && child.children.join("") === fr.employeeTasks.submitted).length > 0);
  assert.equal(cachedSecond.length, 1, "the cached task row shows the derived state");
  assert.ok(allTexts(tree).every((text) => !text.includes("Dernier état serveur")));
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R9 a legacy-content draft cannot be submitted and nothing is written", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, JSON.stringify({
    id: "legacy-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 1, createdAt: 10, savedAt: 20,
    payload: { content: "R9 legacy notes" },
  }));
  const before = runtime.__draftRows!.get(key);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await requestSubmission(tree);
  assert.equal(findText(tree, fr.employeeTasks.submissionNotAllowed)?.props.accessibilityRole, "alert");
  assert.equal(submitRows(firstTask.id).length, 0);
  assert.equal(runtime.__draftRows!.get(key), before);
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true, "a refused request does not lock the draft");
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R10 edits attempted through the handlers while locked write nothing and show no save failure", async () => {
  await loadApp();
  installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R10-report" });
  seedOutbox(firstTask.id, 1, "submit", "queued");
  const draftBefore = runtime.__draftRows!.get(`employee-1/${firstTask.id}`);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  const field = findInput(tree, reportField().labelFr)!;
  assert.equal(field.props.value, "R10-report");
  assert.equal(field.props.editable, false);
  await act(async () => { field.props.onChangeText("R10-forbidden-edit"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), draftBefore, "no local_drafts revision");
  assert.equal(runtime.__outboxRows!.size, 1, "no outbox row");
  assert.equal(findInput(tree, reportField().labelFr)!.props.value, "R10-report");
  assert.equal(findText(tree, fr.employeeTasks.saveFailed), undefined);
  assert.equal(findText(tree, fr.employeeTasks.savingDraft), undefined);
  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.saveFailed), undefined, "leaving a locked task does not try to save it");
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R11 an active run reads « en cours » without a retry, and a sign-out during it never leaves the next session busy", async () => {
  await loadApp();
  installMocks();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let sends = 0;
  runtime.__syncTransport = { async send() { sends++; await gate; return { type: "blocking", code: "HTTP_503" }; } };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await requestSubmission(tree);
  assert.equal(sends, 1, "the run is waiting on the transport");
  assert.ok(syncLine(tree, fr.employeeTasks.syncInFlight), "the line reads « Synchronisation en cours… » while the run is active");
  assert.equal(hasButton(tree, fr.employeeTasks.retrySync), false);

  await act(async () => { findButton(tree, fr.auth.logout).props.onPress(); await settle(); });
  seedOutbox(secondTask.id, 50, "submit", "blocked");
  await act(async () => { release(); await settle(); });
  await signIn(tree);
  await act(async () => { await settle(); });
  await act(async () => { findTaskRow(tree, secondTask.establishment).props.onPress(); await settle(); });
  assert.equal(syncLine(tree, fr.employeeTasks.syncBlocked)?.props.accessibilityRole, "alert", "no run is active any more");
  assert.equal(hasButton(tree, fr.employeeTasks.retrySync), true);
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R12 a submission request that cannot be written shows a French alert and changes nothing", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  runtime.__failOutboxInsert = true;
  await requestSubmission(tree);
  assert.equal(findText(tree, fr.employeeTasks.submissionFailed)?.props.accessibilityRole, "alert");
  assert.equal(submitRows(firstTask.id).length, 0);
  assert.equal(runtime.__draftRows!.has(`employee-1/${firstTask.id}`), false, "the draft write was rolled back with the request");
  assert.ok(findText(tree, fr.employeeTasks.draft));
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true);
  assert.equal(hasButton(tree, fr.employeeTasks.submit), true);
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R13 an outbox read failure never shows a pending submission as an editable draft", async () => {
  await loadApp();
  installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R13-report" });
  seedOutbox(firstTask.id, 1, "submit", "queued");
  runtime.__failOutboxList = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { await settle(); });
  await openFirstTask(tree);
  assert.ok(findText(tree, fr.employeeTasks.draftStorageUnavailable), "the open fails instead of guessing « Brouillon »");
  assert.notEqual(findInput(tree, reportField().labelFr)?.props.editable, true);
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);

  runtime.__failOutboxList = false;
  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); await settle(); });
  await openFirstTask(tree);
  assert.ok(findText(tree, fr.employeeTasks.submissionPending));
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  runtime.__failOutboxList = true;
  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); await settle(); });
  assert.ok(findText(tree, `${firstTask.service} · ${fr.employeeTasks.submissionPending} · ${fr.employeeTasks.syncQueued}`), "a failed refresh keeps the last derived state");
  await act(async () => { tree.unmount(); });
});

test("Story 7.2 R14 a refused submission keeps autosaving the pending edit", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, JSON.stringify({
    id: "legacy-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 1, createdAt: 10, savedAt: 20,
    payload: { content: "R14 legacy notes" },
  }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { findInput(tree, fr.employeeTasks.legacyDraftContent)!.props.onChangeText("R14 edited notes"); });
  await requestSubmission(tree);
  assert.ok(findText(tree, fr.employeeTasks.submissionNotAllowed));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
  assert.ok(runtime.__draftRows!.get(key)!.includes("R14 edited notes"), "the edit is saved after the refusal");
  assert.equal(findText(tree, fr.employeeTasks.savingDraft), undefined);
  assert.equal(submitRows(firstTask.id).length, 0);
  await act(async () => { tree.unmount(); });
});

// Story 7.3 — automatic synchronization triggers and the server acceptance date.
test("Story 7.3 R15 sign-in, reconnection, return to the foreground and a changed save each start a run", async () => {
  await loadApp();
  installMocks();
  seedDraft(firstTask.id);
  seedOutbox(firstTask.id, 1, "sync-draft", "queued");
  const transport = fakeTransport([], { type: "accepted", serverRevision: 1 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { await settle(); });
  assert.deepEqual(transport.sent.map((request) => request.operationId), [`seed-op-${firstTask.id}-1`], "online sign-in sends the queued item");

  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); await settle(); });
  seedOutbox(secondTask.id, 2, "sync-draft", "queued");
  assert.equal(transport.sent.length, 1, "nothing is sent offline");
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await settle(); });
  assert.equal(transport.sent.at(-1)?.operationId, `seed-op-${secondTask.id}-2`, "reconnection sends");
  assert.equal(transport.sent.length, 2);

  seedOutbox(thirdTask.id, 3, "sync-draft", "queued");
  await act(async () => { for (const listener of runtime.__appStateListeners ?? []) listener("active"); await settle(); });
  assert.equal(transport.sent.at(-1)?.operationId, `seed-op-${thirdTask.id}-3`, "returning to the foreground sends");
  assert.equal(transport.sent.length, 3);

  await openFirstTask(tree);
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R15-changed"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
  assert.equal(transport.sent.length, 4, "a save that created a revision sends its draft synchronization");
  assert.equal(transport.sent[3]!.kind, "sync-draft");
  assert.equal((transport.sent[3]!.snapshot.payload as { values: Record<string, string> }).values["header.reportNumber"], "R15-changed");
  await act(async () => { await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(); await settle(); });
  assert.equal(transport.sent.length, 4, "an unchanged save starts nothing");
  await act(async () => { tree.unmount(); });
});

test("Story 7.3 R15 sign-in, reconnection, return to the foreground and a changed save never resend a blocked item", async () => {
  await loadApp();
  installMocks();
  seedDraft(firstTask.id);
  seedOutbox(firstTask.id, 1, "sync-draft", "queued");
  seedOutbox(secondTask.id, 50, "submit", "blocked");
  const blocked = `seed-op-${secondTask.id}-50`;
  const transport = fakeTransport([], { type: "accepted", serverRevision: 1 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { await settle(); });
  assert.deepEqual(transport.sent.map((request) => request.operationId), [`seed-op-${firstTask.id}-1`], "sign-in sends only the queued item");

  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); await settle(); });
  seedOutbox(thirdTask.id, 3, "sync-draft", "queued");
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await settle(); });
  assert.equal(transport.sent.at(-1)?.operationId, `seed-op-${thirdTask.id}-3`, "reconnection sends the queued item");
  assert.equal(transport.sent.length, 2);

  await act(async () => { for (const listener of runtime.__appStateListeners ?? []) listener("active"); await settle(); });
  assert.equal(transport.sent.length, 2, "returning to the foreground leaves the blocked item alone");

  await openFirstTask(tree);
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R15-blocked-changed"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
  assert.equal(transport.sent.length, 3, "a changed save sends only its own draft synchronization");
  assert.equal(transport.sent.some((request) => request.operationId === blocked), false);
  assert.equal(runtime.__outboxRows!.get(blocked)!.status, "blocked");
  await act(async () => { tree.unmount(); });
});

test("Story 7.3 R16 an accepted submission shows the server acceptance date in local time, and nothing without it", async () => {
  await loadApp();
  const acceptedAt = "2026-10-04T08:05:00.000Z";
  const local = new Date(acceptedAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const expected = `Soumission acceptée par le serveur le ${pad(local.getDate())}/${pad(local.getMonth() + 1)}/${local.getFullYear()} à ${pad(local.getHours())}:${pad(local.getMinutes())}.`;
  for (const outcomeJson of [JSON.stringify({ serverRevision: 1, detail: { acceptedAt } }), "{}", JSON.stringify({ serverRevision: 1, detail: { acceptedAt: "hier" } })]) {
    installMocks();
    seedDraft(firstTask.id);
    seedOutbox(firstTask.id, 1, "submit", "resolved", "accepted");
    runtime.__outboxRows!.get(`seed-op-${firstTask.id}-1`)!.outcome_json = outcomeJson;
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await openFirstTask(tree);
    assert.ok(findText(tree, fr.employeeTasks.submitted), "the lifecycle label is unchanged");
    const lines = allTexts(tree).filter((text) => text.startsWith("Soumission acceptée par le serveur"));
    if (outcomeJson.includes(acceptedAt)) {
      assert.deepEqual(lines, [expected]);
      assert.equal(findText(tree, expected)!.props.accessibilityRole, "summary");
    } else assert.deepEqual(lines, [], outcomeJson);
    await act(async () => { tree.unmount(); });
  }
});

test("Story 7.3 R17 no trigger sends anything offline or without an online authorization", async () => {
  await loadApp();
  installMocks();
  const transport = fakeTransport([], { type: "accepted", serverRevision: 1 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });
  seedDraft(firstTask.id);
  seedOutbox(firstTask.id, 1, "sync-draft", "queued");

  runtime.__networkOnline = false;
  try {
    await act(async () => { tree = create(<App />); await settle(1); });
    await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); await settle(100); });
    await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R17-offline"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
    await act(async () => { for (const listener of runtime.__appStateListeners ?? []) listener("active"); await settle(); });
    assert.equal(transport.sent.length, 0, "offline: no send");
    await act(async () => { tree.unmount(); });
  } finally {
    runtime.__networkOnline = true;
  }

  runtime.__sessionAvailable = false;
  await act(async () => { tree = create(<App />); await settle(); });
  assert.ok(findText(tree, fr.auth.reauthenticateOnline), "online but not authorized by the server");
  await act(async () => { for (const listener of runtime.__appStateListeners ?? []) listener("active"); await settle(); });
  assert.equal(transport.sent.length, 0, "without an online authorization: no send");
  assert.ok([...runtime.__outboxRows!.values()].every((row) => row.status === "queued"));
  await act(async () => { tree.unmount(); });
});

// Story 8.1 — explicit synchronization conflict resolution.
const conflictActor = { id: "employee-1", displayName: "Employée Test" };
const conflictDetail = { revision: 2, state: "draft", lastChangedAt: "2026-10-04T08:00:00.000Z", lastChangedBy: conflictActor };
const pad2 = (value: number) => String(value).padStart(2, "0");
const deviceDateTime = (value: number | string) => {
  const date = new Date(value);
  return { date: `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`, time: `${pad2(date.getHours())}:${pad2(date.getMinutes())}` };
};
const fieldLabel = (sectionId: string, fieldId: string) => {
  const section = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((item) => item.id === sectionId)!;
  return `${section.labelFr} › ${section.fields.find((item) => item.id === fieldId)!.labelFr}`;
};

function seedConflict(taskId: string, sequence: number, kind: "sync-draft" | "submit") {
  seedOutbox(taskId, sequence, kind, "resolved", "conflict");
  runtime.__outboxRows!.get(`seed-op-${taskId}-${sequence}`)!.outcome_json = JSON.stringify({ serverRevision: 2, detail: conflictDetail });
  return `seed-op-${taskId}-${sequence}`;
}

function serverVersion(state: "draft" | "submitted", values: Record<string, string>, revision = 3) {
  return { revision, state, lastChangedAt: "2026-10-04T09:30:00.000Z", lastChangedBy: { id: "employee-2", displayName: "Collègue Test" }, payload: graphiePayload(values) };
}

/** Installs the current-version read; offline or unauthorized panels must never call it. */
function serveVersion(api: MockApi, respond: () => Promise<unknown>) {
  const calls: string[] = [];
  api.getEmployeeTaskAuditVersion = async (taskId) => { calls.push(taskId); return respond(); };
  return calls;
}

const conflictRows = () => ({
  drafts: new Map(runtime.__draftRows), outbox: JSON.stringify([...runtime.__outboxRows!.values()]),
  resolutions: runtime.__resolutionRows!.size, syncState: JSON.stringify([...runtime.__syncStateRows!.entries()]),
});

test("Story 8.1 R18 a draft conflict shows the local, conflict-time and current server versions with the differing fields; the form stays editable", async () => {
  await loadApp();
  const api = installMocks();
  const localValues = { ...createNewGraphieDraftValues(), "header.reportNumber": "R18-local" };
  const draft = seedDraft(firstTask.id, localValues);
  seedConflict(firstTask.id, 1, "sync-draft");
  const calls = serveVersion(api, async () => serverVersion("draft", { ...localValues, "header.reportNumber": "R18-serveur", "comments.general": "Commentaire serveur" }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.deepEqual(calls, [firstTask.id]);
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle)?.props.accessibilityRole, "alert");
  assert.ok(findText(tree, fr.employeeTasks.conflictExplanation));
  const saved = deviceDateTime(draft.savedAt);
  assert.ok(findText(tree, `Version locale : révision 1, enregistrée le ${saved.date} à ${saved.time}`));
  const atConflict = deviceDateTime(conflictDetail.lastChangedAt);
  assert.ok(findText(tree, `Version du serveur au moment du conflit : révision 2, modifiée le ${atConflict.date} à ${atConflict.time} par Employée Test`));
  const current = deviceDateTime("2026-10-04T09:30:00.000Z");
  assert.ok(findText(tree, `Version actuelle du serveur : révision 3 (${fr.employeeTasks.draft}), modifiée le ${current.date} à ${current.time} par Collègue Test`));
  assert.ok(findText(tree, fr.employeeTasks.conflictDifferences));
  assert.ok(findText(tree, fieldLabel(GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.id, "header.reportNumber")));
  assert.ok(findText(tree, fieldLabel("comments", "comments.general")));
  assert.equal(findText(tree, fr.employeeTasks.conflictPendingKept), undefined);
  assert.ok(allTexts(tree).every((text) => !text.includes("R18-serveur") && !text.includes("Commentaire serveur")), "server values are not shown");
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
  assert.equal(hasButton(tree, fr.employeeTasks.retrySync), false);
  assert.equal(findButton(tree, fr.employeeTasks.conflictKeepLocal).props.disabled, false);
  assert.equal(findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.disabled, false);
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true);

  // A save during the open conflict stays local: no outbox item with the stale base.
  const outboxBefore = JSON.stringify([...runtime.__outboxRows!.values()]);
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R18-edited"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
  assert.ok(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!.includes("R18-edited"));
  assert.equal(JSON.stringify([...runtime.__outboxRows!.values()]), outboxBefore);
  assert.ok(findText(tree, fr.employeeTasks.conflictTitle), "the conflict stays open");
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R19 a submit conflict keeps the form read-only and says the requested submission is kept", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R19-local" });
  seedConflict(firstTask.id, 1, "submit");
  serveVersion(api, async () => serverVersion("draft", createNewGraphieDraftValues()));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.ok(findText(tree, fr.employeeTasks.conflictPendingKept));
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
  assert.equal(findButton(tree, fr.employeeTasks.conflictKeepLocal).props.disabled, false);
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R20 a failed or offline server read shows why with « Réessayer », keeps both actions disabled, and a successful retry enables them", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id);
  seedConflict(firstTask.id, 1, "sync-draft");
  let fail = true;
  const calls = serveVersion(api, async () => { if (fail) throw new Error("server unavailable"); return serverVersion("draft", createNewGraphieDraftValues()); });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.equal(calls.length, 1);
  assert.equal(findText(tree, fr.employeeTasks.conflictServerUnavailable)?.props.accessibilityRole, "alert");
  assert.ok(findButton(tree, fr.employeeTasks.conflictRetryFetch));
  assert.equal(findButton(tree, fr.employeeTasks.conflictKeepLocal).props.disabled, true);
  assert.equal(findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.disabled, true);
  assert.ok(allTexts(tree).every((text) => !text.startsWith("Version actuelle du serveur")), "no invented server data");

  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); await settle(); });
  await act(async () => { findButton(tree, fr.employeeTasks.conflictRetryFetch).props.onPress(); await settle(); });
  assert.equal(calls.length, 1, "nothing is fetched offline");
  assert.ok(tree.root.findAll((node) => node.type === "Text" && node.children.join("") === fr.auth.offlineUnavailable).length > 0);
  assert.equal(findButton(tree, fr.employeeTasks.conflictKeepLocal).props.disabled, true);

  fail = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await settle(); });
  await act(async () => { findButton(tree, fr.employeeTasks.conflictRetryFetch).props.onPress(); await settle(); });
  assert.equal(calls.length, 2);
  assert.equal(findText(tree, fr.employeeTasks.conflictServerUnavailable), undefined);
  assert.equal(findButton(tree, fr.employeeTasks.conflictKeepLocal).props.disabled, false);
  assert.equal(findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.disabled, false);
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R21 keep-local makes the draft editable again and sends one sync-draft on the server revision with the conflict reference", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R21-local" });
  const conflicted = seedConflict(firstTask.id, 1, "sync-draft");
  serveVersion(api, async () => serverVersion("draft", createNewGraphieDraftValues(), 5));
  const transport = fakeTransport([], { type: "accepted", serverRevision: 6 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.equal(transport.sent.length, 0, "the open conflict pauses the task");
  await act(async () => { findButton(tree, fr.employeeTasks.conflictKeepLocal).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle), undefined, "the panel closes");
  assert.deepEqual(transport.sent.map((request) => [request.kind, request.baseRevision, request.conflictOperationId]), [["sync-draft", 5, conflicted]]);
  assert.equal((transport.sent[0]!.snapshot.payload as { values: Record<string, string> }).values["header.reportNumber"], "R21-local");
  assert.equal(submitRows(firstTask.id).length, 0, "no submission is queued");
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true);
  assert.ok(hasButton(tree, fr.employeeTasks.submit), "Soumettre returns");
  assert.ok(syncLine(tree, fr.employeeTasks.draftSynchronized));
  assert.equal(runtime.__resolutionRows!.size, 1);
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R22 discard asks for confirmation; cancel changes nothing and confirm reloads the server values as a synchronized draft", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R22-local" });
  seedConflict(firstTask.id, 1, "sync-draft");
  serveVersion(api, async () => serverVersion("draft", { ...createNewGraphieDraftValues(), "header.reportNumber": "R22-serveur" }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  const before = conflictRows();
  await act(async () => { findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.onPress(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictConfirmDiscard)?.props.accessibilityRole, "alert");
  await act(async () => { findButton(tree, fr.common.cancel).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictConfirmDiscard), undefined);
  assert.deepEqual(conflictRows(), before, "cancelling changes nothing");
  assert.equal(findInput(tree, reportField().labelFr)!.props.value, "R22-local");

  await act(async () => { findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.onPress(); });
  await act(async () => { findButton(tree, fr.employeeTasks.conflictConfirmDiscardAction).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle), undefined);
  assert.equal(findInput(tree, reportField().labelFr)!.props.value, "R22-serveur");
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true);
  assert.ok(syncLine(tree, fr.employeeTasks.draftSynchronized));
  assert.ok(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!.includes("R22-serveur"));
  assert.equal([...runtime.__resolutionRows!.values()][0]!.choice, "discard-local");
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R23 a submitted server version offers only discard, which reloads it read-only as accepted", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R23-local" });
  seedConflict(firstTask.id, 1, "submit");
  serveVersion(api, async () => serverVersion("submitted", { ...createNewGraphieDraftValues(), "header.reportNumber": "R23-accepté" }, 4));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.ok(allTexts(tree).some((text) => text.startsWith(`Version actuelle du serveur : révision 4 (${fr.employeeTasks.submitted})`)));
  assert.equal(hasButton(tree, fr.employeeTasks.conflictKeepLocal), false);
  await act(async () => { findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.onPress(); });
  await act(async () => { findButton(tree, fr.employeeTasks.conflictConfirmDiscardAction).props.onPress(); await settle(); });
  const stateDetail = tree.root.findAll((node) => node.type === "View" && node.findAll((child) => child.type === "Text" && child.children.join("") === fr.employeeTasks.state).length > 0
    && node.findAll((child) => child.type === "Text" && child.children.join("") === fr.employeeTasks.submitted).length > 0)[0];
  assert.ok(stateDetail, "« État » reads « Soumis — accepté par le serveur »");
  assert.equal(findInput(tree, reportField().labelFr)!.props.value, "R23-accepté");
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle), undefined);
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R24 a failed resolution keeps the panel and leaves the local draft and outbox unchanged", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R24-local" });
  seedConflict(firstTask.id, 1, "sync-draft");
  serveVersion(api, async () => serverVersion("draft", createNewGraphieDraftValues()));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  const before = conflictRows();
  runtime.__failOutboxInsert = true;
  await act(async () => { findButton(tree, fr.employeeTasks.conflictKeepLocal).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictResolutionFailed)?.props.accessibilityRole, "alert");
  assert.ok(findText(tree, fr.employeeTasks.conflictTitle), "the panel stays");
  assert.deepEqual(conflictRows(), before);
  assert.equal(findInput(tree, reportField().labelFr)!.props.value, "R24-local");
  assert.equal(hasButton(tree, fr.employeeTasks.submit), false);
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R25 a stale panel (the open conflicts changed) says so, changes nothing and reads the server version again", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R25-local" });
  seedConflict(firstTask.id, 1, "sync-draft");
  const calls = serveVersion(api, async () => serverVersion("draft", createNewGraphieDraftValues()));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.equal(calls.length, 1);
  seedConflict(firstTask.id, 2, "sync-draft");
  const before = conflictRows();
  await act(async () => { findButton(tree, fr.employeeTasks.conflictKeepLocal).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictResolutionStale)?.props.accessibilityRole, "alert");
  assert.ok(findText(tree, fr.employeeTasks.conflictTitle), "the panel stays");
  assert.ok(calls.length > 1, "the server version is read again");
  assert.deepEqual(conflictRows(), before, "a stale panel changes nothing");
  assert.equal(findButton(tree, fr.employeeTasks.conflictKeepLocal).props.disabled, false, "the refreshed panel allows a new choice");
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R26 keep-local first saves an edit typed just before, so the kept version is the one on screen", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R26-local" });
  seedConflict(firstTask.id, 1, "sync-draft");
  serveVersion(api, async () => serverVersion("draft", createNewGraphieDraftValues(), 5));
  const transport = fakeTransport([], { type: "accepted", serverRevision: 6 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R26-edited"); });
  await act(async () => { findButton(tree, fr.employeeTasks.conflictKeepLocal).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle), undefined);
  assert.equal(transport.sent.length, 1);
  assert.equal((transport.sent[0]!.snapshot.payload as { values: Record<string, string> }).values["header.reportNumber"], "R26-edited");
  assert.ok(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!.includes("R26-edited"));
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R27 a submit conflict resolved with keep-local becomes an editable draft, queues no submission and offers Soumettre again", async () => {
  await loadApp();
  const api = installMocks();
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R27-local" });
  const conflicted = seedConflict(firstTask.id, 1, "submit");
  serveVersion(api, async () => serverVersion("draft", createNewGraphieDraftValues(), 5));
  const transport = fakeTransport([], { type: "accepted", serverRevision: 6 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { await settle(); });
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  await act(async () => { findButton(tree, fr.employeeTasks.conflictKeepLocal).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle), undefined);
  assert.deepEqual(transport.sent.map((request) => [request.kind, request.baseRevision, request.conflictOperationId]), [["sync-draft", 5, conflicted]]);
  assert.equal(submitRows(firstTask.id).length, 1, "only the conflicted submit row remains; no new submission is queued");
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true);
  assert.ok(hasButton(tree, fr.employeeTasks.submit), "Soumettre returns");
  await act(async () => { tree.unmount(); });
});

test("Story 8.1 R28 an unreadable local draft in conflict offers only discard, lists no differences and hides its delete button", async () => {
  await loadApp();
  const api = installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, unreadableDraftRows.oldRule(firstTask.id));
  seedConflict(firstTask.id, 1, "sync-draft");
  serveVersion(api, async () => serverVersion("draft", { ...createNewGraphieDraftValues(), "header.reportNumber": "R28-serveur" }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await settle(); });
  assert.ok(findText(tree, fr.employeeTasks.conflictLocalUnavailable));
  assert.equal(hasButton(tree, fr.employeeTasks.conflictKeepLocal), false);
  assert.equal(findText(tree, fr.employeeTasks.conflictDifferences), undefined);
  assert.equal(findText(tree, fr.employeeTasks.conflictNoDifference), undefined);
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false, "the unreadable draft cannot be deleted during the conflict");
  await act(async () => { findButton(tree, fr.employeeTasks.conflictDiscardLocal).props.onPress(); });
  await act(async () => { findButton(tree, fr.employeeTasks.conflictConfirmDiscardAction).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.conflictTitle), undefined);
  assert.equal(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable), undefined);
  assert.ok(runtime.__draftRows!.get(key)!.includes("R28-serveur"));
  await act(async () => { tree.unmount(); });
});

// Story 8.2 — correction draft after a validation rejection.
const refusedAt = new Date(2026, 9, 5, 9, 7).getTime();
const refusalIssues = [{ path: "values.header.reportNumber", code: "unpaired-surrogate" }, { path: "legacyContent", code: "legacy-content-on-submit" }];
const reportIssueLine = (code: string) => `${fieldLabel(GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.id, "header.reportNumber")} : ${fr.employeeTasks.issueCodes[code]}`;

/** A submission refused by the server (stored 422) whose snapshot holds `reportNumber`. */
function seedRefusal(taskId: string, sequence: number, reportNumber: string, code = "INVALID_PAYLOAD", issues: unknown[] = refusalIssues) {
  seedOutbox(taskId, sequence, "submit", "resolved", "rejected");
  const operationId = `seed-op-${taskId}-${sequence}`;
  const row = runtime.__outboxRows!.get(operationId)!;
  Object.assign(row, { outcome_json: JSON.stringify({ detail: { code, issues } }), resolved_at: refusedAt, updated_at: refusedAt });
  const snapshot = JSON.parse(runtime.__snapshotRows!.get(row.snapshot_id)!.payload_json) as { payload: { values: Record<string, string> } };
  snapshot.payload.values = { ...snapshot.payload.values, "header.reportNumber": reportNumber };
  runtime.__snapshotRows!.set(row.snapshot_id, { employee_id: "employee-1", payload_json: JSON.stringify(snapshot) });
  return operationId;
}

function stateShown(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((node) => node.type === "View" && node.findAll((child) => child.type === "Text" && child.children.join("") === fr.employeeTasks.state).length > 0
    && node.findAll((child) => child.type === "Text" && child.children.join("") === label).length > 0).length > 0;
}

const correctionRows = () => ({
  drafts: new Map(runtime.__draftRows), outbox: JSON.stringify([...runtime.__outboxRows!.values()]),
  snapshots: JSON.stringify([...runtime.__snapshotRows!.entries()]), corrections: runtime.__correctionRows!.size,
});

async function openRefusedTask(reportNumber: string, code?: string, issues?: unknown[]) {
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": reportNumber });
  const refused = seedRefusal(firstTask.id, 1, reportNumber, code, issues);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  return { tree, refused };
}

test("Story 8.2 R29 a refused submission shows why, keeps the attempt read-only and is never presented as a conflict", async () => {
  await loadApp();
  installMocks();
  const { tree } = await openRefusedTask("R29-valeur-refusée");
  assert.ok(stateShown(tree, fr.employeeTasks.acceptanceBlocked));
  assert.equal(findText(tree, fr.employeeTasks.rejectionCodes.INVALID_PAYLOAD)?.props.accessibilityRole, "alert");
  assert.ok(findText(tree, fr.employeeTasks.rejectionIssues));
  assert.ok(findText(tree, reportIssueLine("unpaired-surrogate")), "the field is named « section › champ »");
  assert.ok(findText(tree, `${fr.employeeTasks.issueFormLevel} : ${fr.employeeTasks.issueCodes["legacy-content-on-submit"]}`));
  assert.ok(findText(tree, fr.employeeTasks.rejectionOriginalKept));
  assert.ok(findText(tree, fr.employeeTasks.rulesGated));
  assert.ok(allTexts(tree).every((text) => !text.includes("R29-valeur-refusée")), "values are never shown as text");
  assert.ok(allTexts(tree).every((text) => !/conflit/i.test(text)), "a rejection is not a conflict");
  assert.equal(findText(tree, fr.employeeTasks.submitted), undefined);
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  for (const title of [fr.employeeTasks.submit, fr.employeeTasks.deleteDraft, fr.employeeTasks.retrySync, fr.employeeTasks.conflictKeepLocal, fr.employeeTasks.conflictDiscardLocal]) {
    assert.equal(hasButton(tree, title), false, title);
  }
  assert.ok(hasButton(tree, fr.employeeTasks.createCorrection));
  await act(async () => { tree.unmount(); });
});

test("Story 8.2 R30 R31 a correction draft starts from the refused snapshot, is editable, and its resubmission is accepted with the reference", async () => {
  await loadApp();
  installMocks();
  const transport = fakeTransport([], { type: "accepted", serverRevision: 2 });
  runtime.__syncTransport = transport;
  seedDraft(firstTask.id, { ...createNewGraphieDraftValues(), "header.reportNumber": "R30-plus-récent" });
  const refused = seedRefusal(firstTask.id, 1, "R30-refusé");
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  const snapshotsBefore = JSON.stringify([...runtime.__snapshotRows!.entries()]);
  const refusedRow = JSON.stringify(runtime.__outboxRows!.get(refused));

  await act(async () => { findButton(tree, fr.employeeTasks.createCorrection).props.onPress(); await settle(); });
  assert.ok(stateShown(tree, fr.employeeTasks.correctionDraft));
  assert.ok(findText(tree, "Correction de la soumission refusée le 05/10/2026 à 09:07"));
  assert.ok(findText(tree, fr.employeeTasks.rulesGated));
  assert.equal(findText(tree, fr.employeeTasks.rejectionOriginalKept), undefined, "the refusal panel closes");
  const input = findInput(tree, reportField().labelFr)!;
  assert.equal(input.props.value, "R30-refusé", "the form shows the refused snapshot");
  assert.equal(input.props.editable, true);
  assert.ok(String(input.props.accessibilityHint).includes(fr.employeeTasks.issueCodes["unpaired-surrogate"]!), "the refused field carries its issue text");
  assert.ok(findText(tree, `${fr.employeeTasks.issueFormLevel} : ${fr.employeeTasks.issueCodes["legacy-content-on-submit"]}`));
  assert.ok(hasButton(tree, fr.employeeTasks.submit));
  assert.equal(runtime.__correctionRows!.size, 1);
  assert.equal(JSON.stringify([...runtime.__snapshotRows!.entries()]), snapshotsBefore, "no snapshot is written");
  assert.equal(JSON.stringify(runtime.__outboxRows!.get(refused)), refusedRow, "the refused attempt is unchanged");
  assert.equal(transport.sent.length, 0, "creation queues nothing");
  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); await settle(); });
  assert.ok(findText(tree, `${firstTask.service} · ${fr.employeeTasks.correctionDraft}`), "the task list uses the same label");
  await openFirstTask(tree);

  // R31: correct the value, Soumettre, confirm; the transport sees the reference; acceptance makes it submitted.
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R31-corrigé"); });
  await requestSubmission(tree);
  await act(async () => { await settle(); });
  const submit = transport.sent.find((request) => request.kind === "submit")!;
  assert.ok(submit, "the submission is sent");
  assert.equal(submit.correctionOfOperationId, refused);
  assert.equal((submit.snapshot.payload as { values: Record<string, string> }).values["header.reportNumber"], "R31-corrigé");
  assert.ok(transport.sent.every((request) => request.correctionOfOperationId === refused));
  assert.ok(stateShown(tree, fr.employeeTasks.submitted));
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  assert.equal(findText(tree, fr.employeeTasks.correctionDraft), undefined);
  await act(async () => { tree.unmount(); });
});

test("Story 8.2 R32 a correction draft is created offline; nothing is sent until the device is online", async () => {
  await loadApp();
  installMocks();
  const transport = fakeTransport([], { type: "accepted", serverRevision: 2 });
  runtime.__syncTransport = transport;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });
  const refused = seedRefusal(firstTask.id, 1, "R32-refusé");
  runtime.__networkOnline = false;
  try {
    await act(async () => { tree = create(<App />); await settle(1); });
    await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); await settle(100); });
    assert.ok(findText(tree, `${fr.employeeTasks.connectivity}: ${fr.employeeTasks.offline}`));
    await act(async () => { findButton(tree, fr.employeeTasks.createCorrection).props.onPress(); await settle(); });
    assert.ok(stateShown(tree, fr.employeeTasks.correctionDraft));
    await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R32-corrigé"); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); await settle(); });
    assert.equal(transport.sent.length, 0, "offline: nothing is sent");
    await act(async () => { runtime.__networkOnline = true; runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await settle(50); });
    assert.deepEqual(transport.sent.map((request) => [request.kind, request.correctionOfOperationId]), [["sync-draft", refused]]);
    await act(async () => { tree.unmount(); });
  } finally {
    runtime.__networkOnline = true;
  }
});

test("Story 8.2 R33 a failed creation says so, keeps the refusal panel and changes nothing", async () => {
  await loadApp();
  installMocks();
  const { tree } = await openRefusedTask("R33-refusé");
  const before = correctionRows();
  runtime.__failCorrectionInsert = true;
  await act(async () => { findButton(tree, fr.employeeTasks.createCorrection).props.onPress(); await settle(); });
  assert.equal(findText(tree, fr.employeeTasks.correctionFailed)?.props.accessibilityRole, "alert");
  assert.ok(findText(tree, fr.employeeTasks.rejectionOriginalKept), "the panel stays");
  assert.ok(stateShown(tree, fr.employeeTasks.acceptanceBlocked));
  assert.deepEqual(correctionRows(), before);
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  assert.equal(findButton(tree, fr.employeeTasks.createCorrection).props.disabled, false, "the action can be tried again");
  await act(async () => { tree.unmount(); });
});

test("Story 8.2 R34 AUDIT_ALREADY_SUBMITTED shows its message and offers no action", async () => {
  await loadApp();
  installMocks();
  const { tree } = await openRefusedTask("R34", "AUDIT_ALREADY_SUBMITTED", []);
  assert.ok(findText(tree, fr.employeeTasks.rejectionCodes.AUDIT_ALREADY_SUBMITTED));
  assert.equal(findText(tree, fr.employeeTasks.rejectionIssues), undefined);
  for (const title of [fr.employeeTasks.createCorrection, fr.employeeTasks.submit, fr.employeeTasks.conflictKeepLocal, fr.employeeTasks.conflictDiscardLocal]) {
    assert.equal(hasButton(tree, title), false, title);
  }
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, false);
  await act(async () => { tree.unmount(); });
});

test("Story 8.2 R35 a refused correction shows the new issues and can be corrected again", async () => {
  await loadApp();
  installMocks();
  const newIssues = [{ path: "values.header.reportNumber", code: "unknown-option" }];
  const transport = fakeTransport([{ type: "rejected", detail: { code: "INVALID_PAYLOAD", issues: newIssues } }], { type: "accepted", serverRevision: 2 });
  runtime.__syncTransport = transport;
  const { tree, refused } = await openRefusedTask("R35-refusé");
  await act(async () => { findButton(tree, fr.employeeTasks.createCorrection).props.onPress(); await settle(); });
  await requestSubmission(tree);
  await act(async () => { await settle(); });
  assert.equal(transport.sent.at(-1)!.correctionOfOperationId, refused);
  assert.ok(stateShown(tree, fr.employeeTasks.acceptanceBlocked));
  assert.ok(findText(tree, reportIssueLine("unknown-option")), "the new issue is shown");
  assert.ok(!findText(tree, reportIssueLine("unpaired-surrogate")), "the earlier refusal's issues are gone");
  assert.ok(!findText(tree, `${fr.employeeTasks.issueFormLevel} : ${fr.employeeTasks.issueCodes["legacy-content-on-submit"]}`));
  await act(async () => { findButton(tree, fr.employeeTasks.createCorrection).props.onPress(); await settle(); });
  assert.ok(stateShown(tree, fr.employeeTasks.correctionDraft));
  const rejected = [...runtime.__correctionRows!.values()].map((row) => row.rejected_operation_id);
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0], refused);
  assert.equal(rejected[1], transport.sent.at(-1)!.operationId, "the second correction links the newer refusal");
  await act(async () => { tree.unmount(); });
});

test("Story 8.2 R36 a payload the shared validator refuses is not submitted; the issues are shown and the form stays editable", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await openFirstTask(tree);
  await act(async () => { findInput(tree, reportField().labelFr)!.props.onChangeText("R36\u0000"); });
  await requestSubmission(tree);
  assert.equal(findText(tree, fr.employeeTasks.submissionInvalid)?.props.accessibilityRole, "alert");
  assert.ok(findText(tree, reportIssueLine("nul-character")));
  assert.equal(findText(tree, fr.common.confirm), undefined, "the confirmation closes");
  assert.equal(submitRows(firstTask.id).length, 0, "nothing is queued");
  assert.equal(findInput(tree, reportField().labelFr)!.props.editable, true);
  assert.ok(hasButton(tree, fr.employeeTasks.submit));
  await act(async () => { tree.unmount(); });
});
