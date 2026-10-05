import type { ConflictResolution, DraftRepository, GraphieDraftPayload, LocalDraft, CachedSynchronizedTask, OutboxItem, OutboxTransition, SubmissionRequest, TaskSyncStatus } from "./model";

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
    async deleteUnreadable(employeeId: string, taskId: string): Promise<void> {
      return authorize(employeeId, () => repository.deleteUnreadable(employeeId, taskId));
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
    async requestSubmission(employeeId: string, taskId: string, payload: GraphieDraftPayload, expectedRevision?: number): Promise<SubmissionRequest> {
      return authorize(employeeId, () => repository.requestSubmission(employeeId, taskId, payload, expectedRevision));
    },
    async listOutbox(employeeId: string): Promise<OutboxItem[]> {
      return authorize(employeeId, () => repository.listOutbox(employeeId));
    },
    async getTaskSyncStatus(employeeId: string, taskId: string): Promise<TaskSyncStatus> {
      return authorize(employeeId, () => repository.getTaskSyncStatus(employeeId, taskId));
    },
    async readOutboxSnapshot(employeeId: string, operationId: string): Promise<LocalDraft> {
      return authorize(employeeId, () => repository.readOutboxSnapshot(employeeId, operationId));
    },
    async recordOutboxTransition(employeeId: string, operationId: string, transition: OutboxTransition): Promise<OutboxItem> {
      return authorize(employeeId, () => repository.recordOutboxTransition(employeeId, operationId, transition));
    },
    async resolveConflictKeepLocal(employeeId: string, taskId: string, input: Parameters<DraftRepository["resolveConflictKeepLocal"]>[2]) {
      return authorize(employeeId, () => repository.resolveConflictKeepLocal(employeeId, taskId, input));
    },
    async resolveConflictDiscardLocal(employeeId: string, taskId: string, input: Parameters<DraftRepository["resolveConflictDiscardLocal"]>[2]) {
      return authorize(employeeId, () => repository.resolveConflictDiscardLocal(employeeId, taskId, input));
    },
    async listConflictResolutions(employeeId: string): Promise<ConflictResolution[]> {
      return authorize(employeeId, () => repository.listConflictResolutions(employeeId));
    },
  };
}
