import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { GRAPHIE_CALCULATION_IDENTITY } from "@cetem-qc/domain";
import { createDraftRepository, type GraphieDraftPayload } from "../local-drafts/model.js";
import { createSqliteTestDouble } from "../test-support/sqlite-test-double.js";
import { createSyncEngine, type SyncRequest, type SyncResult } from "./sync-engine.js";

// Story 8.1: an open conflict pauses its task in every run until an explicit resolution.

mock.module("expo-sqlite", { namedExports: { openDatabaseAsync: async () => { throw new Error("unused default driver"); } } });
mock.module("expo-crypto", { namedExports: { getRandomBytesAsync: async (length: number) => new Uint8Array(length) } });

async function setup() {
  const { createSqliteDraftDatabase } = await import("../local-drafts/sqlite-draft-database.js");
  const secrets = new Map<string, string>();
  const store = {
    async get(key: string) { return secrets.get(key) ?? null; },
    async set(key: string, value: string) { secrets.set(key, value); },
    async remove(key: string) { secrets.delete(key); },
  };
  const double = createSqliteTestDouble();
  const database = createSqliteDraftDatabase(store, double.driver as never, async (length) => new Uint8Array(length).fill(0xcd));
  let time = 10_000;
  let id = 0;
  const repository = createDraftRepository(database, () => ++time, () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`);
  const engine = (transport: { send(request: SyncRequest): Promise<SyncResult> }) => createSyncEngine({
    store: repository, transport, now: () => ++time, sleep: async () => undefined, isAuthorized: () => true,
  });
  return { repository, engine };
}

function fakeTransport(responses: SyncResult[], fallback: SyncResult = { type: "accepted", serverRevision: 9 }) {
  const sent: SyncRequest[] = [];
  return { sent, async send(request: SyncRequest) { sent.push(structuredClone(request)); return responses.shift() ?? fallback; } };
}

const form = (reportNumber: string): GraphieDraftPayload => ({ ...GRAPHIE_CALCULATION_IDENTITY, values: { "header.reportNumber": reportNumber } });
const current = { revision: 2, state: "draft", lastChangedAt: "2026-10-04T08:00:00.000Z", lastChangedBy: null };

test("E4 after a conflict the task's next item is not sent, other tasks are, and later runs send nothing for it", async () => {
  const f = await setup();
  // Task A: an attempted item, then a queued submit behind it.
  const saved = await f.repository.save("employee-a", "task-a", form("A"));
  const [first] = await f.repository.listOutbox("employee-a");
  await f.repository.recordOutboxTransition("employee-a", first!.operationId, { type: "attempt-start", at: 1 });
  await f.repository.recordOutboxTransition("employee-a", first!.operationId, { type: "retryable", code: "HTTP_503", pause: true, at: 2 });
  const { operation: submit } = await f.repository.requestSubmission("employee-a", "task-a", form("A"), saved.revision);
  await f.repository.save("employee-a", "task-b", form("B"));

  const transport = fakeTransport([{ type: "conflict", serverRevision: 2, detail: current }]);
  const summary = await f.engine(transport).run("employee-a");
  assert.deepEqual(transport.sent.map((request) => [request.taskId, request.kind]), [["task-a", "sync-draft"], ["task-b", "sync-draft"]]);
  assert.equal(summary.resolved, 2);
  const waiting = (await f.repository.listOutbox("employee-a")).find((item) => item.operationId === submit.operationId)!;
  assert.deepEqual([waiting.status, waiting.attemptCount], ["queued", 0], "the submit behind the conflict was never attempted");

  for (const options of [{ retryBlocked: false }, { retryBlocked: true }, {}]) {
    const later = fakeTransport([]);
    await f.engine(later).run("employee-a", options);
    assert.deepEqual(later.sent, [], JSON.stringify(options));
  }
});

test("E5 after keep-local the next run sends the new item with the conflict reference and the server base", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("local"));
  await f.engine(fakeTransport([{ type: "conflict", serverRevision: 2, detail: current }])).run("employee-a");
  const [conflicted] = await f.repository.listOutbox("employee-a");
  const { operation } = await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [conflicted!.operationId], server: { revision: 2, state: "draft" } });
  const transport = fakeTransport([{ type: "accepted", serverRevision: 3 }]);
  await f.engine(transport).run("employee-a");
  assert.deepEqual(transport.sent.map((request) => [request.operationId, request.kind, request.baseRevision, request.conflictOperationId]),
    [[operation.operationId, "sync-draft", 2, conflicted!.operationId]]);
  // An item without lineage carries no reference.
  await f.repository.save("employee-a", "task-b", form("other"));
  const plain = fakeTransport([{ type: "accepted", serverRevision: 1 }]);
  await f.engine(plain).run("employee-a");
  assert.equal("conflictOperationId" in plain.sent[0]!, false);
});

test("E5 a keep-local item that conflicts again pauses the task and the next resolution references the new conflict", async () => {
  const f = await setup();
  await f.repository.save("employee-a", "task-a", form("local"));
  await f.engine(fakeTransport([{ type: "conflict", serverRevision: 2, detail: current }])).run("employee-a");
  const [first] = await f.repository.listOutbox("employee-a");
  await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [first!.operationId], server: { revision: 2, state: "draft" } });
  await f.engine(fakeTransport([{ type: "conflict", serverRevision: 3, detail: { ...current, revision: 3 } }])).run("employee-a");
  const open = (await f.repository.listOutbox("employee-a")).filter((item) => item.outcome === "conflict" && item.conflictResolutionId === null);
  assert.equal(open.length, 1);
  const { operation } = await f.repository.resolveConflictKeepLocal("employee-a", "task-a", { conflictOperationIds: [open[0]!.operationId], server: { revision: 3, state: "draft" } });
  assert.deepEqual([operation.baseRevision, operation.conflictOperationId], [3, open[0]!.operationId]);
});
