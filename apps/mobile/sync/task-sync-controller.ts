import type { ConflictResolution, OutboxItem } from "../local-drafts/model";
import { createSyncEngine, type SyncStore, type SyncTransport } from "./sync-engine";

/** The durable rows of the signed-in employee and the active run; every presented sync state is derived from them. */
export type TaskSyncSnapshot = {
  outbox?: { employeeId: string; items: OutboxItem[] };
  resolutions?: { employeeId: string; items: ConflictResolution[] };
  /** The employee whose run is active; another identity never sees it as running. */
  runningFor?: string;
};

export type TaskSyncStore = SyncStore & { listConflictResolutions(employeeId: string): Promise<ConflictResolution[]> };

/** What the App knows at call time about connectivity and the server-confirmed authorization. */
export type SyncAuthorizationContext = { online: boolean; status: string; identityId: string | undefined };

/** Automatic triggers: they leave blocked items for an explicit retry. */
export type SyncTrigger = "online-authorization" | "reconnect" | "foreground" | "changed-save";

/**
 * The App's synchronization wiring without React (Story 8.1, epic-7 retro item 21): one engine over the
 * single transport, the run preconditions, the durable-row refresh and the automatic triggers.
 */
export function createTaskSyncController(options: {
  store: TaskSyncStore;
  /** Null in test doubles without transport: no run ever starts. */
  transport: SyncTransport | null;
  context: () => SyncAuthorizationContext;
  /** True while the stored grant is still valid (not expired, logged out or locked). */
  storedGrantValid: (employeeId: string) => Promise<boolean>;
  isActiveIdentity: (employeeId: string) => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { store, transport, context, storedGrantValid, isActiveIdentity } = options;
  let snapshot: TaskSyncSnapshot = {};
  let refreshGeneration = 0;
  const listeners = new Set<(next: TaskSyncSnapshot) => void>();

  function update(change: Partial<TaskSyncSnapshot> | ((current: TaskSyncSnapshot) => Partial<TaskSyncSnapshot>)) {
    snapshot = { ...snapshot, ...(typeof change === "function" ? change(snapshot) : change) };
    for (const listener of listeners) listener(snapshot);
  }

  async function isAuthorized(employeeId: string) {
    const current = context();
    if (!current.online || current.status !== "online-authorized" || current.identityId !== employeeId) return false;
    // The server confirmed this session; the stored grant must still be valid (not expired, logged out or locked).
    const valid = await storedGrantValid(employeeId).catch(() => false);
    return valid && context().status === "online-authorized";
  }

  const engine = transport ? createSyncEngine({
    store, transport,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    isAuthorized,
  }) : null;

  /** Re-reads the durable outbox and resolutions; a read failure keeps the previous state and returns false. */
  async function refreshOutbox(employeeId: string | undefined) {
    if (!employeeId) return false;
    const generation = ++refreshGeneration;
    try {
      const [items, resolutions] = await Promise.all([store.listOutbox(employeeId), store.listConflictResolutions(employeeId)]);
      if (generation !== refreshGeneration || !isActiveIdentity(employeeId)) return true;
      update({ outbox: { employeeId, items }, resolutions: { employeeId, items: resolutions } });
      return true;
    } catch {
      // Never fall back to « Brouillon »: the last derived state stays on screen.
      return false;
    }
  }

  /** `automatic` runs (triggers) leave blocked items for an explicit retry. */
  async function runSync(employeeId: string, automatic = false) {
    if (!engine || !await isAuthorized(employeeId)) return false;
    update({ runningFor: employeeId });
    try {
      await engine.run(employeeId, { retryBlocked: !automatic });
    } catch {
      // A failed run keeps every item, snapshot and draft; the refreshed rows tell the state.
    } finally {
      update((current) => ({ runningFor: current.runningFor === employeeId ? undefined : current.runningFor }));
      await refreshOutbox(employeeId);
    }
    return true;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: (next: TaskSyncSnapshot) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    hasTransport: () => engine !== null,
    isAuthorized,
    refreshOutbox,
    runSync,
    trigger: (employeeId: string, _reason: SyncTrigger) => runSync(employeeId, true),
  };
}

export type TaskSyncController = ReturnType<typeof createTaskSyncController>;
