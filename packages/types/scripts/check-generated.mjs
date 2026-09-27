import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const contract = process.argv[2] ?? path.join(packageRoot, "openapi/cetem-qc-v1.yaml");
const committed = process.argv[3] ?? path.join(packageRoot, "src/generated/api-v1.ts");
const tempRoot = await mkdtemp(path.join(tmpdir(), "cetem-qc-openapi-"));
const generated = path.join(tempRoot, "api-v1.ts");

try {
  const executable = path.join(packageRoot, "node_modules/.bin/openapi-typescript");
  const result = process.platform === "win32"
    ? spawnSync(`"${executable}.cmd" "${contract}" -o "${generated}"`, { cwd: packageRoot, encoding: "utf8", shell: true })
    : spawnSync(executable, [contract, "-o", generated], { cwd: packageRoot, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "OpenAPI generation failed.\n");
    process.exitCode = result.status ?? 1;
  } else {
    const [actual, expected] = await Promise.all([readFile(committed, "utf8"), readFile(generated, "utf8")]);
    if (actual !== expected) {
      console.error("Generated API types are stale. Run `pnpm contracts:generate` and commit the result.");
      process.exitCode = 1;
    } else {
      console.log("Generated API types match the OpenAPI contract.");
    }
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
