import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ApiRequestError, createApiClient } from "@cetem-qc/api-client/v1";
import type { ApiClient, EmployeeTaskListResponse, EmployeeTaskResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { getEmployeeTaskListState } from "./employee-task-list-state";
import { EmployeeTaskDetailRequests } from "./employee-task-detail-state";
import type { EmployeeTaskDetailState } from "./employee-task-detail-state";

declare const process: { env: { EXPO_PUBLIC_API_URL?: string } };

type AuthenticatedUser = { id: string; email: string; displayName: string; role: "responsable" | "employe"; mustChangePassword: boolean };
type Screen = { kind: "list" } | { kind: "detail"; id: string };

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:3001";

export default function App() {
  const clientRef = useRef<ApiClient | undefined>(undefined);
  if (!clientRef.current) {
    clientRef.current = createApiClient({
      baseUrl: apiBaseUrl,
    });
  }
  const api = clientRef.current;
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
  const listState = getEmployeeTaskListState({ loading, error: Boolean(error), taskCount: tasks.length });

  async function signIn() {
    setLoading(true);
    setError(undefined);
    try {
      const session = await api.authenticate({ email: email.trim(), password });
      if (session.user.role !== "employe") {
        await api.logout();
        setError(fr.auth.employeeOnly);
      } else {
        setUser(session.user);
        setPassword("");
        if (!session.user.mustChangePassword) await loadTasks();
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
      setUser(session.user);
      setPassword("");
      setNewPassword("");
      await loadTasks();
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : fr.auth.activationError);
    } finally {
      setLoading(false);
    }
  }

  async function loadTasks() {
    setLoading(true);
    setError(undefined);
    try {
      const response = await api.listAssignedEmployeeTasks();
      setTasks(response.tasks);
      setScreen({ kind: "list" });
      setTask(undefined);
    } catch {
      setError(fr.employeeTasks.loadError);
    } finally {
      setLoading(false);
    }
  }

  async function openTask(id: string) {
    detailRequestsRef.current.invalidate();
    setScreen({ kind: "detail", id });
    setTask(undefined);
    setDetailState({ taskId: id, status: "loading" });
    setLoading(true);
    setError(undefined);
    const result = await detailRequestsRef.current.open(id, async (taskId) => (await api.getAssignedEmployeeTask(taskId)).task);
    if (!result.current) return;
    setDetailState(result.state);
    if (result.state.status === "ready") setTask(result.task);
    else {
      setError(fr.employeeTasks.detailError);
    }
    setLoading(false);
  }

  async function retryTaskDetail() {
    if (!detailState || detailState.status !== "error") return;
    setLoading(true);
    setError(undefined);
    setTask(undefined);
    setDetailState({ ...detailState, status: "loading" });
    const result = await detailRequestsRef.current.retry(detailState, async (taskId) => (await api.getAssignedEmployeeTask(taskId)).task);
    if (!result.current) return;
    setDetailState(result.state);
    if (result.state.status === "ready") setTask(result.task);
    else setError(fr.employeeTasks.detailError);
    setLoading(false);
  }

  async function signOut() {
    detailRequestsRef.current.invalidate();
    setLoading(true);
    try { await api.logout(); } catch { /* Expired sessions can still return to sign-in. */ }
    setUser(undefined);
    setTasks([]);
    setTask(undefined);
    setError(undefined);
    setEmail("");
    setPassword("");
    setScreen({ kind: "list" });
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>CETEM-QC</Text>
        {!user ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{fr.auth.employeeTitle}</Text>
            <Text style={styles.muted}>{fr.auth.employeeDescription}</Text>
            <Field label={fr.auth.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <Field label={fr.auth.password} value={password} onChangeText={setPassword} secureTextEntry />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Button title={fr.auth.signIn} onPress={() => void signIn()} disabled={loading || !email || !password} />
          </View>
        ) : user.mustChangePassword ? (
          <View style={styles.card}>
            <Text style={styles.heading}>{fr.auth.activationTitle}</Text>
            <Text style={styles.muted}>{fr.auth.activationDescription}</Text>
            <Field label={fr.auth.currentPassword} value={password} onChangeText={setPassword} secureTextEntry />
            <Field label={fr.auth.newPassword} value={newPassword} onChangeText={setNewPassword} secureTextEntry />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Button title={fr.auth.activate} onPress={() => void activate()} disabled={loading || !password || newPassword.length < 12} />
          </View>
        ) : (
          <View style={styles.card}>
            {screen.kind === "list" ? (
              <>
                <Text style={styles.heading}>{fr.employeeTasks.title}</Text>
                <Text style={styles.muted}>{fr.employeeTasks.description}</Text>
                {listState === "loading" ? <ActivityIndicator accessibilityLabel={fr.common.loading} color="#135c4c" /> : null}
                {listState === "empty" ? <Text style={styles.muted}>{fr.employeeTasks.empty}</Text> : null}
                {listState === "ready" ? tasks.map((item) => (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => void openTask(item.id)} style={styles.taskRow}>
                    <View style={styles.taskCopy}>
                      <Text style={styles.taskTitle}>{item.establishment}</Text>
                      <Text style={styles.muted}>{item.service} · {fr.employeeTasks.draft}</Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </Pressable>
                )) : null}
                {listState === "error" ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                {listState === "error" ? <Button title={fr.common.retry} onPress={() => void loadTasks()} disabled={loading} /> : null}
              </>
            ) : (
              <>
                <Button title={fr.employeeTasks.back} onPress={() => { detailRequestsRef.current.invalidate(); setScreen({ kind: "list" }); setTask(undefined); setDetailState(undefined); setError(undefined); setLoading(false); }} secondary />
                {loading ? <ActivityIndicator accessibilityLabel={fr.common.loading} color="#135c4c" /> : null}
                {task ? <>
                  <Text style={styles.heading}>{task.establishment}</Text>
                  <Detail label={fr.employeeTasks.taskId} value={task.id} />
                  <Detail label={fr.employeeTasks.type} value={fr.employeeTasks.graphieMobile} />
                  <Detail label={fr.employeeTasks.establishment} value={task.establishment} />
                  <Detail label={fr.employeeTasks.service} value={task.service || "—"} />
                  <Detail label={fr.employeeTasks.state} value={fr.employeeTasks.draft} />
                  <Detail label={fr.employeeTasks.createdAt} value={new Date(task.createdAt).toLocaleDateString("fr-FR")} />
                </> : null}
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                {detailState?.status === "error" ? <Button title={fr.common.retry} onPress={() => void retryTaskDetail()} disabled={loading} /> : null}
              </>
            )}
            <Button title={fr.auth.logout} onPress={() => void signOut()} secondary disabled={loading} />
          </View>
        )}
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
  container: { flexGrow: 1, justifyContent: "center", padding: 20, gap: 18 },
  brand: { color: "#135c4c", fontSize: 17, fontWeight: "800", letterSpacing: 1.4 },
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 22, gap: 16, borderWidth: 1, borderColor: "#e1e9e4" },
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
  taskRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: "#e1e9e4", borderRadius: 12, padding: 14 },
  taskCopy: { flex: 1, gap: 5 },
  taskTitle: { color: "#17352c", fontSize: 17, fontWeight: "700" },
  chevron: { color: "#135c4c", fontSize: 27 },
  detail: { gap: 4, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: "#edf1ee" },
  detailValue: { color: "#17352c", fontSize: 16, lineHeight: 22 },
});
