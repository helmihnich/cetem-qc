import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import * as Network from "expo-network";
import { ApiRequestError, createApiClient } from "@cetem-qc/api-client/v1";
import type { ApiClient, EmployeeTaskListResponse, EmployeeTaskResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { getEmployeeTaskListState } from "./employee-task-list-state";
import { EmployeeTaskDetailRequests } from "./employee-task-detail-state";
import type { EmployeeTaskDetailState } from "./employee-task-detail-state";
import { getEmployeeTaskContentWidth, getEmployeeTaskPresentation } from "./employee-task-layout";
import { createOfflineAuthorizationService, offlineAuthorizationWindowFromDays } from "./offline-authorization-state";
import type { OfflineAuthorizationState } from "./offline-authorization-state";
import { expoSecureKeyValueStore } from "./offline-authorization-storage";
import { runOnlyWhenOnlineAuthorized, ServerWorkAuthorizationError } from "./server-work-authorization";

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
  const listState = getEmployeeTaskListState({ loading, error: Boolean(error), taskCount: tasks.length });
  const presentation = getEmployeeTaskPresentation({
    viewportWidth,
    screen: screen.kind,
    tasks,
    selectedTask: task,
  });
  const { layout } = presentation;
  const contentWidth = getEmployeeTaskContentWidth(viewportWidth, layout);
  const presentedTask = presentation.selectedTask;

  async function revalidateServerAuthorization(expectedUser: AuthenticatedUser): Promise<OfflineAuthorizationState> {
    try {
      const session = await api.getSession();
      if (session.user.id !== expectedUser.id || session.user.role !== "employe") {
        const state = await authorizationRef.current.logout(expectedUser.id);
        setAuthorization(state);
        setUser(undefined);
        setError(fr.auth.reauthenticateOnline);
        throw new ApiRequestError("Session identity changed.", 401, "AUTHENTICATION_FAILED");
      }
      const state = await authorizationRef.current.confirmServerAuthorization(expectedUser.id);
      setAuthorization(state);
      if (state.status.startsWith("locked-")) setUser(undefined);
      return state;
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 403 && cause.code === "ACCOUNT_DEACTIVATED") {
        const state = await authorizationRef.current.lockDeactivated(expectedUser.id);
        setAuthorization(state);
        setUser(undefined);
        setError(fr.auth.accountDeactivated);
      } else if (cause instanceof ApiRequestError && cause.status === 401) {
        const state = await authorizationRef.current.beginRevalidation(expectedUser.id);
        setAuthorization(state.status === "offline-authorized" ? { ...state, status: "revalidating" } : state);
        if (state.status !== "offline-authorized" && state.status !== "revalidating") setUser(undefined);
        setError(fr.auth.reauthenticateOnline);
      }
      throw cause;
    }
  }

  useEffect(() => {
    let active = true;
    const updateConnection = async (connected: boolean) => {
      if (!active) return;
      setIsOnline(connected);
      if (!connected) {
        try {
          const current = await authorizationRef.current.hydrate();
          const state = current.identity ? await authorizationRef.current.authorizeOffline(current.identity.id) : current;
          if (!active) return;
          setAuthorization(state);
          if (state.status === "offline-authorized" && state.identity) {
            setUser(state.identity);
            setError(undefined);
          } else {
            setUser(undefined);
            if (state.status === "locked-expired") setError(fr.auth.offlineExpired);
            else if (state.status === "locked-corrupt-or-clock-invalid") setError(fr.auth.offlineUnavailable);
          }
        } catch {
          if (active) { setAuthorization({ status: "locked-corrupt-or-clock-invalid" }); setUser(undefined); setError(fr.auth.offlineUnavailable); }
        }
        return;
      }

      if (!user) {
        try {
          const current = await authorizationRef.current.hydrate();
          const state = current.identity ? await authorizationRef.current.beginRevalidation(current.identity.id) : current;
          if (!active) return;
          if ((state.status === "offline-authorized" || state.status === "revalidating") && state.identity) {
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
          else { setUser(undefined); setError(state.status === "locked-expired" ? fr.auth.offlineExpired : fr.auth.offlineUnavailable); }
        } catch {
          if (active) { setAuthorization({ status: "locked-corrupt-or-clock-invalid" }); setUser(undefined); setError(fr.auth.offlineUnavailable); }
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
        setUser(employee);
        setPassword("");
        if (!employee.mustChangePassword) await loadTasks(employee);
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
      setUser(employee);
      setPassword("");
      setNewPassword("");
      await loadTasks(employee);
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : fr.auth.activationError);
    } finally {
      setLoading(false);
    }
  }

  async function loadTasks(authenticatedUser = user) {
    if (!isOnline || !authenticatedUser) { setError(fr.auth.offlineUnavailable); return; }
    setLoading(true);
    setError(undefined);
    try {
      const response = await runOnlyWhenOnlineAuthorized(
        () => revalidateServerAuthorization(authenticatedUser),
        () => api.listAssignedEmployeeTasks(),
      );
      setTasks(response.tasks);
      setScreen({ kind: "list" });
      setTask(undefined);
    } catch (cause) {
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
      setLoading(false);
    }
  }

  async function openTask(id: string) {
    if (!isOnline || !user) { setError(fr.auth.offlineUnavailable); return; }
    detailRequestsRef.current.invalidate();
    setScreen({ kind: "detail", id });
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
    detailRequestsRef.current.invalidate();
    setAuthorization({ status: "locked-logged-out", identity: user });
    setUser(undefined);
    let lockPersisted = true;
    try { await authorizationRef.current.logout(user?.id); } catch { lockPersisted = false; }
    setLoading(true);
    try { await api.logout(); } catch { /* Expired sessions can still return to sign-in. */ }
    setTasks([]);
    setTask(undefined);
    setError(lockPersisted ? undefined : fr.auth.offlineUnavailable);
    setEmail("");
    setPassword("");
    setScreen({ kind: "list" });
    setLoading(false);
  }

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
                      <Text style={styles.muted}>{item.service} · {fr.employeeTasks.draft}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                ))}</View> : null}
                {listState === "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                {listState === "error" ? <Button title={fr.common.retry} onPress={() => void loadTasks()} disabled={loading} /> : null}
              </>
            ) : (
              <>
                <Button title={fr.employeeTasks.back} onPress={() => { detailRequestsRef.current.invalidate(); setScreen({ kind: "list" }); setTask(undefined); setDetailState(undefined); setError(undefined); setLoading(false); }} secondary />
                {loading ? <ActivityIndicator accessibilityLabel={fr.common.loading} color="#135c4c" /> : null}
                {presentedTask ? <View style={layout === "tablet" ? styles.tabletDetails : styles.phoneDetails}>
                  <Text style={styles.heading}>{presentedTask.establishment}</Text>
                  <Detail label={fr.employeeTasks.taskId} value={presentedTask.id} />
                  <Detail label={fr.employeeTasks.type} value={fr.employeeTasks.graphieMobile} />
                  <Detail label={fr.employeeTasks.establishment} value={presentedTask.establishment} />
                  <Detail label={fr.employeeTasks.service} value={presentedTask.service || "—"} />
                  <Detail label={fr.employeeTasks.state} value={fr.employeeTasks.draft} />
                  <Detail label={fr.employeeTasks.createdAt} value={new Date(presentedTask.createdAt).toLocaleDateString("fr-FR")} />
                </View> : null}
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
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

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; secureTextEntry?: boolean; autoCapitalize?: "none" | "sentences"; keyboardType?: "email-address" }) {
  return <View style={styles.field}><Text style={styles.label}>{props.label}</Text><TextInput accessibilityLabel={props.label} style={styles.input} value={props.value} onChangeText={props.onChangeText} secureTextEntry={props.secureTextEntry} autoCapitalize={props.autoCapitalize} keyboardType={props.keyboardType} autoCorrect={false} /></View>;
}

function Button(props: { title: string; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={props.onPress} disabled={props.disabled} style={[styles.button, props.secondary && styles.secondaryButton, props.disabled && styles.disabled]}><Text style={[styles.buttonText, props.secondary && styles.secondaryButtonText]}>{props.title}</Text></Pressable>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <View style={styles.detail}><Text style={styles.label}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f7f5" },
  container: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 20 },
  brand: { color: "#135c4c", fontSize: 17, fontWeight: "800", letterSpacing: 1.4 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 22, gap: 16, borderWidth: 1, borderColor: "#e1e9e4" },
  tabletCard: { padding: 28, gap: 20 },
  heading: { color: "#17352c", fontSize: 25, fontWeight: "700" },
  muted: { color: "#5b6e65", fontSize: 15, lineHeight: 22 },
  field: { gap: 7 },
  label: { color: "#3e554b", fontSize: 13, fontWeight: "700" },
  input: { minHeight: 48, borderColor: "#cbd8d0", borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, color: "#17352c", fontSize: 16 },
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
});
