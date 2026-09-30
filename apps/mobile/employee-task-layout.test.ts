import assert from "node:assert/strict";
import test from "node:test";
import { EMPLOYEE_CONTENT_HORIZONTAL_GUTTER, EMPLOYEE_TABLET_LAYOUT_MIN_WIDTH, getEmployeeTaskContentWidth, getEmployeeTaskLayout, getEmployeeTaskPresentation } from "./employee-task-layout.js";

test("phone viewport selects a single-column layout that follows available width", () => {
  assert.equal(getEmployeeTaskLayout(390), "phone");
  assert.equal(getEmployeeTaskContentWidth(390, "phone"), 350);
  assert.equal(getEmployeeTaskContentWidth(390, "phone") + EMPLOYEE_CONTENT_HORIZONTAL_GUTTER * 2, 390);
  assert.equal(getEmployeeTaskContentWidth(430, "phone"), 390);
});

test("tablet viewport selects grouped layout and caps content width on wide screens", () => {
  assert.equal(getEmployeeTaskLayout(EMPLOYEE_TABLET_LAYOUT_MIN_WIDTH), "tablet");
  assert.equal(getEmployeeTaskLayout(1024), "tablet");
  assert.equal(getEmployeeTaskContentWidth(1024, "tablet"), 960);
  assert.equal(getEmployeeTaskContentWidth(1366, "tablet"), 960);
});

test("narrow landscape phone remains phone layout without requiring rotation", () => {
  assert.equal(getEmployeeTaskLayout(700), "phone");
});

test("phone and tablet presentations preserve the same task list and selected authorized task", () => {
  const tasks = [{ id: "task-a", establishment: "Centre A" }, { id: "task-b", establishment: "Centre B" }];
  const phoneList = getEmployeeTaskPresentation({ viewportWidth: 390, screen: "list", tasks });
  const tabletList = getEmployeeTaskPresentation({ viewportWidth: 1024, screen: "list", tasks });
  assert.deepEqual(phoneList.taskIds, tabletList.taskIds);
  assert.equal(phoneList.screen, tabletList.screen);

  const phoneDetail = getEmployeeTaskPresentation({ viewportWidth: 390, screen: "detail", tasks, selectedTask: tasks[0] });
  const tabletDetail = getEmployeeTaskPresentation({ viewportWidth: 1024, screen: "detail", tasks, selectedTask: tasks[0] });
  assert.equal(phoneDetail.selectedTask, tabletDetail.selectedTask);
  assert.equal(phoneDetail.selectedTask?.id, "task-a");
});
