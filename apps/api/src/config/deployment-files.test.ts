import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "../../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const templates = readdirSync(join(root, "deploy/env")).filter((file) => file.endsWith(".env.example")).map((file) => `deploy/env/${file}`);
const secretKey = /PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL/;

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) { if (entry !== "node_modules" && entry !== ".next") walk(path, files); }
    else files.push(path);
  }
  return files;
}

test("every environment variable read by the API and web is documented in a template", () => {
  const documented = [".env.example", ...templates].map(read).join("\n");
  const names = new Set<string>();
  const sources = [...walk(join(root, "apps/api/src")), ...walk(join(root, "apps/web/src"))]
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("test-support"));
  for (const file of sources) {
    for (const match of readFileSync(file, "utf8").matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1]);
  }
  for (const name of ["CETEM_QC_API_URL", "HOST", "PORT", "NEON_DATABASE_URL"]) names.add(name);
  names.delete("NODE_ENV");
  for (const name of names) assert.match(documented, new RegExp(`^${name}=`, "m"), `${name} is not documented`);
});

test("secret-bearing keys are empty in every template", () => {
  for (const file of [".env.example", ...templates]) {
    for (const line of read(file).split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && secretKey.test(match[1])) assert.equal(match[2].trim(), "", `${file}: ${match[1]} must be empty`);
    }
  }
});

test("docker-compose.yml has no secret literal, no published PostgreSQL port, a migrate service and a /ready healthcheck", () => {
  const compose = read("docker-compose.yml");
  for (const line of compose.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]*(?:PASSWORD|SECRET|KEY|TOKEN)[A-Z_]*):\s*(\S.*)$/);
    if (match) assert.ok(match[2].startsWith("${"), `${match[1]} must come from the environment`);
  }
  const postgres = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  migrate:"));
  assert.doesNotMatch(postgres, /ports:/);
  assert.match(compose, /^ {2}migrate:/m);
  assert.match(compose, /db:migrate/);
  assert.match(compose, /\/ready/);
  assert.match(compose, /profiles: \[scan\]/);
});

test("Dockerfiles run as non-root and copy no env file", () => {
  for (const file of ["apps/api/Dockerfile", "apps/web/Dockerfile"]) {
    const dockerfile = read(file);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /node:24\.21\.0/);
    assert.doesNotMatch(dockerfile, /COPY[^\n]*\.env/);
  }
  const ignore = read(".dockerignore");
  for (const entry of [".env*", ".data", "node_modules"]) assert.ok(ignore.includes(entry), `.dockerignore lacks ${entry}`);
});

test("the French deployment guide covers recovery, provisioning and out-of-scope items", () => {
  const path = "docs/deployment/guide-deploiement-pov.md";
  assert.ok(existsSync(join(root, path)));
  const guide = read(path);
  for (const heading of [/Hors périmètre/, /Sauvegarde/, /Restauration/, /Retour arrière/, /Provisionnement/]) assert.match(guide, heading);
  for (const term of [/Kubernetes/, /autoscaling/, /production sans approbation/, /NEON_DATABASE_URL/, /\/ready/]) assert.match(guide, term);
});
