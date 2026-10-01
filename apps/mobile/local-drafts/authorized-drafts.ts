import type { DraftRepository, GraphieDraftPayload, LocalDraft, CachedSynchronizedTask } from "./model";

export type DraftAuthorization = <T>(employeeId: string, operation: () => Promise<T>) => Promise<T>;

export function createAuthorizedDrafts(repository: DraftRepository, authorize: DraftAuthorization) {
  return {
    async read(employeeId: string, taskId: string): Promise<LocalDraft | null> {
      return authorize(employeeId, () => repository.read(employeeId, taskId));
    },
    async list(employeeId: string): Promise<LocalDraft[]> {
      return authorize(employeeId, () => repository.list(employeeId));
    },
    async save(employeeId: string, taskId: string, content: string | GraphieDraftPayload, expectedRevision?: number): Promise<LocalDraft> {
      return authorize(employeeId, () => repository.save(employeeId, taskId, content, expectedRevision));
    },
    async delete(employeeId: string, taskId: string, expectedRevision: number): Promise<void> {
      return authorize(employeeId, () => repository.delete(employeeId, taskId, expectedRevision));
    },
    async cacheSynchronizedTask(employeeId: string, task: CachedSynchronizedTask["task"]): Promise<void> {
      return authorize(employeeId, () => repository.cacheSynchronizedTask(employeeId, task));
    },
    async replaceCachedSynchronizedTasks(employeeId: string, tasks: CachedSynchronizedTask["task"][]): Promise<void> {
      return authorize(employeeId, () => repository.replaceCachedSynchronizedTasks(employeeId, tasks));
    },
    async revokeCachedSynchronizedTask(employeeId: string, taskId: string): Promise<void> {
      // A server-confirmed assignment denial must be able to revoke stale context even if
      // the user has since logged out; this deletion is identity/task scoped and draft-free.
      return repository.revokeCachedSynchronizedTask(employeeId, taskId);
    },
    async listCachedSynchronizedTasks(employeeId: string): Promise<CachedSynchronizedTask[]> {
      return authorize(employeeId, () => repository.listCachedSynchronizedTasks(employeeId));
    },
  };
}
