import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resetResponsablePassword } from "../modules/identity-auth/responsable-password-reset.js";

async function main(): Promise<void> {
  const terminal = createInterface({ input: stdin, output: stdout });
  let email = "";
  try {
    email = (await terminal.question("Responsable email: ")).trim();
  } finally {
    terminal.close();
  }

  const { databasePool } = await import("../db/pool.js");
  try {
    const reset = await resetResponsablePassword(databasePool, email);
    stdout.write(`Temporary password reset for ${reset.email}. Hand over this temporary credential once:\n${reset.temporaryPassword}\n`);
  } finally {
    await databasePool.end();
  }
}

main().catch(() => {
  // Errors can include database details; never print inputs or generated credentials.
  console.error("Responsable password reset failed. Check operator input and database connectivity.");
  process.exitCode = 1;
});
