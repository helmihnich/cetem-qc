// Test-only SQLite double: a real SQLite engine (node:sqlite) behind the expo-sqlite methods the adapter uses.
// Never imported by the app.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export type SqliteTestDouble = {
  /** The shared engine; a "restart" opens a new adapter over the same rows. */
  engine: DatabaseSync;
  /** Every statement issued through the double, in order. */
  statements: string[];
  /** Makes the next matching statement throw (once). */
  failNext(pattern: RegExp): void;
  driver: { openDatabaseAsync(name: string): Promise<unknown> };
};

export function createSqliteTestDouble(engine = new DatabaseSync(":memory:")): SqliteTestDouble {
  const statements: string[] = [];
  const failures: RegExp[] = [];
  const track = (sql: string) => {
    statements.push(sql);
    const index = failures.findIndex((pattern) => pattern.test(sql));
    if (index >= 0) { failures.splice(index, 1); throw new Error(`Injected SQLite failure: ${sql.trim().slice(0, 60)}`); }
  };
  // SQLCipher is not available here: the key pragma is recorded but not applied.
  const isKeyPragma = (sql: string) => /^\s*PRAGMA\s+key\b/i.test(sql);
  const params = (values: unknown[]) => values as SQLInputValue[];
  const connection = {
    async execAsync(sql: string) { track(sql); if (!isKeyPragma(sql)) engine.exec(sql); },
    async getFirstAsync<T>(sql: string, ...values: unknown[]): Promise<T | null> {
      track(sql);
      return (engine.prepare(sql).get(...params(values)) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...values: unknown[]): Promise<T[]> {
      track(sql);
      return engine.prepare(sql).all(...params(values)) as T[];
    },
    async runAsync(sql: string, ...values: unknown[]) {
      track(sql);
      const result = engine.prepare(sql).run(...params(values));
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    async withExclusiveTransactionAsync(operation: (tx: typeof connection) => Promise<void>) {
      statements.push("BEGIN EXCLUSIVE");
      engine.exec("BEGIN EXCLUSIVE");
      try { await operation(connection); engine.exec("COMMIT"); statements.push("COMMIT"); } catch (error) {
        engine.exec("ROLLBACK"); statements.push("ROLLBACK"); throw error;
      }
    },
    async closeAsync() { /* the engine outlives adapters to simulate a restart */ },
  };
  return {
    engine,
    statements,
    failNext(pattern) { failures.push(pattern); },
    driver: { async openDatabaseAsync() { return connection; } },
  };
}
