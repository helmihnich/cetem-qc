import { ApiRequestError, type ApiClient, type SyncOperationResponse } from "@cetem-qc/api-client/v1";
import type { SyncRequest, SyncResult, SyncTransport } from "./sync-engine";

/** Technical limit, not a CETEM rule: an attempt without a response after 30 s counts as a timeout. */
export const SYNC_REQUEST_TIMEOUT_MS = 30_000;

type Timers = { setTimeout: (callback: () => void, ms: number) => unknown; clearTimeout: (handle: unknown) => void };
const defaultTimers: Timers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status >= 500;

/**
 * The HTTP adapter the engine sends outbox items through. Only a schema-valid server outcome becomes
 * `accepted`, `conflict` or `rejected`; `detail` never carries payload values.
 */
export function createAppSyncTransport(api: ApiClient, timers: Timers = defaultTimers): SyncTransport {
  return {
    async send(request: SyncRequest): Promise<SyncResult> {
      const { snapshot } = request;
      const body = {
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        baseRevision: request.baseRevision,
        localDraftRevision: snapshot.revision,
        clientSavedAt: new Date(snapshot.savedAt).toISOString(),
        payload: snapshot.payload as Record<string, unknown>,
        // Absent unless the item resolves a conflict, so earlier requests keep their exact envelope.
        ...(request.conflictOperationId !== undefined ? { conflictOperationId: request.conflictOperationId } : {}),
        ...(request.correctionOfOperationId !== undefined ? { correctionOfOperationId: request.correctionOfOperationId } : {}),
      };
      const controller = new AbortController();
      let timedOut = false;
      const timer = timers.setTimeout(() => { timedOut = true; controller.abort(); }, SYNC_REQUEST_TIMEOUT_MS);
      let response: SyncOperationResponse;
      try {
        const send = request.kind === "submit" ? api.submitEmployeeTaskAudit : api.syncEmployeeTaskDraft;
        response = await send(request.taskId, body, { signal: controller.signal });
      } catch (error) {
        if (timedOut) return { type: "retryable", code: "timeout" };
        if (error instanceof ApiRequestError) {
          const code = error.code === "UNEXPECTED_API_RESPONSE" ? `HTTP_${error.status}` : error.code;
          return isRetryableStatus(error.status) ? { type: "retryable", code: `HTTP_${error.status}` } : { type: "blocking", code };
        }
        // The envelope could not be built from this snapshot: sending again would not help.
        if ((error as { name?: unknown } | null)?.name === "ZodError") return { type: "blocking", code: "INVALID_REQUEST" };
        return { type: "retryable", code: "network-error" };
      } finally {
        timers.clearTimeout(timer);
      }
      if (response.status === 200) {
        const { acceptedAt, acceptedBy, submissionId } = response.body;
        return { type: "accepted", serverRevision: response.body.serverRevision, detail: { acceptedAt, acceptedBy, ...(submissionId !== undefined ? { submissionId } : {}) } };
      }
      if (response.status === 409) return { type: "conflict", serverRevision: response.body.serverRevision, detail: response.body.current };
      return { type: "rejected", detail: { code: response.body.code, issues: response.body.issues } };
    },
  };
}
