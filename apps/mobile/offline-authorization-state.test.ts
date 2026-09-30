import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineAuthorizationService, DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS, offlineAuthorizationWindowFromDays } from "./offline-authorization-state.js";
import type { SecureKeyValueStore } from "./offline-authorization-state.js";

const identity = { id: "employee-a", email: "a@example.test", displayName: "Employee A", role: "employe" as const, mustChangePassword: false };
const otherIdentity = { ...identity, id: "employee-b", email: "b@example.test" };
const day = 24 * 60 * 60 * 1000;

test("offline policy accepts up to seven days, permits shorter values, and rejects longer values", () => {
  assert.equal(offlineAuthorizationWindowFromDays(), 7 * day);
  assert.equal(offlineAuthorizationWindowFromDays("7"), 7 * day);
  assert.equal(offlineAuthorizationWindowFromDays("3.5"), 3.5 * day);
  assert.throws(() => offlineAuthorizationWindowFromDays("0"), /greater than zero/);
  assert.throws(() => offlineAuthorizationWindowFromDays("7.01"), /at most seven days/);
  assert.throws(() => createOfflineAuthorizationService({ get: async () => null, set: async () => undefined, remove: async () => undefined }, { now: Date.now }, 8 * day), /at most seven days/);
});

function fixture(windowMs = DEFAULT_OFFLINE_AUTHORIZATION_WINDOW_MS) {
  const values = new Map<string, string>();
  let now = Date.UTC(2026, 8, 30);
  const store: SecureKeyValueStore = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const service = createOfflineAuthorizationService(store, { now: () => now }, windowMs);
  return { values, store, service, setNow: (value: number) => { now = value; }, now: () => now };
}

test("successful online authentication establishes an identity-bound seven-day offline grant", async () => {
  const f = fixture();
  const state = await f.service.establishOnlineAuthorization(identity);
  assert.equal(state.status, "online-authorized");
  assert.equal(state.expiresAt, f.now() + 7 * day);
  assert.equal((await f.service.hydrate()).status, "offline-authorized");
});

test("successful online reauthentication resets the authorization window", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  f.setNow(f.now() + 5 * day);
  const state = await f.service.establishOnlineAuthorization(identity);
  assert.equal(state.expiresAt, f.now() + 7 * day);
});

test("hydration after process restart and transient connectivity loss preserve the original grant", async () => {
  const f = fixture();
  const initial = f.now();
  await f.service.establishOnlineAuthorization(identity);
  f.setNow(initial + day);
  const restartedService = createOfflineAuthorizationService(f.store, { now: f.now });
  const state = await restartedService.hydrate();
  assert.equal(state.status, "offline-authorized");
  assert.equal(state.expiresAt, initial + 7 * day);
});

test("server token expiry does not alter offline authorization", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  f.setNow(f.now() + day);
  assert.equal((await f.service.evaluate(identity.id)).status, "offline-authorized");
});

test("grant is valid immediately before expiry and locks at and after the exact seven-day boundary", async () => {
  const f = fixture();
  const start = f.now();
  await f.service.establishOnlineAuthorization(identity);
  f.setNow(start + 7 * day - 1);
  assert.equal((await f.service.evaluate(identity.id)).status, "offline-authorized");
  f.setNow(start + 7 * day);
  assert.equal((await f.service.evaluate(identity.id)).status, "locked-expired");
  f.setNow(start + 7 * day + 1);
  assert.equal((await f.service.evaluate(identity.id)).status, "locked-expired");
});

test("explicit logout immediately locks access and preserves protected payload", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  const loggingOut = f.service.logout(identity.id);
  assert.equal(await f.service.readProtectedPayload(identity.id), null, "access closes before the secure lock write completes");
  assert.equal((await loggingOut).status, "locked-logged-out");
  assert.equal(await f.service.readProtectedPayload(identity.id), null);
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
});

test("expiry preserves protected payload while denying access", async () => {
  const f = fixture();
  const start = f.now();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  f.setNow(start + 7 * day);
  assert.equal(await f.service.readProtectedPayload(identity.id), null);
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
});

test("known deactivation locks access and preserves protected payload", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  assert.equal((await f.service.lockDeactivated(identity.id)).status, "locked-deactivated");
  assert.equal(await f.service.readProtectedPayload(identity.id), null);
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
});

test("online reauthentication restores access only for the authenticated identity", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.logout(identity.id);
  const state = await f.service.establishOnlineAuthorization(identity);
  assert.equal(state.status, "online-authorized");
  assert.equal(await f.service.readProtectedPayload(identity.id), null);
  await f.service.writeProtectedPayload(identity.id, "same-account-work");
});

test("a successful login by another identity cannot unlock the previous identity's payload", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "employee-a-work");
  await f.service.establishOnlineAuthorization(otherIdentity);
  assert.equal(await f.service.readProtectedPayload(identity.id), null);
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "employee-a-work");
  await f.service.writeProtectedPayload(otherIdentity.id, "employee-b-work");
  assert.equal(await f.service.readProtectedPayload(otherIdentity.id), "employee-b-work");
});

test("missing metadata fails closed and corrupt metadata is replaced by a locked state", async () => {
  const f = fixture();
  assert.equal((await f.service.hydrate()).status, "locked-logged-out");
  f.values.set("cetem-qc.offline-authorization.v1", "not-json");
  assert.equal((await f.service.hydrate()).status, "locked-corrupt-or-clock-invalid");
});

test("persisted grants with an overlong window fail closed and preserve payload", async () => {
  const f = fixture();
  f.values.set("cetem-qc.offline-authorization.v1", JSON.stringify({
    schemaVersion: 1, status: "grant", identity,
    authenticatedAt: f.now(), lastTrustedTime: f.now(), policyWindowMs: 8 * day,
  }));
  f.values.set("cetem-qc.protected-payload.v1.employee-a", "opaque-evidence");
  assert.equal((await f.service.hydrate()).status, "locked-corrupt-or-clock-invalid");
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
});

test("persisted grants with authentication time after trusted time fail closed", async () => {
  const f = fixture();
  f.values.set("cetem-qc.offline-authorization.v1", JSON.stringify({
    schemaVersion: 1, status: "grant", identity,
    authenticatedAt: f.now() + day, lastTrustedTime: f.now(), policyWindowMs: 7 * day,
  }));
  assert.equal((await f.service.hydrate()).status, "locked-corrupt-or-clock-invalid");
});

test("backward device clock movement fails closed without deleting payload", async () => {
  const f = fixture();
  const start = f.now();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  f.setNow(start + day);
  await f.service.evaluate(identity.id);
  f.setNow(start + day - 1);
  assert.equal((await f.service.evaluate(identity.id)).status, "locked-corrupt-or-clock-invalid");
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
});

test("revalidation preserves protected payload access without resetting the grant", async () => {
  const f = fixture();
  const start = f.now();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  f.setNow(start + day);
  assert.equal((await f.service.beginRevalidation(identity.id)).status, "revalidating");
  assert.equal(await f.service.readProtectedPayload(identity.id), "opaque-evidence");
  const confirmed = await f.service.confirmServerAuthorization(identity.id);
  assert.equal(confirmed.status, "online-authorized");
  assert.equal(confirmed.expiresAt, start + 7 * day);
  assert.equal(await f.service.readProtectedPayload(identity.id), "opaque-evidence");
});

test("authorization transitions never remove protected payload entries", async () => {
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  await f.service.logout(identity.id);
  await f.service.establishOnlineAuthorization(otherIdentity);
  assert.equal(f.values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
  assert.equal([...f.values.keys()].some((key) => key.startsWith("cetem-qc.protected-payload.v1.")), true);
});

test("logout persists a tombstone if the authorization lock write fails and preserves payload", async () => {
  const values = new Map<string, string>();
  let failAuthorizationWrite = false;
  const store: SecureKeyValueStore = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      if (key === "cetem-qc.offline-authorization.v1" && failAuthorizationWrite) throw new Error("secure write failed");
      values.set(key, value);
    },
    remove: async (key) => { values.delete(key); },
  };
  const service = createOfflineAuthorizationService(store, { now: () => Date.UTC(2026, 8, 30) });
  await service.establishOnlineAuthorization(identity);
  await service.writeProtectedPayload(identity.id, "opaque-evidence");
  failAuthorizationWrite = true;
  assert.equal((await service.logout(identity.id)).status, "locked-logged-out");
  assert.equal(values.has("cetem-qc.offline-authorization.v1"), false);
  assert.equal(values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
  assert.equal((await createOfflineAuthorizationService(store, { now: Date.now }).hydrate()).status, "locked-logged-out");
});

test("logout racing an in-flight authorization evaluation cannot restore access after restart", async () => {
  const values = new Map<string, string>();
  let releaseRead!: () => void;
  let signalRead!: () => void;
  const authReadStarted = new Promise<void>((resolve) => { signalRead = resolve; });
  let blockAuthorizationRead = false;
  const pendingRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  const store: SecureKeyValueStore = {
    get: async (key) => {
      if (key === "cetem-qc.offline-authorization.v1" && blockAuthorizationRead) {
        blockAuthorizationRead = false;
        signalRead();
        await pendingRead;
      }
      return values.get(key) ?? null;
    },
    set: async (key, value) => { values.set(key, value); },
    remove: async (key) => { values.delete(key); },
  };
  const f = fixture();
  await f.service.establishOnlineAuthorization(identity);
  await f.service.writeProtectedPayload(identity.id, "opaque-evidence");
  const service = createOfflineAuthorizationService(store, { now: f.now });
  for (const [key, value] of f.values) values.set(key, value);
  blockAuthorizationRead = true;
  const evaluating = service.evaluate(identity.id);
  await authReadStarted;
  const loggingOut = service.logout(identity.id);
  releaseRead();
  assert.equal((await evaluating).status, "locked-logged-out");
  assert.equal((await loggingOut).status, "locked-logged-out");
  const restarted = createOfflineAuthorizationService(store, { now: f.now });
  assert.equal((await restarted.hydrate()).status, "locked-logged-out");
  assert.equal(values.get("cetem-qc.protected-payload.v1.employee-a"), "opaque-evidence");
});

test("logout remains locked after authorization write failure, delete failure, or both", async () => {
  for (const failure of ["write", "delete", "both"] as const) {
    const values = new Map<string, string>();
    let failAuthorizationSet = false;
    let failAuthorizationRemove = false;
    const store: SecureKeyValueStore = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        if (key === "cetem-qc.offline-authorization.v1" && failAuthorizationSet) throw new Error("secure write failed");
        values.set(key, value);
      },
      remove: async (key) => {
        if (key === "cetem-qc.offline-authorization.v1" && failAuthorizationRemove) throw new Error("secure delete failed");
        values.delete(key);
      },
    };
    const service = createOfflineAuthorizationService(store, { now: () => Date.UTC(2026, 8, 30) });
    await service.establishOnlineAuthorization(identity);
    await service.writeProtectedPayload(identity.id, `opaque-${failure}`);
    failAuthorizationSet = failure === "write" || failure === "both";
    failAuthorizationRemove = failure === "delete" || failure === "both";
    assert.equal((await service.logout(identity.id)).status, "locked-logged-out", failure);
    const restarted = createOfflineAuthorizationService(store, { now: () => Date.UTC(2026, 8, 30) });
    assert.equal((await restarted.hydrate()).status, "locked-logged-out", failure);
    assert.equal(values.get("cetem-qc.protected-payload.v1.employee-a"), `opaque-${failure}`);
  }
});
