import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { createTaskSyncController, type TaskSyncController } from "./task-sync-controller";

/** Thin React binding of the task sync controller: one controller per App and its snapshot as state. */
export function useTaskSync(create: () => Parameters<typeof createTaskSyncController>[0]) {
  const controllerRef = useRef<TaskSyncController | undefined>(undefined);
  if (!controllerRef.current) controllerRef.current = createTaskSyncController(create());
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(controller.getSnapshot());
  useEffect(() => controller.subscribe(setSnapshot), [controller]);
  return { controller, snapshot };
}

/**
 * The automatic triggers: online authorization established or confirmed (sign-in, server revalidation,
 * reconnection) and return to the foreground. The controller checks connectivity and authorization itself.
 */
export function useTaskSyncTriggers(controller: TaskSyncController, trigger: {
  employeeId: string | undefined;
  isOnline: boolean;
  authorizationStatus: string;
  authorizedIdentityId: string | undefined;
  isActiveIdentity: (employeeId: string) => boolean;
}) {
  const { employeeId, isOnline, authorizationStatus, authorizedIdentityId } = trigger;
  const isActiveIdentityRef = useRef(trigger.isActiveIdentity);
  isActiveIdentityRef.current = trigger.isActiveIdentity;
  useEffect(() => {
    if (employeeId && isOnline && authorizationStatus === "online-authorized" && authorizedIdentityId === employeeId) {
      void controller.trigger(employeeId, "online-authorization");
    }
  }, [authorizationStatus, authorizedIdentityId, isOnline, employeeId]);

  useEffect(() => {
    if (!employeeId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && isActiveIdentityRef.current(employeeId)) void controller.trigger(employeeId, "foreground");
    });
    return () => subscription.remove();
  }, [employeeId]);
}
