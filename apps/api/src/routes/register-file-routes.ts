import express from "express";
import { apiErrorSchema, storedFileListSchema, storedFileSchema } from "@cetem-qc/schemas/api/v1";
import { getAcceptedSubmissionForReview } from "../modules/audits/queries/accepted-submission.js";
import { getCurrentConformityDecision } from "../modules/conformity/index.js";
import {
  createObjectStorage, createPdfScanner, fileCommandTestSeams, listStoredFiles, readStoredFile, rescanPdfFile, resolvePdfMaxBytes, storePdfFile,
} from "../modules/files/index.js";
import type { ObjectStorage, PdfScanner, StoredFile } from "../modules/files/index.js";
import type { findActiveSession } from "../modules/identity-auth/sessions.js";
import { getSummaryState } from "../modules/summaries/index.js";
import type { RouteDeps } from "./route-deps.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_FILE_NAME = "Rapport.pdf";
const MAX_FILE_NAME = 120;
const TOO_LARGE_MESSAGE = "Le fichier dépasse la taille maximale de 20 Mo.";

type RefusalClass =
  | "forbidden-role" | "not-found" | "not-confirmed" | "not-decided" | "too-large" | "unsupported-type" | "attempt-conflict" | "not-rescannable";

/**
 * Display-only file name: percent-decoded, reduced to its base name, control characters and path separators removed,
 * trimmed to 120 characters. It never builds a storage key, a path, a header or a log line.
 */
export function sanitizeFileName(header: string | undefined): string {
  let name = header ?? "";
  try { name = decodeURIComponent(name); } catch { /* keep the raw value: it is cleaned below */ }
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f\u0080-\u009f\\/]/g, "").trim().slice(0, MAX_FILE_NAME).trim();
  return cleaned === "" || cleaned === "." || cleaned === ".." ? DEFAULT_FILE_NAME : cleaned;
}

export function registerFileRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
  const maxBytes = resolvePdfMaxBytes(process.env);
  let configuredStorage: ObjectStorage | undefined;
  // Created eagerly so an unknown ANTIVIRUS value fails at start-up (no connection is opened until a scan).
  const configuredScanner: PdfScanner = createPdfScanner(process.env);
  const storage = () => fileCommandTestSeams.storage ?? (configuredStorage ??= createObjectStorage(process.env));
  const scanner = () => fileCommandTestSeams.scanner ?? configuredScanner;
  const commandDeps = () => ({ pool: getPool(), storage: storage(), scanner: scanner(), maxBytes });
  // Tests may lower the limit through the environment before the app is created; the parser is shared by all uploads.
  const rawParser = express.raw({ type: "application/pdf", limit: maxBytes });

  // Log lines carry the event, the actor and a fixed class only: never a task or file ID, a file name, a path or content.
  const refuse = (actorId: string, refusalClass: RefusalClass) =>
    console.info(JSON.stringify({ event: "file.pdf.refused", class: refusalClass, actorId }));
  const error = (response: express.Response, status: number, code: string, message: string) =>
    response.status(status).json(apiErrorSchema.parse({ error: { code, message } }));
  const forbidden = (actorId: string, response: express.Response) => {
    refuse(actorId, "forbidden-role");
    error(response, 403, "FORBIDDEN", "Accès réservé au Responsable de l’équipe.");
  };
  const notFound = (actorId: string, response: express.Response) => {
    refuse(actorId, "not-found");
    error(response, 404, "TASK_NOT_FOUND", "Tâche introuvable.");
  };
  const tooLarge = (actorId: string, response: express.Response) => {
    refuse(actorId, "too-large");
    error(response, 413, "FILE_TOO_LARGE", TOO_LARGE_MESSAGE);
  };
  const storageFailed = (response: express.Response) =>
    error(response, 502, "FILE_STORAGE_FAILED", "Le fichier n’a pas pu être enregistré. Vous pouvez réessayer.");
  const sessionOf = (response: express.Response) => response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
  const present = (file: StoredFile) => storedFileSchema.parse(file);
  const parseBody = (request: express.Request, response: express.Response) =>
    new Promise<unknown>((resolve) => rawParser(request, response, (failure?: unknown) => resolve(failure ?? null)));

  v1.post("/tasks/:taskId/pdf-files", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = sessionOf(response);
    if (session.role !== "responsable") { forbidden(session.id, response); return; }
    const taskId = String(request.params.taskId ?? "");
    if (!UUID.test(taskId)) { notFound(session.id, response); return; }
    try {
      const snapshot = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
      if (!snapshot) { notFound(session.id, response); return; }

      const declared = request.header("content-length");
      if (declared !== undefined && Number(declared) > maxBytes) { tooLarge(session.id, response); return; }
      if (!request.is("application/pdf")) {
        refuse(session.id, "unsupported-type");
        error(response, 415, "UNSUPPORTED_FILE_TYPE", "Seuls les fichiers PDF sont acceptés.");
        return;
      }
      const attemptHeader = request.header("x-attempt-id") ?? "";
      if (!UUID.test(attemptHeader)) { error(response, 422, "VALIDATION_FAILED", "Cette demande est invalide."); return; }
      const failure = await parseBody(request, response);
      if (failure) {
        if ((failure as { type?: unknown }).type === "entity.too.large") tooLarge(session.id, response);
        else error(response, 422, "VALIDATION_FAILED", "Cette demande est invalide.");
        return;
      }
      const body: unknown = request.body;
      if (!Buffer.isBuffer(body) || body.length === 0) { error(response, 422, "VALIDATION_FAILED", "Cette demande est invalide."); return; }
      if (body.length > maxBytes) { tooLarge(session.id, response); return; }

      const state = await getSummaryState(getPool(), snapshot.submissionId);
      if (state.state !== "confirmed") {
        refuse(session.id, "not-confirmed");
        error(response, 409, "SUMMARY_NOT_CONFIRMED", "La synthèse n’est pas confirmée : le rapport PDF ne peut pas être importé.");
        return;
      }
      if (!(await getCurrentConformityDecision(getPool(), snapshot.submissionId))) {
        refuse(session.id, "not-decided");
        error(response, 409, "CONFORMITY_NOT_DECIDED", "Aucune décision de conformité n’est enregistrée : le rapport PDF ne peut pas être importé.");
        return;
      }

      const outcome = await storePdfFile(commandDeps(), {
        taskId: snapshot.taskId, uploaderId: session.id, attemptId: attemptHeader.toLowerCase(),
        displayName: sanitizeFileName(request.header("x-file-name")), bytes: new Uint8Array(body),
      });
      switch (outcome.type) {
        case "attempt-conflict":
          refuse(session.id, "attempt-conflict");
          error(response, 409, "FILE_ATTEMPT_CONFLICT", "Cette demande d’envoi est invalide.");
          return;
        case "replayed":
          if (outcome.file.status === "storage-failed") { storageFailed(response); return; }
          response.status(200).json(present(outcome.file));
          return;
        case "storage-failed":
          console.info(JSON.stringify({ event: "file.pdf.stored", status: "storage-failed", actorId: session.id }));
          storageFailed(response);
          return;
        case "stored":
          console.info(JSON.stringify({ event: "file.pdf.stored", status: outcome.file.status, actorId: session.id }));
          response.status(201).json(present(outcome.file));
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      error(response, 500, "INTERNAL_ERROR", "Le fichier n’a pas pu être traité.");
    }
  });

  /** Role, task syntax and ownership shared by list, download and rescan. Returns the owned task ID or undefined after answering. */
  const authorize = async (request: express.Request, response: express.Response): Promise<string | undefined> => {
    response.set("Cache-Control", "no-store");
    const session = sessionOf(response);
    if (session.role !== "responsable") { forbidden(session.id, response); return undefined; }
    const taskId = String(request.params.taskId ?? "");
    if (!UUID.test(taskId)) { notFound(session.id, response); return undefined; }
    const snapshot = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
    if (!snapshot) { notFound(session.id, response); return undefined; }
    return snapshot.taskId;
  };

  v1.get("/tasks/:taskId/pdf-files", async (request, response) => {
    try {
      const taskId = await authorize(request, response);
      if (!taskId) return;
      response.status(200).json(storedFileListSchema.parse({ files: await listStoredFiles(getPool(), taskId) }));
    } catch {
      error(response, 500, "INTERNAL_ERROR", "La liste des fichiers n’a pas pu être chargée.");
    }
  });

  v1.get("/tasks/:taskId/pdf-files/:fileId/content", async (request, response) => {
    try {
      const taskId = await authorize(request, response);
      if (!taskId) return;
      const session = sessionOf(response);
      const fileId = String(request.params.fileId ?? "");
      if (!UUID.test(fileId)) { notFound(session.id, response); return; }
      const found = await readStoredFile(getPool(), storage(), { taskId, fileId: fileId.toLowerCase() });
      if (!found) { notFound(session.id, response); return; }
      console.info(JSON.stringify({ event: "file.pdf.downloaded", actorId: session.id }));
      const day = found.file.uploadedAt.slice(0, 10).replaceAll("-", "");
      response.status(200)
        .set("Content-Type", "application/pdf")
        .set("Content-Disposition", `attachment; filename="Rapport-LCQ-manuel-${day}-${found.file.id.replaceAll("-", "").slice(0, 8)}.pdf"`)
        .set("Content-Length", String(found.bytes.length))
        .set("X-Content-Type-Options", "nosniff")
        .end(Buffer.from(found.bytes));
    } catch {
      error(response, 500, "INTERNAL_ERROR", "Le fichier n’a pas pu être téléchargé.");
    }
  });

  v1.post("/tasks/:taskId/pdf-files/:fileId/scan-retries", async (request, response) => {
    try {
      const taskId = await authorize(request, response);
      if (!taskId) return;
      const session = sessionOf(response);
      const fileId = String(request.params.fileId ?? "");
      if (!UUID.test(fileId)) { notFound(session.id, response); return; }
      const outcome = await rescanPdfFile(commandDeps(), taskId, fileId.toLowerCase());
      if (outcome.type === "not-found") { notFound(session.id, response); return; }
      if (outcome.type === "not-rescannable") {
        refuse(session.id, "not-rescannable");
        error(response, 409, "FILE_NOT_RESCANNABLE", "L’analyse de ce fichier ne peut pas être relancée.");
        return;
      }
      if (outcome.file.status === "scan-failed") console.info(JSON.stringify({ event: "file.pdf.scan-failed", actorId: session.id }));
      response.status(200).json(present(outcome.file));
    } catch {
      error(response, 500, "INTERNAL_ERROR", "L’analyse n’a pas pu être relancée.");
    }
  });
}
