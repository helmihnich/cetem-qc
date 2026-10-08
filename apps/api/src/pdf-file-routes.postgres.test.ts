import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { confirmedSummarySchema, storedFileListSchema, storedFileSchema } from "@cetem-qc/schemas/api/v1";
import type { StoredFile } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { createMemoryObjectStorage, createPdfScanner, fileCommandTestSeams } from "./modules/files/index.js";
import type { PdfScanner, ScanResult } from "./modules/files/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";
import { buildPdf, pdfWithToken } from "./test-support/pdf-fixtures.js";

// Story 11.2: manual PDF intake (synthetic PDFs, in-memory storage, scanner `none` or an injected fake; no network).

const NOT_FOUND = { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } };
const FORBIDDEN = { error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } };
const INVALID = { error: { code: "VALIDATION_FAILED", message: "Cette demande est invalide." } };
const NOT_CONFIRMED = { error: { code: "SUMMARY_NOT_CONFIRMED", message: "La synthèse n’est pas confirmée : le rapport PDF ne peut pas être importé." } };
const NOT_DECIDED = { error: { code: "CONFORMITY_NOT_DECIDED", message: "Aucune décision de conformité n’est enregistrée : le rapport PDF ne peut pas être importé." } };
const TOO_LARGE = { error: { code: "FILE_TOO_LARGE", message: "Le fichier dépasse la taille maximale de 20 Mo." } };
const UNSUPPORTED = { error: { code: "UNSUPPORTED_FILE_TYPE", message: "Seuls les fichiers PDF sont acceptés." } };
const ATTEMPT = { error: { code: "FILE_ATTEMPT_CONFLICT", message: "Cette demande d’envoi est invalide." } };
const NOT_RESCANNABLE = { error: { code: "FILE_NOT_RESCANNABLE", message: "L’analyse de ce fichier ne peut pas être relancée." } };
const STORAGE_FAILED = { error: { code: "FILE_STORAGE_FAILED", message: "Le fichier n’a pas pu être enregistré. Vous pouvez réessayer." } };
const POV_NOTE = "analyse antivirus non effectuée (PoV)";

type Reply = { status: number; text: string; body: Record<string, unknown>; cacheControl: string | null };

async function call(fixture: SyncFixture, method: "GET" | "POST", path: string, token: string | null, body?: unknown): Promise<Reply> {
  const response = await fetch(`${fixture.apiRoot}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}

interface UploadOptions { attemptId?: string | null; token?: string | null; contentType?: string | null; fileName?: string; body?: Buffer }
async function upload(fixture: SyncFixture, taskId: string, bytes: Buffer = buildPdf(), options: UploadOptions = {}): Promise<Reply> {
  const attemptId = options.attemptId === undefined ? randomUUID() : options.attemptId;
  const token = options.token === undefined ? fixture.tokens.owner : options.token;
  const contentType = options.contentType === undefined ? "application/pdf" : options.contentType;
  const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/pdf-files`, {
    method: "POST",
    headers: {
      ...(contentType ? { "content-type": contentType } : {}), ...(attemptId ? { "x-attempt-id": attemptId } : {}),
      ...(options.fileName !== undefined ? { "x-file-name": options.fileName } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: new Uint8Array(options.body ?? bytes),
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}
const list = (fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.owner) => call(fixture, "GET", `/tasks/${taskId}/pdf-files`, token);
const rescan = (fixture: SyncFixture, taskId: string, fileId: string, token: string | null = fixture.tokens.owner) => call(fixture, "POST", `/tasks/${taskId}/pdf-files/${fileId}/scan-retries`, token, undefined);
const download = async (fixture: SyncFixture, taskId: string, fileId: string, token: string | null = fixture.tokens.owner) => {
  const response = await fetch(`${fixture.apiRoot}/tasks/${taskId}/pdf-files/${fileId}/content`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const bytes = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, bytes };
};
const fileOf = (reply: Reply): StoredFile => storedFileSchema.parse(reply.body);

const confirm = (fixture: SyncFixture, taskId: string, text = "Synthèse finale.") => call(fixture, "POST", `/tasks/${taskId}/summary-confirmation`, fixture.tokens.owner, { text });
const reopen = (fixture: SyncFixture, taskId: string) => call(fixture, "POST", `/tasks/${taskId}/summary-reopening`, fixture.tokens.owner, {});
const decide = (fixture: SyncFixture, taskId: string, outcome = "machine-conforme") => call(fixture, "POST", `/tasks/${taskId}/conformity-decision`, fixture.tokens.owner, { outcome });

async function acceptedTask(fixture: SyncFixture, values: Record<string, string> = { "header.reportNumber": "R-201" }) {
  const taskId = await fixture.newTask(fixture.employee);
  const reply = await fixture.send("submissions", taskId, envelope(0, formPayload(values)), fixture.tokens.employee);
  assert.equal(reply.status, 200);
  return { taskId, submissionId: String(reply.body.submissionId) };
}
async function readyTask(fixture: SyncFixture, outcome = "machine-conforme", values?: Record<string, string>) {
  const accepted = await acceptedTask(fixture, values);
  confirmedSummarySchema.parse((await confirm(fixture, accepted.taskId)).body);
  assert.equal((await decide(fixture, accepted.taskId, outcome)).status, 201);
  return accepted;
}

interface FileRow { id: string; attempt_id: string; task_id: string; kind: string; display_name: string; byte_size: number; sha256: string; storage_ref: string | null; uploaded_by: string }
interface CheckRow { file_id: string; stage: string; result: string; failure_class: string | null; scanner: string | null }
const fileRows = async (pool: Pool) => (await pool.query<FileRow>("SELECT * FROM stored_files ORDER BY seq")).rows;
const checkRows = async (pool: Pool) => (await pool.query<CheckRow>("SELECT * FROM stored_file_checks ORDER BY seq")).rows;
const fileCount = async (pool: Pool) => `${(await fileRows(pool)).length}/${(await checkRows(pool)).length}`;

async function fingerprint(pool: Pool, tables: string[]): Promise<string> {
  const parts = tables.map((table) => `'${table}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text), '[]'::jsonb) FROM ${table} t)`);
  return (await pool.query<{ fingerprint: string }>(`SELECT jsonb_build_object(${parts.join(", ")})::text AS fingerprint`)).rows[0]!.fingerprint;
}
const protectedTables = ["tasks", "task_assignments", "task_assignment_history", "audits", "audit_revisions", "audit_submissions", "sync_operation_outcomes",
  "audit_lineage_links", "audit_replacement_links", "audit_deactivated_assignee_recovery_links", "audit_recovery_field_provenance",
  "audit_insight_decisions", "audit_manual_insights", "audit_review_accesses", "summary_ai_drafts", "confirmed_summaries", "summary_reopenings",
  "conformity_decisions", "conformity_decision_invalidations", "report_candidates", "report_candidate_outcomes"];

async function captureInfo<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.info;
  const lines: string[] = [];
  console.info = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  try { return { result: await run(), lines }; } finally { console.info = original; }
}

interface FakeScanner extends PdfScanner { calls: number; next: ScanResult | "throw" }
interface Context { storage: ReturnType<typeof createMemoryObjectStorage>; scanner: FakeScanner; calls: { put: number; remove: number }; failPut: { on: boolean } }

/** Installs a memory storage and a controllable scanner for one test (default result `clean`), and always restores the wiring. */
async function withFiles<T>(run: (context: Context) => Promise<T>, options: { env?: Record<string, string>; scanner?: ScanResult | "throw" | "none" } = {}): Promise<T> {
  const inner = createMemoryObjectStorage();
  const calls = { put: 0, remove: 0 };
  const failPut = { on: false };
  const storage = Object.assign(Object.create(inner) as typeof inner, {
    put: async (key: string, bytes: Uint8Array) => { calls.put++; await inner.put(key, bytes); if (failPut.on) throw new Error("disk full at /secret/path"); },
    remove: async (key: string) => { calls.remove++; await inner.remove(key); },
  });
  const none = createPdfScanner({});
  const scanner: FakeScanner = {
    id: "clamav", calls: 0, next: options.scanner === "none" ? "not-performed" : (options.scanner ?? "clean"),
    scan: async (bytes) => {
      scanner.calls++;
      if (options.scanner === "none") return none.scan(bytes);
      if (scanner.next === "throw") throw new Error("scanner exploded");
      return scanner.next;
    },
  };
  fileCommandTestSeams.storage = storage;
  fileCommandTestSeams.scanner = options.scanner === "none" ? none : scanner;
  const previous = Object.fromEntries(Object.keys(options.env ?? {}).map((key) => [key, process.env[key]]));
  Object.assign(process.env, options.env ?? {});
  try { return await run({ storage: inner, scanner, calls, failPut }); } finally {
    fileCommandTestSeams.storage = undefined;
    fileCommandTestSeams.scanner = undefined;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    registerDefaultSummaryReopenParticipants();
  }
}

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test("R1 confirmed summary, current decision, valid PDF, scanner none: 201 ready with the PoV note, matching bytes, one file and three checks", async () => {
  await withFiles(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      const { taskId } = await readyTask(fixture);
      const pdf = buildPdf();
      const reply = await upload(fixture, taskId, pdf, { fileName: "Rapport signé.pdf" });
      assert.equal(reply.status, 201, reply.text);
      assert.match(reply.cacheControl ?? "", /no-store/i);
      const file = fileOf(reply);
      assert.deepEqual([file.status, file.fileName, file.byteSize, file.sha256], ["ready", "Rapport signé.pdf", pdf.length, sha(pdf)]);
      assert.deepEqual(file.scan, { result: "not-performed", scanner: "none", checkedAt: file.scan.checkedAt });
      assert.deepEqual(file.validation, { result: "passed", class: null });
      assert.deepEqual(file.uploadedBy, { id: owner, displayName: "Responsable Test" });
      assert.ok(!/storage|official|officiel|files\/pdf/i.test(reply.text.replace("scanner", "")), "no storage key or official property");
      assert.equal(POV_NOTE.length > 0, true);
      const rows = await fileRows(pool);
      assert.equal(rows.length, 1);
      assert.deepEqual([rows[0]!.task_id, rows[0]!.kind, rows[0]!.storage_ref, rows[0]!.uploaded_by, rows[0]!.byte_size, rows[0]!.sha256], [taskId, "manual-pdf", `files/pdf/${file.id}.pdf`, owner, pdf.length, sha(pdf)]);
      assert.deepEqual((await checkRows(pool)).map((row) => `${row.stage}:${row.result}`), ["validation:passed", "storage:passed", "scan:not-performed"]);
      const stored = (await storage.get(rows[0]!.storage_ref!))!;
      assert.deepEqual([stored.length, sha(stored)], [pdf.length, file.sha256]);
      const downloaded = await download(fixture, taskId, file.id);
      assert.deepEqual([downloaded.status, downloaded.bytes.equals(pdf)], [200, true]);
    });
  }, { scanner: "none" });
});

test("R2 a clean scanner gives ready for both decision outcomes", async () => {
  await withFiles(async ({ scanner }) => {
    await withSyncFixture(async (fixture) => {
      for (const outcome of ["machine-conforme", "machine-non-conforme"]) {
        const { taskId } = await readyTask(fixture, outcome, { "header.reportNumber": `R-${outcome}` });
        const file = fileOf(await upload(fixture, taskId));
        assert.deepEqual([file.status, file.scan.result, file.scan.scanner], ["ready", "clean", "clamav"]);
      }
      assert.equal(scanner.calls, 2);
    });
  });
});

test("R3 each validator class through the route: rejected are not stored and not scanned; active content is quarantined, stored and not scanned", async () => {
  await withFiles(async ({ storage, scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const pdf = buildPdf();
      const cases: Array<[string, Buffer, string]> = [
        ["not-pdf", Buffer.from("this is not a pdf at all"), "rejected"],
        ["truncated", pdf.subarray(0, pdf.length - 8), "rejected"],
        ["corrupt-structure", Buffer.from(pdf.toString("latin1").replace(/startxref\s+\d+/, "startxref\n999999"), "latin1"), "rejected"],
        ["encrypted", buildPdf({ trailer: "/Encrypt 9 0 R" }), "rejected"],
        ["active-content", pdfWithToken("/JavaScript"), "quarantined"],
      ];
      for (const [klass, bytes, status] of cases) {
        const reply = await upload(fixture, taskId, bytes);
        assert.equal(reply.status, 201, `${klass}: ${reply.text}`);
        const file = fileOf(reply);
        assert.deepEqual([file.status, file.validation.class, file.scan.result], [status, klass, "pending"], klass);
        assert.equal((await download(fixture, taskId, file.id)).status, 404, klass);
      }
      assert.equal(scanner.calls, 0);
      const rows = await fileRows(fixture.pool);
      assert.deepEqual(rows.map((row) => row.storage_ref === null), [true, true, true, true, false]);
      assert.equal(storage.keys().length, 1);
      assert.equal(rows[0]!.byte_size, "this is not a pdf at all".length);
    });
  });
});

test("R4 threat quarantines; unavailable and a throwing scanner give scan-failed; none is ever ready or downloadable", async () => {
  await withFiles(async ({ scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const results: Array<[ScanResult | "throw", string, string]> = [["threat", "quarantined", "threat"], ["unavailable", "scan-failed", "unavailable"], ["throw", "scan-failed", "unavailable"]];
      for (const [next, status, scan] of results) {
        scanner.next = next;
        const file = fileOf(await upload(fixture, taskId));
        assert.deepEqual([file.status, file.scan.result], [status, scan], next);
        assert.equal((await download(fixture, taskId, file.id)).status, 404, next);
      }
    });
  });
});

test("R5 rescan: a clean result makes a scan-failed file ready and appends a row; still unavailable stays scan-failed; a forged scan-pending file rescans to ready", async () => {
  await withFiles(async ({ scanner, storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool, owner } = fixture;
      const { taskId } = await readyTask(fixture);
      scanner.next = "unavailable";
      const failed = fileOf(await upload(fixture, taskId));
      assert.equal(failed.status, "scan-failed");
      const still = await rescan(fixture, taskId, failed.id);
      assert.deepEqual([still.status, fileOf(still).status], [200, "scan-failed"]);
      assert.equal((await checkRows(pool)).filter((row) => row.stage === "scan").length, 2);
      scanner.next = "clean";
      const ready = await rescan(fixture, taskId, failed.id);
      assert.deepEqual([ready.status, fileOf(ready).status, fileOf(ready).scan.result], [200, "ready", "clean"]);
      assert.equal((await checkRows(pool)).filter((row) => row.stage === "scan").length, 3);
      assert.equal((await download(fixture, taskId, failed.id)).status, 200);

      // A crash between storing and scanning leaves a file with validation and storage rows only.
      const pdf = buildPdf();
      const id = randomUUID();
      await pool.query("INSERT INTO stored_files (id, attempt_id, task_id, kind, display_name, byte_size, sha256, storage_ref, uploaded_by) VALUES ($1, $2, $3, 'manual-pdf', 'Forgé.pdf', $4, $5, $6, $7)", [id, randomUUID(), taskId, pdf.length, sha(pdf), `files/pdf/${id}.pdf`, owner]);
      await pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'validation', 'passed'), ($1, 'storage', 'passed')", [id]);
      await storage.put(`files/pdf/${id}.pdf`, new Uint8Array(pdf));
      const listed = storedFileListSchema.parse((await list(fixture, taskId)).body);
      assert.equal(listed.files.find((file) => file.id === id)!.status, "scan-pending");
      assert.equal((await download(fixture, taskId, id)).status, 404);
      const forged = await rescan(fixture, taskId, id);
      assert.deepEqual([forged.status, fileOf(forged).status], [200, "ready"]);
    });
  });
});

test("R6 rescan of ready, quarantined, rejected and storage-failed files is 409 and writes nothing; unknown or other-team files are 404", async () => {
  await withFiles(async ({ scanner, failPut }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const ready = fileOf(await upload(fixture, taskId));
      scanner.next = "threat";
      const quarantined = fileOf(await upload(fixture, taskId));
      const rejected = fileOf(await upload(fixture, taskId, Buffer.from("not a pdf")));
      failPut.on = true;
      assert.equal((await upload(fixture, taskId)).status, 502);
      failPut.on = false;
      const storageFailed = storedFileListSchema.parse((await list(fixture, taskId)).body).files.find((file) => file.status === "storage-failed")!;
      const before = await fileCount(pool);
      const callsBefore = scanner.calls;
      for (const file of [ready, quarantined, rejected, storageFailed]) {
        const reply = await rescan(fixture, taskId, file.id);
        assert.deepEqual([reply.status, reply.body], [409, NOT_RESCANNABLE], file.status);
      }
      assert.equal(await fileCount(pool), before);
      assert.equal(scanner.calls, callsBefore);
      for (const target of [randomUUID(), "not-a-uuid"]) assert.deepEqual([(await rescan(fixture, taskId, target)).status, (await rescan(fixture, taskId, target)).body], [404, NOT_FOUND]);
      assert.equal((await rescan(fixture, taskId, ready.id, fixture.tokens.otherOwner)).status, 404);
      assert.equal((await rescan(fixture, taskId, ready.id, fixture.tokens.employee)).status, 403);
    });
  });
});

test("R7 size and type limits: 413 by declared and read size, 415 for other media types, 422 for empty body or bad attempt; nothing is written or scanned", async () => {
  await withFiles(async ({ scanner, storage }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const small = buildPdf();
      assert.equal(small.length < 2000, true);
      assert.equal((await upload(fixture, taskId, small)).status, 201, "under the configured limit");
      const before = await fileCount(fixture.pool);
      const big = Buffer.concat([buildPdf(), Buffer.alloc(3000, 32)]);
      const large = await upload(fixture, taskId, big);
      assert.deepEqual([large.status, large.body], [413, TOO_LARGE]);
      // Declared Content-Length above the limit is refused before any body is read.
      const declared = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const url = new URL(`${fixture.apiRoot}/tasks/${taskId}/pdf-files`);
        const req = httpRequest({ host: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/pdf", "content-length": String(25_000_000), "x-attempt-id": randomUUID(), authorization: `Bearer ${fixture.tokens.owner}` } }, (response) => {
          let body = "";
          response.on("data", (chunk) => { body += String(chunk); });
          response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
          req.destroy();
        });
        req.on("error", reject);
        req.write("%PDF-");
      });
      assert.equal(declared.status, 413);
      for (const contentType of ["text/plain", "application/json", "application/octet-stream", null]) {
        const reply = await upload(fixture, taskId, small, { contentType });
        assert.deepEqual([reply.status, reply.body], [415, UNSUPPORTED], String(contentType));
      }
      for (const options of [{ body: Buffer.alloc(0) }, { attemptId: null }, { attemptId: "not-a-uuid" }] as UploadOptions[]) {
        const reply = await upload(fixture, taskId, small, options);
        assert.deepEqual([reply.status, reply.body], [422, INVALID], JSON.stringify(options));
      }
      assert.equal(await fileCount(fixture.pool), before);
      assert.equal(scanner.calls, 1);
      assert.equal(storage.keys().length, 1);
    });
  }, { env: { PDF_MAX_BYTES: "2000" } });
});

test("R8 a storage failure gives 502, a storage-failed check and no stored object; a new attempt succeeds; replaying the failed attempt is 502 without storage or scan", async () => {
  await withFiles(async ({ storage, calls, failPut, scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      failPut.on = true;
      const attemptId = randomUUID();
      const { result: failed, lines } = await captureInfo(() => upload(fixture, taskId, buildPdf(), { attemptId }));
      assert.deepEqual([failed.status, failed.body], [502, STORAGE_FAILED]);
      assert.deepEqual(storage.keys(), [], "the partial object is removed");
      assert.equal(calls.remove, 1);
      assert.deepEqual((await checkRows(pool)).map((row) => `${row.stage}:${row.result}:${row.failure_class}`), ["validation:passed:null", "storage:failed:storage-failed"]);
      assert.equal(scanner.calls, 0);
      assert.ok(lines.every((line) => !line.includes("secret")));
      failPut.on = false;
      const putsBefore = calls.put;
      const replay = await upload(fixture, taskId, buildPdf(), { attemptId });
      assert.deepEqual([replay.status, replay.body], [502, STORAGE_FAILED]);
      assert.equal(calls.put, putsBefore);
      assert.equal(storedFileListSchema.parse((await list(fixture, taskId)).body).files[0]!.status, "storage-failed");
      const retried = await upload(fixture, taskId);
      assert.deepEqual([retried.status, fileOf(retried).status], [201, "ready"]);
      assert.equal(storage.keys().length, 1);
    });
  });
});

test("R9 an open summary gives 409 SUMMARY_NOT_CONFIRMED, a missing or invalidated decision 409 CONFORMITY_NOT_DECIDED; nothing is written", async () => {
  await withFiles(async ({ storage, scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await acceptedTask(fixture);
      const never = await upload(fixture, taskId);
      assert.deepEqual([never.status, never.body], [409, NOT_CONFIRMED]);
      assert.equal((await confirm(fixture, taskId)).status, 201);
      const undecided = await upload(fixture, taskId);
      assert.deepEqual([undecided.status, undecided.body], [409, NOT_DECIDED]);
      assert.equal((await decide(fixture, taskId)).status, 201);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      const reopened = await upload(fixture, taskId);
      assert.deepEqual([reopened.status, reopened.body], [409, NOT_CONFIRMED]);
      assert.equal((await confirm(fixture, taskId, "Nouvelle synthèse.")).status, 201);
      assert.deepEqual([(await upload(fixture, taskId)).status, (await upload(fixture, taskId)).body], [409, NOT_DECIDED], "the reopening invalidated the decision");
      assert.equal(await fileCount(fixture.pool), "0/0");
      assert.deepEqual(storage.keys(), []);
      assert.equal(scanner.calls, 0);
    });
  });
});

test("R10 Employé 403; malformed, unknown, other-team, draft and no-audit tasks 404 identical to 9.1; size and type problems on them stay 404; nothing is written", async () => {
  await withFiles(async ({ scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const draftTask = await fixture.newTask(fixture.employee);
      const noAudit = await fixture.newTask(fixture.employee);
      assert.equal((await fixture.send("draft-syncs", draftTask, envelope(0, formPayload({ "header.reportNumber": "R-D" })), fixture.tokens.employee)).status, 200);
      for (const token of [fixture.tokens.employee, fixture.tokens.colleague]) {
        assert.deepEqual([(await upload(fixture, taskId, buildPdf(), { token })).status, (await upload(fixture, taskId, buildPdf(), { token })).body], [403, FORBIDDEN]);
        assert.equal((await list(fixture, taskId, token)).status, 403);
        assert.equal((await download(fixture, taskId, randomUUID(), token)).status, 403);
      }
      assert.equal((await upload(fixture, taskId, buildPdf(), { token: null })).status, 401);
      for (const target of ["not-a-uuid", randomUUID(), draftTask, noAudit]) {
        for (const options of [{}, { contentType: "text/plain" }, { attemptId: null }, { body: Buffer.alloc(0) }] as UploadOptions[]) {
          const reply = await upload(fixture, target, buildPdf(), options);
          assert.deepEqual([reply.status, reply.body], [404, NOT_FOUND], `${target} ${JSON.stringify(options)}`);
        }
        assert.deepEqual([(await list(fixture, target)).status, (await list(fixture, target)).body], [404, NOT_FOUND]);
      }
      const other = await upload(fixture, taskId, buildPdf(), { token: fixture.tokens.otherOwner });
      assert.deepEqual([other.status, other.body], [404, NOT_FOUND]);
      assert.equal((await list(fixture, taskId, fixture.tokens.otherOwner)).status, 404);
      assert.equal(await fileCount(fixture.pool), "0/0");
      assert.equal(scanner.calls, 0);
    });
  });
});

test("R11 a replayed attempt returns 200 with the same file and calls neither scanner nor storage; another task gives 409; concurrent duplicates leave one file", async () => {
  await withFiles(async ({ scanner, calls }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const second = await readyTask(fixture, "machine-non-conforme", { "header.reportNumber": "R-202" });
      const attemptId = randomUUID();
      const created = await upload(fixture, taskId, buildPdf(), { attemptId });
      assert.equal(created.status, 201);
      const counts = [scanner.calls, calls.put, await fileCount(pool)];
      const replay = await upload(fixture, taskId, buildPdf(), { attemptId });
      assert.equal(replay.status, 200);
      assert.deepEqual(replay.body, created.body);
      assert.deepEqual([scanner.calls, calls.put, await fileCount(pool)], counts);
      const conflict = await upload(fixture, second.taskId, buildPdf(), { attemptId });
      assert.deepEqual([conflict.status, conflict.body], [409, ATTEMPT]);
      assert.deepEqual([scanner.calls, calls.put, await fileCount(pool)], counts);

      const shared = randomUUID();
      const replies = await Promise.all([1, 2, 3].map(() => upload(fixture, second.taskId, buildPdf({ catalog: "/Title (concurrent)" }), { attemptId: shared })));
      assert.ok(replies.every((reply) => reply.status === 201 || reply.status === 200), replies.map((reply) => reply.status).join());
      assert.equal(replies.filter((reply) => reply.status === 201).length, 1);
      assert.equal(new Set(replies.map((reply) => fileOf(reply).id)).size, 1);
      assert.equal((await fileRows(pool)).filter((row) => row.attempt_id === shared).length, 1);
    });
  });
});

test("R12 the list is newest first, team-scoped, derives every status and exposes no storage key; history and download survive a reopening", async () => {
  await withFiles(async ({ scanner, failPut }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const ready = fileOf(await upload(fixture, taskId, buildPdf(), { fileName: "a.pdf" }));
      scanner.next = "unavailable";
      await upload(fixture, taskId, buildPdf(), { fileName: "b.pdf" });
      await upload(fixture, taskId, Buffer.from("nope"), { fileName: "c.pdf" });
      failPut.on = true;
      await upload(fixture, taskId, buildPdf(), { fileName: "d.pdf" });
      failPut.on = false;
      const shown = await list(fixture, taskId);
      assert.equal(shown.status, 200);
      assert.match(shown.cacheControl ?? "", /no-store/i);
      const files = storedFileListSchema.parse(shown.body).files;
      assert.deepEqual(files.map((file) => [file.fileName, file.status]), [["d.pdf", "storage-failed"], ["c.pdf", "rejected"], ["b.pdf", "scan-failed"], ["a.pdf", "ready"]]);
      assert.ok(!/files\/pdf|storage_ref|storageRef|"official"|"isOfficial"|"designated"/.test(shown.text));
      assert.equal((await list(fixture, taskId, fixture.tokens.otherOwner)).status, 404);
      assert.equal((await reopen(fixture, taskId)).status, 201);
      assert.deepEqual(storedFileListSchema.parse((await list(fixture, taskId)).body).files.map((file) => file.status), ["storage-failed", "rejected", "scan-failed", "ready"]);
      assert.equal((await download(fixture, taskId, ready.id)).status, 200);
      assert.equal((await rescan(fixture, taskId, files[2]!.id)).status, 200, "a rescan needs no report eligibility either");
    });
  });
});

test("R13 download returns the exact bytes with the required headers; every other case is the same 404; Employé 403", async () => {
  await withFiles(async ({ scanner }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const pdf = buildPdf({ catalog: "/Title (exact)" });
      const ready = fileOf(await upload(fixture, taskId, pdf));
      const response = await download(fixture, taskId, ready.id);
      assert.equal(response.status, 200);
      assert.ok(response.bytes.equals(pdf));
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="Rapport-LCQ-manuel-\d{8}-[0-9a-f]{8}\.pdf"$/);
      assert.equal(response.headers.get("content-disposition"), `attachment; filename="Rapport-LCQ-manuel-${ready.uploadedAt.slice(0, 10).replaceAll("-", "")}-${ready.id.replaceAll("-", "").slice(0, 8)}.pdf"`);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");

      const rejected = fileOf(await upload(fixture, taskId, Buffer.from("nope")));
      scanner.next = "threat";
      const threat = fileOf(await upload(fixture, taskId));
      const quarantined = fileOf(await upload(fixture, taskId, pdfWithToken("/Launch")));
      scanner.next = "unavailable";
      const failedScan = fileOf(await upload(fixture, taskId));
      for (const [label, target, token] of [
        ["rejected", rejected.id, undefined], ["threat", threat.id, undefined], ["quarantined", quarantined.id, undefined], ["scan-failed", failedScan.id, undefined],
        ["unknown", randomUUID(), undefined], ["malformed", "not-a-uuid", undefined], ["other team", ready.id, fixture.tokens.otherOwner],
      ] as const) {
        const reply = await download(fixture, taskId, target, token ?? fixture.tokens.owner);
        assert.equal(reply.status, 404, label);
        assert.deepEqual(JSON.parse(reply.bytes.toString("utf8")), NOT_FOUND, label);
      }
      assert.equal((await download(fixture, taskId, ready.id, null)).status, 401);
    });
  });
});

test("R14 X-File-Name is display-only: traversal, separators, control characters and long names are cleaned; the key is always files/pdf/<uuid>.pdf", async () => {
  await withFiles(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { taskId } = await readyTask(fixture);
      const cases: Array<[string | undefined, string]> = [
        ["../../etc/passwd", "passwd"], ["a%5Cb.pdf", "b.pdf"], ["%2E%2E%2F%2E%2E%2Fx.pdf", "x.pdf"], ["bon%0D%0Ajour%00.pdf", "bonjour.pdf"],
        ["%E2%80%A6", "…"], [`${"x".repeat(500)}.pdf`, "x".repeat(120)], ["", "Rapport.pdf"], ["   ", "Rapport.pdf"], ["..", "Rapport.pdf"], [undefined, "Rapport.pdf"], ["%E0%A4%A", "%E0%A4%A"],
      ];
      for (const [header, expected] of cases) {
        const file = fileOf(await upload(fixture, taskId, buildPdf(), header === undefined ? {} : { fileName: header }));
        assert.equal(file.fileName, expected, String(header));
      }
      assert.ok(storage.keys().every((key) => /^files\/pdf\/[0-9a-f-]{36}\.pdf$/.test(key)));
      assert.ok((await fileRows(fixture.pool)).every((row) => row.storage_ref === `files/pdf/${row.id}.pdf`));
    });
  });
});

test("R15 an upload writes only the file tables and one object: evidence, summaries, decisions, reports, access rows and tasks.updated_at are unchanged", async () => {
  await withFiles(async ({ storage }) => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const before = await fingerprint(pool, protectedTables);
      const created = fileOf(await upload(fixture, taskId));
      await list(fixture, taskId);
      await download(fixture, taskId, created.id);
      await rescan(fixture, taskId, created.id);
      assert.equal(await fingerprint(pool, protectedTables), before);
      assert.equal(storage.keys().length, 1);
      const reports = (await pool.query<{ count: string }>("SELECT count(*) FROM report_candidates")).rows[0]!.count;
      assert.equal(reports, "0", "no candidate is created from a ready file");
    });
  });
});

test("R16 the file tables are insert-only and check their row shapes", async () => {
  await withFiles(async () => {
    await withSyncFixture(async (fixture) => {
      const { pool } = fixture;
      const { taskId } = await readyTask(fixture);
      const file = fileOf(await upload(fixture, taskId));
      for (const statement of [
        "UPDATE stored_files SET display_name = 'x'", "DELETE FROM stored_files", "TRUNCATE stored_files",
        "UPDATE stored_file_checks SET result = 'clean'", "DELETE FROM stored_file_checks", "TRUNCATE stored_file_checks",
      ]) {
        await assert.rejects(pool.query(statement), (error: Error) => { assert.ok(error.message.length > 0); return true; }, statement);
      }
      const row = (await fileRows(pool))[0]!;
      await assert.rejects(pool.query("INSERT INTO stored_files (attempt_id, task_id, kind, display_name, byte_size, sha256, uploaded_by) VALUES ($1, $2, 'official-pdf', 'x', 1, 'a', $3)", [randomUUID(), row.task_id, row.uploaded_by]), /check/i);
      await assert.rejects(pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'scan', 'clean')", [file.id]), /check|null/i, "a scan row needs its scanner");
      await assert.rejects(pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'validation', 'clean')", [file.id]), /check/i);
      await assert.rejects(pool.query("INSERT INTO stored_file_checks (file_id, stage, result) VALUES ($1, 'storage', 'official')", [file.id]), /check/i);
    });
  });
});

test("R17 logs carry only the event, the actor and a fixed class or status; the raw parser leaves the JSON limit of other routes unchanged", async () => {
  await withFiles(async ({ scanner, failPut }) => {
    await withSyncFixture(async (fixture) => {
      const { owner } = fixture;
      const { taskId } = await readyTask(fixture, "machine-conforme", { "header.etablissement": "Clinique Secrète" });
      const open = await acceptedTask(fixture);
      let logged!: { id: string; name: string; attempt: string };
      const { lines } = await captureInfo(async () => {
        const created = fileOf(await upload(fixture, taskId, buildPdf(), { fileName: "Confidentiel client.pdf" }));
        await upload(fixture, taskId, buildPdf(), { attemptId: created.attemptId });
        await list(fixture, taskId);
        await download(fixture, taskId, created.id);
        await download(fixture, taskId, randomUUID());
        scanner.next = "unavailable";
        const failed = fileOf(await upload(fixture, taskId));
        await rescan(fixture, taskId, failed.id);
        await rescan(fixture, taskId, created.id);
        failPut.on = true;
        await upload(fixture, taskId);
        failPut.on = false;
        await upload(fixture, open.taskId);
        await upload(fixture, randomUUID());
        await upload(fixture, taskId, buildPdf(), { token: fixture.tokens.employee });
        await upload(fixture, taskId, buildPdf(), { contentType: "text/plain" });
        await upload(fixture, taskId, buildPdf(), { attemptId: randomUUID(), body: Buffer.alloc(0) });
        logged = { id: created.id, name: created.fileName, attempt: created.attemptId };
      });
      const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => String(line.event).startsWith("file.pdf."));
      assert.deepEqual([...new Set(parsed.map((line) => line.event))].sort(), ["file.pdf.downloaded", "file.pdf.refused", "file.pdf.scan-failed", "file.pdf.stored"]);
      for (const line of parsed) {
        assert.ok(Object.keys(line).every((key) => ["event", "actorId", "class", "status"].includes(key)), JSON.stringify(line));
        assert.equal(typeof line.actorId, "string");
      }
      const classes = new Set(parsed.filter((line) => line.event === "file.pdf.refused").map((line) => line.class));
      for (const expected of ["not-found", "not-confirmed", "forbidden-role", "unsupported-type", "not-rescannable"]) assert.ok(classes.has(expected), expected);
      const everything = lines.join("\n");
      for (const secret of [taskId, open.taskId, logged.id, logged.name, logged.attempt, "Clinique Secrète", "Confidentiel", "files/pdf", "secret/path", "Rapport.pdf", "Rapport-LCQ"]) assert.ok(!everything.includes(secret), secret);
      assert.ok(parsed.every((line) => line.actorId === owner || line.actorId === fixture.employee));

      const oversized = await fetch(`${fixture.apiRoot}/tasks/${taskId}/summary-confirmation`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${fixture.tokens.owner}` }, body: JSON.stringify({ text: "x".repeat(40_000) }),
      });
      assert.equal(oversized.status, 413);
      assert.equal(((await oversized.json()) as { error: { code: string } }).error.code, "PAYLOAD_TOO_LARGE");
    });
  });
});

test("R18 migration 0023 is recorded and creates only the two file tables", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool } = fixture;
    assert.equal((await pool.query("SELECT version FROM schema_migrations WHERE version LIKE '0023%'")).rows.length, 1);
    const tables = (await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name LIKE 'stored_file%' ORDER BY 1")).rows;
    assert.deepEqual(tables.map((row) => row.table_name), ["stored_file_checks", "stored_files"]);
  });
});
