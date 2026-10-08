import type express from "express";
import { apiErrorSchema, createEmployeeRequestSchema, employeeCredentialResponseSchema, employeeListResponseSchema, updateEmployeeStatusRequestSchema, updateEmployeeStatusResponseSchema } from "@cetem-qc/schemas/api/v1";
import { findActiveSession } from "../modules/identity-auth/sessions.js";
import { listOwnTeamEmployees } from "../modules/team-access/queries/list-own-team-employees.js";
import { createOwnTeamEmployee, DuplicateEmployeeEmailError, regenerateOwnTeamEmployeeCredential, resetOwnTeamEmployeePassword, updateOwnTeamEmployeeStatus } from "../modules/team-access/employee-credentials.js";
import type { RouteDeps } from "./route-deps.js";

export function registerEmployeeRoutes(v1: express.Router, deps: RouteDeps): void {
  const { getPool } = deps;
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
}
