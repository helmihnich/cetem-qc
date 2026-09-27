import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL must be set before initializing the database pool.");
}

export const databasePool = new Pool({ connectionString });

databasePool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});
