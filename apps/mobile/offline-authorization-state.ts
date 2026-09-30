export const DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function offlineAuthorizationWindowFromDays(configuredDays?: string): number {
  if (configuredDays === undefined || configuredDays.trim() === "") return DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS;
  const days = Number(configuredDays);
  if (!Number.isFinite(days) || days <= 0 || days > DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS / MS_PER_DAY) {
    throw new Error("Offline authorization window must be greater than zero and at most seven days.");
  }
  return days * MS_PER_DAY;
}

export type EmployeeIdentity = {
  id: string;
  email: string;
  displayName: string;
  role: "employe";
  mustChangePassword: boolean;
};

export type OfflineAuthorizationStatus =
  | "online-authorized"
  | "offline-authorized"
  | "revalidating"
  | "locked-expired"
  | "locked-logged-out"
  | "locked-deactivated"
  | "locked-corrupt-or-clock-invalid";

export type OfflineAuthorizationState = {
  status: OfflineAuthorizationStatus;
  identity?: EmployeeIdentity;
  expiresAt?: number;
};

type Grant = {
  schemaVersion: 1;
  status: "grant";
  identity: EmployeeIdentity;
  authenticatedAt: number;
  lastTrustedTime: number;
  policyWindowMs: number;
};

type Lock = {
  schemaVersion: 1;
  status: "locked-logged-out" | "locked-deactivated" | "locked-expired" | "locked-corrupt-or-clock-invalid";
  identity?: EmployeeIdentity;
  lastTrustedTime: number;
};

type StoredAuthorization = Grant | Lock;

export interface SecureKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Clock {
  now(): number;
}

const AUTHORIZATION_KEY = "cetem-qc.offline-authorization.v1";
const LOGOUT_TOMBSTONE_KEY = "cetem-qc.offline-authorization-logout.v1";
const PAYLOAD_PREFIX = "cetem-qc.protected-payload.v1.";

type LogoutTombstone = { schemaVersion: 1; identityId?: string };

function parseLogoutTombstone(raw: string | null): LogoutTombstone | undefined | null {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1 || (record.identityId !== undefined && (typeof record.identityId !== "string" || record.identityId.length === 0))) return null;
    return record as LogoutTombstone;
  } catch {
    return null;
  }
}

function isIdentity(value: unknown): value is EmployeeIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Record<string, unknown>;
  return typeof identity.id === "string" && identity.id.length > 0
    && typeof identity.email === "string"
    && typeof identity.displayName === "string"
    && identity.role === "employe"
    && typeof identity.mustChangePassword === "boolean";
}

function parseStoredAuthorization(raw: string): StoredAuthorization | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== 1 || typeof record.status !== "string") return undefined;
    if (record.status === "grant") {
      if (!isIdentity(record.identity) || !Number.isFinite(record.authenticatedAt)
        || !Number.isFinite(record.lastTrustedTime) || !Number.isFinite(record.policyWindowMs)
        || Number(record.policyWindowMs) <= 0
        || Number(record.policyWindowMs) > DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS
        || Number(record.authenticatedAt) > Number(record.lastTrustedTime)
        || !Number.isFinite(Number(record.authenticatedAt) + Number(record.policyWindowMs))) return undefined;
      return record as unknown as Grant;
    }
    if (["locked-logged-out", "locked-deactivated", "locked-expired", "locked-corrupt-or-clock-invalid"].includes(record.status)
      && Number.isFinite(record.lastTrustedTime)
      && (record.identity === undefined || isIdentity(record.identity))) return record as unknown as Lock;
    return undefined;
  } catch {
    return undefined;
  }
}

export function createOfflineAuthorizationService(store: SecureKeyValueStore, clock: Clock, policyWindowMs = DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS) {
  if (!Number.isFinite(policyWindowMs) || policyWindowMs <= 0 || policyWindowMs > DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS) throw new Error("Offline authorization window must be greater than zero and at most seven days.");
  const revokedIdentities = new Set<string>();
  let allIdentitiesRevoked = false;
  let stateQueue: Promise<void> = Promise.resolve();

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = stateQueue.then(operation, operation);
    stateQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function read(): Promise<StoredAuthorization | undefined> {
    const raw = await store.get(AUTHORIZATION_KEY);
    return raw === null ? undefined : parseStoredAuthorization(raw);
  }

  async function write(record: StoredAuthorization): Promise<void> {
    await store.set(AUTHORIZATION_KEY, JSON.stringify(record));
  }

  async function locked(status: Lock["status"], identity?: EmployeeIdentity, lastTrustedTime = clock.now()): Promise<OfflineAuthorizationState> {
    await write({ schemaVersion: 1, status, identity, lastTrustedTime: Number.isFinite(lastTrustedTime) ? lastTrustedTime : 0 });
    return { status, identity };
  }

  async function evaluateUnlocked(expectedIdentityId?: string): Promise<OfflineAuthorizationState> {
    if (allIdentitiesRevoked || (expectedIdentityId !== undefined && revokedIdentities.has(expectedIdentityId))) {
      return { status: "locked-logged-out" };
    }
    const tombstone = parseLogoutTombstone(await store.get(LOGOUT_TOMBSTONE_KEY));
    if (tombstone === null) return { status: "locked-corrupt-or-clock-invalid" };
    const raw = await store.get(AUTHORIZATION_KEY);
    if (raw === null) return { status: "locked-logged-out" };
    const record = parseStoredAuthorization(raw);
    if (!record) return locked("locked-corrupt-or-clock-invalid");
    if (record.status !== "grant") return { status: record.status, identity: record.identity };
    if (tombstone && (tombstone.identityId === undefined || tombstone.identityId === record.identity.id)) {
      return { status: "locked-logged-out", identity: record.identity };
    }
    if (expectedIdentityId !== undefined && record.identity.id !== expectedIdentityId) return { status: "locked-logged-out" };

    const now = clock.now();
    if (!Number.isFinite(now) || now < record.lastTrustedTime) return locked("locked-corrupt-or-clock-invalid", record.identity, record.lastTrustedTime);
    if (now >= record.authenticatedAt + record.policyWindowMs) return locked("locked-expired", record.identity, now);

    await write({ ...record, lastTrustedTime: now });
    if (allIdentitiesRevoked || revokedIdentities.has(record.identity.id)) return { status: "locked-logged-out", identity: record.identity };
    return { status: "offline-authorized", identity: record.identity, expiresAt: record.authenticatedAt + record.policyWindowMs };
  }

  async function evaluate(expectedIdentityId?: string): Promise<OfflineAuthorizationState> {
    return serialized(() => evaluateUnlocked(expectedIdentityId));
  }

  return {
    async establishOnlineAuthorization(identity: EmployeeIdentity): Promise<OfflineAuthorizationState> {
      const now = clock.now();
      if (!Number.isFinite(now)) throw new Error("Device clock is invalid.");
      return serialized(async () => {
      const record: Grant = {
        schemaVersion: 1, status: "grant", identity,
        authenticatedAt: now, lastTrustedTime: now, policyWindowMs,
      };
      await write(record);
      await store.remove(LOGOUT_TOMBSTONE_KEY);
      revokedIdentities.delete(identity.id);
      allIdentitiesRevoked = false;
      return { status: "online-authorized", identity, expiresAt: now + policyWindowMs };
      });
    },

    evaluate,

    async hydrate(): Promise<OfflineAuthorizationState> {
      return evaluate();
    },

    async beginRevalidation(identityId: string): Promise<OfflineAuthorizationState> {
      const state = await evaluate(identityId);
      if (state.status !== "offline-authorized") return state;
      return { ...state, status: "revalidating" };
    },

    async authorizeOffline(identityId: string): Promise<OfflineAuthorizationState> {
      const state = await evaluate(identityId);
      return state;
    },

    async confirmServerAuthorization(identityId: string): Promise<OfflineAuthorizationState> {
      return serialized(async () => {
      const record = await read();
      if (!record || record.status !== "grant" || record.identity.id !== identityId) return { status: "locked-logged-out" };
      const state = await evaluateUnlocked(identityId);
      if (state.status !== "offline-authorized") return state;
      return { ...state, status: "online-authorized" };
      });
    },

    async lockDeactivated(identityId: string): Promise<OfflineAuthorizationState> {
      revokedIdentities.add(identityId);
      return serialized(async () => {
        const record = await read();
        if (record?.status === "grant" && record.identity.id !== identityId) return evaluateUnlocked(record.identity.id);
        const identity = record?.status === "grant" && record.identity.id === identityId ? record.identity : undefined;
        return locked("locked-deactivated", identity);
      });
    },

    async logout(identityId?: string): Promise<OfflineAuthorizationState> {
      if (identityId) revokedIdentities.add(identityId);
      else allIdentitiesRevoked = true;
      return serialized(async () => {
        const record = await read();
        if (identityId && record?.status === "grant" && record.identity.id !== identityId) {
          return { status: "locked-logged-out", identity: record.identity };
        }
        const identity = record?.status === "grant" && (identityId === undefined || record.identity.id === identityId)
          ? record.identity : undefined;
        let tombstonePersisted = false;
        let tombstoneError: unknown;
        try {
          await store.set(LOGOUT_TOMBSTONE_KEY, JSON.stringify({ schemaVersion: 1, ...(identityId ? { identityId } : {}) } satisfies LogoutTombstone));
          tombstonePersisted = true;
        } catch (error) {
          tombstoneError = error;
        }
        let lockError: unknown;
        try {
          await locked("locked-logged-out", identity);
          return { status: "locked-logged-out", identity };
        } catch (error) {
          lockError = error;
        }
        try {
          await store.remove(AUTHORIZATION_KEY);
          return { status: "locked-logged-out", identity };
        } catch (removeError) {
          if (tombstonePersisted) return { status: "locked-logged-out", identity };
          throw new AggregateError([tombstoneError, lockError, removeError], "Could not persist offline logout lock.");
        }
      });
    },

    async readProtectedPayload(identityId: string): Promise<string | null> {
      return serialized(async () => {
        const state = await evaluateUnlocked(identityId);
        if (state.status !== "offline-authorized") return null;
        const payload = await store.get(`${PAYLOAD_PREFIX}${encodeURIComponent(identityId)}`);
        if (allIdentitiesRevoked || revokedIdentities.has(identityId)) return null;
        return payload;
      });
    },

    async writeProtectedPayload(identityId: string, payload: string): Promise<void> {
      await serialized(async () => {
        const state = await evaluateUnlocked(identityId);
        if (state.status !== "offline-authorized") throw new Error("Protected local data is locked.");
        await store.set(`${PAYLOAD_PREFIX}${encodeURIComponent(identityId)}`, payload);
        if (allIdentitiesRevoked || revokedIdentities.has(identityId)) throw new Error("Protected local data is locked.");
      });
    },

  };
}
