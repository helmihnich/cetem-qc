import assert from "node:assert/strict";
import test from "node:test";
import { validateModuleImports, validateWorkspaceDependencies } from "./check-boundaries.js";

const app = (name: string, dependencies: Record<string, string> = {}) => ({ name, dependencies });

test("apps can depend on shared packages collected from all manifests", () => {
  const issues = validateWorkspaceDependencies(
    { web: app("@cetem-qc/web", { "@cetem-qc/types": "workspace:*" }) },
    [app("@cetem-qc/types")],
  );
  assert.deepEqual(issues, []);
});

test("peer and optional dependency edges follow workspace boundaries", () => {
  const issues = validateWorkspaceDependencies(
    {
      web: { ...app("@cetem-qc/web"), peerDependencies: { "@cetem-qc/mobile": "workspace:*" } },
      mobile: { ...app("@cetem-qc/mobile"), optionalDependencies: { "@cetem-qc/api": "workspace:*" } },
      api: app("@cetem-qc/api"),
    },
    [{ ...app("@cetem-qc/types"), optionalDependencies: { "@cetem-qc/web": "workspace:*" } }],
  );
  assert(issues.some((issue) => issue.includes("@cetem-qc/web must not depend on application @cetem-qc/mobile")));
  assert(issues.some((issue) => issue.includes("@cetem-qc/mobile must not depend on application @cetem-qc/api")));
  assert(issues.some((issue) => issue.includes("@cetem-qc/types must not depend on application @cetem-qc/web")));
});

test("apps and shared packages cannot depend on applications", () => {
  const issues = validateWorkspaceDependencies(
    {
      web: app("@cetem-qc/web", { "@cetem-qc/mobile": "workspace:*" }),
      mobile: app("@cetem-qc/mobile"),
      api: app("@cetem-qc/api"),
    },
    [app("@cetem-qc/types", { "@cetem-qc/api": "workspace:*" })],
  );
  assert(issues.some((issue) => issue.includes("@cetem-qc/web must not depend on application @cetem-qc/mobile")));
  assert(issues.some((issue) => issue.includes("@cetem-qc/types must not depend on application @cetem-qc/api")));
});

test("a module may use its own adapter and internal implementation", () => {
  const issues = validateModuleImports([
    { file: "/repo/apps/api/src/modules/a/commands/do.ts", source: 'import "../adapters/a-repository.js";' },
    { file: "/repo/apps/api/src/modules/a/adapters/a-repository.ts", source: "export {};" },
  ]);
  assert.deepEqual(issues, []);
});

test("a module cannot import another module internals, but may use its public query surface", () => {
  const issues = validateModuleImports([
    { file: "/repo/apps/api/src/modules/a/commands/do.ts", source: 'import "../../b/repositories/b-repository.js"; import "../../b/queries/read-b.js";' },
    { file: "/repo/apps/api/src/modules/b/repositories/b-repository.ts", source: "export {};" },
    { file: "/repo/apps/api/src/modules/b/queries/read-b.ts", source: 'import "../tables/b-table.js";' },
    { file: "/repo/apps/api/src/modules/b/tables/b-table.ts", source: "export {};" },
  ]);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /module b/);
});

test("a public query can use its owning module's internals", () => {
  const issues = validateModuleImports([
    { file: "/repo/apps/api/src/modules/a/commands/do.ts", source: 'import "../../b/queries/read-b.js";' },
    { file: "/repo/apps/api/src/modules/b/queries/read-b.ts", source: 'import "../repositories/b-repository.js";' },
    { file: "/repo/apps/api/src/modules/b/repositories/b-repository.ts", source: "export {};" },
  ]);
  assert.equal(issues.length, 0);
});

test("web and mobile cannot import each other's source directly", () => {
  const issues = validateModuleImports([
    { file: "/repo/apps/web/src/page.tsx", source: 'import "../../mobile/App.js";' },
    { file: "/repo/apps/mobile/src/App.tsx", source: 'import "@cetem-qc/web/src/app/page";' },
  ]);
  assert.equal(issues.length, 2);
  assert(issues.some((issue) => issue.includes("web application source")));
  assert(issues.some((issue) => issue.includes("mobile application source")));
});

test("root-level app sources are checked and shared workspace packages remain allowed", () => {
  const issues = validateModuleImports([
    { file: "C:/repo/apps/mobile/App.tsx", source: 'import "../web/src/app/page.js"; import "@cetem-qc/schemas/api/v1";' },
    { file: "C:/repo/apps/web/src/app/page.tsx", source: 'import "../../../mobile/src/App.js"; import "@cetem-qc/types/api/v1";' },
  ]);
  assert.equal(issues.length, 2);
  assert(issues.some((issue) => issue.includes("apps/mobile/App.tsx") && issue.includes("web application source")));
  assert(issues.some((issue) => issue.includes("mobile application source") && issue.includes("apps/web/src/app/page.tsx")));
});
