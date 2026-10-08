import express from "express";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { acceptedEvidenceResponseSchema, apiErrorSchema, conformityDecisionRequestSchema, conformityDecisionSchema, insightDecisionRequestSchema, insightDecisionResponseSchema, manualInsightRequestSchema, manualInsightResponseSchema, summaryConfirmationRequestSchema, summaryReopeningRequestSchema, summaryReopeningSchema, confirmedSummarySchema, summaryDraftRequestSchema, summaryDraftResponseSchema, authenticationRequestSchema, authenticationResponseSchema, createDeactivatedAssigneeRecoveryRequestSchema, createEmployeeRequestSchema, createTaskRequestSchema, deactivatedAssigneeRecoveryResponseSchema, employeeCredentialResponseSchema, employeeListResponseSchema, employeeTaskAuditVersionSchema, employeeTaskRecoverySeedResponseSchema, employeeTaskListQuerySchema, employeeTaskListResponseSchema, employeeTaskResponseSchema, healthQuerySchema, passwordReplacementRequestSchema, reassignUnstartedTaskRequestSchema, reassignUnstartedTaskResponseSchema, replacementTaskResponseSchema, sessionResponseSchema, syncOperationRequestSchema, taskAssigneeListResponseSchema, taskListQuerySchema, taskListResponseSchema, taskResponseSchema, updateEmployeeStatusRequestSchema, updateEmployeeStatusResponseSchema } from "@cetem-qc/schemas/api/v1";
import { getHealth } from "./modules/health/health-query.js";
import {
  authenticateWithPassword,
  InvalidCredentialsError,
  replacePasswordAfterAuthentication,
} from "./modules/identity-auth/authentication.js";
import { createSession, findActiveSession, hasLiveDeactivatedSession, revokeSession } from "./modules/identity-auth/sessions.js";
import { listOwnTeamEmployees } from "./modules/team-access/queries/list-own-team-employees.js";
import { createOwnTeamEmployee, DuplicateEmployeeEmailError, regenerateOwnTeamEmployeeCredential, resetOwnTeamEmployeePassword, updateOwnTeamEmployeeStatus } from "./modules/team-access/employee-credentials.js";
import { createAssignedTask, listAssignedEmployeeTasks, listEligibleTaskAssignees, listOwnTeamTasks, listTaskAssignmentHistory, reassignUnstartedDeactivatedTask, TaskAssigneeUnavailableError } from "./modules/tasks/tasks.js";
import { getAssignedEmployeeTask } from "./modules/tasks/queries/assigned-employee-task.js";
import { getCurrentAuditVersion } from "./modules/audits/queries/current-audit-version.js";
import { getDeactivatedAssigneeRecoverySeed } from "./modules/audits/queries/deactivated-assignee-recovery-seed.js";
import { readTaskAcceptanceAndLineage } from "./modules/audits/queries/task-audit-lineage.js";
import { openAcceptedEvidenceForReview } from "./modules/audits/commands/record-review-access.js";
import { recordInsightDecision } from "./modules/audits/commands/record-insight-decision.js";
import { addManualInsight } from "./modules/audits/commands/add-manual-insight.js";
import { createSummaryDraftProvider } from "./modules/ai/index.js";
import { requestSummaryDraft, summaryCommandTestSeams } from "./modules/summaries/commands/request-summary-draft.js";
import { confirmSummary } from "./modules/summaries/commands/confirm-summary.js";
import { reopenSummary } from "./modules/summaries/commands/reopen-summary.js";
import { getSummaryHistory, getSummaryState } from "./modules/summaries/queries/confirmed-summary.js";
import { getConformityHistory, getCurrentConformityDecision, recordConformityDecision } from "./modules/conformity/index.js";
import { registerDefaultSummaryReopenParticipants } from "./register-participants.js";
import { getAcceptedSubmissionForReview } from "./modules/audits/queries/accepted-submission.js";
import { createReplacementControl } from "./modules/audits/commands/create-replacement-control.js";
import { createDeactivatedAssigneeRecovery } from "./modules/audits/commands/create-deactivated-assignee-recovery.js";
import { processSyncOperation } from "./modules/sync/commands/process-sync-operation.js";
import type { SyncOperationKind } from "./modules/sync/commands/process-sync-operation.js";

export function createApp(pool?: Pool) {
  registerDefaultSummaryReopenParticipants();
  const app = express();
  let sharedPool = pool;
  const getPool = () => sharedPool ??= createDatabasePool();
  let summaryProvider: ReturnType<typeof createSummaryDraftProvider> | undefined;
  app.locals.closeDatabase = async () => { if (sharedPool && sharedPool !== pool) await sharedPool.end(); };

  // Synchronization operations carry a whole form snapshot; only their two routes accept up to 256 kB.
  const defaultJson = express.json({ limit: "32kb" });
  const syncOperationJson = express.json({ limit: "256kb" });
  // Case-insensitive like Express routing, so every path that reaches the two routes gets their limit.
  const syncOperationPath = /^\/api\/v1\/employee\/tasks\/[^/]+\/(?:draft-syncs|submissions)\/?$/i;
  app.use((request, response, next) => {
    const parser = request.method === "POST" && syncOperationPath.test(request.path) ? syncOperationJson : defaultJson;
    parser(request, response, next);
  });
  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." } }));
      return;
    }
    if ((error as { type?: unknown } | null)?.type === "entity.too.large") {
      response.status(413).json(apiErrorSchema.parse({ error: { code: "PAYLOAD_TOO_LARGE", message: "Les données envoyées sont trop volumineuses." } }));
      return;
    }
    next(error);
  });
  const v1 = express.Router();

  const unauthorized = (response: express.Response) => {
    response.status(401).json(apiErrorSchema.parse({
      error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." },
    }));
  };

  const bearerToken = (authorization: string | undefined): string | undefined => {
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/);
    return match?.[1];
  };

  const requireSession = async (request: express.Request, response: express.Response, next: express.NextFunction) => {
    const token = bearerToken(request.header("authorization"));
    if (!token) { unauthorized(response); return; }
    try {
      const session = await findActiveSession(getPool(), token);
      if (!session) { unauthorized(response); return; }
      const allowedDuringActivation = request.method === "GET" && request.path === "/session"
        || request.method === "DELETE" && request.path === "/session"
        || request.method === "POST" && request.path === "/authenticate/password";
      if (session.mustChangePassword && !allowedDuringActivation) { unauthorized(response); return; }
      response.locals.session = session;
      next();
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  };

  v1.get("/health", async (request, response) => {
    const parsed = healthQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Les paramètres de la requête sont invalides.",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: "Valeur invalide.",
          })),
        },
      });
      return;
    }

    response.json(await getHealth(parsed.data));
  });

  v1.post("/authenticate", async (request, response) => {
    const parsed = authenticationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." },
      });
      return;
    }
    try {
      const account = await authenticateWithPassword(getPool(), parsed.data.email, parsed.data.password);
      const session = await createSession(getPool(), account);
      const payload = authenticationResponseSchema.parse({
        token: session.token,
        sessionExpiresAt: session.expiresAt,
        user: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          role: account.role,
          mustChangePassword: account.mustChangePassword,
        },
      });
      response.status(200).json(payload);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json(apiErrorSchema.parse({
          error: { code: "AUTHENTICATION_FAILED", message: error.message },
        }));
        return;
      }
      response.status(500).json(apiErrorSchema.parse({
        error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." },
      }));
    }
  });

  v1.use("/employee/tasks", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });

  v1.get("/session", async (request, response) => {
    const token = bearerToken(request.header("authorization"));
    if (!token) { unauthorized(response); return; }
    try {
      const session = await findActiveSession(getPool(), token);
      if (!session) {
        if (await hasLiveDeactivatedSession(getPool(), token)) {
          response.status(403).json(apiErrorSchema.parse({ error: { code: "ACCOUNT_DEACTIVATED", message: "Ce compte est désactivé." } }));
          return;
        }
        unauthorized(response);
        return;
      }
      response.status(200).json(sessionResponseSchema.parse({
        sessionExpiresAt: session.expiresAt,
        user: {
          id: session.id, email: session.email, displayName: session.displayName,
          role: session.role, mustChangePassword: session.mustChangePassword,
        },
      }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  // All server operations registered after the public auth flow require a live session.
  v1.use(requireSession);

  v1.delete("/session", async (_request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    try {
      await revokeSession(getPool(), session.token);
      response.status(204).end();
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.get("/employees", async (_request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({
        error: { code: "FORBIDDEN", message: "Accès réservé au responsable de l’équipe." },
      }));
      return;
    }
    try {
      const employees = await listOwnTeamEmployees(getPool(), session.id);
      response.status(200).json(employeeListResponseSchema.parse({ employees }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({
        error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." },
      }));
    }
  });

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

  v1.get("/employee/tasks", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "employe") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }));
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
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }));
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
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }));
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
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Accès réservé à l’Employé." } }));
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

  v1.post("/tasks", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action réservée au Responsable de l’équipe." } }));
      return;
    }
    const parsed = createTaskRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "L’établissement, le type Graphie Mobile et un Employé responsable sont requis.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const task = await createAssignedTask(getPool(), session.id, parsed.data);
      response.status(201).json(taskResponseSchema.parse({ task }));
    } catch (error) {
      if (error instanceof TaskAssigneeUnavailableError) {
        response.status(422).json(apiErrorSchema.parse({ error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Cet Employé n’est pas actif ou ne fait pas partie de votre équipe." } }));
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
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "L’établissement, le type Graphie Mobile et un Employé responsable sont requis.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
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
          response.status(422).json(apiErrorSchema.parse({ error: { code: "TASK_ASSIGNEE_UNAVAILABLE", message: "Cet Employé n’est pas actif ou ne fait pas partie de votre équipe." } }));
          return;
      }
    } catch {
      // Never log the error: it may carry request values.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Le contrôle de remplacement n’a pas pu être créé." } }));
    }
  });

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

  v1.post("/employees", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "AccÃ¨s rÃ©servÃ© au responsable de lâ€™Ã©quipe." } }));
      return;
    }
    const parsed = createEmployeeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Le prÃ©nom, le nom et une adresse e-mail valide sont requis.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const result = await createOwnTeamEmployee(getPool(), session.id, parsed.data);
      response.status(201).set("Cache-Control", "no-store").json(employeeCredentialResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof DuplicateEmployeeEmailError) {
        response.status(409).json(apiErrorSchema.parse({ error: { code: "EMAIL_ALREADY_EXISTS", message: "Cette adresse e-mail est dÃ©jÃ  utilisÃ©e." } }));
        return;
      }
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.post("/employees/:employeeId/credential", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "AccÃ¨s rÃ©servÃ© au responsable de lâ€™Ã©quipe." } }));
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.employeeId ?? "")) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "EmployÃ© introuvable ou dÃ©jÃ  activÃ©." } }));
      return;
    }
    try {
      const result = await regenerateOwnTeamEmployeeCredential(getPool(), session.id, request.params.employeeId!);
      if (!result) {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "EmployÃ© introuvable ou dÃ©jÃ  activÃ©." } }));
        return;
      }
      response.status(200).set("Cache-Control", "no-store").json(employeeCredentialResponseSchema.parse(result));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.post("/employees/:employeeId/password-reset", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action réservée au Responsable de l’équipe." } }));
      return;
    }
    const employeeNotFound = () => response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Employé introuvable dans votre équipe." } }));
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.employeeId ?? "")) {
      employeeNotFound();
      return;
    }
    try {
      const result = await resetOwnTeamEmployeePassword(getPool(), session.id, request.params.employeeId!);
      if (result.outcome === "not_found") {
        employeeNotFound();
        return;
      }
      if (result.outcome === "inactive") {
        response.status(409).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_INACTIVE", message: "Cet Employé est désactivé. Réactivez-le avant de réinitialiser son mot de passe." } }));
        return;
      }
      response.status(200).set("Cache-Control", "no-store").json(employeeCredentialResponseSchema.parse({ employee: result.employee, temporaryCredential: result.temporaryCredential }));
    } catch {
      // Never log here: the generated credential may still be in scope.
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.patch("/employees/:employeeId/status", async (request, response) => {
    const session = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
    if (session.role !== "responsable") {
      response.status(403).json(apiErrorSchema.parse({ error: { code: "FORBIDDEN", message: "Action réservée au responsable de l’équipe." } }));
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.employeeId ?? "")) {
      response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Employé introuvable dans votre équipe." } }));
      return;
    }
    const parsed = updateEmployeeStatusRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(apiErrorSchema.parse({ error: { code: "VALIDATION_ERROR", message: "Le statut demandé est invalide.", details: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: "Valeur invalide." })) } }));
      return;
    }
    try {
      const employee = await updateOwnTeamEmployeeStatus(getPool(), session.id, request.params.employeeId!, parsed.data.active);
      if (!employee) {
        response.status(404).json(apiErrorSchema.parse({ error: { code: "EMPLOYEE_NOT_FOUND", message: "Employé introuvable dans votre équipe." } }));
        return;
      }
      response.status(200).set("Cache-Control", "no-store").json(updateEmployeeStatusResponseSchema.parse({ employee }));
    } catch {
      response.status(500).json(apiErrorSchema.parse({ error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }));
    }
  });

  v1.post("/authenticate/password", requireSession, async (request, response) => {
    const parsed = passwordReplacementRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Les informations saisies sont invalides." },
      });
      return;
    }
    try {
      const currentSession = response.locals.session as NonNullable<Awaited<ReturnType<typeof findActiveSession>>>;
      const replacementSession = await replacePasswordAfterAuthentication(
        getPool(),
        currentSession.email,
        parsed.data.currentPassword,
        parsed.data.newPassword,
      );
      const account = replacementSession;
      const payload = authenticationResponseSchema.parse({
        token: replacementSession.token,
        sessionExpiresAt: replacementSession.expiresAt,
        user: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
          role: account.role,
          mustChangePassword: account.mustChangePassword,
        },
      });
      response.status(200).json(payload);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json(apiErrorSchema.parse({
          error: { code: "AUTHENTICATION_FAILED", message: error.message },
        }));
        return;
      }
      response.status(500).json(apiErrorSchema.parse({
        error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." },
      }));
    }
  });

  app.use("/api/v1", v1);
  return app;
}

function createDatabasePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL must be set before handling authentication requests.");
  // Loaded lazily so health checks and isolated route construction do not require database configuration.
  const { Pool: PgPool } = require("pg") as typeof import("pg");
  const pool = new PgPool({ connectionString });
  pool.on("error", (error) => console.error("Unexpected PostgreSQL pool error", error));
  return pool;
}

export async function shutdownApplication(
  server: Pick<Server, "close">,
  closeDatabase: () => Promise<void>,
): Promise<Array<{ message: string; error: unknown }>> {
  const failures: Array<{ message: string; error: unknown }> = [];

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  } catch (error) {
    failures.push({ message: "HTTP server shutdown failed", error });
  }

  try {
    await closeDatabase();
  } catch (error) {
    failures.push({ message: "PostgreSQL pool shutdown failed", error });
  }

  return failures;
}

function handleShutdownFailures(failures: Array<{ message: string; error: unknown }>): void {
  for (const { message, error } of failures) {
    reportShutdownError(message, error);
    if (process.exitCode === undefined) process.exitCode = 1;
  }
}

function reportShutdownError(message: string, error: unknown): void {
  try {
    console.error(message, error);
  } catch {
    // Shutdown reporting must not prevent remaining cleanup.
  }
}

const port = Number(process.env.PORT ?? 3001);
if (typeof require !== "undefined" && require.main === module) {
  const app = createApp();
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`CETEM-QC API listening on http://127.0.0.1:${port}/api/v1`);
  });
  const shutdown = () => {
    void shutdownApplication(server, app.locals.closeDatabase).then(handleShutdownFailures);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
