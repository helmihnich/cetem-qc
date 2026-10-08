import type express from "express";
import { acceptedEvidenceResponseSchema, apiErrorSchema, insightDecisionRequestSchema, insightDecisionResponseSchema, manualInsightRequestSchema, manualInsightResponseSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "../modules/identity-auth/sessions.js";
import { readTaskAcceptanceAndLineage } from "../modules/audits/queries/task-audit-lineage.js";
import { openAcceptedEvidenceForReview } from "../modules/audits/commands/record-review-access.js";
import { recordInsightDecision } from "../modules/audits/commands/record-insight-decision.js";
import { addManualInsight } from "../modules/audits/commands/add-manual-insight.js";
import { getSummaryHistory, getSummaryState } from "../modules/summaries/queries/confirmed-summary.js";
import { getConformityHistory, getCurrentConformityDecision } from "../modules/conformity/index.js";
import { getAcceptedSubmissionForReview } from "../modules/audits/queries/accepted-submission.js";
import type { RouteDeps } from "./route-deps.js";

export function registerEvidenceRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
  v1.get("/tasks/:taskId/accepted-evidence", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Refusals are structured server lines with the actor and a fixed class only: never the requested ID or any evidence.
    const refuse = (refusalClass: "forbidden-role" | "not-found") => console.info(JSON.stringify({ event: "audit.review_refused", class: refusalClass, actorId: session.id }));
    if (session.role !== "responsable") {
      refuse("forbidden-role");
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } }));
      return;
    }
    const notFound = () => {
      refuse("not-found");
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    };
    const failed = () => response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Les preuves n’ont pas pu être chargées." } }));
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      notFound();
      return;
    }
    try {
      const outcome = await openAcceptedEvidenceForReview(getPool(), session.id, taskId.toLowerCase());
      if (outcome.type === "not-found") {
        notFound();
        return;
      }
      if (outcome.type === "inconsistent") {
        console.info(JSON.stringify({ event: "audit.review_inconsistent", actorId: session.id }));
        failed();
        return;
      }
      const { evidence, task, insights } = outcome;
      const lineage = (await readTaskAcceptanceAndLineage(getPool(), [evidence.taskId])).get(evidence.taskId)!;
      const summaryState = await getSummaryState(getPool(), evidence.submissionId);
      response.status(200).json(acceptedEvidenceResponseSchema.parse({
        task,
        submission: { submissionId: evidence.submissionId, auditId: evidence.auditId, revision: evidence.revision, submittedBy: evidence.submittedBy, acceptedAt: evidence.acceptedAt },
        identity: evidence.identity,
        values: evidence.payload.values,
        results: evidence.results,
        insights,
        insightDecisions: outcome.insightDecisions,
        manualInsights: outcome.manualInsights,
        summary: summaryState.state === "confirmed" ? summaryState.summary : null,
        summaryVersion: { number: summaryState.state === "confirmed" ? summaryState.summary.version : summaryState.nextVersion, state: summaryState.state },
        summaryHistory: await getSummaryHistory(getPool(), evidence.submissionId),
        conformityDecision: await getCurrentConformityDecision(getPool(), evidence.submissionId),
        conformityHistory: await getConformityHistory(getPool(), evidence.submissionId),
        lineage: { replacementOf: lineage.replacementOf, replacedBy: lineage.replacedBy, recoverySource: lineage.recoverySource, recoverySuccessorTaskId: lineage.recoverySuccessorTaskId },
      }));
    } catch {
      // Never log the error: it may carry stored values.
      failed();
    }
  });

  v1.post("/tasks/:taskId/insight-decisions", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Refusal lines carry the actor and a fixed class only: never the task ID, proposal ID or statement.
    const refuse = (refusalClass: "forbidden-role" | "not-found" | "validation" | "locked") => console.info(JSON.stringify({ event: "audit.insight_decision_refused", class: refusalClass, actorId: session.id }));
    if (session.role !== "responsable") {
      refuse("forbidden-role");
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } }));
      return;
    }
    const notFound = () => {
      refuse("not-found");
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    };
    const invalid = () => {
      refuse("validation");
      response.status(422).json(apiErrorSchema.parse({ error: { code: "VALIDATION_FAILED", message: "Cette décision d’insight est invalide." } }));
    };
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      notFound();
      return;
    }
    const parsed = insightDecisionRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound();
        else invalid();
        return;
      }
      const outcome = await recordInsightDecision(getPool(), session.id, taskId.toLowerCase(), parsed.data.proposalId, parsed.data.decision);
      switch (outcome.type) {
        case "recorded":
          response.status(200).json(insightDecisionResponseSchema.parse(outcome.current));
          return;
        case "not-found":
          notFound();
          return;
        case "summary-confirmed":
          refuse("locked");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_CONFIRMED", message: "La synthèse est confirmée : cette action n’est plus possible." } }));
          return;
        case "unknown-proposal":
          invalid();
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "audit.insight_decision_inconsistent", actorId: session.id }));
          response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La décision n’a pas pu être enregistrée." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La décision n’a pas pu être enregistrée." } }));
    }
  });

  v1.post("/tasks/:taskId/manual-insights", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Refusal lines carry the actor and a fixed class only: never the task ID, text or justification.
    const refuse = (refusalClass: "forbidden-role" | "not-found" | "validation" | "locked") => console.info(JSON.stringify({ event: "audit.manual_insight_refused", class: refusalClass, actorId: session.id }));
    if (session.role !== "responsable") {
      refuse("forbidden-role");
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } }));
      return;
    }
    const notFound = () => {
      refuse("not-found");
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    };
    const invalid = () => {
      refuse("validation");
      response.status(422).json(apiErrorSchema.parse({ error: { code: "VALIDATION_FAILED", message: "Cet insight manuel est invalide." } }));
    };
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      notFound();
      return;
    }
    const parsed = manualInsightRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound();
        else invalid();
        return;
      }
      const outcome = await addManualInsight(getPool(), session.id, taskId.toLowerCase(), parsed.data);
      switch (outcome.type) {
        case "added":
          response.status(201).json(manualInsightResponseSchema.parse(outcome.insight));
          return;
        case "not-found":
          notFound();
          return;
        case "summary-confirmed":
          refuse("locked");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_CONFIRMED", message: "La synthèse est confirmée : cette action n’est plus possible." } }));
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "audit.manual_insight_inconsistent", actorId: session.id }));
          response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "L’insight manuel n’a pas pu être enregistré." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry request values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "L’insight manuel n’a pas pu être enregistré." } }));
    }
  });
}
