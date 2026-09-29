import assert from "node:assert/strict";
import test from "node:test";
import { getEmployeeTaskListState } from "./employee-task-list-state.js";

test("employee task list keeps loading, error, empty, and populated states distinct", () => {
  assert.equal(getEmployeeTaskListState({ loading: true, error: false, taskCount: 0 }), "loading");
  assert.equal(getEmployeeTaskListState({ loading: false, error: true, taskCount: 0 }), "error");
  assert.equal(getEmployeeTaskListState({ loading: false, error: false, taskCount: 0 }), "empty");
  assert.equal(getEmployeeTaskListState({ loading: false, error: false, taskCount: 2 }), "ready");
  assert.equal(getEmployeeTaskListState({ loading: true, error: true, taskCount: 2 }), "loading", "loading must not be rendered as stale error or list content");
});
