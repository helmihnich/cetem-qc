import assert from "node:assert/strict";
import test from "node:test";
import { EmployeeTaskDetailRequests } from "./employee-task-detail-state.js";

const selectedTaskId = "00000000-0000-4000-8000-000000000010";

test("assigned task detail enters success state for the selected task", async () => {
  const requests = new EmployeeTaskDetailRequests();
  const task = { id: selectedTaskId, establishment: "Centre A" };
  const requestedIds: string[] = [];
  const result = await requests.open(selectedTaskId, async (id) => { requestedIds.push(id); return task; });

  assert.deepEqual(requestedIds, [selectedTaskId]);
  assert.deepEqual(result, { current: true, state: { taskId: selectedTaskId, status: "ready" }, task });
  if (result.state.status === "ready") {
    assert.equal(result.task.establishment, "Centre A");
    assert.equal(result.task.id, selectedTaskId);
  }
});

test("assigned task detail keeps the selected ID after failure and retries that same ID", async () => {
  const requests = new EmployeeTaskDetailRequests();
  const requestedIds: string[] = [];
  const failed = await requests.open(selectedTaskId, async (id) => {
    requestedIds.push(id);
    throw new Error("offline");
  });
  assert.deepEqual(failed, { current: true, state: { taskId: selectedTaskId, status: "error" } });

  const task = { id: selectedTaskId, establishment: "Centre A" };
  const retried = await requests.retry(failed.state, async (id) => { requestedIds.push(id); return task; });
  assert.deepEqual(requestedIds, [selectedTaskId, selectedTaskId]);
  assert.deepEqual(retried, { current: true, state: { taskId: selectedTaskId, status: "ready" }, task });
  if (retried.state.status === "ready") assert.equal(retried.task.establishment, "Centre A");
});

test("out-of-order responses keep the latest selected task and ignore the stale result", async () => {
  const requests = new EmployeeTaskDetailRequests();
  const pending = new Map<string, (task: { id: string; establishment: string }) => void>();
  const loadTask = (id: string) => new Promise<{ id: string; establishment: string }>((resolve) => pending.set(id, resolve));

  const taskAId = selectedTaskId;
  const taskBId = "00000000-0000-4000-8000-000000000011";
  const requestA = requests.open(taskAId, loadTask);
  const requestB = requests.open(taskBId, loadTask);

  pending.get(taskBId)!({ id: taskBId, establishment: "Centre B" });
  const resultB = await requestB;
  assert.deepEqual(resultB, { current: true, state: { taskId: taskBId, status: "ready" }, task: { id: taskBId, establishment: "Centre B" } });

  pending.get(taskAId)!({ id: taskAId, establishment: "Centre A" });
  const resultA = await requestA;
  assert.deepEqual(resultA, { current: false });
  assert.equal(resultB.current && resultB.state.status === "ready" ? resultB.task.establishment : undefined, "Centre B");
});

test("returning to the list invalidates a pending detail response", async () => {
  const requests = new EmployeeTaskDetailRequests();
  let resolveTask!: (task: { id: string; establishment: string }) => void;
  const request = requests.open(selectedTaskId, () => new Promise((resolve) => { resolveTask = resolve; }));

  requests.invalidate();
  resolveTask({ id: selectedTaskId, establishment: "Centre A" });

  assert.deepEqual(await request, { current: false });
});
