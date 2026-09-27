import type { Pool, PoolClient } from "pg";

export type Transaction = PoolClient;

export async function withTransaction<T>(
  pool: Pool,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const transaction = await pool.connect();
  let hasPrimaryError = false;

  try {
    await transaction.query("BEGIN");
    const result = await work(transaction);
    await transaction.query("COMMIT");
    return result;
  } catch (error) {
    hasPrimaryError = true;
    try {
      await transaction.query("ROLLBACK");
    } catch (rollbackError) {
      try {
        console.error("Transaction rollback failed", rollbackError);
      } catch {
        // Reporting must not replace the original transaction failure.
      }
    }
    throw error;
  } finally {
    try {
      transaction.release();
    } catch (releaseError) {
      if (!hasPrimaryError) throw releaseError;
      try {
        console.error("Transaction release failed", releaseError);
      } catch {
        // Reporting must not replace the original transaction failure.
      }
    }
  }
}
