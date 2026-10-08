import type express from "express";
import { apiErrorSchema, conformityDecisionRequestSchema, conformityDecisionSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "../modules/identity-auth/sessions.js";
import { recordConformityDecision } from "../modules/conformity/index.js";
import { getAcceptedSubmissionForReview } from "../modules/audits/queries/accepted-submission.js";
import type { RouteDeps } from "./route-deps.js";

export function registerConformityRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
  v1.post("/tasks/:taskId/conformity-decision", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Log lines carry the actor and fixed classes only: never the task ID, decision ID or outcome.
    const refuse = (refusalClass: "forbidden-role" | "not-found" | "not-confirmed" | "already-decided") => console.info(JSON.stringify({ event: "conformity.refused", class: refusalClass, actorId: session.id }));
    if (session.role !== "responsable") {
      refuse("forbidden-role");
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } }));
      return;
    }
    const notFound = () => {
      refuse("not-found");
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    };
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      notFound();
      return;
    }
    const parsed = conformityDecisionRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound();
        else response.status(422).json(apiErrorSchema.parse({ error: { code: "VALIDATION_FAILED", message: "Cette décision est invalide." } }));
        return;
      }
      const outcome = await recordConformityDecision(getPool(), session.id, taskId.toLowerCase(), parsed.data.outcome);
      switch (outcome.type) {
        case "recorded":
          console.info(JSON.stringify({ event: "conformity.recorded", actorId: session.id }));
          response.status(201).json(conformityDecisionSchema.parse(outcome.decision));
          return;
        case "not-found":
          notFound();
          return;
        case "not-confirmed":
          refuse("not-confirmed");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_NOT_CONFIRMED", message: "La synthèse n’est pas confirmée : la décision ne peut pas être enregistrée." } }));
          return;
        case "already-decided":
          refuse("already-decided");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "CONFORMITY_ALREADY_DECIDED", message: "Une décision est déjà enregistrée pour cette synthèse." } }));
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "conformity.inconsistent", actorId: session.id }));
          response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La décision n’a pas pu être enregistrée." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La décision n’a pas pu être enregistrée." } }));
    }
  });
}
