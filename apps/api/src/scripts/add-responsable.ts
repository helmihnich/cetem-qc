import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { addResponsable } from "../modules/identity-auth/bootstrap.js";

async function main(): Promise<void> {
  const terminal = createInterface({ input: stdin, output: stdout });
  let email = "";
  let displayName = "";
  try {
    email = (await terminal.question("Responsable email: ")).trim();
    displayName = (await terminal.question("Responsable name: ")).trim();
  } finally {
    terminal.close();
  }

  const { databasePool } = await import("../db/pool.js");
  try {
    const provisioned = await addResponsable(databasePool, { email, displayName });
    stdout.write(`Account created for ${provisioned.email}. Hand over this temporary credential once:\n${provisioned.temporaryPassword}\n`);
  } finally {
    await databasePool.end();
  }
}

main().catch((error: unknown) => {
  // Only the SQLSTATE code and the message of validation errors are shown; never inputs or generated credentials.
  const { code, message } = (error ?? {}) as { code?: string; message?: string };
  const reason = code === "23505" ? "this email already has an account" : code ?? message ?? "unknown error";
  console.error(`Responsable creation failed: ${reason}`);
  process.exitCode = 1;
});
