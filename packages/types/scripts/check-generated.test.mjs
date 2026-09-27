import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = path.join(packageRoot, "scripts/check-generated.mjs");
const contract = path.join(packageRoot, "openapi/cetem-qc-v1.yaml");

test("checker passes matching output and rejects stale output without overwriting it", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "cetem-qc-check-generated-"));
  const artifact = path.join(tempRoot, "api-v1.ts");
  const stale = "stale generated contract content\n";

  try {
    const generatedArtifact = await readFile(path.join(packageRoot, "src/generated/api-v1.ts"), "utf8");
    await writeFile(artifact, generatedArtifact);
    const matchingResult = spawnSync(process.execPath, [checker, contract, artifact], {
      cwd: packageRoot,
      encoding: "utf8",
    });
    assert.equal(matchingResult.status, 0, matchingResult.stderr || matchingResult.stdout);

    await writeFile(artifact, stale);
    const staleResult = spawnSync(process.execPath, [checker, contract, artifact], {
      cwd: packageRoot,
      encoding: "utf8",
    });
    assert.notEqual(staleResult.status, 0, "stale generated output should fail the checker");
    assert.equal(await readFile(artifact, "utf8"), stale, "checker must not overwrite stale output");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
