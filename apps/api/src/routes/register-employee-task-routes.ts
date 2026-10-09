import type express from "express";
import { apiErrorSchema, employeeTaskAuditVersionSchema, employeeTaskRecoverySeedResponseSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, syncOperationRequestSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "../modules/identity-auth/sessions.js";
import { listAssignedEmployeeTasks } from "../modules/tasks/tasks.js";
import { getAssignedEmployeeTask } from "../modules/tasks/queries/assigned-employee-task.js";
import { getCurrentAuditVersion } from "../modules/audits/queries/current-audit-version.js";
import { getDeactivatedAssigneeRecoverySeed } from "../modules/audits/queries/deactivated-assignee-recovery-seed.js";
import { processSyncOperation } from "../modules/sync/commands/process-sync-operation.js";
import type { SyncOperationKind } from "../modules/sync/commands/process-sync-operation.js";
import type { RouteDeps } from "./route-deps.js";

export function registerEmployeeTaskRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool, unauthorized } = deps;
  v1.get("/employee/tasks", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "employe") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Technicien." } }));
      return;
    }
    if (!employeeTaskListQuerySchema.safeParse(request.query).success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les paramètres de la requête sont invalides." } }));
      return;
    }
    try {
      const tasks = await listAssignedEmployeeTasks(getPool(), session.id);
      response.status(200).json(employeeTaskListResponseSchema.parse({ tasks }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La liste des tâches n’a pas pu être chargée." } }));
    }
  });

  v1.get("/employee/tasks/:taskId", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "employe") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Technicien." } }));
      return;
    }
    if (!employeeTaskListQuerySchema.safeParse(request.query).success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les paramètres de la requête sont invalides." } }));
      return;
    }
    const taskId = request.params.taskId ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
      return;
    }
    try {
      const task = await getAssignedEmployeeTask(getPool(), session.id, taskId);
      if (!task) {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
        return;
      }
      response.status(200).json(employeeTaskResponseSchema.parse({ task }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La tâche n’a pas pu être chargée." } }));
    }
  });

  v1.get("/employee/tasks/:taskId/audit-version", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "employe") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Technicien." } }));
      return;
    }
    const taskNotFound = () => response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      taskNotFound();
      return;
    }
    try {
      if (!await getAssignedEmployeeTask(getPool(), session.id, taskId)) {
        taskNotFound();
        return;
      }
      const version = await getCurrentAuditVersion(getPool(), taskId.toLowerCase());
      response.status(200).json(employeeTaskAuditVersionSchema.parse(version));
    } catch {
      // Never log the error: it may carry payload values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "La version du serveur n’a pas pu être chargée." } }));
    }
  });

  v1.get("/employee/tasks/:taskId/recovery-seed", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "employe") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "AccÃ¨s rÃ©servÃ© Ã  lâ€™EmployÃ©." } }));
      return;
    }
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "TÃ¢che introuvable." } }));
      return;
    }
    try {
      if (!await getAssignedEmployeeTask(getPool(), session.id, taskId)) {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "TÃ¢che introuvable." } }));
        return;
      }
      const recovery = await getDeactivatedAssigneeRecoverySeed(getPool(), session.id, taskId.toLowerCase());
      response.status(200).json(employeeTaskRecoverySeedResponseSchema.parse({ recovery }));
    } catch {
      // Payloads and source values are sensitive: never log query failures here.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Le brouillon de rÃ©cupÃ©ration nâ€™a pas pu Ãªtre chargÃ©." } }));
    }
  });

  const syncOperationRoute = (kind: SyncOperationKind) => async (request: express.Request, response: express.Response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "employe") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé au Technicien." } }));
      return;
    }
    const taskNotFound = () => response.status(404).json(apiErrorSchema.parse({ error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }));
    const taskId = String(request.params.taskId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)) {
      taskNotFound();
      return;
    }
    try {
      // Assignment is checked on every call, replays included, before anything else is read.
      if (!await getAssignedEmployeeTask(getPool(), session.id, taskId)) {
        taskNotFound();
        return;
      }
      const parsed = syncOperationRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        // Issue paths only: payload values never appear in an error body.
        response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
        return;
      }
      const outcome = await processSyncOperation(getPool(), {
        kind, taskId: taskId.toLowerCase(), actor: { id: session.id, displayName: session.displayName }, request: parsed.data,
      });
      if (outcome.type === "authorization-failed") { unauthorized(response); return; }
      if (outcome.type === "task-not-assigned") { taskNotFound(); return; }
      if (outcome.type === "key-reused") {
        response.status(422).json(apiErrorSchema.parse({ error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Cette clé d’opération a déjà été utilisée pour une autre requête." } }));
        return;
      }
      response.status(outcome.httpStatus).json(outcome.body);
    } catch {
      // Never log the error: it may carry payload values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  };
  v1.post("/employee/tasks/:taskId/draft-syncs", syncOperationRoute("sync-draft"));
  v1.post("/employee/tasks/:taskId/submissions", syncOperationRoute("submit"));
}
