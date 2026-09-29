export interface EmployeeTaskDetailState {
  taskId: string;
  status: "loading" | "ready" | "error";
}

export type EmployeeTaskDetailResult<T> =
  | { current: true; state: { taskId: string; status: "ready" }; task: T }
  | { current: true; state: { taskId: string; status: "error" }; task?: undefined }
  | { current: false };

export class EmployeeTaskDetailRequests {
  private generation = 0;

  open<T>(taskId: string, loadTask: (taskId: string) => Promise<T>): Promise<EmployeeTaskDetailResult<T>> {
    return this.load(++this.generation, taskId, loadTask);
  }

  retry<T>(state: EmployeeTaskDetailState, loadTask: (taskId: string) => Promise<T>): Promise<EmployeeTaskDetailResult<T>> {
    return this.load(++this.generation, state.taskId, loadTask);
  }

  invalidate() {
    this.generation++;
  }

  private async load<T>(generation: number, taskId: string, loadTask: (taskId: string) => Promise<T>): Promise<EmployeeTaskDetailResult<T>> {
  try {
    const task = await loadTask(taskId);
      return generation === this.generation
        ? { current: true, state: { taskId, status: "ready" }, task }
        : { current: false };
  } catch {
      return generation === this.generation
        ? { current: true, state: { taskId, status: "error" } }
        : { current: false };
    }
  }
}
