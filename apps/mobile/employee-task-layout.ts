export type EmployeeTaskLayout = "phone" | "tablet";
export type EmployeeTaskScreen = "list" | "detail";

export interface EmployeeTaskPresentation<T> {
  layout: EmployeeTaskLayout;
  screen: EmployeeTaskScreen;
  taskIds: string[];
  selectedTask?: T;
}

export const EMPLOYEE_TABLET_LAYOUT_MIN_WIDTH = 768;
export const EMPLOYEE_CONTENT_HORIZONTAL_GUTTER = 20;

export function getEmployeeTaskLayout(viewportWidth: number): EmployeeTaskLayout {
  return viewportWidth >= EMPLOYEE_TABLET_LAYOUT_MIN_WIDTH ? "tablet" : "phone";
}

export function getEmployeeTaskContentWidth(viewportWidth: number, layout: EmployeeTaskLayout): number {
  const availableWidth = Math.max(0, viewportWidth - EMPLOYEE_CONTENT_HORIZONTAL_GUTTER * 2);
  if (layout === "phone") return availableWidth;
  return Math.min(availableWidth, 960);
}

export function getEmployeeTaskPresentation<T extends { id: string }>(input: {
  viewportWidth: number;
  screen: EmployeeTaskScreen;
  tasks: T[];
  selectedTask?: T;
}): EmployeeTaskPresentation<T> {
  return {
    layout: getEmployeeTaskLayout(input.viewportWidth),
    screen: input.screen,
    taskIds: input.tasks.map((task) => task.id),
    ...(input.screen === "detail" && input.selectedTask ? { selectedTask: input.selectedTask } : {}),
  };
}
