import assert from "node:assert/strict";
import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import test, { mock } from "node:test";
import { EMPLOYEE_CONTENT_HORIZONTAL_GUTTER } from "./employee-task-layout.js";

const runtime = globalThis as typeof globalThis & {
  __mobileTestWidth?: number;
  __mobileTestApi?: MockApi;
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

mock.module("react-native", {
  namedExports: {
    ActivityIndicator: "ActivityIndicator",
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
mock.module("@cetem-qc/api-client/v1", {
  namedExports: {
    ApiRequestError: class ApiRequestError extends Error {},
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
  logout: () => Promise<void>;
  listCalls: number;
  detailCalls: string[];
}

const firstTask: Task = {
  id: "00000000-0000-4000-8000-000000000051",
  establishment: "Centre hospitalier Nord",
  service: "Radiologie",
  createdAt: "2026-09-30T10:00:00.000Z",
};

function installMocks() {
  runtime.__mobileTestWidth = 390;
  const api: MockApi = {
    authenticate: async () => ({ user: { id: "employee-1", email: "employee@example.test", displayName: "Employée Test", role: "employe", mustChangePassword: false } }),
    listAssignedEmployeeTasks: async () => { api.listCalls++; return { tasks: [firstTask] }; },
    getAssignedEmployeeTask: async (id) => { api.detailCalls.push(id); return { task: firstTask }; },
    logout: async () => undefined,
    listCalls: 0,
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
  await act(async () => { findButton(tree, "Se connecter").props.onPress(); });
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
