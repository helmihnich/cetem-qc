import type express from "express";
import { apiErrorSchema, createDeactivatedAssigneeRecoveryRequestSchema, createTaskRequestSchema, deactivatedAssigneeRecoveryResponseSchema, reassignUnstartedTaskRequestSchema, reassignUnstartedTaskResponseSchema, replacementTaskResponseSchema, taskAssigneeListResponseSchema, taskListQuerySchema, taskListResponseSchema, taskResponseSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "../modules/identity-auth/sessions.js";
import { createAssignedTask, listEligibleTaskAssignees, listOwnTeamTasks, listTaskAssignmentHistory, reassignUnstartedDeactivatedTask, TaskAssigneeUnavailableError } from "../modules/tasks/tasks.js";
import { readTaskAcceptanceAndLineage } from "../modules/audits/queries/task-audit-lineage.js";
import { createReplacementControl } from "../modules/audits/commands/create-replacement-control.js";
import { createDeactivatedAssigneeRecovery } from "../modules/audits/commands/create-deactivated-assignee-recovery.js";
import type { RouteDeps } from "./route-deps.js";

export function registerTaskRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool, unauthorized } = deps;
  v1.get("/task-assignees", async (_request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l’équipe." } }));
      return;
    }
    try {
      response.status(200).json(taskAssigneeListResponseSchema.parse({ assignees: await listEligibleTaskAssignees(getPool(), session.id) }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.get("/tasks", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Responsable de l'équipe." } }));
      return;
    }
    if (!taskListQuerySchema.safeParse(request.query).success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les paramètres de la requête sont invalides." } }));
      return;
    }
    try {
      const tasks = await listOwnTeamTasks(getPool(), session.id);
      // The accepted state and the replacement lineage are derived by `audits`, never stored on the task.
      const lineage = await readTaskAcceptanceAndLineage(getPool(), tasks.map((task) => task.id));
      const assignmentHistory = await listTaskAssignmentHistory(getPool(), session.id, tasks.map((task) => task.id));
      response.status(200).json(taskListResponseSchema.parse({
        tasks: tasks.map((task) => ({
          ...task, ...lineage.get(task.id)!,
          recoveryState: lineage.get(task.id)!.recoveryState,
          assignmentHistory: assignmentHistory.get(task.id) ?? [],
        })),
      }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La liste des tâches n'a pas pu être chargée." } }));
    }
  });

  v1.post("/tasks", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action réservée au Responsable de l’équipe." } }));
      return;
    }
    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "L’établissement, le type Graphie Mobile et un Technicien responsable sont requis.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const task = await createAssignedTask(getPool(), session.id, parsed.data);
      response.status(201).json(taskResponseSchema.parse({ task }));
    } catch (error) {
      if (error instanceof TaskAssigneeUnavailableError) {
        response.status(422).json(apiErrorSchema.parse({ error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Ce Technicien n’est pas actif ou ne fait pas partie de votre équipe." } }));
        return;
      }
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La tâche n’a pas pu être créée." } }));
    }
  });

  v1.post("/tasks/:taskId/replacements", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action réservée au Responsable de l’équipe." } }));
      return;
    }
    const taskNotFound = () => response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      taskNotFound();
      return;
    }
    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "L’établissement, le type Graphie Mobile et un Technicien responsable sont requis.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const outcome = await createReplacementControl(getPool(), { responsableId: session.id, originalTaskId: taskId.toLowerCase(), task: parsed.data });
      switch (outcome.type) {
        case "created":
          response.status(201).json(replacementTaskResponseSchema.parse({ task: outcome.task, replacementOf: outcome.replacementOf }));
          return;
        case "not-found":
          taskNotFound();
          return;
        case "not-accepted":
          response.status(409).json(apiErrorSchema.parse({ error: { code: "AUDIT_NOT_ACCEPTED", message: "Cette tâche n’a pas d’audit accepté par le serveur." } }));
          return;
        case "already-replaced":
          response.status(409).json(apiErrorSchema.parse({ error: { code: "REPLACEMENT_ALREADY_EXISTS", message: "Un contrôle de remplacement existe déjà pour cet audit." } }));
          return;
        case "assignee-unavailable":
          response.status(422).json(apiErrorSchema.parse({ error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Ce Technicien n’est pas actif ou ne fait pas partie de votre équipe." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry request values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Le contrôle de remplacement n’a pas pu être créé." } }));
    }
  });

  v1.post("/tasks/:taskId/deactivated-assignee-reassignment", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action rÃ©servÃ©e au Responsable de lâ€™Ã©quipe." } }));
      return;
    }
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "TÃ¢che introuvable." } }));
      return;
    }
    const parsed = reassignUnstartedTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les informations de rÃ©affectation sont invalides." } }));
      return;
    }
    try {
      const outcome = await reassignUnstartedDeactivatedTask(getPool(), {
        responsableId: session.id, taskId: taskId.toLowerCase(), employeeId: parsed.data.successorId,
        expectedAssignmentVersion: parsed.data.expectedAssignmentVersion,
      });
      if (outcome.type === "reassigned") {
        response.status(200).json(reassignUnstartedTaskResponseSchema.parse({ taskId: outcome.taskId, assigneeId: outcome.employeeId, assignmentVersion: outcome.assignmentVersion }));
      } else if (outcome.type === "not-found") {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "TÃ¢che introuvable." } }));
      } else if (outcome.type === "assignee-unavailable") {
        response.status(422).json(apiErrorSchema.parse({ error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Cet EmployÃ© nâ€™est pas actif ou ne fait pas partie de votre Ã©quipe." } }));
      } else if (outcome.type === "responsable-inactive") {
        unauthorized(response);
      } else {
        response.status(409).json(apiErrorSchema.parse({ error: { code: "TASK_RECOVERY_STATE_CHANGED", message: "Lâ€™Ã©tat de la tÃ¢che a changÃ©. Actualisez la liste." } }));
      }
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La rÃ©affectation nâ€™a pas pu Ãªtre effectuÃ©e." } }));
    }
  });

  v1.post("/tasks/:taskId/deactivated-assignee-recovery", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action rÃ©servÃ©e au Responsable de lâ€™Ã©quipe." } }));
      return;
    }
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "TÃ¢che introuvable." } }));
      return;
    }
    const parsed = createDeactivatedAssigneeRecoveryRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les informations de rÃ©cupÃ©ration sont invalides." } }));
      return;
    }
    try {
      const outcome = await createDeactivatedAssigneeRecovery(getPool(), {
        responsableId: session.id, sourceTaskId: taskId.toLowerCase(), sourceRevision: parsed.data.sourceRevision,
        expectedAssignmentVersion: parsed.data.expectedAssignmentVersion, successorId: parsed.data.successorId,
      });
      if (outcome.type === "created") {
        response.status(201).json(deactivatedAssigneeRecoveryResponseSchema.parse({
          task: outcome.task, recoveryId: outcome.recoveryId, recoveryKind: outcome.recoveryKind, source: outcome.source,
        }));
      } else if (outcome.type === "not-found") {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "TÃ¢che introuvable." } }));
      } else if (outcome.type === "assignee-unavailable") {
        response.status(422).json(apiErrorSchema.parse({ error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Cet EmployÃ© nâ€™est pas actif ou ne fait pas partie de votre Ã©quipe." } }));
      } else if (outcome.type === "responsable-inactive") {
        unauthorized(response);
      } else {
        response.status(409).json(apiErrorSchema.parse({ error: { code: "TASK_RECOVERY_STATE_CHANGED", message: "Le travail source a changÃ© ou ne peut plus Ãªtre rÃ©cupÃ©rÃ©." } }));
      }
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Le nouveau travail de rÃ©cupÃ©ration nâ€™a pas pu Ãªtre crÃ©Ã©." } }));
    }
  });
}
