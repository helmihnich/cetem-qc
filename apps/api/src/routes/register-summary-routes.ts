import type express from "express";
import { apiErrorSchema, summaryConfirmationRequestSchema, summaryReopeningRequestSchema, summaryReopeningSchema, confirmedSummarySchema, summaryDraftRequestSchema, summaryDraftResponseSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "../modules/identity-auth/sessions.js";
import { createSummaryDraftProvider } from "../modules/ai/index.js";
import { requestSummaryDraft, summaryCommandTestSeams } from "../modules/summaries/commands/request-summary-draft.js";
import { confirmSummary } from "../modules/summaries/commands/confirm-summary.js";
import { reopenSummary } from "../modules/summaries/commands/reopen-summary.js";
import { getAcceptedSubmissionForReview } from "../modules/audits/queries/accepted-submission.js";
import type { RouteDeps } from "./route-deps.js";

export function registerSummaryRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
  let summaryProvider: ReturnType<typeof createSummaryDraftProvider> | undefined;
  v1.post("/tasks/:taskId/summary-drafts", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Log lines carry the actor and fixed classes only: never the task ID, prompt, input values, draft text or key.
    const refuse = (refusalClass: "forbidden-role" | "not-found" | "validation" | "locked") => console.info(JSON.stringify({ event: "summary.ai_draft_refused", class: refusalClass, actorId: session.id }));
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
      response.status(422).json(apiErrorSchema.parse({ error: { code: "VALIDATION_FAILED", message: "Cette demande de brouillon est invalide." } }));
    };
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      notFound();
      return;
    }
    const parsed = summaryDraftRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound();
        else invalid();
        return;
      }
      const provider = summaryCommandTestSeams.provider ?? (summaryProvider ??= createSummaryDraftProvider(process.env));
      const outcome = await requestSummaryDraft(getPool(), provider, session.id, taskId.toLowerCase());
      switch (outcome.type) {
        case "generated":
          console.info(JSON.stringify({ event: "summary.ai_draft_generated", actorId: session.id, provider: outcome.draft.provider, durationMs: outcome.durationMs }));
          response.status(201).json(summaryDraftResponseSchema.parse(outcome.draft));
          return;
        case "failed":
          console.info(JSON.stringify({ event: "summary.ai_draft_failed", actorId: session.id, provider: outcome.provider, class: outcome.failureClass, durationMs: outcome.durationMs }));
          response.status(502).json(apiErrorSchema.parse({ error: { code: "AI_UNAVAILABLE", message: "Le brouillon IA n’est pas disponible. Réessayez ou rédigez la synthèse manuellement." } }));
          return;
        case "not-found":
          notFound();
          return;
        case "summary-confirmed":
          refuse("locked");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_CONFIRMED", message: "La synthèse est confirmée : cette action n’est plus possible." } }));
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "summary.ai_draft_inconsistent", actorId: session.id }));
          response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Le brouillon n’a pas pu être enregistré." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry request values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Le brouillon n’a pas pu être enregistré." } }));
    }
  });

  v1.post("/tasks/:taskId/summary-confirmation", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Log lines carry the actor and fixed classes only: never the task ID, summary text, draft text or input values.
    const refuse = (refusalClass: "forbidden-role" | "not-found" | "validation" | "already-confirmed") => console.info(JSON.stringify({ event: "summary.confirm_refused", class: refusalClass, actorId: session.id }));
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
      response.status(422).json(apiErrorSchema.parse({ error: { code: "VALIDATION_FAILED", message: "Cette synthèse est invalide." } }));
    };
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      notFound();
      return;
    }
    const parsed = summaryConfirmationRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound();
        else invalid();
        return;
      }
      const outcome = await confirmSummary(getPool(), session.id, taskId.toLowerCase(), parsed.data);
      switch (outcome.type) {
        case "confirmed":
          console.info(JSON.stringify({ event: "summary.confirmed", actorId: session.id }));
          response.status(201).json(confirmedSummarySchema.parse(outcome.summary));
          return;
        case "not-found":
          notFound();
          return;
        case "invalid-draft":
          invalid();
          return;
        case "already-confirmed":
          refuse("already-confirmed");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_ALREADY_CONFIRMED", message: "La synthèse est déjà confirmée." } }));
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "summary.confirm_inconsistent", actorId: session.id }));
          response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La synthèse n’a pas pu être confirmée." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry request values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La synthèse n’a pas pu être confirmée." } }));
    }
  });

  v1.post("/tasks/:taskId/summary-reopening", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    // Log lines carry the actor and fixed classes only: never the task ID, summary text or input values.
    const refuse = (refusalClass: "forbidden-role" | "not-found" | "not-confirmed" | "designated") => console.info(JSON.stringify({ event: "summary.reopen_refused", class: refusalClass, actorId: session.id }));
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
    const parsed = summaryReopeningRequestSchema.safeParse(request.body);
    try {
      if (!parsed.success) {
        // A syntactically valid but unknown or other team's task must stay indistinguishable: check the task first.
        const probe = await getAcceptedSubmissionForReview(getPool(), session.id, taskId.toLowerCase());
        if (!probe) notFound();
        else response.status(422).json(apiErrorSchema.parse({ error: { code: "VALIDATION_FAILED", message: "Cette demande est invalide." } }));
        return;
      }
      const outcome = await reopenSummary(getPool(), session.id, taskId.toLowerCase());
      switch (outcome.type) {
        case "reopened":
          console.info(JSON.stringify({ event: "summary.reopened", actorId: session.id }));
          response.status(201).json(summaryReopeningSchema.parse(outcome.reopening));
          return;
        case "not-found":
          notFound();
          return;
        case "not-confirmed":
          refuse("not-confirmed");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_NOT_CONFIRMED", message: "La synthèse n’est pas confirmée : elle ne peut pas être rouverte." } }));
          return;
        case "designated":
          refuse("designated");
          response.status(409).json(apiErrorSchema.parse({ error: { code: "SUMMARY_DESIGNATED", message: "Un rapport officiel est désigné : la synthèse ne peut plus être rouverte." } }));
          return;
        case "inconsistent":
          console.info(JSON.stringify({ event: "summary.reopen_inconsistent", actorId: session.id }));
          response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La synthèse n’a pas pu être rouverte." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry stored values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La synthèse n’a pas pu être rouverte." } }));
    }
  });
}
