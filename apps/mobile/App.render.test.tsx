import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import test, { mock } from "node:test";
import { EMPLOYEE_CONTENT_HORIZONTAL_GUTTER } from "./employee-task-layout.js";
import { createOfflineAuthorizationService } from "./offline-authorization-state.js";
import { runOnlyWhenOnlineAuthorized } from "./server-work-authorization.js";
import { GRAPHIE_MOBILE_POV_CATALOGUE, createNewGraphieDraftValues } from "./graphie-pov-catalogue.js";
import { fr } from "@cetem-qc/i18n";

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
  __cachedTaskRows?: Map<string, string>;
  __employeeId?: string;
  __holdDraftWrite?: Promise<void>;
  __draftWriteStarted?: () => void;
  __holdDraftRead?: Promise<void>;
  __draftReadStarted?: () => void;
  __holdDraftReadByTask?: Map<string, Promise<void>>;
  __draftReadStartedByTask?: Map<string, () => void>;
  __holdTaskListByEmployee?: Map<string, Promise<void>>;
  __taskListStartedByEmployee?: Map<string, () => void>;
  __holdTaskDetailById?: Map<string, Promise<void>>;
  __taskDetailStartedById?: Map<string, () => void>;
  __cacheWriteFailure?: boolean;
  __revokedTaskIds?: Set<string>;
  __failTaskDetailById?: Set<string>;
  __assignedTasksByEmployee?: Map<string, Task[]>;
  __failTaskListForEmployee?: Set<string>;
  __failDraftList?: boolean;
  __failDraftDelete?: boolean;
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
        if (sql.includes("user_version")) return { user_version: 2 };
        if (sql.includes("sqlite_master")) return { name: sql.includes("synchronized_tasks") ? "synchronized_tasks" : "local_drafts" };
        if (sql.includes("payload_json")) {
          const taskId = String(params[1] ?? "");
          const taskGate = runtime.__holdDraftReadByTask?.get(taskId);
          if (taskGate) { runtime.__draftReadStartedByTask?.get(taskId)?.(); await taskGate; }
          if (runtime.__holdDraftRead) { runtime.__draftReadStarted?.(); await runtime.__holdDraftRead; }
        }
        const row = rows.get(key(params[0]!, params[1]!));
        if (!row) return null;
        const parsed = JSON.parse(row) as { payload_json?: string; revision?: number };
        return sql.includes("payload_json") ? { payload_json: parsed.payload_json ?? row } : { revision: parsed.revision ?? (JSON.parse(parsed.payload_json ?? row) as { revision: number }).revision };
      },
      getAllAsync: async (sql: string, employeeId: string) => {
        if (runtime.__failDraftList) throw new Error("list failed");
        if (sql.includes("synchronized_tasks")) return [...(runtime.__cachedTaskRows ?? new Map()).entries()]
          .filter(([key]) => key.startsWith(`${employeeId}/`))
          .map(([, raw]) => raw)
          .map((raw) => JSON.parse(raw) as { task_json: string; synchronized_at: number })
          .map((row) => ({ task_json: row.task_json, synchronized_at: row.synchronized_at }));
        return [...rows.values()].filter((raw) => (JSON.parse(raw) as { employeeId: string }).employeeId === employeeId).map((payload_json) => ({ payload_json }));
      },
      runAsync: async (sql: string, ...params: (string | number)[]) => {
        if (sql.includes("DELETE FROM synchronized_tasks")) {
          const [employeeId, taskId] = params.map(String);
          for (const key of runtime.__cachedTaskRows?.keys() ?? []) {
            if (key.startsWith(`${employeeId}/`) && (!taskId || key === `${employeeId}/${taskId}`)) runtime.__cachedTaskRows?.delete(key);
          }
        } else if (sql.includes("INSERT INTO synchronized_tasks")) {
          if (runtime.__cacheWriteFailure) throw new Error("cache write failed");
          runtime.__cachedTaskRows ??= new Map();
          const [employeeId, taskId, taskJson, synchronizedAt] = params;
          runtime.__cachedTaskRows.set(`${employeeId}/${taskId}`, JSON.stringify({ task_json: taskJson, synchronized_at: synchronizedAt }));
        } else if (sql.includes("INSERT INTO local_drafts")) {
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
          if (runtime.__failDraftDelete) throw new Error("delete failed");
          const [employeeId, taskId, revision] = params;
          const current = rows.get(key(String(employeeId), String(taskId)));
          // Without a revision parameter the statement is the unconditional unreadable-draft delete.
          const matches = current !== undefined && (!sql.includes("revision") || (JSON.parse(current) as { revision: number }).revision === revision);
          if (matches) { rows.delete(key(String(employeeId), String(taskId))); return { changes: 1, lastInsertRowId: 1 }; }
          return { changes: 0, lastInsertRowId: 0 };
        }
        return { changes: 1, lastInsertRowId: 1 };
      },
      withExclusiveTransactionAsync: async (operation: (tx: unknown) => Promise<void>) => {
        const before = new Map(rows);
        const cacheBefore = new Map(runtime.__cachedTaskRows);
        try { await operation(db); } catch (error) {
          rows.clear(); for (const [id, value] of before) rows.set(id, value);
          runtime.__cachedTaskRows = new Map(cacheBefore);
          throw error;
        }
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
const thirdTask: Task = {
  id: "00000000-0000-4000-8000-000000000053",
  establishment: "Centre hospitalier Est",
  service: "Imagerie",
  createdAt: "2026-09-30T12:00:00.000Z",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function installMocks() {
  runtime.__mobileTestWidth = 390;
  runtime.__secureValues = new Map();
  runtime.__draftRows = new Map();
  runtime.__cachedTaskRows = new Map();
  runtime.__employeeId = "employee-1";
  runtime.__holdDraftRead = undefined;
  runtime.__holdDraftWrite = undefined;
  runtime.__holdDraftReadByTask = new Map();
  runtime.__draftReadStartedByTask = new Map();
  runtime.__holdTaskListByEmployee = new Map();
  runtime.__taskListStartedByEmployee = new Map();
  runtime.__holdTaskDetailById = new Map();
  runtime.__taskDetailStartedById = new Map();
  runtime.__cacheWriteFailure = false;
  runtime.__revokedTaskIds = new Set();
  runtime.__failTaskDetailById = new Set();
  runtime.__assignedTasksByEmployee = new Map();
  runtime.__failTaskListForEmployee = new Set();
  runtime.__draftReadStarted = undefined;
  runtime.__draftWriteStarted = undefined;
  runtime.__failDraftList = false;
  runtime.__failDraftDelete = false;
  runtime.__networkOnline = true;
  runtime.__sessionAvailable = true;
  const api: MockApi = {
    authenticate: async () => ({ user: { id: runtime.__employeeId ?? "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false } }),
    listAssignedEmployeeTasks: async () => {
      api.listCalls++;
      const employeeId = runtime.__employeeId ?? "employee-1";
      const gate = runtime.__holdTaskListByEmployee?.get(employeeId);
      if (gate) { runtime.__taskListStartedByEmployee?.get(employeeId)?.(); await gate; }
      if (runtime.__failTaskListForEmployee?.has(employeeId)) throw new Error("task list unavailable");
      return { tasks: runtime.__assignedTasksByEmployee?.get(employeeId) ?? (employeeId === "employee-2" ? [thirdTask] : [firstTask, secondTask]) };
    },
    getAssignedEmployeeTask: async (id) => {
      api.detailCalls.push(id);
      const employeeId = runtime.__employeeId ?? "employee-1";
      const assignedAtRequest = !runtime.__revokedTaskIds?.has(id) && (employeeId !== "employee-2" || id === thirdTask.id);
      const gate = runtime.__holdTaskDetailById?.get(id);
      if (gate) { runtime.__taskDetailStartedById?.get(id)?.(); await gate; }
      if (runtime.__failTaskDetailById?.has(id)) throw new Error("task detail unavailable");
      if (!assignedAtRequest) {
        const { ApiRequestError: MockApiRequestError } = await import("@cetem-qc/api-client/v1");
        throw new MockApiRequestError("task assignment revoked", 403, "TASK_NOT_ASSIGNED");
      }
      return { task: id === secondTask.id ? secondTask : id === thirdTask.id ? thirdTask : firstTask };
    },
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
      return { user: { id: runtime.__employeeId ?? "employee-1", role: "employe" } };
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

async function waitForButton(tree: ReactTestRenderer, title: string) {
  for (let tick = 0; tick < 20; tick++) {
    const button = tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === title).length > 0)[0];
    if (button) return button;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return findButton(tree, title);
}

function findInput(tree: ReactTestRenderer, label: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.type === "TextInput" && node.props.accessibilityLabel === label)[0];
}

function findChoice(tree: ReactTestRenderer, accessibleLabel: string): ReactTestInstance | undefined {
  return tree.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityLabel === accessibleLabel)[0];
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

test("legacy notes and structured context survive save and restart independently; choice options are selectable", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, JSON.stringify({
    id: "legacy-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 1, createdAt: 10, savedAt: 20,
    payload: { content: "old legacy notes" },
  }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const legacy = findInput(tree, "Contenu conservé du brouillon précédent");
  const context = findInput(tree, "N° rapport");
  assert.equal(legacy?.props.value, "old legacy notes");
  assert.equal(context?.props.value, "");
  const choiceField = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!.fields[0]!;
  await act(async () => { findButton(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!.labelFr).props.onPress(); });
  const optionButtons = tree.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith(`${choiceField.labelFr}: `));
  assert.deepEqual(optionButtons.map((node) => node.props.accessibilityLabel), choiceField.options!.map((option) => `${choiceField.labelFr}: ${option}`));
  assert.equal(findInput(tree, choiceField.labelFr), undefined, "choice fields do not expose arbitrary text input");
  const selectedOption = choiceField.options![1]!;
  const selectedButton = findChoice(tree, `${choiceField.labelFr}: ${selectedOption}`)!;
  await act(async () => { selectedButton.props.onPress(); });
  const selectedAfterTap = findChoice(tree, `${choiceField.labelFr}: ${selectedOption}, sélectionné`)!;
  assert.equal(selectedAfterTap.props.accessibilityState.selected, true);
  assert.ok(selectedAfterTap.findAll((node) => node.type === "Text" && node.children.join("").includes("sélectionné")).length > 0);
  await act(async () => { findButton(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.labelFr).props.onPress(); });
  const resumedLegacy = tree.root.findAll((node) => node.type === "TextInput" && String(node.props.accessibilityLabel ?? "").startsWith("Contenu conserv"))[0]!;
  const resumedContext = findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr)!;
  await act(async () => { resumedLegacy.props.onChangeText("edited legacy notes"); resumedContext.props.onChangeText("current structured context"); });
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { catalogueId: string; catalogueVersion: string; schemaVersion: number; ruleId: string; ruleVersion: string; values: Record<string, string>; legacyContent?: string } };
  assert.deepEqual(
    { catalogueId: saved.payload.catalogueId, catalogueVersion: saved.payload.catalogueVersion, schemaVersion: saved.payload.schemaVersion, ruleId: saved.payload.ruleId, ruleVersion: saved.payload.ruleVersion },
    { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0" },
  );
  assert.equal(saved.payload.legacyContent, "edited legacy notes");
  assert.equal(saved.payload.values["header.reportNumber"], "current structured context");
  assert.equal(saved.payload.values[choiceField.id], selectedOption);
  await act(async () => { tree.unmount(); });

  runtime.__secureValues = new Map();
  runtime.__draftRows = new Map([[key, JSON.stringify(JSON.parse(runtime.__draftRows!.get(key)!))]]);
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "edited legacy notes");
  assert.equal(findInput(tree, "N° rapport")?.props.value, "current structured context");
  await act(async () => { findButton(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!.labelFr).props.onPress(); });
  assert.equal(findChoice(tree, `${choiceField.labelFr}: ${selectedOption}, sélectionné`)?.props.accessibilityState.selected, true);
  await act(async () => { tree.unmount(); });
});

test("malformed saved form metadata shows compatibility state and retains stored bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const encryptedRow = JSON.stringify({
    id: "future-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 2, createdAt: 10, savedAt: 20,
    payload: { content: "do not reinterpret malformed metadata", catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: {} },
  });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__draftRows!.set(key, encryptedRow);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, "Ce brouillon utilise une version de formulaire non prise en charge. Il est conservé sans modification."));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => String(node.props.value ?? "").includes("do not reinterpret")), false);
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  assert.equal(runtime.__draftRows.get(key), encryptedRow);
  await act(async () => { tree.unmount(); });
});

test("employee saves locally, remounts offline to resume, and confirms or cancels local draft deletion", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const content = findInput(tree, "N° rapport");
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
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const resumed = findInput(tree, "N° rapport");
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

test("continues an online-cached task across sections offline and resumes it without server calls", async () => {
  await loadApp();
  installMocks();
  const api = runtime.__mobileTestApi!;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.equal(runtime.__cachedTaskRows!.size, 2, "the successful online task-list response is cached locally");
  const callsBeforeOffline = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const callsAfterOfflineStartup = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, firstTask.id));
  assert.ok(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes("Hors ligne")).length > 0);
  const context = findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr)!;
  await act(async () => { context.props.onChangeText("offline continuation"); });
  const qualitative = GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === "visual")!;
  await act(async () => { findButton(tree, qualitative.labelFr).props.onPress(); });
  const choice = qualitative.fields.find((field) => field.type === "choice")!;
  const option = choice.options![0]!;
  await act(async () => { findChoice(tree, `${choice.labelFr}: ${option}`)!.props.onPress(); });
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  assert.equal(api.listCalls, callsAfterOfflineStartup.list, "offline task navigation does not reload the task list");
  assert.deepEqual(api.detailCalls, callsAfterOfflineStartup.details, "offline task navigation does not call task detail");
  assert.equal(runtime.__draftRows!.size, 1);
  await act(async () => { tree.unmount(); });

  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findInput(tree, GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr)?.props.value, "offline continuation");
  await act(async () => { findButton(tree, qualitative.labelFr).props.onPress(); });
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityState?.selected === true && String(node.props.accessibilityLabel ?? "").startsWith(`${choice.labelFr}: ${option}`)).length, 1);
  assert.deepEqual(api.detailCalls, callsAfterOfflineStartup.details, "offline cached task navigation makes no task-detail requests");
  await act(async () => { tree.unmount(); });
});

test("offline timer autosave commits locally without API calls and survives restart", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  const api = runtime.__mobileTestApi!;
  const callsBeforeOffline = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const callsAfterOfflineStartup = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const field = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((item) => item.id === "header.reportNumber")!;
  await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("timer saved offline"); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
  const key = `employee-1/${firstTask.id}`;
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values[field.id], "timer saved offline");
  assert.ok(findText(tree, fr.employeeTasks.savedLocally), "local acknowledgement follows the durable autosave");
  assert.deepEqual({ list: api.listCalls, session: api.sessionCalls, details: api.detailCalls }, callsBeforeOffline);
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = true;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findInput(tree, field.labelFr)?.props.value, "timer saved offline");
  assert.deepEqual(api.detailCalls, [firstTask.id], "only online draft resume revalidates task assignment");
  await act(async () => { tree.unmount(); });
  runtime.__networkOnline = false;
});

test("offline timer autosave still locks and preserves protected data after authorization expiry", async () => {
  await loadApp();
  const actualNow = Date.now;
  runtime.__testNow = actualNow();
  Date.now = () => runtime.__testNow!;
  try {
    installMocks();
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    const api = runtime.__mobileTestApi!;
    const callsBeforeOffline = { list: api.listCalls, session: api.sessionCalls, details: [...api.detailCalls] };
    await act(async () => { tree.unmount(); });
    runtime.__networkOnline = false;
    await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
    const field = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((item) => item.id === "header.reportNumber")!;
    await act(async () => { findInput(tree, field.labelFr)!.props.onChangeText("must not autosave after expiry"); });
    runtime.__testNow += 8 * 24 * 60 * 60 * 1000;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    assert.equal(runtime.__draftRows!.has(`employee-1/${firstTask.id}`), false, "expired authorization prevents the timer write");
    assert.ok(findText(tree, "Connexion Employé"), "authorization loss redacts the editor");
    assert.deepEqual({ list: api.listCalls, session: api.sessionCalls, details: api.detailCalls }, callsBeforeOffline);
    await act(async () => { tree.unmount(); });
  } finally {
    Date.now = actualNow;
    delete runtime.__testNow;
  }
});

test("online resume rechecks the cached task assignment before hydrating the draft", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "online-draft", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1,
    payload: { content: "authorized cached draft" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id], "online draft resume revalidates through task detail");
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "authorized cached draft");
  await act(async () => { tree.unmount(); });
});

test("revoked online task assignment hides the cached form and preserves the encrypted draft", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "revoked-draft", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1,
    payload: { content: "protected revoked draft" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  runtime.__assignedTasksByEmployee!.set("employee-1", [firstTask]);
  runtime.__revokedTaskIds!.add(firstTask.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id]);
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent"), undefined, "form content is not hydrated before online authorization");
  assert.ok(findText(tree, fr.employeeTasks.taskNoLongerAssigned));
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), original, "denial does not delete or rewrite protected local data");
  await act(async () => { tree.unmount(); });
});

test("online TASK_NOT_ASSIGNED revokes cached context, preserves the draft, and denies a later offline open", async () => {
  await loadApp();
  installMocks();
  const originalDraft = JSON.stringify({
    id: "revoked-online-resume", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 4, payload: { content: "preserve these measurements" }, createdAt: 10, savedAt: 40,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, originalDraft);
  runtime.__revokedTaskIds!.add(firstTask.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`));

  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id]);
  assert.equal(findInput(tree, fr.employeeTasks.legacyDraftContent), undefined, "denied content is not hydrated");
  assert.ok(findText(tree, fr.employeeTasks.taskNoLongerAssigned));
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "only the denied task context is revoked");
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft, "revocation leaves the complete Story 5.3 record unchanged");

  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === firstTask.id).length > 0).length, 0, "revoked draft is not resumable offline");
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === firstTask.establishment).length > 0).length, 0, "revoked task is absent from the offline task list");
  assert.ok(findText(tree, fr.employeeTasks.offlineDraftPreserved));
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id], "denied offline work issues no second detail request");
  await act(async () => { tree.unmount(); });
});

test("generic online task-detail failure retains cached authorization and draft for offline use", async () => {
  await loadApp();
  installMocks();
  const originalDraft = JSON.stringify({
    id: "transient-resume", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 2, payload: { content: "transient failure preserves this" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, originalDraft);
  runtime.__failTaskDetailById!.add(firstTask.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, fr.employeeTasks.detailError));
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "unknown failure does not revoke cached context");
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);

  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findInput(tree, fr.employeeTasks.legacyDraftContent), "valid offline access still resumes after a transient error");
  assert.equal(runtime.__cachedTaskRows!.get(`employee-1/${firstTask.id}`) !== undefined, true);
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);
  await act(async () => { tree.unmount(); });
});

test("stale TASK_NOT_ASSIGNED response revokes only its originating task after an account switch", async () => {
  await loadApp();
  installMocks();
  const employeeTwoDraft = JSON.stringify({
    id: "employee-two-draft", employeeId: "employee-2", taskId: thirdTask.id,
    payloadSchemaVersion: 1, revision: 1, payload: { content: "employee two evidence" }, createdAt: 10, savedAt: 20,
  });
  const employeeOneDraft = JSON.stringify({
    id: "employee-one-pending-revocation", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 1, payload: { content: "employee one evidence" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, employeeOneDraft);
  runtime.__draftRows!.set(`employee-2/${thirdTask.id}`, employeeTwoDraft);
  runtime.__assignedTasksByEmployee!.set("employee-1", [firstTask, secondTask]);
  runtime.__assignedTasksByEmployee!.set("employee-2", [thirdTask]);
  runtime.__revokedTaskIds!.add(firstTask.id);
  const detailGate = deferred();
  let detailStarted!: () => void;
  const detailStartedPromise = new Promise<void>((resolve) => { detailStarted = resolve; });
  runtime.__holdTaskDetailById!.set(firstTask.id, detailGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, detailStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await detailStartedPromise; });

  await act(async () => { findButton(tree, fr.employeeTasks.back).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, fr.auth.logout).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__employeeId = "employee-2";
  await signIn(tree);
  assert.ok(findText(tree, thirdTask.establishment), "employee two is the current screen before the stale response returns");
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { detailGate.resolve(); for (let tick = 0; tick < 12; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.ok(findText(tree, thirdTask.establishment), "the stale response does not replace the current employee's screen");
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "the authoritative denial revokes only its originating task");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${secondTask.id}`), "another task for the first employee remains unchanged");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-2/${thirdTask.id}`), "the current employee's cache is untouched");
  assert.equal(runtime.__draftRows!.get(`employee-2/${thirdTask.id}`), employeeTwoDraft, "another employee's draft remains unchanged");
  assert.ok(!findText(tree, firstTask.establishment));
  await act(async () => { tree.unmount(); });
});

test("offline cached open revalidates a reconnect race and withholds a revoked draft", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "reconnect-revoked", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 2,
    payload: { content: "must remain protected" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const gate = deferred();
  let readStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, gate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, readStarted);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await readStartedPromise; });
  runtime.__revokedTaskIds!.add(firstTask.id);
  runtime.__networkOnline = true;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  await act(async () => { gate.resolve(); for (let tick = 0; tick < 15; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id], "reconnect routes the pending open through current task authorization");
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent"), undefined);
  assert.equal(findText(tree, "must remain protected"), undefined);
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), original, "denial preserves the encrypted local draft");
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "revoked authorization removes only the task context");
  assert.ok(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes(fr.employeeTasks.taskNoLongerAssigned)).length > 0, JSON.stringify(tree.root.findAll((node) => node.type === "Text").map((node) => node.children.join(""))));
  await act(async () => { tree.unmount(); });
});

test("offline cached open may hydrate after reconnect only when current task authorization succeeds", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "reconnect-authorized", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 2,
    payload: { content: "authorized after reconnect" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const gate = deferred();
  let readStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, gate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, readStarted);
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await readStartedPromise; });
  runtime.__networkOnline = true;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  await act(async () => { gate.resolve(); for (let tick = 0; tick < 15; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id]);
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "authorized after reconnect");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "authorized task context remains available");
  await act(async () => { tree.unmount(); });
});

test("navigation to another task wins while reconnect authorization is pending", async () => {
  await loadApp();
  installMocks();
  const original = JSON.stringify({
    id: "stale-reconnect", employeeId: "employee-1", taskId: firstTask.id, payloadSchemaVersion: 1, revision: 1,
    payload: { content: "stale reconnect content" }, createdAt: 10, savedAt: 20,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, original);
  const readGate = deferred();
  const detailGate = deferred();
  let readStarted!: () => void;
  let detailStarted!: () => void;
  const readStartedPromise = new Promise<void>((resolve) => { readStarted = resolve; });
  const detailStartedPromise = new Promise<void>((resolve) => { detailStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, readGate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, readStarted);
  runtime.__holdTaskDetailById!.set(firstTask.id, detailGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, detailStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); await readStartedPromise; });
  runtime.__networkOnline = true;
  await act(async () => { runtime.__networkListener?.({ isConnected: true, isInternetReachable: true }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  await act(async () => { readGate.resolve(); await detailStartedPromise; });
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findTaskRow(tree, secondTask.establishment).props.onPress(); for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  detailGate.resolve();
  await act(async () => { for (let tick = 0; tick < 10; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, secondTask.id), "the current task remains selected after the late reconnect response");
  assert.equal(findText(tree, firstTask.id), undefined);
  assert.equal(findText(tree, "stale reconnect content"), undefined);
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), original);
  await act(async () => { tree.unmount(); });
});

test("task-cache write failure warns but does not strand an authorized online editor", async () => {
  await loadApp();
  installMocks();
  runtime.__cacheWriteFailure = true;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(findText(tree, fr.employeeTasks.taskCacheFailed), "the list reports failed offline-context persistence");
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  const editor = findInput(tree, "N° rapport");
  assert.equal(editor?.props.editable, true, "authorized server task and draft hydration complete despite the cache warning");
  assert.ok(findText(tree, fr.employeeTasks.taskCacheFailed));
  assert.ok(!runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "failed cache write is not represented as offline availability");
  await act(async () => { tree.unmount(); });
});

test("successful authoritative refresh revokes omitted offline context and preserves its local draft", async () => {
  await loadApp();
  installMocks();
  const originalDraft = JSON.stringify({
    id: "preserved-revoked-draft", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 3, payload: { content: "preserved evidence" }, createdAt: 10, savedAt: 30,
  });
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, originalDraft);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  runtime.__assignedTasksByEmployee!.set("employee-1", [secondTask]);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual([...runtime.__cachedTaskRows!.keys()], ["employee-1/" + secondTask.id], "successful server omission reconciles only task context");
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft, "the local draft bytes and revision are preserved");

  runtime.__networkOnline = false;
  await act(async () => { runtime.__networkListener?.({ isConnected: false, isInternetReachable: false }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findText(tree, firstTask.establishment), undefined, "the revoked task is no longer offered as offline work");
  assert.equal(findText(tree, firstTask.id), undefined, "the preserved draft is not presented as resumable without authorized task context");
  assert.ok(findText(tree, fr.employeeTasks.offlineDraftPreserved));
  assert.equal(runtime.__draftRows!.get(`employee-1/${firstTask.id}`), originalDraft);
  await act(async () => { tree.unmount(); });
});

test("authoritative task refresh updates retained context and a failed refresh does not revoke cache", async () => {
  await loadApp();
  installMocks();
  const changedTask = { ...firstTask, service: "Service actualisé" };
  runtime.__assignedTasksByEmployee!.set("employee-1", [changedTask]);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  let cachedRow = JSON.parse(runtime.__cachedTaskRows!.get(`employee-1/${firstTask.id}`)!) as { task_json: string };
  assert.equal((JSON.parse(cachedRow.task_json) as Task).service, changedTask.service);
  const priorCache = new Map(runtime.__cachedTaskRows);
  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__failTaskListForEmployee!.add("employee-1");
  await signIn(tree);
  for (let tick = 0; tick < 8; tick++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.deepEqual(runtime.__cachedTaskRows, priorCache, "unknown refresh outcome never destructively reconciles task context");
  assert.ok(findText(tree, changedTask.establishment));
  await act(async () => { tree.unmount(); });
});

test("a stale employee task-list response cannot reconcile another account cache", async () => {
  await loadApp();
  installMocks();
  const firstGate = deferred();
  let firstStarted!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  runtime.__holdTaskListByEmployee!.set("employee-1", firstGate.promise);
  runtime.__taskListStartedByEmployee!.set("employee-1", firstStarted);
  runtime.__cachedTaskRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({ task_json: JSON.stringify(firstTask), synchronized_at: 10 }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { await firstRequestStarted; });
  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__employeeId = "employee-2";
  runtime.__holdTaskListByEmployee!.delete("employee-1");
  await signIn(tree);
  assert.ok(runtime.__cachedTaskRows!.has(`employee-2/${thirdTask.id}`));
  runtime.__holdTaskListByEmployee!.delete("employee-1");
  await act(async () => { firstGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(runtime.__cachedTaskRows!.has(`employee-2/${thirdTask.id}`), "late employee A response cannot remove employee B context");
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`), "the stale request cannot reconcile any account after logout");
  await act(async () => { tree.unmount(); });
});

test("later task open wins when an earlier online task detail resolves last", async () => {
  await loadApp();
  installMocks();
  const firstGate = deferred();
  const secondGate = deferred();
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const firstRequestStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondRequestStarted = new Promise<void>((resolve) => { secondStarted = resolve; });
  runtime.__holdTaskDetailById!.set(firstTask.id, firstGate.promise);
  runtime.__holdTaskDetailById!.set(secondTask.id, secondGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, firstStarted);
  runtime.__taskDetailStartedById!.set(secondTask.id, secondStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await firstRequestStarted; });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findTaskRow(tree, secondTask.establishment).props.onPress(); await secondRequestStarted; });
  runtime.__holdTaskDetailById!.delete(secondTask.id);
  await act(async () => { secondGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, secondTask.id), "task B finishes and becomes the selected detail");
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { firstGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, secondTask.id), "late task A response cannot replace task B");
  assert.equal(findText(tree, firstTask.id), undefined);
  await act(async () => { tree.unmount(); });
});

test("offline cached-task navigation ignores an earlier delayed draft read", async () => {
  await loadApp();
  installMocks();
  for (const [task, content] of [[firstTask, "offline A"], [secondTask, "offline B"]] as const) {
    runtime.__draftRows!.set(`employee-1/${task.id}`, JSON.stringify({
      id: `draft-${task.id}`, employeeId: "employee-1", taskId: task.id, payloadSchemaVersion: 1, revision: 1,
      payload: { content }, createdAt: 10, savedAt: 20,
    }));
  }
  const firstGate = deferred();
  const secondGate = deferred();
  let firstStarted!: () => void;
  let secondStarted!: () => void;
  const firstReadStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
  const secondReadStarted = new Promise<void>((resolve) => { secondStarted = resolve; });
  runtime.__holdDraftReadByTask!.set(firstTask.id, firstGate.promise);
  runtime.__holdDraftReadByTask!.set(secondTask.id, secondGate.promise);
  runtime.__draftReadStartedByTask!.set(firstTask.id, firstStarted);
  runtime.__draftReadStartedByTask!.set(secondTask.id, secondStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  const callsBeforeOffline = [...runtime.__mobileTestApi!.detailCalls];
  runtime.__networkOnline = false;
  await act(async () => { for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findButton(tree, firstTask.id), "draft row remains available while offline");
  await act(async () => { findButton(tree, firstTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, secondTask.id).props.onPress(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__holdDraftReadByTask!.delete(firstTask.id);
  runtime.__holdDraftReadByTask!.delete(secondTask.id);
  await act(async () => { firstGate.resolve(); secondGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findInput(tree, "Contenu conservé du brouillon précédent")?.props.value, "offline B");
  assert.deepEqual(runtime.__mobileTestApi!.detailCalls, [firstTask.id, secondTask.id], "task details were fetched only for the initial online cache population");
  await act(async () => { tree.unmount(); });
});

test("employee switch hides prior cache while loading and ignores its late detail response", async () => {
  await loadApp();
  installMocks();
  const oldTaskGate = deferred();
  const newListGate = deferred();
  let oldTaskStarted!: () => void;
  let newListStarted!: () => void;
  const oldTaskRequestStarted = new Promise<void>((resolve) => { oldTaskStarted = resolve; });
  const newListRequestStarted = new Promise<void>((resolve) => { newListStarted = resolve; });
  runtime.__holdTaskDetailById!.set(firstTask.id, oldTaskGate.promise);
  runtime.__taskDetailStartedById!.set(firstTask.id, oldTaskStarted);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  assert.ok(runtime.__cachedTaskRows!.has(`employee-1/${firstTask.id}`));
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); await oldTaskRequestStarted; });
  await act(async () => { findButton(tree, "Retour à Mes tâches").props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { findButton(tree, "Se déconnecter").props.onPress(); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  runtime.__employeeId = "employee-2";
  runtime.__holdTaskListByEmployee!.set("employee-2", newListGate.promise);
  runtime.__taskListStartedByEmployee!.set("employee-2", newListStarted);
  await signIn(tree);
  await act(async () => { await newListRequestStarted; });
  assert.equal(findText(tree, firstTask.establishment), undefined, "employee A's cached context is hidden while B's list loads");
  runtime.__holdTaskDetailById!.delete(firstTask.id);
  await act(async () => { oldTaskGate.resolve(); for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(findText(tree, firstTask.establishment), undefined, "late employee A response cannot repopulate B's view");
  runtime.__holdTaskListByEmployee!.delete("employee-2");
  await act(async () => { newListGate.resolve(); for (let tick = 0; tick < 8; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, thirdTask.establishment));
  assert.equal(findText(tree, firstTask.establishment), undefined);
  await act(async () => { tree.unmount(); });
});

test("hydration keeps an existing draft read-only until its committed revision is known", async () => {
  await loadApp();
  installMocks();
  runtime.__draftRows!.set(`employee-1/${firstTask.id}`, JSON.stringify({
    id: "committed-draft", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 7,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-paper-form", ruleVersion: "2.0.0", values: { "header.reportNumber": "durable content" } },
    createdAt: 10, savedAt: 20,
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
  const editor = () => findInput(tree, "N° rapport")!;
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
  const committed = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { values: Record<string, string> } };
  assert.equal(committed.revision, 8, "the hydrated revision is used as the save base");
  assert.equal(committed.payload.values["header.reportNumber"], "revision seven updated");
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
  const editor = findInput(tree, "Contenu conservé du brouillon précédent");
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
  await act(async () => { (await waitForButton(tree, firstTask.id)).props.onPress(); await new Promise((resolve) => setTimeout(resolve, 0)); });
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
  const editor = findInput(tree, "Contenu conservé du brouillon précédent")!;
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
  const editor = findInput(tree, "Contenu conservé du brouillon précédent")!;
  await act(async () => { editor.props.onChangeText("explicitly saved version"); });
  let saving!: Promise<boolean>;
  await act(async () => { saving = findButton(tree, "Enregistrer").props.onPress() as Promise<boolean>; await writeStarted; });
  await act(async () => { findButton(tree, "Supprimer le brouillon local").props.onPress(); });
  await act(async () => { findButton(tree, "Confirmer").props.onPress(); });
  releaseWrite();
  runtime.__holdDraftWrite = undefined;
  runtime.__draftWriteStarted = undefined;
  await act(async () => { assert.equal(await saving, true); await new Promise((resolve) => setTimeout(resolve, 0)); });
  const stillCommitted = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { revision: number; payload: { values: Record<string, string> } };
  assert.equal(stillCommitted.revision, 2);
  assert.equal(stillCommitted.payload.legacyContent, "explicitly saved version");
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
    const editor = findInput(tree, "Contenu conservé du brouillon précédent")!;
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
    identity: { id: runtime.__employeeId ?? "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false },
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

// Story 5.6: paper-form sections, tables and defaults.
function sectionOf(id: string) {
  return GRAPHIE_MOBILE_POV_CATALOGUE.sections.find((section) => section.id === id)!;
}

async function goToSection(tree: ReactTestRenderer, id: string) {
  await act(async () => { findButton(tree, sectionOf(id).labelFr).props.onPress(); });
}

function findSectionHeading(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll((node) => node.type === "Text" && node.props.accessibilityRole === "header" && node.children.join("") === label)[0];
}

async function openFirstTaskAfterRestart() {
  runtime.__secureValues = new Map();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  return tree;
}

for (const [layout, width] of [["phone", 390], ["tablet", 1024]] as const) {
  test(`${layout} section navigation reaches all 11 paper sections, ending with « Contrôle effectué par »`, async () => {
    await loadApp();
    installMocks();
    runtime.__mobileTestWidth = width;
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<App />); });
    await signIn(tree);
    await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
    assert.equal(GRAPHIE_MOBILE_POV_CATALOGUE.sections.length, 11);
    for (const section of GRAPHIE_MOBILE_POV_CATALOGUE.sections) {
      await goToSection(tree, section.id);
      assert.ok(findSectionHeading(tree, section.labelFr), `expected heading ${section.labelFr}`);
    }
    assert.equal(GRAPHIE_MOBILE_POV_CATALOGUE.sections.at(-1)!.labelFr, "Contrôle effectué par");
    assert.ok(findInput(tree, "Nom et prénom"));
    assert.ok(findInput(tree, "Qualité"));
    assert.ok(findInput(tree, "Date de contrôle"));
    for (const forbidden of ["Conforme", "À signaler", "Non vérifié", "concluant", "Conclusion générale", "Contrôle approuvé par", "Signature"]) {
      assert.equal(tree.root.findAll((node) => node.type === "Text" && node.children.join("").includes(forbidden)).length, 0, forbidden);
    }
    await act(async () => { tree.unmount(); });
  });
}

test("phone tables render one labelled group per row with unit-labelled decimal inputs; tablet lays cells out in a row", async () => {
  await loadApp();
  installMocks();
  runtime.__mobileTestWidth = 390;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const isTouchTarget = (style: unknown) => (Array.isArray(style) ? style : [style]).flat().some((item) => item && typeof item === "object" && (item as { minHeight?: number }).minHeight! >= 44);
  for (const option of tree.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith("Nature de l'intervention: "))) {
    assert.ok(isTouchTarget(option.props.style), "choice buttons are at least 44 pt");
  }
  const deviceGrids = [
    ["equipment", ["Équipement", "Tube à rayons X", "Générateur HT"], ["Marque", "Modèle", "N° de série", "D.M.S"]],
    ["instruments", ["KVp mètre", "Dosimètre", "Mètre-ruban"], ["Marque", "Modèle", "N° de série"]],
  ] as const;
  for (const [sectionId, devices, attributes] of deviceGrids) {
    await goToSection(tree, sectionId);
    for (const device of devices) {
      const group = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === device)[0];
      assert.ok(group, `expected one group per device: ${device}`);
      assert.deepEqual(group!.findAll((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel), attributes.map((attribute) => `${device} — ${attribute}`));
    }
  }
  await goToSection(tree, "repeatability");
  for (const row of [1, 2, 3, 4, 5]) {
    const group = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === `Mesure ${row}`)[0];
    assert.ok(group, `expected row group Mesure ${row}`);
    assert.ok(group!.findAll((node) => node.type === "Text" && node.children.join("") === `Mesure ${row}`).length > 0);
    assert.equal(group!.findAll((node) => node.type === "TextInput").length, 3);
    assert.equal((Array.isArray(group!.props.style) ? group!.props.style : [group!.props.style]).some((item: { flexDirection?: string } | false) => item && item.flexDirection === "row"), false, "phone rows stack their inputs");
  }
  const measured = findInput(tree, "Mesure 2 — kV mesuré (kV)");
  assert.ok(measured);
  assert.equal(measured!.props.keyboardType, "decimal-pad");
  assert.ok(findInput(tree, "Mesure 5 — Kerma (mGy)"));
  assert.ok(findText(tree, "Kerma (mGy)"), "units are visible on the input label");
  assert.ok(findText(tree, "La mesure du kerma sera utilisée par la suite pour le contrôle de la reproductibilité et la répétabilité du rayonnement de sortie."));
  assert.equal(findInput(tree, "mAs (mAs)")?.props.keyboardType, "decimal-pad");
  assert.ok(findInput(tree, "mA max/2 (mA)"));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput" && /Kerma/.test(String(node.props.accessibilityLabel))).length, 5, "Kerma is entered once per repeatability row only");
  await goToSection(tree, "voltageAccuracy");
  for (const label of ["KV min", "KV", "KV max"]) assert.ok(findInput(tree, `${label} — kV affiché (kV)`), label);
  await goToSection(tree, "linearity");
  for (const row of [1, 2, 3]) assert.ok(findInput(tree, `Mesure ${row} — Kerma (dét) (mGy)`));
  const inputLabels = tree.root.findAll((node) => node.type === "TextInput").map((node) => node.props.accessibilityLabel);
  assert.deepEqual(inputLabels.slice(-3), ["mA max/2 (mA)", "DFC (distance foyer–chambre) (m)", "Commentaire"]);
  for (const input of tree.root.findAll((node) => node.type === "TextInput")) {
    assert.ok(isTouchTarget(input.props.style), "touch target is at least 44 pt");
    if (!input.props.multiline) assert.equal(input.props.keyboardType, "decimal-pad", String(input.props.accessibilityLabel));
  }
  await act(async () => { tree.unmount(); });

  installMocks();
  runtime.__mobileTestWidth = 1024;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await goToSection(tree, "repeatability");
  const tabletRow = tree.root.findAll((node) => node.type === "View" && node.props.accessibilityLabel === "Mesure 1")[0]!;
  assert.ok((Array.isArray(tabletRow.props.style) ? tabletRow.props.style : [tabletRow.props.style]).some((item: { flexDirection?: string } | false) => item && item.flexDirection === "row"));
  assert.ok(findInput(tree, "Mesure 1 — kV mesuré (kV)"));
  await act(async () => { tree.unmount(); });
});

test("a new draft shows paper defaults that persist across restart, and a cleared default stays empty", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  assert.ok(findChoice(tree, "Nature de l'intervention: Demande ponctuelle"));
  await goToSection(tree, "instruments");
  for (const row of ["KVp mètre", "Dosimètre"]) {
    assert.equal(findInput(tree, `${row} — Marque`)?.props.value, "Fluke Biomedical");
    assert.equal(findInput(tree, `${row} — Modèle`)?.props.value, "8000");
    assert.equal(findInput(tree, `${row} — N° de série`)?.props.value, "105991");
  }
  for (const attribute of ["Marque", "Modèle", "N° de série"]) assert.equal(findInput(tree, `Mètre-ruban — ${attribute}`)?.props.value, "");
  await goToSection(tree, "voltageAccuracy");
  assert.deepEqual(["KV min", "KV", "KV max"].map((row) => findInput(tree, `${row} — kV affiché (kV)`)?.props.value), ["50", "70", ""]);
  await goToSection(tree, "linearity");
  assert.deepEqual([1, 2, 3].map((row) => findInput(tree, `Mesure ${row} — mAs (mAs)`)?.props.value), ["10", "", ""]);
  await goToSection(tree, "lightField");
  assert.deepEqual(["kV (kV)", "mAs (mAs)", "D.F.R (distance foyer–récepteur) (m)"].map((label) => findInput(tree, label)?.props.value), ["70", "4", "1"]);
  assert.equal(runtime.__draftRows!.has(key), false, "seeding alone does not write a draft");
  await goToSection(tree, "repeatability");
  assert.deepEqual([1, 2, 3, 4, 5].map((row) => findInput(tree, `Mesure ${row} — kV affiché (kV)`)?.props.value), ["70", "70", "70", "70", "70"]);
  await act(async () => { findInput(tree, "Mesure 3 — kV affiché (kV)")!.props.onChangeText(""); });
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["voltage.repeatability.row3.kvDisplayed"], "");
  assert.equal(saved.payload.values["instruments.dosimeter.brand"], "Fluke Biomedical");
  assert.equal(saved.payload.values["header.interventionNature"], "Convention");
  await act(async () => { tree.unmount(); });

  tree = await openFirstTaskAfterRestart();
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  await goToSection(tree, "repeatability");
  assert.deepEqual([1, 2, 3, 4, 5].map((row) => findInput(tree, `Mesure ${row} — kV affiché (kV)`)?.props.value), ["70", "70", "", "70", "70"]);
  await goToSection(tree, "instruments");
  assert.equal(findInput(tree, "KVp mètre — Marque")?.props.value, "Fluke Biomedical");
  await act(async () => { tree.unmount(); });
});

test("a new draft opened offline from the cached task list is seeded with the paper defaults", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });

  runtime.__networkOnline = false;
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows!.has(key), false);
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  await goToSection(tree, "instruments");
  assert.deepEqual(["Marque", "Modèle", "N° de série"].map((attribute) => findInput(tree, `KVp mètre — ${attribute}`)?.props.value), ["Fluke Biomedical", "8000", "105991"]);
  await goToSection(tree, "repeatability");
  assert.equal(findInput(tree, "Mesure 1 — kV affiché (kV)")?.props.value, "70");
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["header.interventionNature"], "Convention");
  assert.equal(saved.payload.values["instruments.kvpMeter.serial"], "105991");
  await act(async () => { tree.unmount(); });
});

test("table cells and light-field gaps survive save, restart and resume as exact strings", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  const entries: [string, string, string][] = [
    ["voltageAccuracy", "KV max — kV affiché (kV)", "90"],
    ["voltageAccuracy", "KV min — kV mesuré (kV)", "49,2"],
    ["repeatability", "Mesure 2 — kV mesuré (kV)", "69,7"],
    ["repeatability", "Mesure 5 — Kerma (mGy)", "0.123"],
    ["repeatability", "mAs (mAs)", "20"],
    ["linearity", "Mesure 3 — Kerma (dét) (mGy)", "1,308"],
    ["linearity", "DFC (distance foyer–chambre) (m)", "0,7"],
    ["lightField", "Écart 1 (mm)", "2"],
    ["lightField", "Écart 4 (mm)", "-1,5"],
    ["equipment", "Tube à rayons X — Marque", "Varian"],
    ["controlPerformedBy", "Date de contrôle", "2026-10-02"],
  ];
  for (const [section, label, value] of entries) {
    await goToSection(tree, section);
    const input = findInput(tree, label);
    assert.ok(input, label);
    await act(async () => { input!.props.onChangeText(value); });
  }
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["voltage.repeatability.row2.kvMeasured"], "69,7");
  assert.equal(saved.payload.values["lightField.gap4"], "-1,5");
  assert.equal(saved.payload.values["equipment.tube.brand"], "Varian");
  await act(async () => { tree.unmount(); });

  tree = await openFirstTaskAfterRestart();
  for (const [section, label, value] of entries) {
    await goToSection(tree, section);
    assert.equal(findInput(tree, label)?.props.value, value, label);
  }
  await act(async () => { tree.unmount(); });
});

test("visual and mechanical checks offer N.A / Oui / Non touch buttons with exposed, persisted selection", async () => {
  await loadApp();
  installMocks();
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await goToSection(tree, "visual");
  for (const field of sectionOf("visual").fields) {
    const options = tree.root.findAll((node) => node.type === "Pressable" && String(node.props.accessibilityLabel ?? "").startsWith(`${field.labelFr}: `));
    assert.deepEqual(options.map((node) => node.props.accessibilityLabel), ["N.A", "Oui", "Non"].map((option) => `${field.labelFr}: ${option}`), "blank is the initial unanswered state");
    assert.equal(options.some((node) => node.props.accessibilityState.selected), false, field.id);
  }
  await act(async () => { findChoice(tree, "Intégrité de l'appareil, bon état des couvercles: Oui")!.props.onPress(); });
  await act(async () => { findChoice(tree, "Intégrité de l'appareil, bon état des couvercles: Oui, sélectionné")!.props.onPress(); });
  assert.equal(findChoice(tree, "Intégrité de l'appareil, bon état des couvercles: Oui, sélectionné"), undefined, "tapping the selected option returns to unanswered");
  assert.equal(tree.root.findAll((node) => node.type === "TextInput" && node.props.multiline).length, 0, "no comment field in visual checks");
  await act(async () => { findChoice(tree, "Propreté générale: N.A")!.props.onPress(); });
  await goToSection(tree, "mechanical");
  await act(async () => { findChoice(tree, "Contrôle des freins: Non")!.props.onPress(); });
  const selected = findChoice(tree, "Contrôle des freins: Non, sélectionné")!;
  assert.equal(selected.props.accessibilityState.selected, true);
  assert.ok(selected.findAll((node) => node.type === "Text" && node.children.join("").includes("sélectionné")).length > 0);
  await act(async () => { assert.equal(await findButton(tree, "Enregistrer").props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(`employee-1/${firstTask.id}`)!) as { payload: { values: Record<string, string> } };
  assert.equal(saved.payload.values["visual.integrity"], "");
  await act(async () => { tree.unmount(); });

  tree = await openFirstTaskAfterRestart();
  await goToSection(tree, "mechanical");
  assert.equal(findChoice(tree, "Contrôle des freins: Non, sélectionné")?.props.accessibilityState.selected, true);
  assert.equal(findChoice(tree, "Contrôle des mouvements: Oui, sélectionné"), undefined);
  await goToSection(tree, "visual");
  assert.equal(findChoice(tree, "Propreté générale: N.A, sélectionné")?.props.accessibilityState.selected, true);
  await act(async () => { tree.unmount(); });
});

test("a stored catalogue 1.0.0 / schema 2 draft shows the compatibility notice, renders no values and keeps its bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = JSON.stringify({
    id: "v1-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 4, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "intervention.contexte": "v1 context", "voltage.accuracy": "49.2", "qualitative.0": "Conforme" } },
  });
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => ["v1 context", "49.2", "Fluke Biomedical", "Convention"].includes(String(node.props.value ?? ""))), false);
  assert.equal(tree.root.findAll((node) => node.type === "Pressable" && node.props.accessibilityState?.selected === true && String(node.props.accessibilityLabel ?? "").includes(":")).length, 0);
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  await act(async () => { tree.unmount(); });
});

test("a stored catalogue 2.0.0 / schema 3 draft stamped with the old workbook rule shows the compatibility notice and keeps its bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = JSON.stringify({
    id: "old-rule-form", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 3, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "header.reportNumber": "old rule report", "voltage.accuracy.row1.kvMeasured": "49.2" } },
  });
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => ["old rule report", "49.2"].includes(String(node.props.value ?? ""))), false);
  assert.equal(findButton(tree, "Enregistrer").props.disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  await act(async () => { tree.unmount(); });
});

const unreadableDraftRows = {
  oldRule: (taskId: string) => JSON.stringify({
    id: "old-rule-form", employeeId: "employee-1", taskId,
    payloadSchemaVersion: 1, revision: 3, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "2.0.0", schemaVersion: 3, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "header.reportNumber": "old rule report", "voltage.accuracy.row1.kvMeasured": "49.2" } },
  }),
  catalogueV1: (taskId: string) => JSON.stringify({
    id: "v1-form", employeeId: "employee-1", taskId,
    payloadSchemaVersion: 1, revision: 4, createdAt: 10, savedAt: 20,
    payload: { catalogueId: "graphie-mobile-pov", catalogueVersion: "1.0.0", schemaVersion: 2, ruleId: "cetem-workbook-explicit-formulas", ruleVersion: "1.0.0", values: { "intervention.contexte": "v1 context", "voltage.accuracy": "49.2" } },
  }),
};
const reportNumberLabel = GRAPHIE_MOBILE_POV_CATALOGUE.sections[0]!.fields.find((field) => field.id === "header.reportNumber")!.labelFr;

function hasButton(tree: ReactTestRenderer, title: string) {
  return tree.root.findAll((node) => node.type === "Pressable" && node.findAll((child) => child.type === "Text" && child.children.join("") === title).length > 0).length > 0;
}

async function assertPaperDefaultsShown(tree: ReactTestRenderer) {
  const defaults = createNewGraphieDraftValues();
  assert.equal(findInput(tree, reportNumberLabel)?.props.value, defaults["header.reportNumber"] ?? "");
  assert.equal(findChoice(tree, "Nature de l'intervention: Convention, sélectionné")?.props.accessibilityState.selected, true);
  await goToSection(tree, "instruments");
  assert.equal(findInput(tree, "KVp mètre — Marque")?.props.value, defaults["instruments.kvpMeter.brand"]);
  await goToSection(tree, "header");
}

test("M5 online: an old-rule draft is discarded from the compatibility notice and the form is re-seeded", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = unreadableDraftRows.oldRule(firstTask.id);
  runtime.__draftRows!.set(key, storedRow);
  runtime.__draftRows!.set(`employee-1/${secondTask.id}`, unreadableDraftRows.oldRule(secondTask.id));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.confirmDeleteDraft));
  assert.equal(runtime.__draftRows!.get(key), storedRow, "asking for confirmation does not touch storage");
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(runtime.__draftRows!.has(key), false, "the unreadable row is deleted");
  assert.ok(runtime.__draftRows!.has(`employee-1/${secondTask.id}`), "another task's draft is untouched");
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable), undefined);
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, false);
  await assertPaperDefaultsShown(tree);
  await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { revision: number; payload: { ruleId: string; values: Record<string, string> } };
  assert.equal(saved.revision, 1, "a fresh draft starts after the unreadable one is gone");
  assert.equal(saved.payload.ruleId, "cetem-paper-form");
  assert.equal(saved.payload.values["header.interventionNature"], "Convention");
  await act(async () => { tree.unmount(); });
});

test("M6 offline: a cached catalogue 1.0.0 / schema 2 draft can be discarded without a connection", async () => {
  await loadApp();
  const api = installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { tree.unmount(); });

  runtime.__draftRows!.set(key, unreadableDraftRows.catalogueV1(firstTask.id));
  runtime.__networkOnline = false;
  const detailCalls = [...api.detailCalls];
  await act(async () => { tree = create(<App />); await new Promise((resolve) => setTimeout(resolve, 0)); });
  await act(async () => { (await waitForButton(tree, firstTask.establishment)).props.onPress(); for (let tick = 0; tick < 100; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });

  assert.equal(runtime.__draftRows!.has(key), false);
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable), undefined);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, false);
  await assertPaperDefaultsShown(tree);
  assert.deepEqual(api.detailCalls, detailCalls, "the offline discard makes no server call");
  await act(async () => { tree.unmount(); });
});

test("M7 cancelling the unreadable-draft discard keeps the bytes and the notice", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = unreadableDraftRows.oldRule(firstTask.id);
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.cancel).props.onPress(); });
  assert.equal(findText(tree, fr.employeeTasks.confirmDeleteDraft), undefined);
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(findButton(tree, fr.employeeTasks.deleteDraft).props.disabled, false);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  await act(async () => { tree.unmount(); });
});

test("M8 a failed unreadable-draft delete reports the failure and keeps the bytes", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  const storedRow = unreadableDraftRows.oldRule(firstTask.id);
  runtime.__draftRows!.set(key, storedRow);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  runtime.__failDraftDelete = true;
  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.ok(findText(tree, "Le brouillon local n’a pas pu être supprimé. Il est conservé."));
  assert.ok(findText(tree, fr.employeeTasks.draftCompatibilityUnavailable));
  assert.equal(runtime.__draftRows!.get(key), storedRow);
  assert.equal(findButton(tree, fr.employeeTasks.saveDraft).props.disabled, true);
  assert.equal(findButton(tree, fr.employeeTasks.deleteDraft).props.disabled, false, "the discard can be retried");
  await act(async () => { tree.unmount(); });
});

test("M9 after an explicit delete of a normal draft the form shows a new draft, not the deleted values", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  await act(async () => { findInput(tree, reportNumberLabel)!.props.onChangeText("value to delete"); });
  await act(async () => { findChoice(tree, "Nature de l'intervention: Demande ponctuelle")!.props.onPress(); });
  await goToSection(tree, "instruments");
  await act(async () => { findInput(tree, "KVp mètre — Marque")!.props.onChangeText("Autre marque"); });
  await goToSection(tree, "header");
  await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), true); });
  assert.ok(runtime.__draftRows!.has(key));

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows!.has(key), false);
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(tree.root.findAll((node) => node.type === "TextInput").some((node) => node.props.value === "value to delete"), false);
  await assertPaperDefaultsShown(tree);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
  assert.equal(runtime.__draftRows!.has(key), false, "the reset form is not autosaved as a new draft");
  await act(async () => { tree.unmount(); });
});

test("M9b after an explicit delete of a legacy-content draft the form leaves legacy mode", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, JSON.stringify({
    id: "legacy-to-delete", employeeId: "employee-1", taskId: firstTask.id,
    payloadSchemaVersion: 1, revision: 2, payload: { content: "legacy text to delete" }, createdAt: 10, savedAt: 20,
  }));
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.equal(findInput(tree, fr.employeeTasks.legacyDraftContent)?.props.value, "legacy text to delete");

  await act(async () => { findButton(tree, fr.employeeTasks.deleteDraft).props.onPress(); });
  await act(async () => { findButton(tree, fr.common.confirm).props.onPress(); for (let tick = 0; tick < 4; tick++) await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(runtime.__draftRows!.has(key), false);
  assert.ok(findText(tree, fr.employeeTasks.draftDeleted));
  assert.equal(findInput(tree, fr.employeeTasks.legacyDraftContent), undefined, "legacy-content mode is off");
  await assertPaperDefaultsShown(tree);
  await act(async () => { assert.equal(await findButton(tree, fr.employeeTasks.saveDraft).props.onPress(), true); });
  const saved = JSON.parse(runtime.__draftRows!.get(key)!) as { payload: { content?: string; ruleId: string } };
  assert.equal(saved.payload.content, undefined, "the next save stores a structured draft, not the legacy text");
  assert.equal(saved.payload.ruleId, "cetem-paper-form");
  await act(async () => { tree.unmount(); });
});

test("M10 a generic draft storage failure offers no discard action", async () => {
  await loadApp();
  installMocks();
  const key = `employee-1/${firstTask.id}`;
  runtime.__draftRows!.set(key, "{not json");
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(<App />); });
  await signIn(tree);
  await act(async () => { findTaskRow(tree, firstTask.establishment).props.onPress(); });
  assert.ok(findText(tree, fr.employeeTasks.draftStorageUnavailable));
  assert.equal(hasButton(tree, fr.employeeTasks.deleteDraft), false);
  assert.equal(runtime.__draftRows!.get(key), "{not json");
  await act(async () => { tree.unmount(); });
});
