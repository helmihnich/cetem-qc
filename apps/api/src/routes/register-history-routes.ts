import { createHash } from "node:crypto";
import type express from "express";
import type { Pool } from "pg";
import { apiErrorSchema, historyListQuerySchema, historyListResponseSchema, historyRecordResponseSchema } from "@cetem-qc/schemas/api/v1";
import type { findActiveSession } from "../modules/identity-auth/sessions.js";
import { getAuthorizedTaskSummary, listAuthorizedTaskSummaries } from "../modules/tasks/queries/authorized-task.js";
import type { HistoryActor } from "../modules/tasks/queries/authorized-task.js";
import { getAcceptedSubmissionByTask } from "../modules/audits/queries/accepted-submission.js";
import { readCompletedEvidence } from "../modules/audits/queries/completed-evidence.js";
import { readAuditIdsByTask, readTaskAcceptanceAndLineage } from "../modules/audits/queries/task-audit-lineage.js";
import { getSummaryHistory, getSummaryState } from "../modules/summaries/queries/confirmed-summary.js";
import { getConformityHistory, getCurrentConformityDecision } from "../modules/conformity/index.js";
import { readStoredFile } from "../modules/files/index.js";
import { getOfficialReportFile, listCompletedTaskIds, listOfficialReports } from "../modules/reports/index.js";
import { lineageSeeds, officialDownloadIdentity, resolveHistoryLineage } from "./history-support.js";
import type { RouteDeps } from "./route-deps.js";

type HistoryRefusal = "not-found" | "file-not-ready" | "inconsistent";

export function registerHistoryRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
  const storage = deps.reportStorage;

  // Log lines carry the event, the actor and a fixed class only: never a task, audit or candidate ID, a name, a file name or a path.
  const refuse = (actorId: string, refusalClass: HistoryRefusal) => console.info(JSON.stringify({ event: "history.refused", class: refusalClass, actorId }));
  const error = (response: express.Response, status: number, code: string, message: string) =>
    response.status(status).json(apiErrorSchema.parse({ error: { code, message } }));
  const notFound = (actorId: string, response: express.Response) => {
    refuse(actorId, "not-found");
    error(response, 404, "TASK_NOT_FOUND", "Tâche introuvable.");
  };
  const actorOf = (response: express.Response): HistoryActor => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    return { id: session.id, role: session.role === "responsable" ? "responsable" : "employe" };
  };

  /** Relations of the given completed tasks with the viewer's permissions applied. The viewer's authorized tasks are the only visible ones. */
  const lineageFor = async (pool: Pool, taskIds: string[], authorizedTaskIds: ReadonlySet<string>) => {
    const lineages = await readTaskAcceptanceAndLineage(pool, taskIds);
    const seedsByTask = new Map(taskIds.map((id) => [id, lineageSeeds(lineages.get(id)!)] as const));
    const visibleRelated = [...new Set([...seedsByTask.values()].flat().map((seed) => seed.taskId).filter((id) => authorizedTaskIds.has(id)))];
    const auditIds = await readAuditIdsByTask(pool, visibleRelated);
    const completed = await listCompletedTaskIds(pool, visibleRelated);
    return new Map(taskIds.map((id) => [id, resolveHistoryLineage(seedsByTask.get(id)!, authorizedTaskIds, auditIds, completed)] as const));
  };

  v1.get("/history", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const actor = actorOf(response);
    if (!historyListQuerySchema.safeParse(request.query).success) {
      error(response, 400, "VALIDATION_ERROR", "Les paramètres de la requête sont invalides.");
      return;
    }
    try {
      const pool = getPool();
      const tasks = await listAuthorizedTaskSummaries(pool, actor);
      const authorized = new Set(tasks.keys());
      const officials = await listOfficialReports(pool, [...authorized]);
      const completedIds = [...officials.keys()];
      const lineages = await lineageFor(pool, completedIds, authorized);
      const records = [];
      for (const taskId of completedIds) {
        const official = officials.get(taskId)!;
        const task = tasks.get(taskId)!;
        const accepted = await getAcceptedSubmissionByTask(pool, taskId);
        if (!accepted) continue;
        records.push({
          taskId, type: task.type, establishment: task.establishment, service: task.service, assignee: task.assignee,
          auditId: official.auditId, auditRevision: official.auditRevision, acceptedAt: accepted.acceptedAt, designatedAt: official.designatedAt,
          conformityOutcome: official.bindings.conformityOutcome, reportOrigin: official.origin, lineage: lineages.get(taskId)!,
        });
      }
      records.sort((left, right) => right.designatedAt.localeCompare(left.designatedAt) || left.taskId.localeCompare(right.taskId));
      console.info(JSON.stringify({ event: "history.list.opened", actorId: actor.id }));
      response.status(200).json(historyListResponseSchema.parse({ records }));
    } catch {
      // Never log the error: it may carry stored values.
      error(response, 500, "INTERNAL_ERROR", "L’historique n’a pas pu être chargé.");
    }
  });

  v1.get("/history/:taskId", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const actor = actorOf(response);
    const requested = String(request.params.taskId ?? "").toLowerCase();
    try {
      const pool = getPool();
      // Authorization first: nothing from the request reaches another query before the predicate returns the id.
      const task = await getAuthorizedTaskSummary(pool, actor, requested);
      const official = task ? (await listOfficialReports(pool, [task.id])).get(task.id) : undefined;
      if (!task || !official) { notFound(actor.id, response); return; }
      const outcome = await readCompletedEvidence(pool, task.id);
      if (outcome.type === "not-found") { notFound(actor.id, response); return; }
      const summaryState = outcome.type === "read" ? await getSummaryState(pool, outcome.evidence.submissionId) : undefined;
      const decision = outcome.type === "read" ? await getCurrentConformityDecision(pool, outcome.evidence.submissionId) : null;
      if (outcome.type === "inconsistent" || summaryState?.state !== "confirmed" || !decision) {
        refuse(actor.id, "inconsistent");
        error(response, 500, "INTERNAL_ERROR", "Le contrôle terminé n’a pas pu être chargé.");
        return;
      }
      const { evidence } = outcome;
      const authorized = new Set((await listAuthorizedTaskSummaries(pool, actor)).keys());
      const lineage = (await lineageFor(pool, [task.id], authorized)).get(task.id)!;
      const body = historyRecordResponseSchema.parse({
        task: { id: task.id, establishment: task.establishment, service: task.service, assignee: task.assignee },
        submission: { submissionId: evidence.submissionId, auditId: evidence.auditId, revision: evidence.revision, submittedBy: evidence.submittedBy, acceptedAt: evidence.acceptedAt },
        identity: evidence.identity,
        values: evidence.payload.values,
        results: evidence.results,
        insights: outcome.insights,
        insightDecisions: outcome.insightDecisions,
        manualInsights: outcome.manualInsights,
        summary: summaryState.summary,
        summaryVersion: { number: summaryState.summary.version, state: "confirmed" },
        summaryHistory: await getSummaryHistory(pool, evidence.submissionId),
        conformityDecision: decision,
        conformityHistory: await getConformityHistory(pool, evidence.submissionId),
        officialReport: official,
        lineage,
      });
      console.info(JSON.stringify({ event: "history.record.opened", actorId: actor.id }));
      response.status(200).json(body);
    } catch {
      // Never log the error: it may carry stored values.
      refuse(actor.id, "inconsistent");
      error(response, 500, "INTERNAL_ERROR", "Le contrôle terminé n’a pas pu être chargé.");
    }
  });

  v1.get("/history/:taskId/official-report/file", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const actor = actorOf(response);
    const requested = String(request.params.taskId ?? "").toLowerCase();
    const failed = () => {
      refuse(actor.id, "inconsistent");
      error(response, 500, "INTERNAL_ERROR", "Le rapport n’a pas pu être téléchargé.");
    };
    try {
      const pool = getPool();
      const task = await getAuthorizedTaskSummary(pool, actor, requested);
      // Only the official candidate's file is ever read: no candidate id, file id or key comes from the request.
      const file = task ? await getOfficialReportFile(pool, task.id) : undefined;
      if (!task || !file) { notFound(actor.id, response); return; }
      let bytes: Uint8Array | null | undefined;
      if (file.origin === "uploaded-pdf") {
        bytes = (await readStoredFile(pool, storage(), { taskId: task.id, fileId: file.storedFileId! }))?.bytes;
        if (!bytes) {
          refuse(actor.id, "file-not-ready");
          error(response, 409, "REPORT_FILE_NOT_READY", "Le fichier du rapport officiel n’est pas disponible.");
          return;
        }
      } else {
        bytes = await storage().get(file.storageRef!);
      }
      if (!bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) { failed(); return; }
      const { mediaType, fileName } = officialDownloadIdentity(file);
      console.info(JSON.stringify({ event: "history.report.downloaded", actorId: actor.id }));
      response.status(200)
        .set("Content-Type", mediaType)
        .set("Content-Disposition", `attachment; filename="${fileName}"`)
        .set("Content-Length", String(bytes.length))
        .set("X-Content-Type-Options", "nosniff")
        .end(Buffer.from(bytes));
    } catch {
      // Never log the error: it may carry stored values.
      failed();
    }
  });
}
