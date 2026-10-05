import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import * as Network from "expo-network";
import * as Crypto from "expo-crypto";
import { ApiRequestError, createApiClient } from "@cetem-qc/api-client/v1";
import type { ApiClient, EmployeeTaskListResponse, EmployeeTaskResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { GRAPHIE_CALCULATION_IDENTITY, isInvalidGraphieReading, type CalculationContext } from "@cetem-qc/domain";
import { getEmployeeTaskListState } from "./employee-task-list-state";
import { EmployeeTaskDetailRequests } from "./employee-task-detail-state";
import type { EmployeeTaskDetailState } from "./employee-task-detail-state";
import { getEmployeeTaskContentWidth, getEmployeeTaskPresentation } from "./employee-task-layout";
import { createOfflineAuthorizationService, offlineAuthorizationWindowFromDays } from "./offline-authorization-state";
import type { OfflineAuthorizationState } from "./offline-authorization-state";
import { expoSecureKeyValueStore } from "./offline-authorization-storage";
import { createDraftRepository } from "./local-drafts/model";
import { createSqliteDraftDatabase } from "./local-drafts/sqlite-draft-database";
import { createAuthorizedDrafts } from "./local-drafts/authorized-drafts";
import { ConflictResolutionError, DraftListCorruptionError, LocalDraftPayloadCompatibilityError, PendingSubmissionError, SubmissionNotAllowedError, type LocalDraft } from "./local-drafts/model";
import { ConflictPanel, type ConflictActionResult, type PanelServerVersion } from "./sync/conflict-panel";
import type { SyncTransport } from "./sync/sync-engine";
import { createAppSyncTransport } from "./sync/app-sync-transport";
import { useTaskSync, useTaskSyncTriggers } from "./sync/use-task-sync";
import { submissionAcceptedLine } from "./sync/acceptance-line";
import { deriveTaskSyncState, type TaskSyncState } from "./sync/task-sync-state";
import { runOnlyWhenOnlineAuthorized, ServerWorkAuthorizationError } from "./server-work-authorization";
import { GRAPHIE_CALCULATION_RULE_ID, GRAPHIE_CALCULATION_RULE_VERSION, GRAPHIE_MOBILE_POV_CATALOGUE, GraphiePayloadCompatibilityError, createNewGraphieDraftValues, parseGraphiePayload, type CatalogueField, type CatalogueSection, type CatalogueTable, type GraphieFormValues } from "./graphie-pov-catalogue";
import type { EmployeeTaskLayout } from "./employee-task-layout";
import { calculateGraphieResults, type GraphieCalculationResults } from "./graphie-calculation-service";
import { GRAPHIE_RESULT_BLOCKS_BY_SECTION, GraphieTestResultBlock } from "./graphie-test-result";

declare const process: { env: { EXPO_PUBLIC_API_URL?: string; EXPO_PUBLIC_OFFLINE_AUTHORIZATION_WINDOW_DAYS?: string } };

type AuthenticatedUser = { id: string; email: string; displayName: string; role: "employe"; mustChangePassword: boolean };
type Screen = { kind: "list" } | { kind: "detail"; id: string };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

export default function App() {
  const { width: viewportWidth } = useWindowDimensions();
  const clientRef = useRef<ApiClient | undefined>(undefined);
  if (!clientRef.current) {
    clientRef.current = createApiClient({
      baseUrl: apiBaseUrl,
    });
  }
  const api = clientRef.current;
  const authorizationRef = useRef(createOfflineAuthorizationService(
    expoSecureKeyValueStore,
    { now: () => Date.now() },
    offlineAuthorizationWindowFromDays(process.env.EXPO_PUBLIC_OFFLINE_AUTHORIZATION_WINDOW_DAYS),
  ));
  const detailRequestsRef = useRef(new EmployeeTaskDetailRequests());
  const draftsRef = useRef(createAuthorizedDrafts(
    createDraftRepository(createSqliteDraftDatabase(expoSecureKeyValueStore), Date.now, Crypto.randomUUID),
    (identityId, operation) => authorizationRef.current.withProtectedAccess(identityId, operation),
  ));
  const draftGenerationRef = useRef(0);
  const openRequestGenerationRef = useRef(0);
  const localRefreshGenerationRef = useRef(0);
  const taskListGenerationRef = useRef(0);
  const draftOperationGenerationRef = useRef(0);
  const draftDeletingRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const draftRevisionByScopeRef = useRef(new Map<string, number>());
  const draftContentRef = useRef("");
  const legacyContentModeRef = useRef(false);
  const activeDraftScopeRef = useRef<string | null>(null);
  const draftSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [user, setUser] = useState<AuthenticatedUser>();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [tasks, setTasks] = useState<EmployeeTaskListResponse["tasks"]>([]);
  const [task, setTask] = useState<EmployeeTaskResponse["task"]>();
  const [detailState, setDetailState] = useState<EmployeeTaskDetailState>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [authorization, setAuthorization] = useState<OfflineAuthorizationState>({ status: "locked-logged-out" });
  const [isOnline, setIsOnline] = useState(true);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;
  const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>([]);
  const [cachedTaskContext, setCachedTaskContext] = useState<{ employeeId: string; tasks: EmployeeTaskResponse["task"][] }>();
  const [draftListError, setDraftListError] = useState(false);
  const [taskCacheWarning, setTaskCacheWarning] = useState<string>();
  const [activeDraft, setActiveDraft] = useState<LocalDraft>();
  const [draftContent, setDraftContent] = useState("");
  const [legacyContentMode, setLegacyContentMode] = useState(false);
  const [formValues, setFormValues] = useState<GraphieFormValues>({});
  const [activeSectionId, setActiveSectionId] = useState(GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.id);
  const formValuesRef = useRef<GraphieFormValues>({});
  // Identity of the form being edited: the stored draft's own, or the current one for a new form (Story 6.3).
  const [formIdentity, setFormIdentity] = useState<CalculationContext>();
  const [draftSaveState, setDraftSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [draftHydration, setDraftHydration] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [deleteDraftConfirmation, setDeleteDraftConfirmation] = useState<{ employeeId: string; taskId: string; draftId: string; revision: number }>();
  const [draftNotice, setDraftNotice] = useState<string>();
  // A draft this app version can no longer parse; it can only be discarded (Story 6.7).
  const [unreadableDraft, setUnreadableDraft] = useState<{ employeeId: string; taskId: string }>();
  const [unreadableDeleteConfirmation, setUnreadableDeleteConfirmation] = useState<{ employeeId: string; taskId: string }>();
  const [submitConfirmation, setSubmitConfirmation] = useState<{ employeeId: string; taskId: string }>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // Bumped when a submission request fails, so that the autosave it cancelled is scheduled again.
  const [autosaveRearm, setAutosaveRearm] = useState(0);
  const authorizationStateRef = useRef(authorization);
  authorizationStateRef.current = authorization;
  // Durable outbox rows and conflict resolutions of the signed-in employee, and the active run (Stories 7.2, 8.1).
  const { controller: taskSync, snapshot: syncSnapshot } = useTaskSync(() => ({
    store: draftsRef.current,
    // One HTTP transport per App, using its single API client so the signed-in token is the one sent.
    // Test doubles of this module may provide no transport, in which case no run ever starts.
    transport: createAppSyncTransport(api) as SyncTransport | null,
    context: () => ({ online: isOnlineRef.current, status: authorizationStateRef.current.status, identityId: authorizationStateRef.current.identity?.id }),
    storedGrantValid: async (employeeId) => (await authorizationRef.current.evaluate(employeeId)).status === "offline-authorized",
    isActiveIdentity: (employeeId) => activeIdentityRef.current === employeeId,
  }));
  const syncRunningFor = syncSnapshot.runningFor;
  // Results are derived on every render from the raw strings; they are never written to the draft.
  const calculationResults = useMemo(
    () => (draftHydration === "ready" && formIdentity ? calculateGraphieResults(formIdentity, formValues) : undefined),
    [draftHydration, formIdentity, formValues],
  );
  const listState = getEmployeeTaskListState({ loading, error: Boolean(error), taskCount: tasks.length });
  const activeIdentityRef = useRef<string | null>(null);
  const activeScreenRef = useRef<Screen>(screen);
  const pendingCachedOpenRef = useRef<{ employeeId: string; taskId: string; generation: number } | undefined>(undefined);
  activeScreenRef.current = screen;
  if (user) activeIdentityRef.current = user.id;
  const cachedTasks = cachedTaskContext && user?.id === cachedTaskContext.employeeId ? cachedTaskContext.tasks : [];
  const presentation = getEmployeeTaskPresentation({
    viewportWidth,
    screen: screen.kind,
    tasks,
    selectedTask: task,
  });
  const { layout } = presentation;
  const contentWidth = getEmployeeTaskContentWidth(viewportWidth, layout);
  const presentedTask = presentation.selectedTask;
  const pendingCachedOpen = pendingCachedOpenRef.current;
  const pendingOnlineAuthorization = isOnline && screen.kind === "detail"
    && pendingCachedOpen?.employeeId === user?.id && pendingCachedOpen?.taskId === screen.id;
  const displayedTask = pendingOnlineAuthorization ? undefined
    : task ?? (!isOnline && screen.kind === "detail" ? (cachedTasks.find((item) => item.id === screen.id) ?? presentedTask) : undefined);
  const resumableDrafts = localDrafts.filter((draft) => isOnline || cachedTasks.some((item) => item.id === draft.taskId));
  const unavailableOfflineDrafts = !isOnline && localDrafts.length > resumableDrafts.length;
  activeDraftScopeRef.current = user && screen.kind === "detail" ? `${user.id}\u0000${screen.id}` : null;
  const outboxItems = syncSnapshot.outbox && syncSnapshot.outbox.employeeId === user?.id ? syncSnapshot.outbox.items : [];
  const resolutionItems = syncSnapshot.resolutions && syncSnapshot.resolutions.employeeId === user?.id ? syncSnapshot.resolutions.items : [];
  const taskSyncStateOf = (taskId: string): TaskSyncState => deriveTaskSyncState(
    outboxItems.filter((item) => item.taskId === taskId), resolutionItems.filter((item) => item.taskId === taskId));
  const currentSyncState = screen.kind === "detail" ? taskSyncStateOf(screen.id) : undefined;
  const acceptedLine = screen.kind === "detail" ? submissionAcceptedLine(outboxItems.filter((item) => item.taskId === screen.id)) : undefined;
  const locked = currentSyncState?.locked ?? false;
  // An open conflict pauses the task: no Soumettre, Supprimer or retry until an explicit resolution (Story 8.1).
  const inConflict = Boolean(currentSyncState?.conflict);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const formEditable = draftHydration === "ready" && !draftDeletingRef.current && !deleteDraftConfirmation && !locked && !submitting;
  // A locked task shows its last saved state, never « Enregistrement en cours… ».
  const presentedSaveState = locked && draftSaveState === "saving" ? "saved" : draftSaveState;

  const refreshOutbox = (identityId = user?.id) => taskSync.refreshOutbox(identityId);
  const runSync = (employeeId: string, automatic = false) => taskSync.runSync(employeeId, automatic);

  /** Opening a task needs its submission state first, so that a pending submission is never shown as an editable draft. */
  async function readOutboxBeforeOpen(employeeId: string) {
    if (!await refreshOutbox(employeeId)) throw new Error("Outbox unavailable.");
  }

  async function retrySync() {
    if (!user) return;
    const employeeId = user.id;
    if (!isOnlineRef.current) { setError(fr.auth.offlineUnavailable); return; }
    if (!taskSync.hasTransport()) return;
    if (!await taskSync.isAuthorized(employeeId)) {
      if (activeIdentityRef.current === employeeId) setError(fr.auth.reauthenticateOnline);
      return;
    }
    setError(undefined);
    await runSync(employeeId);
  }

  /** The conflict panel reads the server only online with a server-confirmed authorization (Story 8.1). */
  async function canReadServerVersion(employeeId: string): Promise<string | null> {
    if (!isOnlineRef.current) return fr.auth.offlineUnavailable;
    return await taskSync.isAuthorized(employeeId) ? null : fr.auth.reauthenticateOnline;
  }

  /**
   * Applies an explicit conflict choice after pending local saves, in one store transaction. Keep-local queues
   * the preserved local version and starts a separately authorized run; discard reloads the server version.
   */
  async function resolveConflict(choice: "keep-local" | "discard-local", server: PanelServerVersion): Promise<ConflictActionResult> {
    const conflict = currentSyncState?.conflict;
    if (!user || screen.kind !== "detail" || !conflict) return "failed";
    const employeeId = user.id;
    const taskId = screen.id;
    const scopeKey = `${employeeId}\u0000${taskId}`;
    const conflictOperationIds = conflict.items.map((item) => item.operationId);
    // The preserved local version is the latest local save: flush a pending or previously failed edit first.
    if ((draftSaveState === "saving" || draftSaveState === "failed") && !lockedRef.current && !(await saveDraft())) return "failed";
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const work = draftSaveQueueRef.current.then(async (): Promise<ConflictActionResult> => {
      if (choice === "keep-local") {
        await draftsRef.current.resolveConflictKeepLocal(employeeId, taskId, { conflictOperationIds, server: { revision: server.revision, state: server.state } });
      } else {
        const { draft } = await draftsRef.current.resolveConflictDiscardLocal(employeeId, taskId, {
          conflictOperationIds, server: { revision: server.revision, state: server.state, payload: server.payload },
        });
        if (activeDraftScopeRef.current === scopeKey) {
          draftGenerationRef.current++;
          if (draft) {
            const parsed = parseGraphiePayload(draft.payload);
            formValuesRef.current = parsed.values;
            setFormValues(parsed.values);
            setFormIdentity(calculationIdentityOf(parsed));
            draftContentRef.current = parsed.legacyContent ?? "";
            setDraftContent(parsed.legacyContent ?? "");
            legacyContentModeRef.current = parsed.legacyContent !== undefined;
            setLegacyContentMode(parsed.legacyContent !== undefined);
          } else resetFormToNewDraft();
          setActiveDraft(draft ?? undefined);
          draftRevisionRef.current = draft?.revision ?? 0;
          draftRevisionByScopeRef.current.set(scopeKey, draft?.revision ?? 0);
          clearUnreadableDraft();
          setDraftNotice(undefined);
          setDraftSaveState(draft ? "saved" : "idle");
          setDraftHydration("ready");
          setError(undefined);
        }
      }
      await refreshOutbox(employeeId);
      await refreshLocalDrafts(employeeId);
      // Keep-local is sent by a separately authorized run; it never re-queues a submission. The run is not an
      // explicit retry: blocked items of other tasks still wait for « Réessayer la synchronisation ».
      if (choice === "keep-local") void runSync(employeeId, true);
      return "done";
    }).catch(async (cause): Promise<ConflictActionResult> => {
      if (cause instanceof ConflictResolutionError && cause.reason === "stale") {
        await refreshOutbox(employeeId);
        return "stale";
      }
      await refreshOutbox(employeeId);
      await redactDraftIfAuthorizationLost(employeeId);
      return "failed";
    });
    draftSaveQueueRef.current = work.then(() => undefined);
    return work;
  }

  function beginSubmit() {
    if (!user || screen.kind !== "detail" || draftHydration !== "ready" || !currentSyncState?.canSubmit || submittingRef.current || draftDeletingRef.current) return;
    setSubmitConfirmation({ employeeId: user.id, taskId: screen.id });
  }

  function confirmSubmit() {
    const captured = submitConfirmation;
    setSubmitConfirmation(undefined);
    const selected = activeScreenRef.current;
    if (!captured || !user || user.id !== captured.employeeId || submittingRef.current || lockedRef.current || draftDeletingRef.current
      || selected.kind !== "detail" || selected.id !== captured.taskId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    submittingRef.current = true;
    setSubmitting(true);
    setDraftNotice(undefined);
    const { employeeId, taskId } = captured;
    const scopeKey = `${employeeId}\u0000${taskId}`;
    const request = draftSaveQueueRef.current.then(async () => {
      try {
        const { draft } = await draftsRef.current.requestSubmission(employeeId, taskId, {
          catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id,
          catalogueVersion: GRAPHIE_MOBILE_POV_CATALOGUE.version,
          schemaVersion: GRAPHIE_MOBILE_POV_CATALOGUE.schemaVersion,
          ruleId: GRAPHIE_CALCULATION_RULE_ID,
          ruleVersion: GRAPHIE_CALCULATION_RULE_VERSION,
          values: { ...formValuesRef.current },
          ...(legacyContentModeRef.current ? { legacyContent: draftContentRef.current } : {}),
        }, draftRevisionByScopeRef.current.get(scopeKey) ?? 0);
        draftRevisionByScopeRef.current.set(scopeKey, draft.revision);
        if (activeDraftScopeRef.current === scopeKey) {
          draftRevisionRef.current = draft.revision;
          setActiveDraft(draft);
          setDraftSaveState("saved");
        }
        await refreshOutbox(employeeId);
        await refreshLocalDrafts(employeeId);
        void runSync(employeeId);
      } catch (cause) {
        if (cause instanceof PendingSubmissionError) await refreshOutbox(employeeId);
        else if (cause instanceof SubmissionNotAllowedError) {
          if (activeIdentityRef.current === employeeId) { setError(fr.employeeTasks.submissionNotAllowed); setAutosaveRearm((value) => value + 1); }
        } else {
          if (activeIdentityRef.current === employeeId) { setError(fr.employeeTasks.submissionFailed); setAutosaveRearm((value) => value + 1); }
          await redactDraftIfAuthorizationLost(employeeId);
        }
      }
    }).finally(() => { submittingRef.current = false; setSubmitting(false); });
    draftSaveQueueRef.current = request.then(() => undefined);
  }

  function isCurrentOpen(generation: number, employeeId: string, taskId: string) {
    const selected = activeScreenRef.current;
    return openRequestGenerationRef.current === generation
      && activeIdentityRef.current === employeeId
      && selected.kind === "detail" && selected.id === taskId;
  }

  function selectScreen(next: Screen) {
    activeScreenRef.current = next;
    setScreen(next);
  }

  function updateCachedTasks(employeeId: string, update: (previous: EmployeeTaskResponse["task"][]) => EmployeeTaskResponse["task"][]) {
    setCachedTaskContext((current) => ({
      employeeId,
      tasks: update(current?.employeeId === employeeId ? current.tasks : []),
    }));
  }

  function clearUnreadableDraft() {
    setUnreadableDraft(undefined);
    setUnreadableDeleteConfirmation(undefined);
  }

  function resetFormToNewDraft() {
    const values = createNewGraphieDraftValues();
    formValuesRef.current = values;
    setFormValues(values);
    setFormIdentity(calculationIdentityOf(GRAPHIE_CALCULATION_IDENTITY));
    legacyContentModeRef.current = false;
    setLegacyContentMode(false);
    draftContentRef.current = "";
    setDraftContent("");
  }

  async function revokeCachedTaskContext(employeeId: string, taskId: string, isCurrentOpen: () => boolean) {
    if (activeIdentityRef.current === employeeId) {
      updateCachedTasks(employeeId, (previous) => previous.filter((item) => item.id !== taskId));
      setTasks((previous) => previous.filter((item) => item.id !== taskId));
    }
    try {
      await draftsRef.current.revokeCachedSynchronizedTask(employeeId, taskId);
    } catch {
      if (isCurrentOpen()) setTaskCacheWarning(fr.employeeTasks.taskCacheFailed);
    }
  }

  async function refreshLocalDrafts(identityId = user?.id) {
    const generation = ++localRefreshGenerationRef.current;
    if (!identityId) { setLocalDrafts([]); setCachedTaskContext(undefined); return; }
    const [draftResult, cacheResult] = await Promise.allSettled([
      draftsRef.current.list(identityId),
      draftsRef.current.listCachedSynchronizedTasks(identityId),
      refreshOutbox(identityId),
    ]);
    if (generation !== localRefreshGenerationRef.current || activeIdentityRef.current !== identityId) return;
    if (draftResult.status === "fulfilled") setLocalDrafts(draftResult.value);
    else if (draftResult.reason instanceof DraftListCorruptionError) setLocalDrafts(draftResult.reason.drafts);
    else setLocalDrafts([]);
    setCachedTaskContext({
      employeeId: identityId,
      tasks: cacheResult.status === "fulfilled"
        ? cacheResult.value.map((entry) => entry.task as EmployeeTaskResponse["task"])
        : [],
    });
    setDraftListError(draftResult.status === "rejected" || cacheResult.status === "rejected");
    if (draftResult.status === "rejected" || cacheResult.status === "rejected") await redactDraftIfAuthorizationLost(identityId);
  }

  async function redactDraftIfAuthorizationLost(identityId: string) {
    const state = await authorizationRef.current.evaluate(identityId).catch(() => ({ status: "locked-corrupt-or-clock-invalid" as const }));
    if (activeIdentityRef.current !== identityId) return false;
    if (state.status === "offline-authorized" || state.status === "online-authorized") return false;
    setAuthorization(state);
    draftGenerationRef.current++;
    draftOperationGenerationRef.current++;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    draftContentRef.current = "";
    setDraftContent("");
    legacyContentModeRef.current = false;
    setLegacyContentMode(false);
    setActiveDraft(undefined);
    setDraftHydration("failed");
    setDraftSaveState("idle");
    setDeleteDraftConfirmation(undefined); setSubmitConfirmation(undefined);
    clearUnreadableDraft();
    setLocalDrafts([]);
    setCachedTaskContext(undefined);
    activeIdentityRef.current = null;
    setUser(undefined);
    setError(state.status === "locked-expired" ? fr.auth.offlineExpired
      : state.status === "locked-deactivated" ? fr.auth.accountDeactivated
        : state.status === "locked-logged-out" ? fr.auth.reauthenticateOnline : fr.auth.offlineUnavailable);
    return true;
  }

  function changeDraftContent(value: string) {
    if (draftHydration !== "ready" || draftDeletingRef.current || deleteDraftConfirmation || !user || lockedRef.current || submittingRef.current) return;
    draftGenerationRef.current++;
    draftContentRef.current = value;
    setDraftContent(value);
    setDraftSaveState("saving");
  }

  function changeFormField(fieldId: string, value: string) {
    if (draftHydration !== "ready" || draftDeletingRef.current || deleteDraftConfirmation || !user || lockedRef.current || submittingRef.current) return;
    const next = { ...formValuesRef.current, [fieldId]: value };
    formValuesRef.current = next;
    setFormValues(next);
    draftGenerationRef.current++;
    setDraftSaveState("saving");
  }

  async function openLocalDraft(taskId: string) {
    if (!user) return;
    if (!isOnlineRef.current) {
      const cached = cachedTasks.find((item) => item.id === taskId);
      if (!cached) { setDraftNotice(fr.employeeTasks.taskUnavailableOffline); return; }
      await openCachedTask(cached);
      return;
    }
    const employeeId = user.id;
    const requestGeneration = ++openRequestGenerationRef.current;
    setDraftNotice(undefined);
    const generation = ++draftGenerationRef.current;
    draftOperationGenerationRef.current++;
    setDeleteDraftConfirmation(undefined); setSubmitConfirmation(undefined);
    clearUnreadableDraft();
    setDraftHydration("loading");
    setActiveSectionId(GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.id);
    setDraftContent("");
    draftContentRef.current = "";
    formValuesRef.current = {};
    setFormValues({});
    setFormIdentity(undefined);
    legacyContentModeRef.current = false;
    setLegacyContentMode(false);
    setDraftNotice(undefined);
    setActiveDraft(undefined);
    selectScreen({ kind: "detail", id: taskId });
    setTask(undefined);
    setDetailState(isOnline ? { taskId, status: "loading" } : undefined);
    setDraftSaveState("idle");
    setTaskCacheWarning(undefined);
    setError(undefined);
    setLoading(true);
    try {
      const cachedTask = cachedTasks.find((item) => item.id === taskId);
      if (isOnline) {
        let authorizationError: string | undefined;
        const result = await detailRequestsRef.current.open(taskId, async (id) => {
          try {
            return await runOnlyWhenOnlineAuthorized(
              () => revalidateServerAuthorization(user),
              async () => (await api.getAssignedEmployeeTask(id)).task,
            );
          } catch (cause) {
            if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "ACCOUNT_DEACTIVATED") authorizationError = fr.auth.accountDeactivated;
            else if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "TASK_NOT_ASSIGNED") {
              authorizationError = fr.employeeTasks.taskNoLongerAssigned;
              await revokeCachedTaskContext(employeeId, id, () => openRequestGenerationRef.current === requestGeneration
                && activeIdentityRef.current === employeeId && activeScreenRef.current.kind === "detail" && activeScreenRef.current.id === id);
            }
            else if (cause instanceof ApiRequestError && cause.status === 401) authorizationError = fr.auth.reauthenticateOnline;
            else if (cause instanceof ServerWorkAuthorizationError) authorizationError = cause.authorization.status === "locked-expired" ? fr.auth.offlineExpired : fr.auth.reauthenticateOnline;
            throw cause;
          }
        });
        if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId || !result.current) return;
        setDetailState(result.state);
        if (result.state.status !== "ready" || !result.task) {
          setDraftHydration("failed");
          setError(authorizationError ?? fr.employeeTasks.detailError);
          return;
        }
        const authorizedTask = result.task;
        setTask(authorizedTask);
        try {
          await draftsRef.current.cacheSynchronizedTask(employeeId, authorizedTask);
          if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
          updateCachedTasks(employeeId, (previous) => previous.some((item) => item.id === authorizedTask.id)
            ? previous.map((item) => item.id === authorizedTask.id ? authorizedTask : item)
            : [...previous, authorizedTask]);
          setTaskCacheWarning(undefined);
        } catch {
          if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
          setTaskCacheWarning(fr.employeeTasks.taskCacheFailed);
        }
      } else if (cachedTask) {
        setTask(cachedTask);
        setDetailState({ taskId, status: "ready" });
      }
      if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
      await readOutboxBeforeOpen(employeeId);
      const draft = await draftsRef.current.read(user.id, taskId);
      if (generation !== draftGenerationRef.current || openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
      setActiveDraft(draft ?? undefined);
      draftRevisionRef.current = draft?.revision ?? 0;
      draftRevisionByScopeRef.current.set(`${user.id}\u0000${taskId}`, draft?.revision ?? 0);
      const parsed = draft ? parseGraphiePayload(draft.payload) : { ...GRAPHIE_CALCULATION_IDENTITY, values: createNewGraphieDraftValues(), legacyContent: undefined as string | undefined };
      setDraftContent(parsed.legacyContent ?? "");
      draftContentRef.current = parsed.legacyContent ?? "";
      legacyContentModeRef.current = parsed.legacyContent !== undefined;
      setLegacyContentMode(parsed.legacyContent !== undefined);
      setFormValues(parsed.values);
      setFormIdentity(calculationIdentityOf(parsed));
      formValuesRef.current = parsed.values;
      setDraftSaveState(draft ? "saved" : "idle");
      setDraftHydration("ready");
      setError(undefined);
    } catch (cause) {
      if (generation === draftGenerationRef.current && openRequestGenerationRef.current === requestGeneration && activeIdentityRef.current === employeeId) {
        setDraftHydration("failed");
        if (cause instanceof GraphiePayloadCompatibilityError || cause instanceof LocalDraftPayloadCompatibilityError) {
          setDraftNotice(fr.employeeTasks.draftCompatibilityUnavailable);
          setUnreadableDraft({ employeeId, taskId });
        } else setError(fr.employeeTasks.draftStorageUnavailable);
        await redactDraftIfAuthorizationLost(employeeId);
      }
    } finally { if (generation === draftGenerationRef.current && openRequestGenerationRef.current === requestGeneration && activeIdentityRef.current === employeeId) setLoading(false); }
  }

  function saveDraft(): Promise<boolean> {
    if (!user || screen.kind !== "detail" || draftHydration !== "ready" || draftDeletingRef.current || lockedRef.current || submittingRef.current) return Promise.resolve(false);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const employeeId = user.id;
    const taskId = screen.id;
    const scopeKey = `${employeeId}\u0000${taskId}`;
    const generation = draftGenerationRef.current;
    const operationGeneration = draftOperationGenerationRef.current;
    setDraftSaveState("saving");
    const completion = draftSaveQueueRef.current.then(async () => {
      if (operationGeneration !== draftOperationGenerationRef.current || draftDeletingRef.current) return false;
      let saveGeneration = draftGenerationRef.current;
      const revisionBefore = draftRevisionByScopeRef.current.get(scopeKey) ?? 0;
      let saved!: LocalDraft;
      do {
        saved = await draftsRef.current.save(employeeId, taskId, {
          catalogueId: GRAPHIE_MOBILE_POV_CATALOGUE.id,
          catalogueVersion: GRAPHIE_MOBILE_POV_CATALOGUE.version,
          schemaVersion: GRAPHIE_MOBILE_POV_CATALOGUE.schemaVersion,
          ruleId: GRAPHIE_CALCULATION_RULE_ID,
          ruleVersion: GRAPHIE_CALCULATION_RULE_VERSION,
          values: { ...formValuesRef.current },
          ...(legacyContentModeRef.current ? { legacyContent: draftContentRef.current } : {}),
        }, draftRevisionByScopeRef.current.get(scopeKey) ?? 0);
        draftRevisionByScopeRef.current.set(scopeKey, saved.revision);
        if (activeDraftScopeRef.current === scopeKey) draftRevisionRef.current = saved.revision;
        if (activeDraftScopeRef.current !== scopeKey || saveGeneration === draftGenerationRef.current) break;
        saveGeneration = draftGenerationRef.current;
      } while (true);
      if (activeDraftScopeRef.current === scopeKey) {
        setActiveDraft(saved);
        setDraftSaveState("saved");
        await refreshLocalDrafts(employeeId);
      }
      // A save that created a revision queued a draft synchronization: send it when allowed.
      if (saved.revision !== revisionBefore) void taskSync.trigger(employeeId, "changed-save");
      return true;
    }).catch(async (cause) => {
      if (cause instanceof PendingSubmissionError) {
        // The task was submitted meanwhile: it is read-only now, which is not a save failure.
        if (activeDraftScopeRef.current === scopeKey) setDraftSaveState("saved");
        await refreshOutbox(employeeId);
        return false;
      }
      if (generation === draftGenerationRef.current) {
        setDraftSaveState("failed");
      }
      void redactDraftIfAuthorizationLost(employeeId);
      return false;
    });
    draftSaveQueueRef.current = completion.then(() => undefined);
    return completion;
  }

  async function leaveTaskDetail() {
    openRequestGenerationRef.current++;
    if (draftSaveState === "saving" && !lockedRef.current && !(await saveDraft())) {
      setError(fr.employeeTasks.saveFailed);
      return;
    }
    draftGenerationRef.current++;
    draftOperationGenerationRef.current++;
    setDeleteDraftConfirmation(undefined); setSubmitConfirmation(undefined);
    clearUnreadableDraft();
    setDraftHydration("idle");
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    detailRequestsRef.current.invalidate();
    selectScreen({ kind: "list" }); setTask(undefined); setDetailState(undefined); setActiveDraft(undefined); setError(undefined); setLoading(false);
    await refreshLocalDrafts(user?.id);
  }

  useEffect(() => {
    if (screen.kind !== "detail" || draftHydration !== "ready" || draftSaveState === "idle" || !user || draftDeletingRef.current || locked || submittingRef.current) return;
    const generation = draftGenerationRef.current;
    autosaveTimerRef.current = setTimeout(() => { if (generation === draftGenerationRef.current) saveDraft(); }, 500);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
  }, [draftContent, formValues, draftHydration, screen, user?.id, locked, autosaveRearm]);

  // A conflict recorded while a Soumettre or Supprimer confirmation is open closes it: both stay refused until resolution.
  useEffect(() => {
    if (!inConflict) return;
    setSubmitConfirmation(undefined);
    setDeleteDraftConfirmation(undefined);
  }, [inConflict]);

  useEffect(() => {
    if (!user) { localRefreshGenerationRef.current++; setLocalDrafts([]); setCachedTaskContext(undefined); return; }
    void refreshLocalDrafts(user.id);
  }, [user?.id, authorization.status]);

  useTaskSyncTriggers(taskSync, {
    employeeId: user?.id, isOnline, authorizationStatus: authorization.status, authorizedIdentityId: authorization.identity?.id,
    isActiveIdentity: (employeeId) => activeIdentityRef.current === employeeId,
  });

  async function revalidateServerAuthorization(expectedUser: AuthenticatedUser): Promise<OfflineAuthorizationState> {
    try {
      const session = await api.getSession();
      if (session.user.id !== expectedUser.id || session.user.role !== "employe") {
        const state = await authorizationRef.current.logout(expectedUser.id);
        if (activeIdentityRef.current === expectedUser.id) {
          setAuthorization(state);
            activeIdentityRef.current = null;
          setUser(undefined);
          setError(fr.auth.reauthenticateOnline);
        }
        throw new ApiRequestError("Session identity changed.", 401, "AUTHENTICATION_FAILED");
      }
      const state = await authorizationRef.current.confirmServerAuthorization(expectedUser.id);
      if (activeIdentityRef.current === expectedUser.id) {
        setAuthorization(state);
        if (state.status.startsWith("locked-")) { activeIdentityRef.current = null; setUser(undefined); }
      }
      return state;
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "ACCOUNT_DEACTIVATED") {
        const state = await authorizationRef.current.lockDeactivated(expectedUser.id);
        if (activeIdentityRef.current === expectedUser.id) {
          setAuthorization(state);
          activeIdentityRef.current = null;
          setUser(undefined);
          setError(fr.auth.accountDeactivated);
        }
      } else if (cause instanceof ApiRequestError && cause.status === 401) {
        const state = await authorizationRef.current.beginRevalidation(expectedUser.id);
        if (activeIdentityRef.current === expectedUser.id) {
          setAuthorization(state.status === "offline-authorized" ? { ...state, status: "revalidating" } : state);
          if (state.status !== "offline-authorized" && state.status !== "revalidating") { activeIdentityRef.current = null; setUser(undefined); }
          setError(fr.auth.reauthenticateOnline);
        }
      }
      throw cause;
    }
  }

  useEffect(() => {
    let active = true;
    const updateConnection = async (connected: boolean) => {
      if (!active) return;
      isOnlineRef.current = connected;
      setIsOnline(connected);
      if (user && activeIdentityRef.current !== user.id) activeIdentityRef.current = user.id;
      if (!connected) {
        try {
          const current = await authorizationRef.current.hydrate();
          const state = current.identity ? await authorizationRef.current.authorizeOffline(current.identity.id) : current;
          if (!active) return;
          setAuthorization(state);
          if (state.status === "offline-authorized" && state.identity) {
            activeIdentityRef.current = state.identity.id;
            setUser(state.identity);
            setError(undefined);
          } else {
            activeIdentityRef.current = null;
            setUser(undefined);
            if (state.status === "locked-expired") setError(fr.auth.offlineExpired);
            else if (state.status === "locked-corrupt-or-clock-invalid") setError(fr.auth.offlineUnavailable);
          }
        } catch {
          if (active) { setAuthorization({ status: "locked-corrupt-or-clock-invalid" }); activeIdentityRef.current = null; setUser(undefined); setError(fr.auth.offlineUnavailable); }
        }
        return;
      }

      if (!user) {
        try {
          const current = await authorizationRef.current.hydrate();
          const state = current.identity ? await authorizationRef.current.beginRevalidation(current.identity.id) : current;
          if (!active) return;
          if ((state.status === "offline-authorized" || state.status === "revalidating") && state.identity) {
            activeIdentityRef.current = state.identity.id;
            setAuthorization({ ...state, status: "revalidating" });
            setUser(state.identity);
            setError(fr.auth.reauthenticateOnline);
          } else {
            setAuthorization(state);
            if (state.status === "locked-expired") setError(fr.auth.offlineExpired);
            else if (state.status === "locked-corrupt-or-clock-invalid") setError(fr.auth.offlineUnavailable);
          }
        } catch {
          if (active) { setAuthorization({ status: "locked-corrupt-or-clock-invalid" }); setError(fr.auth.offlineUnavailable); }
        }
        return;
      }

      setAuthorization({ status: "revalidating", identity: user });
      try {
        await revalidateServerAuthorization(user);
        if (!active) return;
        setError(undefined);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403)) return;
        try {
          const state = await authorizationRef.current.evaluate(user.id);
          if (!active) return;
          setAuthorization(state);
          if (state.status === "offline-authorized") setError(undefined);
        else { activeIdentityRef.current = null; setUser(undefined); setError(state.status === "locked-expired" ? fr.auth.offlineExpired : fr.auth.offlineUnavailable); }
        } catch {
          if (active) { setAuthorization({ status: "locked-corrupt-or-clock-invalid" }); activeIdentityRef.current = null; setUser(undefined); setError(fr.auth.offlineUnavailable); }
        }
      }
    };

    const fromNetworkState = (state: Network.NetworkState) => {
      void updateConnection(state.isConnected === true && state.isInternetReachable !== false);
    };
    const networkSubscription = Network.addNetworkStateListener(fromNetworkState);
    const appSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void Network.getNetworkStateAsync().then(fromNetworkState).catch(() => updateConnection(false));
    });
    void Network.getNetworkStateAsync().then(fromNetworkState).catch(() => updateConnection(false));
    return () => { active = false; networkSubscription.remove(); appSubscription.remove(); };
  }, [api, user?.id]);

  async function signIn() {
    setLoading(true);
    setError(undefined);
    try {
      const session = await api.authenticate({ email: email.trim(), password });
      if (session.user.role !== "employe") {
        await api.logout();
        setError(fr.auth.employeeOnly);
      } else {
        const employee = { ...session.user, role: "employe" as const };
        const state = employee.mustChangePassword
          ? await authorizationRef.current.logout(employee.id)
          : await authorizationRef.current.establishOnlineAuthorization(employee);
        setAuthorization(state);
        activeIdentityRef.current = employee.id;
        setUser(employee);
        setPassword("");
      if (!employee.mustChangePassword) { await loadTasks(employee); await refreshLocalDrafts(employee.id); }
      }
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : fr.auth.invalidCredentials);
    } finally {
      setLoading(false);
    }
  }

  async function activate() {
    setLoading(true);
    setError(undefined);
    try {
      const session = await api.replaceTemporaryPassword({ currentPassword: password, newPassword });
      if (session.user.role !== "employe") {
        await api.logout();
        setError(fr.auth.employeeOnly);
        return;
      }
      const employee = { ...session.user, role: "employe" as const };
      const state = await authorizationRef.current.establishOnlineAuthorization(employee);
      setAuthorization(state);
      activeIdentityRef.current = employee.id;
      setUser(employee);
      setPassword("");
      setNewPassword("");
      await loadTasks(employee);
      await refreshLocalDrafts(employee.id);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : fr.auth.activationError);
    } finally {
      setLoading(false);
    }
  }

  async function loadTasks(authenticatedUser = user) {
    if (!isOnlineRef.current || !authenticatedUser) { setError(fr.auth.offlineUnavailable); return; }
    const employeeId = authenticatedUser.id;
    const generation = ++taskListGenerationRef.current;
    setLoading(true);
    setError(undefined);
    try {
      const response = await runOnlyWhenOnlineAuthorized(
        () => revalidateServerAuthorization(authenticatedUser),
        () => api.listAssignedEmployeeTasks(),
      );
      if (generation !== taskListGenerationRef.current || activeIdentityRef.current !== employeeId) return;
      let cacheRefreshed = false;
      try {
        await draftsRef.current.replaceCachedSynchronizedTasks(employeeId, response.tasks);
        cacheRefreshed = true;
      } catch {
        // The server list is authoritative for this session even if local persistence fails.
      }
      if (generation !== taskListGenerationRef.current || activeIdentityRef.current !== employeeId) return;
      setCachedTaskContext({ employeeId, tasks: cacheRefreshed ? response.tasks : [] });
      setTaskCacheWarning(cacheRefreshed ? undefined : fr.employeeTasks.taskCacheFailed);
      setTasks(response.tasks);
      selectScreen({ kind: "list" });
      setTask(undefined);
    } catch (cause) {
      if (generation !== taskListGenerationRef.current || activeIdentityRef.current !== employeeId) return;
      if (cause instanceof ServerWorkAuthorizationError) {
        setError(cause.authorization.status === "locked-expired" ? fr.auth.offlineExpired : fr.auth.reauthenticateOnline);
        return;
      }
      if (cause instanceof ApiRequestError && (cause.status === 401 || cause.status === 403)) {
        return;
      } else {
        const state = await authorizationRef.current.evaluate(authenticatedUser.id).catch(() => ({ status: "locked-corrupt-or-clock-invalid" as const }));
        setAuthorization(state);
        setError(state.status === "offline-authorized" ? fr.auth.offlineUnavailable : fr.employeeTasks.loadError);
      }
    } finally {
      if (generation === taskListGenerationRef.current && activeIdentityRef.current === employeeId) setLoading(false);
    }
  }

  async function openTask(id: string) {
    if (!isOnlineRef.current || !user) { setError(fr.auth.offlineUnavailable); return; }
    const employeeId = user.id;
    const requestGeneration = ++openRequestGenerationRef.current;
    pendingCachedOpenRef.current = undefined;
    setDraftNotice(undefined);
    detailRequestsRef.current.invalidate();
    draftGenerationRef.current++;
    draftOperationGenerationRef.current++;
    setDeleteDraftConfirmation(undefined); setSubmitConfirmation(undefined);
    clearUnreadableDraft();
    setDraftHydration("loading");
    setTaskCacheWarning(undefined);
    setActiveSectionId(GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.id);
    draftDeletingRef.current = false;
    setActiveDraft(undefined);
    setDraftContent("");
    formValuesRef.current = {};
    setFormValues({});
    setFormIdentity(undefined);
    draftContentRef.current = "";
    legacyContentModeRef.current = false;
    setLegacyContentMode(false);
    setDraftSaveState("idle");
    selectScreen({ kind: "detail", id });
    setTask(undefined);
    setDetailState({ taskId: id, status: "loading" });
    setLoading(true);
    setError(undefined);
    let authorizationError: string | undefined;
    const result = await detailRequestsRef.current.open(id, async (taskId) => {
      try {
        return await runOnlyWhenOnlineAuthorized(
          () => revalidateServerAuthorization(user),
          async () => (await api.getAssignedEmployeeTask(taskId)).task,
        );
      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "ACCOUNT_DEACTIVATED") authorizationError = fr.auth.accountDeactivated;
        else if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "TASK_NOT_ASSIGNED") {
          authorizationError = fr.employeeTasks.taskNoLongerAssigned;
          await revokeCachedTaskContext(employeeId, taskId, () => openRequestGenerationRef.current === requestGeneration
            && activeIdentityRef.current === employeeId && activeScreenRef.current.kind === "detail" && activeScreenRef.current.id === taskId);
        }
        else if (cause instanceof ApiRequestError && cause.status === 401) authorizationError = fr.auth.reauthenticateOnline;
        else if (cause instanceof ServerWorkAuthorizationError) authorizationError = cause.authorization.status === "locked-expired" ? fr.auth.offlineExpired : fr.auth.reauthenticateOnline;
        throw cause;
      }
    });
    if (!result.current || openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
    setDetailState(result.state);
    if (result.state.status === "ready") {
      setTask(result.task);
      if (result.task) {
          const authorizedTask = result.task;
        try {
            await draftsRef.current.cacheSynchronizedTask(employeeId, authorizedTask);
          if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
            updateCachedTasks(employeeId, (previous) => previous.some((item) => item.id === authorizedTask.id)
              ? previous.map((item) => item.id === authorizedTask.id ? authorizedTask : item)
              : [...previous, authorizedTask]);
        } catch {
          if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
          setTaskCacheWarning(fr.employeeTasks.taskCacheFailed);
        }
      }
      const generation = draftGenerationRef.current;
      try {
        await readOutboxBeforeOpen(employeeId);
        const draft = await draftsRef.current.read(employeeId, id);
        if (generation === draftGenerationRef.current && openRequestGenerationRef.current === requestGeneration && activeIdentityRef.current === employeeId) {
          setActiveDraft(draft ?? undefined);
          draftRevisionRef.current = draft?.revision ?? 0;
          draftRevisionByScopeRef.current.set(`${user.id}\u0000${id}`, draft?.revision ?? 0);
          const parsed = draft ? parseGraphiePayload(draft.payload) : { ...GRAPHIE_CALCULATION_IDENTITY, values: createNewGraphieDraftValues(), legacyContent: undefined as string | undefined };
          setDraftContent(parsed.legacyContent ?? "");
          draftContentRef.current = parsed.legacyContent ?? "";
          legacyContentModeRef.current = parsed.legacyContent !== undefined;
          setLegacyContentMode(parsed.legacyContent !== undefined);
          setFormValues(parsed.values);
          setFormIdentity(calculationIdentityOf(parsed));
          formValuesRef.current = parsed.values;
          setDraftSaveState(draft ? "saved" : "idle");
          setDraftHydration("ready");
        }
      } catch (cause) {
        if (generation === draftGenerationRef.current && openRequestGenerationRef.current === requestGeneration && activeIdentityRef.current === employeeId) {
          setDraftHydration("failed");
          if (cause instanceof GraphiePayloadCompatibilityError || cause instanceof LocalDraftPayloadCompatibilityError) {
            setDraftNotice(fr.employeeTasks.draftCompatibilityUnavailable);
            setUnreadableDraft({ employeeId, taskId: id });
          } else setError(fr.employeeTasks.draftStorageUnavailable);
          await redactDraftIfAuthorizationLost(employeeId);
        }
      }
    } else if (isCurrentOpen(requestGeneration, employeeId, id)) {
      setDraftHydration("failed"); setError(authorizationError ?? fr.employeeTasks.detailError);
    }
    if (openRequestGenerationRef.current === requestGeneration && activeIdentityRef.current === employeeId) setLoading(false);
  }

  async function openCachedTask(cached: EmployeeTaskResponse["task"]) {
    if (!user || !cachedTasks.some((item) => item.id === cached.id)) return;
    if (isOnlineRef.current) { await openTask(cached.id); return; }
    const employeeId = user.id;
    const requestGeneration = ++openRequestGenerationRef.current;
    pendingCachedOpenRef.current = undefined;
    detailRequestsRef.current.invalidate();
    const access = await authorizationRef.current.evaluate(employeeId).catch(() => ({ status: "locked-corrupt-or-clock-invalid" as const }));
    if (requestGeneration !== openRequestGenerationRef.current || activeIdentityRef.current !== employeeId) return;
    if (isOnlineRef.current) { await openTask(cached.id); return; }
    if (access.status !== "offline-authorized" && access.status !== "online-authorized") {
      await redactDraftIfAuthorizationLost(employeeId);
      return;
    }
    const cachedContext = await draftsRef.current.listCachedSynchronizedTasks(employeeId).catch(() => []);
    if (requestGeneration !== openRequestGenerationRef.current || activeIdentityRef.current !== employeeId) return;
    if (isOnlineRef.current) { await openTask(cached.id); return; }
    const authorizedTask = cachedContext.find((entry) => entry.task.id === cached.id)?.task as EmployeeTaskResponse["task"] | undefined;
    if (!authorizedTask) { setError(fr.employeeTasks.taskUnavailableOffline); return; }
    const latestAccess = await authorizationRef.current.evaluate(employeeId).catch(() => ({ status: "locked-corrupt-or-clock-invalid" as const }));
    if (requestGeneration !== openRequestGenerationRef.current || activeIdentityRef.current !== employeeId) return;
    if (isOnlineRef.current) { await openTask(cached.id); return; }
    if (latestAccess.status !== "offline-authorized") {
      await redactDraftIfAuthorizationLost(employeeId);
      return;
    }
    detailRequestsRef.current.invalidate();
    draftGenerationRef.current++;
    draftOperationGenerationRef.current++;
    const generation = draftGenerationRef.current;
    setDeleteDraftConfirmation(undefined); setSubmitConfirmation(undefined);
    clearUnreadableDraft();
    pendingCachedOpenRef.current = { employeeId, taskId: authorizedTask.id, generation: requestGeneration };
    setTask(authorizedTask);
    setDetailState({ taskId: authorizedTask.id, status: "ready" });
    selectScreen({ kind: "detail", id: cached.id });
    setActiveSectionId(GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.id);
    setActiveDraft(undefined);
    setDraftContent("");
    setFormValues({});
    setFormIdentity(undefined);
    formValuesRef.current = {};
    setLegacyContentMode(false);
    legacyContentModeRef.current = false;
    setDraftHydration("loading");
    setDraftSaveState("idle");
    setTaskCacheWarning(undefined);
    setError(undefined);
    setLoading(false);
    try {
      await readOutboxBeforeOpen(employeeId);
      const draft = await draftsRef.current.read(employeeId, authorizedTask.id);
      if (generation !== draftGenerationRef.current || !isCurrentOpen(requestGeneration, employeeId, authorizedTask.id)) return;
      if (isOnlineRef.current) { pendingCachedOpenRef.current = undefined; await openTask(authorizedTask.id); return; }
      const currentAccess = await authorizationRef.current.evaluate(employeeId).catch(() => ({ status: "locked-corrupt-or-clock-invalid" as const }));
      if (generation !== draftGenerationRef.current || !isCurrentOpen(requestGeneration, employeeId, authorizedTask.id)) return;
      if (isOnlineRef.current) { pendingCachedOpenRef.current = undefined; await openTask(authorizedTask.id); return; }
      if (currentAccess.status !== "offline-authorized") {
        await redactDraftIfAuthorizationLost(employeeId);
        return;
      }
      const currentCache = await draftsRef.current.listCachedSynchronizedTasks(employeeId).catch(() => []);
      if (generation !== draftGenerationRef.current || !isCurrentOpen(requestGeneration, employeeId, authorizedTask.id)) return;
      if (isOnlineRef.current) { pendingCachedOpenRef.current = undefined; await openTask(authorizedTask.id); return; }
      const finalAccess = await authorizationRef.current.evaluate(employeeId).catch(() => ({ status: "locked-corrupt-or-clock-invalid" as const }));
      if (generation !== draftGenerationRef.current || !isCurrentOpen(requestGeneration, employeeId, authorizedTask.id)) return;
      if (isOnlineRef.current) { pendingCachedOpenRef.current = undefined; await openTask(authorizedTask.id); return; }
      if (finalAccess.status !== "offline-authorized" || !currentCache.some((entry) => entry.task.id === authorizedTask.id)) {
        updateCachedTasks(employeeId, (previous) => previous.filter((entry) => entry.id !== authorizedTask.id));
        setTask(undefined);
        setDetailState({ taskId: authorizedTask.id, status: "error" });
        setDraftHydration("failed");
        setError(fr.employeeTasks.taskUnavailableOffline);
        pendingCachedOpenRef.current = undefined;
        return;
      }
      const parsed = draft ? parseGraphiePayload(draft.payload) : { ...GRAPHIE_CALCULATION_IDENTITY, values: createNewGraphieDraftValues(), legacyContent: undefined as string | undefined };
      setActiveDraft(draft ?? undefined);
      draftRevisionRef.current = draft?.revision ?? 0;
      draftRevisionByScopeRef.current.set(`${user.id}\u0000${cached.id}`, draft?.revision ?? 0);
      setFormValues(parsed.values);
      setFormIdentity(calculationIdentityOf(parsed));
      formValuesRef.current = parsed.values;
      setDraftContent(parsed.legacyContent ?? "");
      draftContentRef.current = parsed.legacyContent ?? "";
      setLegacyContentMode(parsed.legacyContent !== undefined);
      legacyContentModeRef.current = parsed.legacyContent !== undefined;
      setDraftSaveState(draft ? "saved" : "idle");
      setDraftHydration("ready");
      setError(undefined);
      pendingCachedOpenRef.current = undefined;
    } catch (cause) {
      if (openRequestGenerationRef.current !== requestGeneration || activeIdentityRef.current !== employeeId) return;
      setDraftHydration("failed");
      const incompatible = cause instanceof GraphiePayloadCompatibilityError || cause instanceof LocalDraftPayloadCompatibilityError;
      setError(incompatible ? fr.employeeTasks.draftCompatibilityUnavailable : fr.employeeTasks.draftStorageUnavailable);
      if (incompatible) setUnreadableDraft({ employeeId, taskId: authorizedTask.id });
      await redactDraftIfAuthorizationLost(employeeId);
      pendingCachedOpenRef.current = undefined;
    }
  }

  function beginDraftDelete() {
    if (!user || !activeDraft || draftHydration !== "ready" || lockedRef.current || inConflict || submittingRef.current) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSubmitConfirmation(undefined);
    setDeleteDraftConfirmation({ employeeId: user.id, taskId: activeDraft.taskId, draftId: activeDraft.id, revision: activeDraft.revision });
  }

  function cancelDraftDelete() {
    setDeleteDraftConfirmation(undefined);
    if (draftSaveState === "saving") void saveDraft();
  }

  function confirmDraftDelete() {
    const captured = deleteDraftConfirmation;
    if (!captured || !user || user.id !== captured.employeeId || draftDeletingRef.current) return;
    const current = activeDraft;
    if (!current || current.id !== captured.draftId || current.taskId !== captured.taskId || current.revision !== captured.revision) {
      setDeleteDraftConfirmation(undefined);
      return;
    }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    draftOperationGenerationRef.current++;
    draftDeletingRef.current = true;
    setDeleteDraftConfirmation(undefined);
    const employeeId = captured.employeeId;
    const scopeKey = `${employeeId}\u0000${captured.taskId}`;
    const deletion = draftSaveQueueRef.current.then(async () => {
      await draftsRef.current.delete(employeeId, captured.taskId, captured.revision);
      if (activeDraftScopeRef.current === scopeKey) {
        resetFormToNewDraft();
        setActiveDraft(undefined);
        draftRevisionRef.current = 0;
        draftRevisionByScopeRef.current.set(scopeKey, 0);
        setDraftSaveState("idle");
        setDraftHydration("ready");
        setDraftNotice(fr.employeeTasks.draftDeleted);
      }
      await refreshLocalDrafts(employeeId);
      return true;
    }).catch(async () => {
      setError(fr.employeeTasks.draftDeleteFailed);
      await redactDraftIfAuthorizationLost(employeeId);
      return false;
    }).finally(() => { draftDeletingRef.current = false; });
    draftSaveQueueRef.current = deletion.then(() => undefined);
  }

  function beginUnreadableDraftDelete() {
    const target = unreadableDraft;
    const selected = activeScreenRef.current;
    if (!user || !target || target.employeeId !== user.id || selected.kind !== "detail" || selected.id !== target.taskId) return;
    setUnreadableDeleteConfirmation(target);
  }

  function confirmUnreadableDraftDelete() {
    const captured = unreadableDeleteConfirmation;
    setUnreadableDeleteConfirmation(undefined);
    const selected = activeScreenRef.current;
    if (!captured || !user || user.id !== captured.employeeId || draftDeletingRef.current
      || selected.kind !== "detail" || selected.id !== captured.taskId
      || unreadableDraft?.employeeId !== captured.employeeId || unreadableDraft.taskId !== captured.taskId) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    draftOperationGenerationRef.current++;
    draftDeletingRef.current = true;
    const { employeeId, taskId } = captured;
    const scopeKey = `${employeeId}\u0000${taskId}`;
    const deletion = draftSaveQueueRef.current.then(async () => {
      await draftsRef.current.deleteUnreadable(employeeId, taskId);
      if (activeDraftScopeRef.current === scopeKey) {
        draftGenerationRef.current++;
        resetFormToNewDraft();
        setActiveDraft(undefined);
        draftRevisionRef.current = 0;
        draftRevisionByScopeRef.current.set(scopeKey, 0);
        setUnreadableDraft(undefined);
        setDraftSaveState("idle");
        setDraftHydration("ready");
        setError(undefined);
        setDraftNotice(fr.employeeTasks.draftDeleted);
      }
      await refreshLocalDrafts(employeeId);
      return true;
    }).catch(async () => {
      if (activeDraftScopeRef.current === scopeKey) {
        setDraftNotice(fr.employeeTasks.draftCompatibilityUnavailable);
        setError(fr.employeeTasks.draftDeleteFailed);
      }
      await redactDraftIfAuthorizationLost(employeeId);
      return false;
    }).finally(() => { draftDeletingRef.current = false; });
    draftSaveQueueRef.current = deletion.then(() => undefined);
  }

  async function retryTaskDetail() {
    if (!detailState || detailState.status !== "error") return;
    if (!isOnline || !user) { setError(fr.auth.offlineUnavailable); return; }
    setLoading(true);
    setError(undefined);
    setTask(undefined);
    setDetailState({ ...detailState, status: "loading" });
    let authorizationError: string | undefined;
    const result = await detailRequestsRef.current.retry(detailState, async (taskId) => {
      try {
        return await runOnlyWhenOnlineAuthorized(
          () => revalidateServerAuthorization(user),
          async () => (await api.getAssignedEmployeeTask(taskId)).task,
        );
      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "ACCOUNT_DEACTIVATED") authorizationError = fr.auth.accountDeactivated;
        else if (cause instanceof ApiRequestError && cause.status === 401) authorizationError = fr.auth.reauthenticateOnline;
        else if (cause instanceof ServerWorkAuthorizationError) authorizationError = cause.authorization.status === "locked-expired" ? fr.auth.offlineExpired : fr.auth.reauthenticateOnline;
        throw cause;
      }
    });
    if (!result.current) return;
    setDetailState(result.state);
    if (result.state.status === "ready") setTask(result.task);
    else setError(authorizationError ?? fr.employeeTasks.detailError);
    setLoading(false);
  }

  async function signOut() {
    openRequestGenerationRef.current++;
    localRefreshGenerationRef.current++;
    taskListGenerationRef.current++;
    if (screen.kind === "detail" && !lockedRef.current && (draftSaveState === "saving" || draftSaveState === "failed")) {
      const saved = await saveDraft();
      if (!saved) { setError(fr.employeeTasks.saveFailed); return; }
    }
    draftGenerationRef.current++;
    detailRequestsRef.current.invalidate();
    setAuthorization({ status: "locked-logged-out", identity: user });
    activeIdentityRef.current = null;
    setUser(undefined);
    let lockPersisted = true;
    try { await authorizationRef.current.logout(user?.id); } catch { lockPersisted = false; }
    setLoading(true);
    try { await api.logout(); } catch { /* Expired sessions can still return to sign-in. */ }
    setTasks([]);
    setTask(undefined);
    setCachedTaskContext(undefined);
    setActiveDraft(undefined);
    setDraftContent("");
    clearUnreadableDraft();
    setLocalDrafts([]);
    setTaskCacheWarning(undefined);
    setError(lockPersisted ? undefined : fr.auth.offlineUnavailable);
    setEmail("");
    setPassword("");
    selectScreen({ kind: "list" });
    setLoading(false);
  }

  const detailTaskId = screen.kind === "detail" ? screen.id : undefined;
  const conflictPanel = user && detailTaskId && currentSyncState?.conflict ? <ConflictPanel
    conflict={currentSyncState.conflict}
    localDraft={activeDraft?.taskId === detailTaskId ? activeDraft : undefined}
    localUnreadable={unreadableDraft?.employeeId === user.id && unreadableDraft.taskId === detailTaskId
      || (draftHydration === "ready" && activeDraft?.taskId !== detailTaskId)}
    canFetch={() => canReadServerVersion(user.id)}
    fetchServer={(signal) => api.getEmployeeTaskAuditVersion(detailTaskId, { signal })}
    onKeepLocal={(server) => resolveConflict("keep-local", server)}
    onDiscard={(server) => resolveConflict("discard-local", server)}
  /> : null;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.container, { alignItems: "center" }]} keyboardShouldPersistTaps="handled">
        <View style={{ width: contentWidth, maxWidth: "100%", gap: 18 }}>
          <Text style={styles.brand}>CETEM-QC</Text>
        {!user ? (
          <View style={[styles.card, layout === "tablet" && styles.tabletCard]}>
            <Text style={styles.heading}>{fr.auth.employeeTitle}</Text>
            <Text style={styles.muted}>{fr.auth.employeeDescription}</Text>
            <Field label={fr.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Field label={fr.auth.password} value={password} onChangeText={setPassword} secureTextEntry />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Button title={fr.auth.signIn} onPress={() => void signIn()} disabled={loading || !email || !password} />
            <Text style={styles.muted}>{fr.auth.forgotPasswordEmployee}</Text>
          </View>
        ) : user.mustChangePassword ? (
          <View style={[styles.card, layout === "tablet" && styles.tabletCard]}>
            <Text style={styles.heading}>{fr.auth.activationTitle}</Text>
            <Text style={styles.muted}>{fr.auth.activationDescription}</Text>
            <Field label={fr.auth.currentPassword} value={password} onChangeText={setPassword} secureTextEntry />
            <Field label={fr.auth.newPassword} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Button title={fr.auth.activate} onPress={() => void activate()} disabled={loading || !password || newPassword.length < 12} />
            <Button title={fr.auth.logout} onPress={() => void signOut()} secondary disabled={loading} />
          </View>
        ) : (
          <View style={[styles.card, layout === "tablet" && styles.tabletCard]}>
            <Text style={styles.muted}>{fr.employeeTasks.connectivity}: {isOnline ? fr.employeeTasks.online : fr.employeeTasks.offline}</Text>
            {authorization.status === "offline-authorized" ? <Text accessibilityRole="summary" style={styles.muted}>{fr.auth.offlineAuthorized}</Text> : null}
            {authorization.status === "revalidating" ? (
              <View style={{ gap: 12 }}>
                <Text accessibilityRole="alert" style={styles.muted}>{fr.auth.reauthenticateOnline}</Text>
                <Field label={fr.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
                <Field label={fr.auth.password} value={password} onChangeText={setPassword} secureTextEntry />
                <Button title={fr.auth.signIn} onPress={() => void signIn()} disabled={loading || !email || !password} />
              </View>
            ) : null}
            {screen.kind === "list" ? (
              <>
                <Text style={styles.heading}>{fr.employeeTasks.title}</Text>
                <Text style={styles.muted}>{fr.employeeTasks.description}</Text>
                {listState === "loading" ? <ActivityIndicator accessibilityLabel={fr.common.loading} color="#135c4c" /> : null}
                {listState === "empty" ? <Text style={styles.muted}>{authorization.status === "offline-authorized" ? fr.employeeTasks.offlineEmpty : fr.employeeTasks.empty}</Text> : null}
                {listState === "ready" ? <View style={layout === "tablet" ? styles.tabletTaskGrid : styles.phoneTaskList}>{tasks.map((item) => (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => void openTask(item.id)} style={[styles.taskRow, layout === "tablet" && styles.tabletTaskRow]}>
                    <View style={styles.taskCopy}>
                      <Text style={styles.taskTitle}>{item.establishment}</Text>
                      <Text style={styles.muted}>{item.service} · {taskListStateLabel(taskSyncStateOf(item.id))}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))}</View> : null}
                {listState === "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                {listState === "error" ? <Button title={fr.common.retry} onPress={() => void loadTasks()} disabled={loading} /> : null}
                {draftNotice ? <Text accessibilityRole="summary" style={styles.muted}>{draftNotice}</Text> : null}
                {draftListError ? <View style={{ gap: 8 }}>
                  <Text accessibilityRole="alert" style={styles.error}>{fr.employeeTasks.draftStorageUnavailable}</Text>
                  <Button title={fr.common.retry} onPress={() => void refreshLocalDrafts()} />
                </View> : null}
                {taskCacheWarning ? <Text accessibilityRole="alert" style={styles.error}>{taskCacheWarning}</Text> : null}
                {resumableDrafts.length > 0 ? <View style={{ gap: 10 }}>
                  <Text style={styles.heading}>{fr.employeeTasks.resumeDraft}</Text>
                  {resumableDrafts.map((draft) => <Pressable key={draft.id} accessibilityRole="button" onPress={() => void openLocalDraft(draft.taskId)} style={styles.taskRow}>
                    <View style={styles.taskCopy}><Text style={styles.taskTitle}>{draft.taskId}</Text><Text style={styles.muted}>{fr.employeeTasks.savedLocally}</Text><Text style={styles.muted}>{taskListStateLabel(taskSyncStateOf(draft.taskId))}</Text></View>
                  </Pressable>)}
                </View> : null}
                {unavailableOfflineDrafts ? <Text accessibilityRole="summary" style={styles.muted}>{fr.employeeTasks.offlineDraftPreserved}</Text> : null}
                {cachedTasks.filter((item) => !localDrafts.some((draft) => draft.taskId === item.id)).map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void openCachedTask(item)} style={styles.taskRow}>
                  <View style={styles.taskCopy}><Text style={styles.taskTitle}>{item.establishment}</Text><Text style={styles.muted}>{taskListStateLabel(taskSyncStateOf(item.id))}</Text></View>
                </Pressable>)}
              </>
            ) : (
              <>
                <Button title={fr.employeeTasks.back} onPress={() => void leaveTaskDetail()} secondary />
                {loading ? <ActivityIndicator accessibilityLabel={fr.common.loading} color="#135c4c" /> : null}
                {displayedTask ? <View style={layout === "tablet" ? styles.tabletDetails : styles.phoneDetails}>
                  <Text style={styles.heading}>{displayedTask.establishment}</Text>
                  <Detail label={fr.employeeTasks.taskId} value={displayedTask.id} />
                  <Detail label={fr.employeeTasks.type} value={fr.employeeTasks.graphieMobile} />
                  <Detail label={fr.employeeTasks.establishment} value={displayedTask.establishment} />
                  <Detail label={fr.employeeTasks.service} value={displayedTask.service || "—"} />
                  <Detail label={fr.employeeTasks.state} value={lifecycleLabel(currentSyncState?.lifecycle ?? "draft")} />
                  {acceptedLine ? <Text accessibilityRole="summary" style={styles.muted}>{acceptedLine}</Text> : null}
                  <Detail label={fr.employeeTasks.createdAt} value={new Date(displayedTask.createdAt).toLocaleDateString("fr-FR")} />
                  <View style={{ width: "100%", gap: 10, paddingTop: 12 }}>
                    {taskCacheWarning ? <Text accessibilityRole="alert" style={styles.error}>{taskCacheWarning}</Text> : null}
                    {currentSyncState ? <TaskSyncStatus state={currentSyncState} running={syncRunningFor === user.id} onRetry={() => void retrySync()} /> : null}
                    {conflictPanel}
                    <Text style={styles.muted}>{fr.employeeTasks.connectivity}: {isOnline ? fr.employeeTasks.online : fr.employeeTasks.offline}</Text>
                    <Text style={styles.muted}>{fr.employeeTasks.localPersistence}: {presentedSaveState === "saving" ? fr.employeeTasks.savingLocally : presentedSaveState === "saved" ? fr.employeeTasks.savedLocally : presentedSaveState === "failed" ? fr.employeeTasks.saveFailed : fr.employeeTasks.notSavedLocally}</Text>
                    {locked ? <Text accessibilityRole="summary" style={styles.muted}>{fr.employeeTasks.readOnlyPending}</Text> : null}
                    <Text style={styles.heading}>{fr.employeeTasks.sectionNavigation}</Text>
                    <View style={styles.sectionNavigation}>{GRAPHIE_MOBILE_POV_CATALOGUE.sections.map((section) => <Pressable key={section.id} accessibilityRole="button" accessibilityState={{ selected: section.id === activeSectionId }} onPress={() => { setActiveSectionId(section.id); if (draftSaveState === "saving") void saveDraft(); }} style={styles.sectionButton}><Text style={styles.muted}>{section.labelFr}</Text></Pressable>)}</View>
                    {draftHydration === "loading" ? <Text accessibilityRole="summary" style={styles.muted}>{fr.common.loading}</Text> : null}
                    {legacyContentMode ? <Field label={fr.employeeTasks.legacyDraftContent} value={draftContent} onChangeText={changeDraftContent} editable={formEditable} multiline /> : null}
                    {GRAPHIE_MOBILE_POV_CATALOGUE.sections.filter((section) => section.id === activeSectionId).map((section) => <GraphieSectionForm key={section.id} section={section} layout={layout} values={formValues} results={calculationResults} onChange={changeFormField} editable={formEditable} />)}
                    <Text accessibilityRole={presentedSaveState === "failed" ? "alert" : "summary"} style={presentedSaveState === "failed" ? styles.error : styles.muted}>
                      {presentedSaveState === "failed" ? fr.employeeTasks.saveFailed : presentedSaveState === "saving" ? fr.employeeTasks.savingDraft : presentedSaveState === "saved" ? fr.employeeTasks.savedLocally : fr.workflow.draft}
                    </Text>
                    <Button title={fr.employeeTasks.saveDraft} onPress={() => saveDraft()} disabled={draftHydration !== "ready" || draftDeletingRef.current || locked || submitting} />
                    {activeDraft && !locked && !inConflict ? <Button title={fr.employeeTasks.deleteDraft} secondary onPress={beginDraftDelete} disabled={draftHydration !== "ready" || draftDeletingRef.current || submitting} /> : null}
                    {deleteDraftConfirmation && activeDraft?.id === deleteDraftConfirmation.draftId ? <View style={styles.confirmation}>
                      <Text accessibilityRole="alert" style={styles.muted}>{fr.employeeTasks.confirmDeleteDraft}</Text>
                      <Button title={fr.common.cancel} secondary onPress={cancelDraftDelete} />
                      <Button title={fr.common.confirm} onPress={confirmDraftDelete} />
                    </View> : null}
                    {draftHydration === "ready" && currentSyncState?.canSubmit && !draftDeletingRef.current && !deleteDraftConfirmation ? <Button title={fr.employeeTasks.submit} onPress={beginSubmit} disabled={submitting || Boolean(submitConfirmation)} /> : null}
                    {submitConfirmation && submitConfirmation.employeeId === user.id && submitConfirmation.taskId === screen.id && !locked ? <View style={styles.confirmation}>
                      <Text accessibilityRole="alert" style={styles.muted}>{fr.employeeTasks.confirmSubmit}</Text>
                      <Button title={fr.common.cancel} secondary onPress={() => setSubmitConfirmation(undefined)} />
                      <Button title={fr.common.confirm} onPress={confirmSubmit} disabled={submitting} />
                    </View> : null}
                  </View>
                </View> : null}
                {!presentedTask && activeDraft ? <View style={{ gap: 10, paddingTop: 12 }}>
                  <Text style={styles.heading}>{fr.employeeTasks.resumeDraft}</Text>
                  <Detail label={fr.employeeTasks.taskId} value={activeDraft.taskId} />
                  {draftHydration === "loading" ? <Text accessibilityRole="summary" style={styles.muted}>{fr.common.loading}</Text> : null}
                  <Detail label={fr.employeeTasks.state} value={lifecycleLabel(currentSyncState?.lifecycle ?? "draft")} />
                  {acceptedLine ? <Text accessibilityRole="summary" style={styles.muted}>{acceptedLine}</Text> : null}
                  {currentSyncState ? <TaskSyncStatus state={currentSyncState} running={syncRunningFor === user.id} onRetry={() => void retrySync()} /> : null}
                  {!displayedTask ? conflictPanel : null}
                  {locked ? <Text accessibilityRole="summary" style={styles.muted}>{fr.employeeTasks.readOnlyPending}</Text> : null}
                  {legacyContentMode ? <Field label={fr.employeeTasks.legacyDraftContent} value={draftContent} onChangeText={changeDraftContent} editable={formEditable} multiline /> : null}
                  <Text style={styles.heading}>{fr.employeeTasks.sectionNavigation}</Text>
                  <View style={styles.sectionNavigation}>{GRAPHIE_MOBILE_POV_CATALOGUE.sections.map((section) => <Pressable key={section.id} accessibilityRole="button" accessibilityState={{ selected: section.id === activeSectionId }} onPress={() => { setActiveSectionId(section.id); if (draftSaveState === "saving") void saveDraft(); }} style={styles.sectionButton}><Text style={styles.muted}>{section.labelFr}</Text></Pressable>)}</View>
                  {GRAPHIE_MOBILE_POV_CATALOGUE.sections.filter((section) => section.id === activeSectionId).map((section) => <GraphieSectionForm key={section.id} section={section} layout={layout} values={formValues} results={calculationResults} onChange={changeFormField} editable={formEditable} />)}
                  <Text accessibilityRole={presentedSaveState === "failed" ? "alert" : "summary"} style={presentedSaveState === "failed" ? styles.error : styles.muted}>
                    {presentedSaveState === "failed" ? fr.employeeTasks.saveFailed : presentedSaveState === "saving" ? fr.employeeTasks.savingDraft : fr.employeeTasks.savedLocally}
                  </Text>
                  <Button title={fr.employeeTasks.saveDraft} onPress={() => saveDraft()} disabled={draftHydration !== "ready" || draftDeletingRef.current || locked || submitting} />
                  {!locked && !inConflict ? <Button title={fr.employeeTasks.deleteDraft} secondary onPress={beginDraftDelete} disabled={draftHydration !== "ready" || draftDeletingRef.current || submitting} /> : null}
                  {deleteDraftConfirmation && activeDraft.id === deleteDraftConfirmation.draftId ? <View style={styles.confirmation}>
                    <Text accessibilityRole="alert" style={styles.muted}>{fr.employeeTasks.confirmDeleteDraft}</Text>
                    <Button title={fr.common.cancel} secondary onPress={cancelDraftDelete} />
                    <Button title={fr.common.confirm} onPress={confirmDraftDelete} />
                  </View> : null}
                </View> : null}
                {draftNotice ? <Text accessibilityRole="summary" style={styles.muted}>{draftNotice}</Text> : null}
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                {unreadableDraft && unreadableDraft.employeeId === user.id && screen.id === unreadableDraft.taskId && !inConflict ? <View style={{ gap: 10 }}>
                  <Button title={fr.employeeTasks.deleteDraft} secondary onPress={beginUnreadableDraftDelete} disabled={draftDeletingRef.current || Boolean(unreadableDeleteConfirmation)} />
                  {unreadableDeleteConfirmation && unreadableDeleteConfirmation.employeeId === user.id && unreadableDeleteConfirmation.taskId === screen.id ? <View style={styles.confirmation}>
                    <Text accessibilityRole="alert" style={styles.muted}>{fr.employeeTasks.confirmDeleteDraft}</Text>
                    <Button title={fr.common.cancel} secondary onPress={() => setUnreadableDeleteConfirmation(undefined)} />
                    <Button title={fr.common.confirm} onPress={confirmUnreadableDraftDelete} />
                  </View> : null}
                </View> : null}
                {detailState?.status === "error" ? <Button title={fr.common.retry} onPress={() => void retryTaskDetail()} disabled={loading} /> : null}
              </>
            )}
            <Button title={fr.auth.logout} onPress={() => void signOut()} secondary disabled={loading} />
          </View>
        )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; autoCapitalize?: "none" | "sentences"; keyboardType?: "email-address" | "decimal-pad"; editable?: boolean; multiline?: boolean; accessibilityLabel?: string; helpFr?: string; errorFr?: string; style?: StyleProp<ViewStyle> }) {
  const hint = [props.helpFr, props.errorFr].filter(Boolean).join(" ");
  return <View style={[styles.field, props.style]}>
    <Text style={styles.label}>{props.label}</Text>
    {props.helpFr ? <Text style={styles.help}>{props.helpFr}</Text> : null}
    <TextInput accessibilityLabel={props.accessibilityLabel ?? props.label} accessibilityHint={hint || undefined} style={[styles.input, props.multiline && { minHeight: 84, textAlignVertical: "top" }]} value={props.value} onChangeText={props.onChangeText} editable={props.editable} secureTextEntry={props.secureTextEntry} autoCapitalize={props.autoCapitalize} keyboardType={props.keyboardType} multiline={props.multiline} autoCorrect={false} />
    {props.errorFr ? <Text style={styles.error}>{props.errorFr}</Text> : null}
  </View>;
}

const calculationIdentityOf = (source: CalculationContext): CalculationContext => ({
  catalogueId: source.catalogueId,
  catalogueVersion: source.catalogueVersion,
  schemaVersion: source.schemaVersion,
  ruleId: source.ruleId,
  ruleVersion: source.ruleVersion,
});

function lifecycleLabel(lifecycle: TaskSyncState["lifecycle"]) {
  return lifecycle === "submission-pending" ? fr.employeeTasks.submissionPending
    : lifecycle === "submitted" ? fr.employeeTasks.submitted
      : lifecycle === "acceptance-blocked" ? fr.employeeTasks.acceptanceBlocked
        : lifecycle === "conflict" ? fr.employeeTasks.syncConflict : fr.employeeTasks.draft;
}

const TRANSFER_LABELS: Record<TaskSyncState["transfer"], string> = {
  "none": fr.employeeTasks.notSynchronized,
  "queued": fr.employeeTasks.syncQueued,
  "in-flight": fr.employeeTasks.syncInFlight,
  "retry-paused": fr.employeeTasks.syncFailed,
  "blocked": fr.employeeTasks.syncBlocked,
  "draft-synchronized": fr.employeeTasks.draftSynchronized,
  "draft-rejected": fr.employeeTasks.draftSyncRejected,
  "draft-conflict": fr.employeeTasks.syncConflict,
};
const FAILED_TRANSFERS: ReadonlySet<TaskSyncState["transfer"]> = new Set(["retry-paused", "blocked", "draft-rejected", "draft-conflict"]);

/** Task list rows: the lifecycle, plus the transfer state while an item is unresolved or failed. */
function taskListStateLabel(state: TaskSyncState) {
  const showTransfer = state.transfer !== "none" && state.transfer !== "draft-synchronized";
  return showTransfer ? `${lifecycleLabel(state.lifecycle)} · ${TRANSFER_LABELS[state.transfer]}` : lifecycleLabel(state.lifecycle);
}

/** The « Synchronisation » line; resolved submissions need no line because the « État » already says it all. */
function TaskSyncStatus(props: { state: TaskSyncState; running: boolean; onRetry: () => void }) {
  const { state } = props;
  if (state.lifecycle !== "draft" && state.lifecycle !== "submission-pending") return null;
  const unresolved = state.transfer === "queued" || state.transfer === "in-flight" || state.transfer === "retry-paused" || state.transfer === "blocked";
  const transfer = props.running && unresolved ? "in-flight" : state.transfer;
  const failed = FAILED_TRANSFERS.has(transfer);
  return <View style={{ gap: 10 }}>
    <Text accessibilityRole={failed ? "alert" : "summary"} style={failed ? styles.error : styles.muted}>{fr.employeeTasks.syncStatus}: {TRANSFER_LABELS[transfer]}</Text>
    {state.canRetry && !props.running ? <Button title={fr.employeeTasks.retrySync} onPress={props.onRetry} /> : null}
  </View>;
}

const fieldLabel = (field: CatalogueField) => `${field.labelFr}${field.unit ? ` (${field.unit})` : ""}`;

function CatalogueInput(props: { field: CatalogueField; value: string; onChange: (fieldId: string, value: string) => void; editable: boolean; rowLabelFr?: string; style?: StyleProp<ViewStyle> }) {
  const { field } = props;
  if (field.type === "choice") return <ChoiceField field={field} value={props.value} onSelect={(value) => props.onChange(field.id, value)} editable={props.editable} />;
  const label = fieldLabel(field);
  return <Field
    label={label}
    accessibilityLabel={props.rowLabelFr ? `${props.rowLabelFr} — ${label}` : label}
    helpFr={field.helpFr}
    errorFr={field.type === "number" && isInvalidGraphieReading(props.value) ? fr.graphieResults.invalidNumber : undefined}
    value={props.value}
    onChangeText={(value) => props.onChange(field.id, value)}
    editable={props.editable}
    keyboardType={field.type === "number" ? "decimal-pad" : undefined}
    multiline={field.type === "textarea"}
    style={props.style}
  />;
}

/** Renders one catalogue section in field order; table cells render as one labelled group per paper row. */
function GraphieSectionForm(props: { section: CatalogueSection; layout: EmployeeTaskLayout; values: GraphieFormValues; results?: GraphieCalculationResults; onChange: (fieldId: string, value: string) => void; editable: boolean }) {
  const { section } = props;
  const tableByFieldId = new Map<string, CatalogueTable>();
  for (const table of section.tables ?? []) for (const id of table.fieldIds.flat()) tableByFieldId.set(id, table);
  const renderedTables = new Set<string>();
  const items: ReactNode[] = [];
  // Read-only result blocks go below the readings, before the section's first comment field.
  const results = props.results;
  const resultBlocks = results ? (GRAPHIE_RESULT_BLOCKS_BY_SECTION[section.id] ?? []).map((name) => <GraphieTestResultBlock key={`result:${name}`} name={name} result={results[name]} layout={props.layout} />) : [];
  let resultsPlaced = false;
  for (const field of section.fields) {
    if (!resultsPlaced && field.type === "textarea") { items.push(...resultBlocks); resultsPlaced = true; }
    const table = tableByFieldId.get(field.id);
    if (!table) {
      items.push(<CatalogueInput key={field.id} field={field} value={props.values[field.id] ?? ""} onChange={props.onChange} editable={props.editable} />);
    } else if (!renderedTables.has(table.id)) {
      renderedTables.add(table.id);
      items.push(<GraphieTable key={`table:${table.id}`} table={table} fields={section.fields} layout={props.layout} values={props.values} onChange={props.onChange} editable={props.editable} />);
    }
  }
  if (!resultsPlaced) items.push(...resultBlocks);
  return <View style={{ gap: 10, paddingTop: 8 }}>
    <Text accessibilityRole="header" style={styles.heading}>{section.labelFr}</Text>
    {items}
  </View>;
}

function GraphieTable(props: { table: CatalogueTable; fields: readonly CatalogueField[]; layout: EmployeeTaskLayout; values: GraphieFormValues; onChange: (fieldId: string, value: string) => void; editable: boolean }) {
  const { table } = props;
  const fieldById = new Map(props.fields.map((field) => [field.id, field]));
  const tablet = props.layout === "tablet";
  return <View style={{ gap: 10 }}>
    {table.helpFr ? <Text style={styles.help}>{table.helpFr}</Text> : null}
    {table.fieldIds.map((row, rowIndex) => {
      const rowLabel = table.rowLabelsFr[rowIndex]!;
      return <View key={`${table.id}:${rowIndex}`} accessibilityLabel={rowLabel} style={[styles.tableRow, tablet && styles.tableRowTablet]}>
        <Text accessibilityRole="header" style={[styles.tableRowLabel, tablet && styles.tableRowLabelTablet]}>{rowLabel}</Text>
        <View style={tablet ? styles.tableCellsTablet : styles.tableCellsPhone}>
          {row.map((id) => <CatalogueInput key={id} field={fieldById.get(id)!} rowLabelFr={rowLabel} value={props.values[id] ?? ""} onChange={props.onChange} editable={props.editable} style={tablet ? styles.tableCellTablet : undefined} />)}
        </View>
      </View>;
    })}
  </View>;
}

function ChoiceField(props: { field: CatalogueField; value: string; onSelect: (value: string) => void; editable?: boolean }) {
  const label = fieldLabel(props.field);
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.choiceOptions}>
      {(props.field.options ?? []).map((option) => {
        const selected = props.value === option;
        return <Pressable key={option} accessibilityRole="button" accessibilityLabel={`${label}: ${option}${selected ? ", sélectionné" : ""}`} accessibilityState={{ selected, disabled: !props.editable }} disabled={!props.editable} onPress={() => props.onSelect(selected ? "" : option)} style={[styles.choiceOption, selected && styles.choiceOptionSelected, !props.editable && styles.disabled]}>
          <Text style={[styles.buttonText, selected && styles.choiceOptionSelectedText]}>{option}{selected ? " · sélectionné" : ""}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function Button(props: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={props.onPress} disabled={props.disabled} style={[styles.button, props.secondary && styles.secondaryButton, props.disabled && styles.disabled]}><Text style={[styles.buttonText, props.secondary && styles.secondaryButtonText]}>{props.title}</Text></Pressable>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f7f5" },
  sectionNavigation: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sectionButton: { minHeight: 48, justifyContent: "center", borderWidth: 1, borderColor: "#c7d5d0", borderRadius: 10, paddingHorizontal: 12 },
  container: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 20 },
  brand: { color: "#135c4c", fontSize: 17, fontWeight: "800", letterSpacing: 1.4 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 22, gap: 16, borderWidth: 1, borderColor: "#e1e9e4" },
  tabletCard: { padding: 28, gap: 20 },
  heading: { color: "#17352c", fontSize: 25, fontWeight: "700" },
  muted: { color: "#5b6e65", fontSize: 15, lineHeight: 22 },
  field: { gap: 7 },
  label: { color: "#3e554b", fontSize: 13, fontWeight: "700" },
  input: { minHeight: 48, borderColor: "#cbd8d0", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, color: "#17352c", fontSize: 16 },
  help: { color: "#5b6e65", fontSize: 13, lineHeight: 18, fontStyle: "italic" },
  tableRow: { gap: 10, borderWidth: 1, borderColor: "#e1e9e4", borderRadius: 12, padding: 12 },
  tableRowTablet: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  tableRowLabel: { color: "#17352c", fontSize: 16, fontWeight: "700" },
  tableRowLabelTablet: { width: 120, paddingTop: 30 },
  tableCellsPhone: { gap: 10 },
  tableCellsTablet: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tableCellTablet: { flexGrow: 1, flexBasis: 140 },
  choiceOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceOption: { flexGrow: 1, minHeight: 44, justifyContent: "center", borderColor: "#cbd8d0", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, backgroundColor: "#fff" },
  choiceOptionSelected: { borderColor: "#135c4c", backgroundColor: "#dceee8" },
  choiceOptionSelectedText: { color: "#135c4c" },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 10, backgroundColor: "#135c4c", paddingHorizontal: 16 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryButton: { backgroundColor: "#edf3ef", borderWidth: 1, borderColor: "#d5e1d9" },
  secondaryButtonText: { color: "#135c4c" },
  disabled: { opacity: 0.55 },
  error: { color: "#a32424", fontSize: 14, lineHeight: 20 },
  phoneTaskList: { gap: 12 },
  tabletTaskGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  taskRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#e1e9e4", borderRadius: 12, padding: 14 },
  tabletTaskRow: { flexGrow: 1, flexBasis: "46%" },
  taskCopy: { flex: 1, gap: 5 },
  taskTitle: { color: "#17352c", fontSize: 17, fontWeight: "700" },
  chevron: { color: "#135c4c", fontSize: 27 },
  phoneDetails: { gap: 0 },
  tabletDetails: { flexDirection: "row", flexWrap: "wrap", columnGap: 20 },
  detail: { flexGrow: 1, flexBasis: "44%", gap: 4, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: "#edf1ee" },
  detailValue: { color: "#17352c", fontSize: 16, lineHeight: 22 },
  confirmation: { gap: 10, borderWidth: 1, borderColor: "#d5e1d9", borderRadius: 12, padding: 14 },
});
