import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { bootstrapFirstResponsable } from "../modules/identity-auth/bootstrap.js";

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
    const provisioned = await bootstrapFirstResponsable(databasePool, { email, displayName });
    stdout.write(`Account created for ${provisioned.email}. Hand over this temporary credential once:\n${provisioned.temporaryPassword}\n`);
  } finally {
    await databasePool.end();
  }
}

main().catch(() => {
  // Errors can include database details; never print inputs or generated credentials.
  console.error("Responsable bootstrap failed. Check operator input and database connectivity.");
  process.exitCode = 1;
});
