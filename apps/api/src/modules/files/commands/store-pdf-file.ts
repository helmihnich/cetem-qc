import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../../../db/transaction.js";
import type { ObjectStorage } from "../ports/object-storage.js";
import type { PdfScanner, ScanResult } from "../ports/pdf-scanner.js";
import { getStoredFileRow, presentStoredFiles, storedFileSelect } from "../queries/stored-files.js";
import type { StoredFile, StoredFileRow } from "../queries/stored-files.js";
import { deriveStatus } from "../queries/stored-files.js";
import { validatePdf } from "../validators/pdf.js";

export interface FileCommandDeps {
  pool: Pool;
  storage: ObjectStorage;
  scanner: PdfScanner;
  maxBytes: number;
}

/** Test-only seams: the production wiring supplies the configured storage and scanner. Never set in production. */
export const fileCommandTestSeams: { storage?: ObjectStorage; scanner?: PdfScanner } = {};

export type StorePdfFileOutcome =
  | { type: "stored"; file: StoredFile }
  | { type: "replayed"; file: StoredFile }
  | { type: "storage-failed"; file: StoredFile }
  | { type: "attempt-conflict" };

const scannerName = (scanner: PdfScanner): string => (scanner.id === "clamav" ? "clamav" : "none");
const lockQuery = "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))";

async function runScan(scanner: PdfScanner, bytes: Uint8Array): Promise<ScanResult> {
  try {
    return await scanner.scan(bytes);
  } catch {
    return "unavailable";
  }
}

async function insertScan(client: Pool | PoolClient, fileId: string, scanner: PdfScanner, result: ScanResult): Promise<void> {
  await client.query("INSERT INTO stored_file_checks (file_id, stage, result, scanner) VALUES ($1, 'scan', $2, $3)", [fileId, result, scannerName(scanner)]);
}

async function presentOne(client: Pool | PoolClient, fileId: string): Promise<StoredFile> {
  const rows = (await client.query<StoredFileRow>(`${storedFileSelect} WHERE file.id = $1`, [fileId])).rows;
  return (await presentStoredFiles(client, rows))[0]!;
}

type FirstTransaction =
  | { type: "inserted"; fileId: string; storageRef: string | null; status: "rejected" | "quarantined" | "continue" }
  | { type: "replayed"; file: StoredFile }
  | { type: "attempt-conflict" };

/**
 * Validates, stores and scans one manual PDF. The caller (route) has already authorized the task and the report
 * eligibility; `taskId` is an opaque scope here. Transaction A records the file and its validation result under a lock
 * on the attempt ID; the binary is stored and scanned outside any transaction; each result is an insert-only check row.
 * Rejected files are not stored. A scanner that fails or throws is `unavailable`, never clean.
 */
export async function storePdfFile(
  deps: FileCommandDeps,
  input: { taskId: string; uploaderId: string; attemptId: string; displayName: string; bytes: Uint8Array },
): Promise<StorePdfFileOutcome> {
  const { pool, storage, scanner, maxBytes } = deps;
  const { taskId, uploaderId, attemptId, displayName, bytes } = input;
  const validation = validatePdf(bytes, { maxBytes });
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const bind = (): Promise<FirstTransaction> => withTransaction(pool, async (transaction): Promise<FirstTransaction> => {
    await transaction.query(lockQuery, [`file-attempt:${attemptId}`]);
    const existing = (await transaction.query<StoredFileRow>(`${storedFileSelect} WHERE file.attempt_id = $1`, [attemptId])).rows[0];
    if (existing) {
      if (existing.task_id !== taskId) return { type: "attempt-conflict" };
      return { type: "replayed", file: (await presentStoredFiles(transaction, [existing]))[0]! };
    }
    const fileId = randomUUID();
    const storageRef = validation.result === "rejected" ? null : `files/pdf/${fileId}.pdf`;
    await transaction.query(
      `INSERT INTO stored_files (id, attempt_id, task_id, kind, display_name, byte_size, sha256, storage_ref, uploaded_by)
       VALUES ($1, $2, $3, 'manual-pdf', $4, $5, $6, $7, $8)`,
      [fileId, attemptId, taskId, displayName, bytes.length, sha256, storageRef, uploaderId],
    );
    await transaction.query(
      "INSERT INTO stored_file_checks (file_id, stage, result, failure_class) VALUES ($1, 'validation', $2, $3)",
      [fileId, validation.result, validation.result === "passed" ? null : validation.class],
    );
    return { type: "inserted", fileId, storageRef, status: validation.result === "passed" ? "continue" : validation.result };
  });

  let first: FirstTransaction;
  try {
    first = await bind();
  } catch (error) {
    // A concurrent insert of the same attempt resolves to the replay path.
    if ((error as { code?: string }).code !== "23505") throw error;
    first = await bind();
  }
  if (first.type === "replayed") return { type: "replayed", file: first.file };
  if (first.type === "attempt-conflict") return first;
  if (first.status === "rejected") return { type: "stored", file: await presentOne(pool, first.fileId) };

  const storageRef = first.storageRef!;
  try {
    await storage.put(storageRef, bytes);
  } catch {
    await storage.remove(storageRef).catch(() => undefined);
    await pool.query("INSERT INTO stored_file_checks (file_id, stage, result, failure_class) VALUES ($1, 'storage', 'failed', 'storage-failed')", [first.fileId]);
    return { type: "storage-failed", file: await presentOne(pool, first.fileId) };
  }
  await pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'storage', 'passed')", [first.fileId]);
  if (first.status === "quarantined") return { type: "stored", file: await presentOne(pool, first.fileId) };

  const result = await runScan(scanner, bytes);
  try {
    await insertScan(pool, first.fileId, scanner, result);
  } catch {
    // The scan result could not be recorded: the file stays scan-pending, never ready.
  }
  return { type: "stored", file: await presentOne(pool, first.fileId) };
}

export type RescanPdfFileOutcome =
  | { type: "rescanned"; file: StoredFile }
  | { type: "not-found" }
  | { type: "not-rescannable" };

async function statusOf(client: Pool | PoolClient, fileId: string): Promise<ReturnType<typeof deriveStatus>> {
  const checks = await client.query<{ stage: "validation" | "storage" | "scan"; result: string }>("SELECT stage, result FROM stored_file_checks WHERE file_id = $1 ORDER BY seq", [fileId]);
  return deriveStatus(checks.rows as Parameters<typeof deriveStatus>[0]);
}

/** Re-scans a `scan-failed` or `scan-pending` file by appending a scan check. Any other status writes nothing. */
export async function rescanPdfFile(deps: FileCommandDeps, taskId: string, fileId: string): Promise<RescanPdfFileOutcome> {
  const { pool, storage, scanner } = deps;
  const row = await getStoredFileRow(pool, taskId, fileId);
  if (!row) return { type: "not-found" };
  const rescannable = (status: string) => status === "scan-failed" || status === "scan-pending";
  if (!rescannable(await statusOf(pool, row.id)) || !row.storage_ref) return { type: "not-rescannable" };

  let result: ScanResult = "unavailable";
  try {
    const bytes = await storage.get(row.storage_ref);
    if (bytes) result = await runScan(scanner, bytes);
  } catch {
    result = "unavailable";
  }
  return withTransaction(pool, async (transaction): Promise<RescanPdfFileOutcome> => {
    await transaction.query(lockQuery, [`file:${row.id}`]);
    // Another request may have decided the file meanwhile (for example a threat): write nothing then.
    if (!rescannable(await statusOf(transaction, row.id))) return { type: "not-rescannable" };
    await insertScan(transaction, row.id, scanner, result);
    return { type: "rescanned", file: await presentOne(transaction, row.id) };
  });
}
