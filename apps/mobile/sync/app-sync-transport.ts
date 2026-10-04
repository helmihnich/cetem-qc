import type { SyncTransport } from "./sync-engine";

/**
 * The transport the App synchronizes with. Story 7.2 has no server endpoint yet, so it returns null:
 * no run is started and every outbox item stays queued on the device. Story 7.3 replaces this body with the HTTP adapter.
 */
export function createAppSyncTransport(): SyncTransport | null {
  return null;
}
