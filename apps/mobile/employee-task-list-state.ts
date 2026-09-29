export type EmployeeTaskListState = "loading" | "error" | "empty" | "ready";

export function getEmployeeTaskListState(input: { loading: boolean; error: boolean; taskCount: number }): EmployeeTaskListState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.taskCount === 0) return "empty";
  return "ready";
}
