import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface WorkspaceManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export function validateWorkspaceDependencies(
  apps: Record<string, WorkspaceManifest>,
  packages: WorkspaceManifest[],
): string[] {
  const issues: string[] = [];
  const packageNames = new Set(packages.map(({ name }) => name));
  const appNames = new Set(Object.values(apps).map(({ name }) => name));
  const dependenciesOf = (manifest: WorkspaceManifest) => ({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });

  for (const [appKey, manifest] of Object.entries(apps)) {
    for (const dependency of Object.keys(dependenciesOf(manifest))) {
      if (appNames.has(dependency)) {
        issues.push(`${manifest.name} must not depend on application ${dependency}`);
      } else if (dependency.startsWith("@cetem-qc/") && !packageNames.has(dependency)) {
        issues.push(`${manifest.name} depends on unknown shared package ${dependency}`);
      }
    }
    if (appKey === "web" && dependenciesOf(manifest)["@cetem-qc/mobile"]) {
      issues.push("apps/web must not depend on apps/mobile");
    }
    if (appKey === "mobile" && dependenciesOf(manifest)["@cetem-qc/web"]) {
      issues.push("apps/mobile must not depend on apps/web");
    }
  }

  for (const manifest of packages) {
    for (const dependency of Object.keys(dependenciesOf(manifest))) {
      if (appNames.has(dependency)) {
        issues.push(`${manifest.name} must not depend on application ${dependency}`);
      }
    }
  }
  return issues;
}

export interface ModuleSource {
  file: string;
  source: string;
}

const importPattern = /(?:\bimport\s+(?:[\s\S]*?\s+from\s+)?|\bexport\s+[\s\S]*?\s+from\s+|\bimport\s*\()\s*["']([^"']+)["']/g;

function moduleOf(file: string): string | undefined {
  const normalized = file.replaceAll("\\", "/");
  const match = normalized.match(/(?:^|\/)modules\/([^/]+)\//);
  return match?.[1];
}

function isPublicModuleSurface(file: string, module: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const moduleRoot = `/modules/${module}/`;
  const relative = normalized.slice(normalized.indexOf(moduleRoot) + moduleRoot.length);
  const segments = relative.split("/");
  return (segments.length === 1 && segments[0] === "index.ts") ||
    ["commands", "queries", "contracts", "ports"].includes(segments[0]);
}

export function validateModuleImports(sources: ModuleSource[]): string[] {
  const issues: string[] = [];
  const knownFiles = new Set(sources.map(({ file }) => path.resolve(file)));
  const resolveLocalImport = (from: string, specifier: string): string | undefined => {
    if (!specifier.startsWith(".")) return undefined;
    const base = path.resolve(path.dirname(from), specifier);
    const extension = path.extname(base);
    const sourceExtension = extension === ".js" ? ".ts" : extension === ".jsx" ? ".tsx" : undefined;
    const candidates = [
      base,
      ...(sourceExtension ? [base.slice(0, -extension.length) + sourceExtension] : []),
      ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => `${base}${ext}`),
      ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((name) => path.join(base, name)),
    ];
    return candidates.find((candidate) => knownFiles.has(candidate));
  };
  const targetApplication = (from: string, specifier: string): string | undefined => {
    const normalized = specifier.replaceAll("\\", "/");
    const absoluteMatch = normalized.match(/(?:^|\/)apps\/(web|mobile)\/(?:src\/)?/);
    if (absoluteMatch) return absoluteMatch[1];
    const packageMatch = normalized.match(/^@cetem-qc\/(web|mobile)\/(?:src\/)?/);
    if (packageMatch) return packageMatch[1];
    if (!normalized.startsWith(".")) return undefined;
    const resolved = path.resolve(path.dirname(from), normalized).replaceAll("\\", "/");
    return resolved.match(/(?:^|\/)apps\/(web|mobile)\/(?:src\/)?/)?.[1];
  };

  for (const { file, source } of sources) {
    const normalizedFrom = file.replaceAll("\\", "/");
    const fromApp = normalizedFrom.match(/(?:^|\/)apps\/(web|mobile)\/(?:.*\/)?[^/]+\.(?:ts|tsx)$/)?.[1];
    if (fromApp) {
      importPattern.lastIndex = 0;
      for (const match of source.matchAll(importPattern)) {
        const targetApp = fromApp === "web" ? "mobile" : "web";
        if (targetApplication(file, match[1]) === targetApp) {
          issues.push(`${normalizedFrom} must not import ${targetApp} application source: ${match[1]}`);
        }
      }
    }
    const fromModule = moduleOf(file);
    if (!fromModule) continue;
    importPattern.lastIndex = 0;
    for (const match of source.matchAll(importPattern)) {
      const target = resolveLocalImport(file, match[1]);
      if (!target) continue;
      const targetModule = moduleOf(target);
      if (targetModule && targetModule !== fromModule && !isPublicModuleSurface(target, targetModule)) {
        issues.push(`${file} must not import internal implementation from module ${targetModule}: ${match[1]}`);
      }
    }
  }
  return issues;
}

async function filesUnder(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(fullPath);
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [fullPath] : [];
  }));
  return nested.flat();
}

async function readManifest(file: string): Promise<WorkspaceManifest> {
  return JSON.parse(await readFile(file, "utf8")) as WorkspaceManifest;
}

async function main() {
  const root = process.cwd();
  const appManifests = Object.fromEntries(await Promise.all(["web", "mobile", "api"].map(async (app) =>
    [app, await readManifest(path.join(root, "apps", app, "package.json"))] as const,
  )));
  const packageEntries = await readdir(path.join(root, "packages"), { withFileTypes: true });
  const packageManifests = await Promise.all(packageEntries.filter((entry) => entry.isDirectory()).map((entry) =>
    readManifest(path.join(root, "packages", entry.name, "package.json")),
  ));

  // Validate app edges only after every shared package name is known.
  const issues = validateWorkspaceDependencies(appManifests, packageManifests);
  const sourceFiles = await Promise.all(["web", "mobile", "api"].map((app) =>
    filesUnder(path.join(root, "apps", app)),
  ));
  const moduleSources = await Promise.all(sourceFiles.flat().map(async (file) => ({
    file,
    source: await readFile(file, "utf8"),
  })));
  issues.push(...validateModuleImports(moduleSources));

  if (issues.length) {
    console.error(issues.map((issue) => `- ${issue}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Application/package and module import boundaries are valid.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
