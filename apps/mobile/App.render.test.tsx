import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import test, { mock } from "node:test";
import { EMPLOYEE_CONTENT_HORIZONTAL_GUTTER } from "./employee-task-layout.js";
import { createOfflineAuthorizationService } from "./offline-authorization-state.js";
import { runOnlyWhenOnlineAuthorized } from "./server-work-authorization.js";

const runtime = globalThis as typeof globalThis & {
  __mobileTestWidth?: number;
  __mobileTestApi?: MockApi;
  __secureValues?: Map<string, string>;
  __networkListener?: (state: { isConnected?: boolean; isInternetReachable?: boolean }) => void;
  __networkOnline?: boolean;
  __sessionAvailable?: boolean;
  __sessionFailure?: { status: number; code: string };
  __testNow?: number;
  __draftRows?: Map<string, string>;
  __holdDraftWrite?: Promise<void>;
  __draftWriteStarted?: () => void;
  __holdDraftRead?: Promise<void>;
  __draftReadStarted?: () => void;
  __failDraftList?: boolean;
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("react-native", {
  namedExports: {
    ActivityIndicator: "ActivityIndicator",
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
    Pressable: "Pressable",
    SafeAreaView: "SafeAreaView",
    ScrollView: "ScrollView",
    StyleSheet: { create: (styles: unknown) => styles },
    Text: "Text",
    TextInput: "TextInput",
    useWindowDimensions: () => ({ width: runtime.__mobileTestWidth ?? 390, height: 844, scale: 1, fontScale: 1 }),
    View: "View",
  },
});
mock.module("expo-network", {
  namedExports: {
    getNetworkStateAsync: async () => ({ isConnected: runtime.__networkOnline, isInternetReachable: runtime.__networkOnline }),
    addNetworkStateListener: (listener: (state: { isConnected?: boolean; isInternetReachable?: boolean }) => void) => {
      runtime.__networkListener = listener;
      return { remove: () => { runtime.__networkListener = undefined; } };
    },
  },
});
mock.module("expo-secure-store", {
  namedExports: {
    getItemAsync: async (key: string) => runtime.__secureValues?.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { runtime.__secureValues?.set(key, value); },
    deleteItemAsync: async (key: string) => { runtime.__secureValues?.delete(key); },
  },
});
mock.module("expo-crypto", { namedExports: {
  getRandomBytesAsync: async (size: number) => new Uint8Array(size).fill(7),
  randomUUID: () => "test-draft-id",
} });
mock.module("expo-sqlite", { namedExports: {
  openDatabaseAsync: async () => {
    runtime.__draftRows ??= new Map();
    const rows = runtime.__draftRows;
    const key = (employeeId: string, taskId: string) => `${employeeId}/${taskId}`;
    const db = {
      execAsync: async () => undefined,
      getFirstAsync: async (sql: string, ...params: string[]) => {
        if (sql.includes("user_version")) return { user_version: 1 };
        if (sql.includes("sqlite_master")) return { name: "local_drafts" };
        if (sql.includes("payload_json") && runtime.__holdDraftRead) { runtime.__draftReadStarted?.(); await runtime.__holdDraftRead; }
        const row = rows.get(key(params[0]!, params[1]!));
        if (!row) return null;
        const parsed = JSON.parse(row) as { payload_json?: string; revision?: number };
        return sql.includes("payload_json") ? { payload_json: parsed.payload_json ?? row } : { revision: parsed.revision ?? (JSON.parse(parsed.payload_json ?? row) as { revision: number }).revision };
      },
      getAllAsync: async (_sql: string, employeeId: string) => {
        if (runtime.__failDraftList) throw new Error("list failed");
        return [...rows.values()].filter((raw) => (JSON.parse(raw) as { employeeId: string }).employeeId === employeeId).map((payload_json) => ({ payload_json }));
      },
      runAsync: async (sql: string, ...params: (string | number)[]) => {
        if (sql.includes("INSERT INTO local_drafts")) {
          const writeGate = runtime.__holdDraftWrite;
          if (writeGate) { runtime.__draftWriteStarted?.(); await writeGate; }
          const [employeeId, taskId, id, payloadSchemaVersion, revision, createdAt, savedAt, payloadJson] = params;
          const expectedRevision = params[8];
          const previous = rows.get(key(String(employeeId), String(taskId)));
          if (previous) {
            const currentRevision = (JSON.parse(previous) as { revision: number }).revision;
            if (currentRevision !== expectedRevision) return { changes: 0, lastInsertRowId: 0 };
          } else if (expectedRevision !== 0) return { changes: 0, lastInsertRowId: 0 };
          const record = JSON.parse(String(payloadJson));
          rows.set(key(String(employeeId), String(taskId)), JSON.stringify({ ...record, id, employeeId, taskId, payloadSchemaVersion, revision, createdAt, savedAt }));
        } else if (sql.includes("DELETE FROM local_drafts")) {
          const [employeeId, taskId, revision] = params;
          const current = rows.get(key(String(employeeId), String(taskId)));
          if (current && (JSON.parse(current) as { revision: number }).revision === revision) { rows.delete(key(String(employeeId), String(taskId))); return { changes: 1, lastInsertRowId: 1 }; }
          return { changes: 0, lastInsertRowId: 0 };
        }
        return { changes: 1, lastInsertRowId: 1 };
      },
      withExclusiveTransactionAsync: async (operation: (tx: unknown) => Promise<void>) => {
        const before = new Map(rows);
        try { await operation(db); } catch (error) { rows.clear(); for (const [id, value] of before) rows.set(id, value); throw error; }
      },
      closeAsync: async () => undefined,
    };
    return db;
  },
} });
mock.module("@cetem-qc/api-client/v1", {
  namedExports: {
    ApiRequestError: class ApiRequestError extends Error {
      constructor(message: string, readonly status = 401, readonly code = "AUTHENTICATION_FAILED") { super(message); }
    },
    createApiClient: () => runtime.__mobileTestApi,
  },
});
let App: typeof import("./App.js")["default"] | undefined;
async function loadApp() {
  App ??= (await import("./App.js")).default;
}

interface Task {
  id: string;
  establishment: string;
  service: string;
  createdAt: string;
}

interface MockApi {
  authenticate: () => Promise<{ user: { id: string; email: string; displayName: string; role: "employe"; mustChangePassword: false } }>;
  listAssignedEmployeeTasks: () => Promise<{ tasks: Task[] }>;
  getAssignedEmployeeTask: (id: string) => Promise<{ task: Task }>;
  getSession: () => Promise<{ user: { id: string; role: "employe" } }>;
  logout: () => Promise<void>;
  listCalls: number;
  sessionCalls: number;
  detailCalls: string[];
}

const firstTask: Task = {
  id: "00000000-0000-4000-8000-000000000051",
  establishment: "Centre hospitalier Nord",
  service: "Radiologie",
  createdAt: "2026-09-30T10:00:00.000Z",
};
const secondTask: Task = {
  id: "00000000-0000-4000-8000-000000000052",
  establishment: "Centre hospitalier Sud",
  service: "Urgences",
  createdAt: "2026-09-30T11:00:00.000Z",
};

function installMocks() {
  runtime.__mobileTestWidth = 390;
  runtime.__secureValues = new Map();
  runtime.__draftRows = new Map();
  runtime.__holdDraftRead = undefined;
  runtime.__holdDraftWrite = undefined;
  runtime.__draftReadStarted = undefined;
  runtime.__draftWriteStarted = undefined;
  runtime.__failDraftList = false;
  runtime.__networkOnline = true;
  runtime.__sessionAvailable = true;
  const api: MockApi = {
    authenticate: async () => ({ user: { id: "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false } }),
    listAssignedEmployeeTasks: async () => { api.listCalls++; return { tasks: [firstTask, secondTask] }; },
    getAssignedEmployeeTask: async (id) => { api.detailCalls.push(id); return { task: id === secondTask.id ? secondTask : firstTask }; },
    getSession: async () => {
      api.sessionCalls++;
      if (runtime.__sessionFailure) {
        const { ApiRequestError: MockApiRequestError } = await import("@cetem-qc/api-client/v1");
        throw new MockApiRequestError("account deactivated", runtime.__sessionFailure.status, runtime.__sessionFailure.code);
      }
      if (!runtime.__sessionAvailable) {
        const { ApiRequestError: MockApiRequestError } = await import("@cetem-qc/api-client/v1");
        throw new MockApiRequestError("session expired", 401, "AUTHENTICATION_FAILED");
      }
      return { user: { id: "employee-1", role: "employe" } };
    },
    logout: async () => { runtime.__sessionAvailable = false; },
    listCalls: 0,
    sessionCalls: 0,
    detailCalls: [],
  };
  runtime.__mobileTestApi = api;
  return api;
}

function findText(tree: ReactTestRenderer, value: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.type === "Text" && node.children.join("") === value)[0];
}

function hasStyle(node: ReactTestInstance, key: string) {
  const style = node.props.style;
  return (Array.isArray(style) ? style : [style]).some((item) => item && typeof item === "object" && key in item);
}

function findButton(tree: ReactTestRenderer, title: string): ReactTestInstance {
  const button = tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === title).length > 0)[0];
  assert.ok(button, `expected button ${title}`);
  return button;
}

async function signIn(tree: ReactTestRenderer) {
  const fields = tree.root.findAll((node) => node.type === "TextInput");
  await act(async () => { fields[0]!.props.onChangeText("employee@example.test"); });
  await act(async () => { fields[1]!.props.onChangeText("correct-password"); });
  await act(async () => {
    runtime.__sessionAvailable = true;
    findButton(tree, "Se connecter").props.onPress();
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getMainCard(tree: ReactTestRenderer) {
  return tree.root.findAll((node) => node.type === "View" && Array.isArray(node.props.style) && node.props.style.some((style: unknown) => style && typeof style === "object" && "borderRadius" in style))[0]!;
}

function findTaskRow(tree: ReactTestRenderer, establishment: string) {
  return tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === establishment).length > 0)[0]!;
}

test("phone App renders task list, opens read-only detail, retries failures and returns to list within padded width", async () => {
  await loadApp();
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);

  assert.ok(findText(tree, "Mes tâches"));
  assert.ok(findText(tree, firstTask.establishment));
  const rootStyle = tree.root.findAll((node) => node.type === "ScrollView")[0]!.props.contentContainerStyle;
  assert.equal(rootStyle[0].paddingHorizontal, 20);
  const content = tree.root.findAll((node) => node.type === "View" && node.props.style?.width === 350)[0];
  assert.ok(content, "390px viewport leaves a 350px content area after 20px gutters");
  assert.equal(content!.props.style.width + EMPLOYEE_CONTENT_HORIZONTAL_GUTTER * 2, runtime.__mobileTestWidth);

  const listGrid = tree.root.findAll((node) => node.type === "View" && hasStyle(node, "gap") && (Array.isArray(node.props.style) ? node.props.style : [node.props.style]).some((style) => style?.gap === 12))[0];
  assert.ok(listGrid, "phone task list uses its vertical gap container");
  assert.equal(getMainCard(tree).findAll((node) => node.type === "View" && hasStyle(node, "flexDirection") && (Array.isArray(node.props.style) ? node.props.style : [node.props.style]).some((style) => style?.flexDirection === "row")).length, 0);

  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, firstTask.id));
  assert.ok(findText(tree, "Brouillon"));
  assert.deepEqual(api.detailCalls, [firstTask.id]);
  assert.ok(findButton(tree, "Retour à Mes tâches"));
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  assert.ok(findText(tree, "Mes tâches"));
  await act(async () => { tree.unmount(); });
});

test("employee saves locally, remounts offline to resume, and confirms or cancels local draft deletion", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const content = tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local");
  assert.ok(content);
  await act(async () => { content!.props.onChangeText("opaque local work"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  assert.ok(findText(tree, "Enregistré localement"), "autosave acknowledges after commit");
  await act(async () => { content!.props.onChangeText("explicit save captured version"); });
  let startWrite!: () => void;
  let releaseWrite!: () => void;
  const writeStarted = new Promise<void>((resolve) => { startWrite = resolve; });
  runtime.__holdDraftWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
  runtime.__draftWriteStarted = startWrite;
  await act(async () => {
    const saving = findButton(tree, "Enregistrer").props.onPress() as Promise<boolean>;
    await writeStarted;
    content!.props.onChangeText("newer edit while save is pending");
    releaseWrite();
    assert.equal(await saving, true);
  });
  runtime.__holdDraftWrite = undefined;
  runtime.__draftWriteStarted = undefined;
  assert.ok(findText(tree, "Enregistré localement"));
  assert.equal(runtime.__draftRows?.size, 1);
  assert.match([...runtime.__draftRows!.values()][0]!, /newer edit while save is pending/);
  assert.match(runtime.__secureValues?.get("cetem-qc.local-drafts.database-key.v1") ?? "", /^[0-9a-f]{64}$/);
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Reprendre le brouillon local"));
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const resumed = tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local");
  assert.equal(resumed?.props.value, "newer edit while save is pending");
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  assert.ok(findText(tree, "Supprimer ce brouillon local ? Cette action est définitive."));
  await act(async () => { findButton(tree, "Annuler").props.onPress(); });
  assert.equal(runtime.__draftRows?.size, 1);
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows?.size, 0);
  assert.ok(findText(tree, "Brouillon local supprimé."));
  await act(async () => { tree.unmount(); });
});

test("hydration keeps an existing draft read-only until its committed revision is known", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({
    id: "committed-draft", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 7, payload: { content: "durable content" }, createdAt: 10, savedAt: 20,
  }));
  let beginRead!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { beginRead = resolve; });
  runtime.__holdDraftRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  runtime.__draftReadStarted = beginRead;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await readStarted; });
  const editor = () => tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local")!;
  assert.equal(editor().props.editable, false);
  assert.equal(editor().props.value, "");
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  await act(async () => { editor().props.onChangeText("too early"); });
  releaseRead();
  runtime.__holdDraftRead = undefined;
  runtime.__draftReadStarted = undefined;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(editor().props.editable, true);
  assert.equal(editor().props.value, "durable content");
  await act(async () => { editor().props.onChangeText("revision seven updated"); await findButton(tree, "Enregistrer").props.onPress(); });
  const committed = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { content: string } };
  assert.equal(committed.revision, 8, "the hydrated revision is used as the save base");
  assert.equal(committed.payload.content, "revision seven updated");
  await act(async () => { tree.unmount(); });
});

test("late hydration from a previous task cannot replace the newer selected draft", async () => {
  await loadApp();
  installMocks();
  for (const [taskId, id, content] of [[firstTask.id, "draft-a", "content A"], [secondTask.id, "draft-b", "content B"]]) {
    runtime.__draftRows!.set(`employee-1/${taskId}`, JSON.stringify({ id, employeeId: "employee-1", taskId, payloadSchemaVersion: 1, revision: 1, payload: { content }, createdAt: 10, savedAt: 20 }));
  }
  let beginRead!: () => void;
  let releaseRead!: () => void;
  const readStarted = new Promise<void>((resolve) => { beginRead = resolve; });
  runtime.__holdDraftRead = new Promise<void>((resolve) => { releaseRead = resolve; });
  runtime.__draftReadStarted = beginRead;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await readStarted; });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  runtime.__holdDraftRead = undefined;
  runtime.__draftReadStarted = undefined;
  await act(async () => { findButton(tree, secondTask.id).props.onPress(); for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.accessibilityLabel === "Contenu du brouillon local"), false, "the next selection stays unavailable while the earlier serialized read is pending");
  releaseRead();
  await act(async () => { for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const editor = tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local");
  assert.equal(editor?.props.value, "content B");
  await act(async () => { tree.unmount(); });
});

test("delete confirmation is cleared on navigation and cannot target the next draft", async () => {
  await loadApp();
  installMocks();
  for (const [taskId, id, content] of [[firstTask.id, "draft-a", "content A"], [secondTask.id, "draft-b", "content B"]]) {
    runtime.__draftRows!.set(`employee-1/${taskId}`, JSON.stringify({ id, employeeId: "employee-1", taskId, payloadSchemaVersion: 1, revision: 1, payload: { content }, createdAt: 10, savedAt: 20 }));
  }
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  assert.ok(findText(tree, "Supprimer ce brouillon local ? Cette action est définitive."));
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  await act(async () => { findButton(tree, secondTask.id).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findText(tree, "Supprimer ce brouillon local ? Cette action est définitive."), undefined);
  assert.ok(runtime.__draftRows!.has(`employee-1/${firstTask.id}`));
  assert.ok(runtime.__draftRows!.has(`employee-1/${secondTask.id}`));
  await act(async () => { tree.unmount(); });
});

test("confirmed delete cancels a scheduled autosave so deleted content stays deleted", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "draft-a", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "old content" }, createdAt: 10, savedAt: 20 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const editor = tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local")!;
  await act(async () => { editor.props.onChangeText("pending autosave content"); });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
  assert.equal(runtime.__draftRows!.has(`employee-1/${firstTask.id}`), false);
  await act(async () => { tree.unmount(); });
});

test("delete serializes behind an in-flight explicit save and preserves the newer revision", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "draft-a", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "old content" }, createdAt: 10, savedAt: 20 }));
  let beginWrite!: () => void;
  let releaseWrite!: () => void;
  const writeStarted = new Promise<void>((resolve) => { beginWrite = resolve; });
  runtime.__holdDraftWrite = new Promise<void>((resolve) => { releaseWrite = resolve; });
  runtime.__draftWriteStarted = beginWrite;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const editor = tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local")!;
  await act(async () => { editor.props.onChangeText("explicitly saved version"); });
  let saving!: Promise<boolean>;
  await act(async () => { saving = findButton(tree, "Enregistrer").props.onPress() as Promise<boolean>; await writeStarted; });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); });
  releaseWrite();
  runtime.__holdDraftWrite = undefined;
  runtime.__draftWriteStarted = undefined;
  await act(async () => { assert.equal(await saving, true); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const stillCommitted = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { content: string } };
  assert.equal(stillCommitted.revision, 2);
  assert.equal(stillCommitted.payload.content, "explicitly saved version");
  assert.ok(findText(tree, "Le brouillon local n’a pas pu être supprimé. Il est conservé."));
  await act(async () => { tree.unmount(); });
});

test("corrupt draft rows preserve valid resume entries and show a storage error", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "good", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "valid" }, createdAt: 10, savedAt: 20 }));
  runtime.__draftRows!.set("employee-1/corrupt", JSON.stringify({ employeeId: "employee-1", taskId: "corrupt", payloadSchemaVersion: 999 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findButton(tree, firstTask.id), "the valid draft remains available for resume");
  assert.ok(findText(tree, "Le brouillon local est indisponible. Vos données protégées sont conservées."));
  assert.ok(runtime.__draftRows!.has("employee-1/corrupt"), "the malformed encrypted record is preserved");
  await act(async () => { tree.unmount(); });
});

test("complete draft list failure renders storage error distinctly from an empty list", async () => {
  await loadApp();
  installMocks();
  runtime.__failDraftList = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findText(tree, "Le brouillon local est indisponible. Vos données protégées sont conservées."));
  assert.ok(findButton(tree, "Réessayer"), "the failed list offers an explicit retry");
  await act(async () => { tree.unmount(); });
});

test("authorization expiry during save locks the editor, redacts text and preserves the encrypted row", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ id: "draft-a", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1, payload: { content: "protected hydrated text" }, createdAt: 10, savedAt: 20 }));
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
    assert.ok(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "protected hydrated text"));
    const editor = tree.root.findAll((node) => node.type === "TextInput").find((node) => node.props.accessibilityLabel === "Contenu du brouillon local")!;
    await act(async () => { editor.props.onChangeText("new plaintext edit"); });
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { await findButton(tree, "Enregistrer").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(findText(tree, "La période d'accès hors ligne a expiré. Connectez-vous en ligne pour accéder aux données locales protégées."));
    assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "protected hydrated text" || node.props.value === "new plaintext edit"), false);
    assert.equal(JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!).payload.content, "protected hydrated text");
    await signIn(tree);
    await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
    assert.ok(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "protected hydrated text"), "a fresh grant restores authorized resume");
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("phone App keeps loading, error and retry states actionable", async () => {
  await loadApp();
  const api = installMocks();
  let rejectDetail!: (error: Error) => void;
  let attempt = 0;
  api.getAssignedEmployeeTask = (id) => {
    api.detailCalls.push(id);
    attempt++;
    if (attempt === 1) return new Promise((_resolve, reject) => { rejectDetail = reject; });
    return Promise.resolve({ task: firstTask });
  };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(tree.root.findAll((node) => node.type === "ActivityIndicator").length, 1);
  await act(async () => { rejectDetail(new Error("temporary unavailable")); });
  assert.ok(findText(tree, "Cette tâche n'a pas pu être chargée."));
  await act(async () => { findButton(tree, "Réessayer").props.onPress(); });
  assert.equal(attempt, 2);
  assert.ok(findText(tree, firstTask.id));
  await act(async () => { tree.unmount(); });
});

test("tablet App keeps the same task authorization flow while grouping the same read-only details", async () => {
  await loadApp();
  const api = installMocks();
  runtime.__mobileTestWidth = 1024;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findText(tree, "Mes tâches"));
  assert.ok(findText(tree, firstTask.establishment));
  assert.ok(tree.root.findAll((node) => node.type === "View" && hasStyle(node, "flexWrap")).length > 0);

  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, firstTask.id));
  assert.ok(findText(tree, "Brouillon"));
  assert.deepEqual(api.detailCalls, [firstTask.id]);
  const details = tree.root.findAll((node) => node.type === "View" && hasStyle(node, "columnGap"));
  assert.ok(details.length > 0, "tablet detail metadata uses grouped columns");
  const detailLabels = ["Identifiant", "Type", "Établissement", "Service", "État", "Créée le"];
  for (const label of detailLabels) assert.ok(findText(tree, label), `expected shared detail label ${label}`);
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  assert.ok(findText(tree, "Mes tâches"));
  await act(async () => { tree.unmount(); });
});

test("tablet detail failure leaves visible retry control usable", async () => {
  await loadApp();
  installMocks();
  runtime.__mobileTestWidth = 1024;
  const api = runtime.__mobileTestApi!;
  let attempt = 0;
  let resolveDetail!: (value: { task: Task }) => void;
  api.getAssignedEmployeeTask = (id) => {
    api.detailCalls.push(id);
    attempt++;
    if (attempt === 1) return new Promise((resolve) => { resolveDetail = resolve; });
    if (attempt === 2) return Promise.reject(new Error("temporary unavailable"));
    return Promise.resolve({ task: firstTask });
  };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(tree.root.findAll((node) => node.type === "ActivityIndicator").length, 1);
  await act(async () => { resolveDetail({ task: firstTask }); });
  assert.ok(findText(tree, firstTask.id));
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); });
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, "Cette tâche n'a pas pu être chargée."));
  await act(async () => { findButton(tree, "Réessayer").props.onPress(); });
  assert.equal(attempt, 3);
  assert.ok(findText(tree, firstTask.id));
  await act(async () => { tree.unmount(); });
});

test("empty assigned-task state renders on phone and tablet", async () => {
  await loadApp();
  for (const width of [390, 1024]) {
    const api = installMocks();
    runtime.__mobileTestWidth = width;
    api.listAssignedEmployeeTasks = async () => { api.listCalls++; return { tasks: [] }; };
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    assert.ok(findText(tree, "Aucune tâche ne vous est attribuée pour le moment."));
    await act(async () => { tree.unmount(); });
  }
});

test("offline restart restores the same employee's authorization and logout preserves protected payload", async () => {
  await loadApp();
  installMocks();
  const now = Date.now();
  runtime.__networkOnline = false;
  runtime.__secureValues!.set("cetem-qc.offline-authorization.v1", JSON.stringify({
    schemaVersion: 1,
    status: "grant",
    identity: { id: "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false },
    authenticatedAt: now - 60_000,
    lastTrustedTime: now - 60_000,
    policyWindowMs: 7 * 24 * 60 * 60 * 1000,
  }));
  runtime.__secureValues!.set("cetem-qc.protected-payload.v1.employee-1", "opaque-protected-evidence");

  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Accès hors ligne autorisé. Les données locales protégées restent disponibles pendant la période prévue."));
  assert.ok(findText(tree, "Aucune tâche synchronisée n'est disponible hors ligne. Les données locales protégées ne sont pas supprimées."));
  assert.equal(runtime.__mobileTestApi!.listCalls, 0, "offline hydration does not call protected task endpoints");

  const sessionCallsBeforeReconnect = runtime.__mobileTestApi!.sessionCalls;
  runtime.__networkOnline = true;
  await act(async () => {
    runtime.__networkListener?.({ isConnected: true, isInternetReachable: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.ok(runtime.__mobileTestApi!.sessionCalls > sessionCallsBeforeReconnect, "reconnect revalidates the current server session");
  assert.equal(findText(tree, "Accès hors ligne autorisé. Les données locales protégées restent disponibles pendant la période prévue."), undefined);

  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); });
  assert.ok(findText(tree, "Connexion Employé"));
  assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "opaque-protected-evidence");
  await act(async () => { tree.unmount(); });
});

test("App sign-in grant survives remount with no server session and protects server-work boundary", async () => {
  await loadApp();
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);

  const grantKey = "cetem-qc.offline-authorization.v1";
  const persistedGrant = JSON.parse(runtime.__secureValues!.get(grantKey) ?? "null") as { status?: string; identity?: { id?: string } } | null;
  assert.equal(persistedGrant?.status, "grant", "successful App sign-in persists authorization through SecureStore");
  assert.equal(persistedGrant?.identity?.id, "employee-1");

  const { expoSecureKeyValueStore } = await import("./offline-authorization-storage.js");
  const localStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
  await localStore.writeProtectedPayload("employee-1", "evidence-created-through-the-App-grant");
  const listCallsBeforeRestart = api.listCalls;
  runtime.__sessionAvailable = false;
  runtime.__networkOnline = true;
  await act(async () => { tree.unmount(); });
  await act(async () => {
    tree = create(<App />);
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.ok(findText(tree, "Une connexion en ligne est nécessaire pour vérifier votre compte. Connectez-vous pour continuer."));
  assert.equal(await localStore.readProtectedPayload("employee-1"), "evidence-created-through-the-App-grant");
  assert.equal(api.listCalls, listCallsBeforeRestart, "remount without a server session does not refetch protected server work");

  let serverTaskCalls = 0;
  await assert.rejects(runOnlyWhenOnlineAuthorized(async () => {
    try {
      await api.getSession();
      return await localStore.confirmServerAuthorization("employee-1");
    } catch {
      return localStore.beginRevalidation("employee-1");
    }
  }, async () => { serverTaskCalls++; return "unexpected"; }));
  assert.equal(serverTaskCalls, 0);
  await act(async () => { tree.unmount(); });
});

test("App locks and preserves protected work when reconnect revalidation reports account deactivation", async () => {
  await loadApp();
  const api = installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);

  const { expoSecureKeyValueStore } = await import("./offline-authorization-storage.js");
  const localStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
  await localStore.writeProtectedPayload("employee-1", "preserved-deactivated-evidence");
  assert.equal(await localStore.readProtectedPayload("employee-1"), "preserved-deactivated-evidence");
  assert.equal(api.listCalls, 1, "sign-in made one authorized list request before deactivation was reported");

  runtime.__sessionFailure = { status: 403, code: "ACCOUNT_DEACTIVATED" };
  const callsBeforeRevalidation = api.listCalls;
  const sessionCallsBeforeRevalidation = api.sessionCalls;
  assert.ok(runtime.__networkListener, "the rendered App is subscribed to connectivity changes");
  await act(async () => {
    runtime.__networkListener?.({ isConnected: true, isInternetReachable: true });
    for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

  assert.ok(api.sessionCalls > sessionCallsBeforeRevalidation, "reconnect revalidates through the App session call");
  assert.equal(api.listCalls, callsBeforeRevalidation, "no protected follow-up task request runs after deactivation is known");
  assert.equal(api.detailCalls.length, 0);
  assert.ok(findText(tree, "Votre compte a été désactivé. Les données locales protégées sont conservées et restent verrouillées."));
  assert.ok(findText(tree, "Connexion Employé"), "the App clears the active employee screen and returns to sign-in");
  assert.equal(findText(tree, "Mes tâches"), undefined, "the authorized task screen is no longer accessible through the App UI");
  assert.equal(await localStore.readProtectedPayload("employee-1"), null, "the real authorization service denies payload access after deactivation");
  assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "preserved-deactivated-evidence");
  const persistedLock = JSON.parse(runtime.__secureValues!.get("cetem-qc.offline-authorization.v1") ?? "null") as { status?: string } | null;
  assert.equal(persistedLock?.status, "locked-deactivated", "the deactivated lock is persisted through SecureStore");

  runtime.__networkOnline = false;
  await act(async () => { tree.unmount(); });
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Connexion Employé"), "remount does not restore the deactivated employee session");
  assert.equal(findText(tree, "Mes tâches"), undefined);
  const restartedStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
  assert.equal((await restartedStore.hydrate()).status, "locked-deactivated", "a fresh service instance restores the persisted deactivation lock");
  assert.equal(await restartedStore.readProtectedPayload("employee-1"), null);
  assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "preserved-deactivated-evidence");
  assert.equal(api.listCalls, callsBeforeRevalidation, "remount after known deactivation issues no protected server request");
  await act(async () => { tree.unmount(); });
  delete runtime.__sessionFailure;
});

test("App sign-in grant expires after remount while its protected payload remains stored", async () => {
  await loadApp();
  const api = installMocks();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    const { expoSecureKeyValueStore } = await import("./offline-authorization-storage.js");
    const localStore = createOfflineAuthorizationService(expoSecureKeyValueStore, { now: () => Date.now() });
    await localStore.writeProtectedPayload("employee-1", "expires-but-is-preserved");
    runtime.__networkOnline = false;
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { tree.unmount(); });
    await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(findText(tree, "La période d'accès hors ligne a expiré. Connectez-vous en ligne pour accéder aux données locales protégées."));
    assert.equal(await localStore.readProtectedPayload("employee-1"), null);
    assert.equal(runtime.__secureValues!.get("cetem-qc.protected-payload.v1.employee-1"), "expires-but-is-preserved");
    assert.equal(api.listCalls, 1, "the restart did not issue a protected server request");
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("expired local grant blocks task fetch even when the server session remains valid", async () => {
  await loadApp();
  const api = installMocks();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    assert.equal(api.listCalls, 1);
    const sessionCallsBefore = api.sessionCalls;
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => {
      findTaskRow(tree, firstTask.establishment).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(api.sessionCalls > sessionCallsBefore, "the still-valid server session was revalidated");
    assert.deepEqual(api.detailCalls, [], "locked local authorization stops before the protected task endpoint");
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});
