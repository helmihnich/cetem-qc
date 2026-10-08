import type { Pool, PoolClient } from "pg";
import type { ObjectStorage } from "../ports/object-storage.js";

export type StoredFileStatus = "rejected" | "quarantined" | "scan-pending" | "scan-failed" | "storage-failed" | "ready";
export type ValidationResult = "passed" | "rejected" | "quarantined";
export type ScanOutcome = "clean" | "threat" | "unavailable" | "not-performed";

export interface StoredFile {
  id: string;
  attemptId: string;
  status: StoredFileStatus;
  fileName: string;
  byteSize: number;
  sha256: string;
  uploadedAt: string;
  uploadedBy: { id: string; displayName: string };
  validation: { result: ValidationResult; class: string | null };
  scan: { result: ScanOutcome | "pending"; scanner: "none" | "clamav" | null; checkedAt: string | null };
}

export interface StoredFileRow {
  id: string;
  attempt_id: string;
  task_id: string;
  display_name: string;
  byte_size: number;
  sha256: string;
  storage_ref: string | null;
  uploaded_by: string;
  uploader_name: string;
  uploaded_at: Date;
}

export interface CheckRow {
  file_id: string;
  stage: "validation" | "storage" | "scan";
  result: ValidationResult | ScanOutcome | "failed";
  failure_class: string | null;
  scanner: string | null;
  checked_at: Date;
}

export const storedFileSelect = `
  SELECT file.id, file.attempt_id, file.task_id, file.display_name, file.byte_size, file.sha256, file.storage_ref,
         file.uploaded_by, account.display_name AS uploader_name, file.uploaded_at
  FROM stored_files file
  JOIN identity_accounts account ON account.id = file.uploaded_by`;

type Executor = Pool | PoolClient;

/**
 * The single status derivation used by list, download, rescan and `getReadyFile`, from a file's checks in `seq` order:
 * a rejected or quarantined validation decides; then a failed storage; then the latest scan row. `ready` needs a passed
 * validation and a latest scan of `clean` or `not-performed`; an unavailable scan is never ready.
 */
export function deriveStatus(checks: readonly Pick<CheckRow, "stage" | "result">[]): StoredFileStatus {
  const validation = checks.find((check) => check.stage === "validation");
  if (validation?.result === "rejected") return "rejected";
  if (validation?.result === "quarantined") return "quarantined";
  if (checks.some((check) => check.stage === "storage" && check.result === "failed")) return "storage-failed";
  const scans = checks.filter((check) => check.stage === "scan");
  // A threat is final even if a later row were ever present.
  if (scans.some((check) => check.result === "threat")) return "quarantined";
  const latest = scans[scans.length - 1];
  if (!latest) return "scan-pending";
  if (latest.result === "clean" || latest.result === "not-performed") return validation?.result === "passed" ? "ready" : "scan-pending";
  return "scan-failed";
}

async function readChecks(client: Executor, fileIds: readonly string[]): Promise<Map<string, CheckRow[]>> {
  const byFile = new Map<string, CheckRow[]>();
  if (fileIds.length === 0) return byFile;
  const result = await client.query<CheckRow>(
    "SELECT file_id, stage, result, failure_class, scanner, checked_at FROM stored_file_checks WHERE file_id = ANY($1::uuid[]) ORDER BY seq",
    [fileIds],
  );
  for (const row of result.rows) byFile.set(row.file_id, [...(byFile.get(row.file_id) ?? []), row]);
  return byFile;
}

export function toStoredFile(row: StoredFileRow, checks: readonly CheckRow[]): StoredFile {
  const validation = checks.find((check) => check.stage === "validation");
  const scans = checks.filter((check) => check.stage === "scan");
  const latest = scans[scans.length - 1];
  return {
    id: row.id,
    attemptId: row.attempt_id,
    status: deriveStatus(checks),
    fileName: row.display_name,
    byteSize: row.byte_size,
    sha256: row.sha256,
    uploadedAt: row.uploaded_at.toISOString(),
    uploadedBy: { id: row.uploaded_by, displayName: row.uploader_name },
    validation: { result: (validation?.result ?? "passed") as ValidationResult, class: validation?.failure_class ?? null },
    scan: latest
      ? { result: latest.result as ScanOutcome, scanner: latest.scanner === "clamav" ? "clamav" : "none", checkedAt: latest.checked_at.toISOString() }
      : { result: "pending", scanner: null, checkedAt: null },
  };
}

/** Maps file rows to contract files, reading their checks. Never exposes the storage reference. */
export async function presentStoredFiles(client: Executor, rows: readonly StoredFileRow[]): Promise<StoredFile[]> {
  const checks = await readChecks(client, rows.map((row) => row.id));
  return rows.map((row) => toStoredFile(row, checks.get(row.id) ?? []));
}

/** The stored files of a task, newest first. The caller has already authorized the task. Read only. */
export async function listStoredFiles(client: Executor, taskId: string): Promise<StoredFile[]> {
  const result = await client.query<StoredFileRow>(`${storedFileSelect} WHERE file.task_id = $1 ORDER BY file.seq DESC`, [taskId]);
  return presentStoredFiles(client, result.rows);
}

export async function getStoredFileRow(client: Executor, taskId: string, fileId: string): Promise<StoredFileRow | undefined> {
  const result = await client.query<StoredFileRow>(`${storedFileSelect} WHERE file.task_id = $1 AND file.id = $2`, [taskId, fileId]);
  return result.rows[0];
}

export interface ReadyPdfFile {
  file: StoredFile;
  storageRef: string;
}

/** The file and its storage reference only when its derived status is `ready`; internal to the route and `readStoredFile`. */
export async function getReadyPdfFile(client: Executor, taskId: string, fileId: string): Promise<ReadyPdfFile | undefined> {
  const row = await getStoredFileRow(client, taskId, fileId);
  if (!row || !row.storage_ref) return undefined;
  const [file] = await presentStoredFiles(client, [row]);
  return file && file.status === "ready" ? { file, storageRef: row.storage_ref } : undefined;
}

export interface ReadyFile {
  id: string;
  fileName: string;
  byteSize: number;
  sha256: string;
  scanResult: "clean" | "not-performed";
  uploadedBy: { id: string; displayName: string };
  uploadedAt: string;
}

/** Public contract for Story 11.3: only `ready` file metadata of an owner scope, never the storage reference. */
export async function getReadyFile(client: Executor, ownerScope: { taskId: string; fileId: string }): Promise<ReadyFile | undefined> {
  const ready = await getReadyPdfFile(client, ownerScope.taskId, ownerScope.fileId);
  if (!ready) return undefined;
  const { file } = ready;
  return {
    id: file.id, fileName: file.fileName, byteSize: file.byteSize, sha256: file.sha256,
    scanResult: file.scan.result === "clean" ? "clean" : "not-performed", uploadedBy: file.uploadedBy, uploadedAt: file.uploadedAt,
  };
}

/** The derived status of a file of a task, or undefined for an unknown file or a file of another task. Never exposes the storage reference. */
export async function getStoredFileStatus(client: Executor, ownerScope: { taskId: string; fileId: string }): Promise<StoredFileStatus | undefined> {
  const row = await getStoredFileRow(client, ownerScope.taskId, ownerScope.fileId);
  if (!row) return undefined;
  const checks = await readChecks(client, [row.id]);
  return deriveStatus(checks.get(row.id) ?? []);
}

/** The scan note of each given file: `clean`, `not-performed`, or null for a file that is not `ready`. Files not found are absent. */
export async function getFileScanResults(client: Executor, fileIds: readonly string[]): Promise<Map<string, "clean" | "not-performed" | null>> {
  const results = new Map<string, "clean" | "not-performed" | null>();
  if (fileIds.length === 0) return results;
  const checks = await readChecks(client, fileIds);
  const known = await client.query<{ id: string }>("SELECT id FROM stored_files WHERE id = ANY($1::uuid[])", [fileIds]);
  for (const { id } of known.rows) {
    const own = checks.get(id) ?? [];
    if (deriveStatus(own) !== "ready") { results.set(id, null); continue; }
    const scans = own.filter((check) => check.stage === "scan");
    results.set(id, scans[scans.length - 1]?.result === "clean" ? "clean" : "not-performed");
  }
  return results;
}

/** The bytes of a `ready` file, or undefined when the file is not ready or the object is missing. */
export async function readStoredFile(client: Executor, storage: ObjectStorage, ownerScope: { taskId: string; fileId: string }): Promise<{ file: StoredFile; bytes: Uint8Array } | undefined> {
  const ready = await getReadyPdfFile(client, ownerScope.taskId, ownerScope.fileId);
  if (!ready) return undefined;
  const bytes = await storage.get(ready.storageRef);
  return bytes ? { file: ready.file, bytes } : undefined;
}
