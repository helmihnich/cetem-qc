import { Pool } from "pg";
import { resolveDatabaseUrl } from "../config/runtime-config.js";

export const databasePool = new Pool({ connectionString: resolveDatabaseUrl(process.env) });

databasePool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});
