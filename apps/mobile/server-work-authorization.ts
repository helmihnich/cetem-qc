import type { OfflineAuthorizationState } from "./offline-authorization-state";

export class ServerWorkAuthorizationError extends Error {
  constructor(readonly authorization: OfflineAuthorizationState) {
    super("Current server work authorization is required.");
    this.name = "ServerWorkAuthorizationError";
  }
}

export async function runOnlyWhenOnlineAuthorized<T>(
  revalidate: () => Promise<OfflineAuthorizationState>,
  work: () => Promise<T>,
): Promise<T> {
  const authorization = await revalidate();
  if (authorization.status !== "online-authorized") throw new ServerWorkAuthorizationError(authorization);
  return work();
}
