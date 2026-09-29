import { z } from "zod";
import type { apiV1Components, apiV1Operations } from "@cetem-qc/types";

const healthQuerySchemaBase = z.object({
  verbose: z.enum(["true", "false"]).optional(),
});

type HealthQueryContract = apiV1Operations["getHealth"]["parameters"]["query"];
type HealthResponseContract = apiV1Components["schemas"]["HealthResponse"];
type ApiErrorContract = apiV1Components["schemas"]["ApiError"];
type AuthenticationRequestContract = apiV1Operations["authenticateWithPassword"]["requestBody"]["content"]["application/json"];
type PasswordReplacementRequestContract = apiV1Operations["replaceTemporaryPassword"]["requestBody"]["content"]["application/json"];
type AuthenticationResponseContract = apiV1Operations["authenticateWithPassword"]["responses"][200]["content"]["application/json"];
type SessionResponseContract = apiV1Operations["getCurrentSession"]["responses"][200]["content"]["application/json"];
type EmployeeListResponseContract = apiV1Operations["listOwnTeamEmployees"]["responses"][200]["content"]["application/json"];
type CreateEmployeeRequestContract = apiV1Operations["createOwnTeamEmployee"]["requestBody"]["content"]["application/json"];
type EmployeeCredentialResponseContract = apiV1Operations["createOwnTeamEmployee"]["responses"][201]["content"]["application/json"];
type UpdateEmployeeStatusRequestContract = apiV1Operations["updateOwnTeamEmployeeStatus"]["requestBody"]["content"]["application/json"];
type UpdateEmployeeStatusResponseContract = apiV1Operations["updateOwnTeamEmployeeStatus"]["responses"][200]["content"]["application/json"];
type TaskAssigneeListResponseContract = apiV1Operations["listTaskAssignees"]["responses"][200]["content"]["application/json"];
type TaskListResponseContract = apiV1Operations["listOwnTeamTasks"]["responses"][200]["content"]["application/json"];
type CreateTaskRequestContract = apiV1Operations["createAssignedTask"]["requestBody"]["content"]["application/json"];
type TaskResponseContract = apiV1Operations["createAssignedTask"]["responses"][201]["content"]["application/json"];

// Keep the runtime parser tied to the generated wire representation.
export const healthQuerySchema: z.ZodType<HealthQueryContract> = healthQuerySchemaBase;

export const healthResponseSchema: z.ZodType<HealthResponseContract> = z.object({
  status: z.literal("ok"),
  version: z.literal("v1"),
});

export const apiErrorSchema: z.ZodType<ApiErrorContract> = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});

export const authenticationRequestSchema: z.ZodType<AuthenticationRequestContract> = z.object({ email: z.string().min(1), password: z.string().min(1) });
export const passwordReplacementRequestSchema: z.ZodType<PasswordReplacementRequestContract> = z.object({
  currentPassword: z.string().min(1), newPassword: z.string().min(1),
});
const authenticatedUserSchema = z.object({
  id: z.string(), email: z.string(), displayName: z.string(), role: z.enum(["responsable", "employe"]),
  mustChangePassword: z.boolean(),
});
const sessionTokenSchema = z.string().min(1);
export const authenticationResponseSchema: z.ZodType<AuthenticationResponseContract> = z.object({
  token: sessionTokenSchema,
  sessionExpiresAt: z.string().datetime(),
  user: authenticatedUserSchema,
});
export const sessionResponseSchema: z.ZodType<SessionResponseContract> = z.object({
  sessionExpiresAt: z.string().datetime(),
  user: authenticatedUserSchema,
});
const teamEmployeeSchema = z.object({
  id: z.string().uuid(), firstName: z.string(), surname: z.string(), email: z.string().email(), active: z.boolean(),
}).strict();
export const employeeListResponseSchema: z.ZodType<EmployeeListResponseContract> = z.object({
  employees: z.array(teamEmployeeSchema),
}).strict();
export const createEmployeeRequestSchema: z.ZodType<CreateEmployeeRequestContract> = z.object({
  firstName: z.string().trim().min(1).max(100), surname: z.string().trim().min(1).max(100), email: z.string().trim().email().max(254),
}).strict();
export const employeeCredentialResponseSchema: z.ZodType<EmployeeCredentialResponseContract> = z.object({
  employee: teamEmployeeSchema,
  temporaryCredential: z.string().min(1),
}).strict();
export const updateEmployeeStatusRequestSchema: z.ZodType<UpdateEmployeeStatusRequestContract> = z.object({ active: z.boolean() }).strict();
export const updateEmployeeStatusResponseSchema: z.ZodType<UpdateEmployeeStatusResponseContract> = z.object({ employee: teamEmployeeSchema }).strict();
export const taskAssigneeListResponseSchema: z.ZodType<TaskAssigneeListResponseContract> = z.object({
  assignees: z.array(z.object({ id: z.string().uuid(), firstName: z.string(), surname: z.string() }).strict()),
}).strict();
export const taskListQuerySchema = z.object({}).strict();
const taskListItemSchema = z.object({
  id: z.string().uuid(), type: z.literal("graphie_mobile"), establishment: z.string(), assignee: z.string(),
  state: z.literal("draft"), lastUpdatedAt: z.string().datetime(),
}).strict();
export const taskListResponseSchema: z.ZodType<TaskListResponseContract> = z.object({ tasks: z.array(taskListItemSchema) }).strict();
export const createTaskRequestSchema: z.ZodType<CreateTaskRequestContract> = z.object({
  establishment: z.string().trim().min(1).max(200), service: z.string().max(200), type: z.literal("graphie_mobile"), assigneeId: z.string().uuid(),
}).strict();
const taskSchema = z.object({
  id: z.string().uuid(), establishment: z.string(), service: z.string(), type: z.literal("graphie_mobile"),
  assigneeId: z.string().uuid(), creatorId: z.string().uuid(), createdAt: z.string().datetime(), state: z.literal("draft"),
}).strict();
export const taskResponseSchema: z.ZodType<TaskResponseContract> = z.object({ task: taskSchema }).strict();
export const sessionTokenResponseSchema = z.object({ token: sessionTokenSchema });
export type HealthQuery = z.infer<typeof healthQuerySchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type AuthenticationRequest = z.infer<typeof authenticationRequestSchema>;
export type PasswordReplacementRequest = z.infer<typeof passwordReplacementRequestSchema>;
export type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type EmployeeListResponse = z.infer<typeof employeeListResponseSchema>;
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;
export type EmployeeCredentialResponse = z.infer<typeof employeeCredentialResponseSchema>;
export type UpdateEmployeeStatusRequest = z.infer<typeof updateEmployeeStatusRequestSchema>;
export type UpdateEmployeeStatusResponse = z.infer<typeof updateEmployeeStatusResponseSchema>;
export type TaskAssigneeListResponse = z.infer<typeof taskAssigneeListResponseSchema>;
export type TaskListResponse = z.infer<typeof taskListResponseSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
export type SessionTokenResponse = z.infer<typeof sessionTokenResponseSchema>;
