import type express from "express";
import { apiErrorSchema, officialReportSchema, reportCandidateListSchema, reportDesignateRequestSchema, reportCandidateRequestSchema, reportCandidateSchema, reportFromPdfRequestSchema } from "@cetem-qc/schemas/api/v1";
import { createObjectStorage, readStoredFile } from "../modules/files/index.js";
import type { ObjectStorage } from "../modules/files/index.js";
import { attachPdfReportCandidate, createWordTemplateGenerator, designateReportCandidate, generateReportCandidate, getOfficialReport, getReportCandidateFile, listReportCandidates, reportCommandTestSeams } from "../modules/reports/index.js";
import type { ReportDocumentGenerator } from "../modules/reports/index.js";
import { getAcceptedSubmissionForReview } from "../modules/audits/queries/accepted-submission.js";
import type { findActiveSession } from "../modules/identity-auth/sessions.js";
import type { RouteDeps } from "./route-deps.js";

const PDF_MEDIA_TYPE = "application/pdf";
const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OFFICIAL_DESIGNATED_MESSAGE = "Un rapport officiel est désigné : aucun nouveau candidat ne peut être créé.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerReportRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
  let configuredStorage: ObjectStorage | undefined;
  let configuredGenerator: ReportDocumentGenerator | undefined;
  const storage = () => reportCommandTestSeams.storage ?? (configuredStorage ??= createObjectStorage(process.env));
  const generator = () => reportCommandTestSeams.generator ?? (configuredGenerator ??= createWordTemplateGenerator());

  // Log lines carry the event, the actor and a fixed class only: never a task, candidate, summary or decision ID, a file name, a path or text.
  const refuse = (actorId: string, refusalClass: "forbidden-role" | "not-found" | "not-confirmed" | "not-decided" | "attempt-conflict" | "inputs-changed" | "file-not-ready" | "already-attached" | "official-designated") =>
    console.info(JSON.stringify({ event: "report.candidate.refused", class: refusalClass, actorId }));
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

  v1.post("/tasks/:taskId/report-candidates", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") { forbidden(session.id, response); return; }
    const taskId = String(request.params.taskId ?? "");
    if (!UUID.test(taskId)) { notFound(session.id, response); return; }
    const parsed = reportCandidateRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound(session.id, response);
        else error(response, 422, "VALIDATION_FAILED", "Cette demande est invalide.");
        return;
      }
      const outcome = await generateReportCandidate(
        { pool: getPool(), storage: storage(), generator: generator() }, session.id, taskId.toLowerCase(), parsed.data.attemptId.toLowerCase(),
      );
      const failed = (failureClass: string) => {
        console.info(JSON.stringify({ event: "report.candidate.failed", class: failureClass, actorId: session.id }));
        error(response, 502, "REPORT_GENERATION_FAILED", "Le rapport n’a pas pu être généré. Vous pouvez réessayer.");
      };
      const changed = () => {
        refuse(session.id, "inputs-changed");
        error(response, 409, "REPORT_INPUTS_CHANGED", "Les données ont changé pendant la génération : ce rapport est obsolète. Générez-le à nouveau.");
      };
      switch (outcome.type) {
        case "ready":
          console.info(JSON.stringify({ event: "report.candidate.generated", actorId: session.id }));
          response.status(201).json(reportCandidateSchema.parse(outcome.candidate));
          return;
        case "replayed-ready":
          response.status(200).json(reportCandidateSchema.parse(outcome.candidate));
          return;
        case "failed":
        case "replayed-failed":
          failed(outcome.failureClass);
          return;
        case "inputs-changed":
          changed();
          return;
        case "not-found":
          notFound(session.id, response);
          return;
        case "official-designated":
          refuse(session.id, "official-designated");
          error(response, 409, "REPORT_OFFICIAL_DESIGNATED", OFFICIAL_DESIGNATED_MESSAGE);
          return;
        case "not-confirmed":
          refuse(session.id, "not-confirmed");
          error(response, 409, "SUMMARY_NOT_CONFIRMED", "La synthèse n’est pas confirmée : le rapport ne peut pas être généré.");
          return;
        case "not-decided":
          refuse(session.id, "not-decided");
          error(response, 409, "CONFORMITY_NOT_DECIDED", "Aucune décision de conformité n’est enregistrée : le rapport ne peut pas être généré.");
          return;
        case "attempt-conflict":
          refuse(session.id, "attempt-conflict");
          error(response, 409, "REPORT_ATTEMPT_CONFLICT", "Cette demande de génération est invalide.");
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "report.candidate.inconsistent", actorId: session.id }));
          error(response, 500, "INTERNAL_ERROR", "Le rapport n’a pas pu être généré.");
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      error(response, 500, "INTERNAL_ERROR", "Le rapport n’a pas pu être généré.");
    }
  });

  v1.post("/tasks/:taskId/pdf-files/:fileId/report-candidate", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") { forbidden(session.id, response); return; }
    const taskId = String(request.params.taskId ?? "");
    const fileId = String(request.params.fileId ?? "");
    if (!UUID.test(taskId) || !UUID.test(fileId)) { notFound(session.id, response); return; }
    const parsed = reportFromPdfRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound(session.id, response);
        else error(response, 422, "VALIDATION_FAILED", "Cette demande est invalide.");
        return;
      }
      const outcome = await attachPdfReportCandidate(
        { pool: getPool() }, session.id, taskId.toLowerCase(), fileId.toLowerCase(), parsed.data.attemptId.toLowerCase(),
      );
      switch (outcome.type) {
        case "attached":
          console.info(JSON.stringify({ event: "report.candidate.attached", actorId: session.id }));
          response.status(201).json(reportCandidateSchema.parse(outcome.candidate));
          return;
        case "replayed":
          response.status(200).json(reportCandidateSchema.parse(outcome.candidate));
          return;
        case "not-found":
          notFound(session.id, response);
          return;
        case "official-designated":
          refuse(session.id, "official-designated");
          error(response, 409, "REPORT_OFFICIAL_DESIGNATED", OFFICIAL_DESIGNATED_MESSAGE);
          return;
        case "not-confirmed":
          refuse(session.id, "not-confirmed");
          error(response, 409, "SUMMARY_NOT_CONFIRMED", "La synthèse n’est pas confirmée : le fichier ne peut pas devenir un candidat de rapport.");
          return;
        case "not-decided":
          refuse(session.id, "not-decided");
          error(response, 409, "CONFORMITY_NOT_DECIDED", "Aucune décision de conformité n’est enregistrée : le fichier ne peut pas devenir un candidat de rapport.");
          return;
        case "file-not-ready":
          refuse(session.id, "file-not-ready");
          error(response, 409, "REPORT_FILE_NOT_READY", "Ce fichier n’est pas prêt : il doit être validé et analysé avant de devenir un candidat de rapport.");
          return;
        case "already-attached":
          refuse(session.id, "already-attached");
          error(response, 409, "REPORT_FILE_ALREADY_ATTACHED", "Ce fichier est déjà un candidat de rapport pour les données actuelles.");
          return;
        case "attempt-conflict":
          refuse(session.id, "attempt-conflict");
          error(response, 409, "REPORT_ATTEMPT_CONFLICT", "Cette demande est invalide.");
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "report.candidate.inconsistent", actorId: session.id }));
          error(response, 500, "INTERNAL_ERROR", "Le candidat de rapport n’a pas pu être créé.");
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      error(response, 500, "INTERNAL_ERROR", "Le candidat de rapport n’a pas pu être créé.");
    }
  });

  const refuseOfficial = (actorId: string, refusalClass: "forbidden-role" | "not-found" | "not-ready" | "outdated" | "already-official") =>
    console.info(JSON.stringify({ event: "report.official.refused", class: refusalClass, actorId }));

  v1.post("/tasks/:taskId/report-candidates/:candidateId/designate", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    const missing = () => {
      refuseOfficial(session.id, "not-found");
      error(response, 404, "TASK_NOT_FOUND", "Tâche introuvable.");
    };
    if (session.role !== "responsable") {
      refuseOfficial(session.id, "forbidden-role");
      error(response, 403, "FORBIDDEN", "Accès réservé au Responsable de l’équipe.");
      return;
    }
    const taskId = String(request.params.taskId ?? "");
    const candidateId = String(request.params.candidateId ?? "");
    if (!UUID.test(taskId) || !UUID.test(candidateId)) { missing(); return; }
    const parsed = reportDesignateRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) missing();
        else error(response, 422, "VALIDATION_FAILED", "Cette demande est invalide.");
        return;
      }
      const outcome = await designateReportCandidate({ pool: getPool() }, session.id, taskId.toLowerCase(), candidateId.toLowerCase());
      switch (outcome.type) {
        case "designated":
          console.info(JSON.stringify({ event: "report.official.designated", actorId: session.id }));
          response.status(201).json(officialReportSchema.parse(outcome.official));
          return;
        case "replayed":
          response.status(200).json(officialReportSchema.parse(outcome.official));
          return;
        case "not-found":
          missing();
          return;
        case "not-ready":
          refuseOfficial(session.id, "not-ready");
          error(response, 409, "REPORT_CANDIDATE_NOT_READY", "Ce rapport n’est pas prêt : il doit être généré avant d’être désigné.");
          return;
        case "outdated":
          refuseOfficial(session.id, "outdated");
          error(response, 409, "REPORT_CANDIDATE_OUTDATED", "Les données ont changé : ce rapport est obsolète et ne peut pas être désigné.");
          return;
        case "already-official":
          refuseOfficial(session.id, "already-official");
          error(response, 409, "REPORT_ALREADY_OFFICIAL", "Un rapport officiel est déjà désigné pour ce contrôle.");
          return;
        case "inconsistent":
          error(response, 500, "INTERNAL_ERROR", "Le rapport officiel n’a pas pu être désigné.");
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      error(response, 500, "INTERNAL_ERROR", "Le rapport officiel n’a pas pu être désigné.");
    }
  });

  v1.get("/tasks/:taskId/official-report", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      refuseOfficial(session.id, "forbidden-role");
      error(response, 403, "FORBIDDEN", "Accès réservé au Responsable de l’équipe.");
      return;
    }
    const taskId = String(request.params.taskId ?? "");
    try {
      const official = UUID.test(taskId) ? await getOfficialReport(getPool(), session.id, taskId.toLowerCase()) : undefined;
      if (!official) {
        refuseOfficial(session.id, "not-found");
        error(response, 404, "TASK_NOT_FOUND", "Tâche introuvable.");
        return;
      }
      response.status(200).json(officialReportSchema.parse(official));
    } catch {
      error(response, 500, "INTERNAL_ERROR", "Le rapport officiel n’a pas pu être chargé.");
    }
  });

  v1.get("/tasks/:taskId/report-candidates", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") { forbidden(session.id, response); return; }
    const taskId = String(request.params.taskId ?? "");
    if (!UUID.test(taskId)) { notFound(session.id, response); return; }
    try {
      const candidates = await listReportCandidates(getPool(), session.id, taskId.toLowerCase());
      if (!candidates) { notFound(session.id, response); return; }
      response.status(200).json(reportCandidateListSchema.parse({ candidates }));
    } catch {
      error(response, 500, "INTERNAL_ERROR", "La liste des rapports n’a pas pu être chargée.");
    }
  });

  v1.get("/tasks/:taskId/report-candidates/:candidateId/file", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") { forbidden(session.id, response); return; }
    const taskId = String(request.params.taskId ?? "");
    const candidateId = String(request.params.candidateId ?? "");
    if (!UUID.test(taskId) || !UUID.test(candidateId)) { notFound(session.id, response); return; }
    try {
      const file = await getReportCandidateFile(getPool(), session.id, taskId.toLowerCase(), candidateId.toLowerCase());
      if (!file) { notFound(session.id, response); return; }
      if (file.origin === "uploaded-pdf") {
        // The binary stays behind the files module: only a file that is still ready is served.
        const stored = await readStoredFile(getPool(), storage(), { taskId: taskId.toLowerCase(), fileId: file.storedFileId! });
        if (!stored) { notFound(session.id, response); return; }
        console.info(JSON.stringify({ event: "report.candidate.downloaded", actorId: session.id }));
        const name = `Rapport-LCQ-candidat-${new Date(file.requestedAt).toISOString().slice(0, 10).replaceAll("-", "")}-${candidateId.toLowerCase().replaceAll("-", "").slice(0, 8)}.pdf`;
        response.status(200)
          .set("Content-Type", PDF_MEDIA_TYPE)
          .set("Content-Disposition", `attachment; filename="${name}"`)
          .set("Content-Length", String(stored.bytes.length))
          .set("X-Content-Type-Options", "nosniff")
          .end(Buffer.from(stored.bytes));
        return;
      }
      const bytes = await storage().get(file.storageRef!);
      if (!bytes) {
        error(response, 500, "INTERNAL_ERROR", "Le rapport n’a pas pu être téléchargé.");
        return;
      }
      console.info(JSON.stringify({ event: "report.candidate.downloaded", actorId: session.id }));
      response.status(200)
        .set("Content-Type", DOCX_MEDIA_TYPE)
        .set("Content-Disposition", `attachment; filename="${file.fileName}"`)
        .set("Content-Length", String(bytes.length))
        .set("X-Content-Type-Options", "nosniff")
        .end(Buffer.from(bytes));
    } catch {
      error(response, 500, "INTERNAL_ERROR", "Le rapport n’a pas pu être téléchargé.");
    }
  });
}
