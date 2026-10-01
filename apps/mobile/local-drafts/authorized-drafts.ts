import type { DraftRepository, GraphieDraftPayload, LocalDraft } from "./model";

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
  };
}
