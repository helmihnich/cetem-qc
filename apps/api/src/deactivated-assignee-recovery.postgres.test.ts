import assert from "node:assert/strict";
import test from "node:test";
import { deactivatedAssigneeRecoveryResponseSchema, taskListResponseSchema } from "@cetem-qc/schemas/api/v1";
import { withPostgresTestSchema } from "./test-support/postgres.js";
import { account, addSession, envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";
import { deactivatedRecoveryTestSeams } from "./modules/audits/commands/create-deactivated-assignee-recovery.js";

async function call(fixture: SyncFixture, method: "GET" | "POST" | "PATCH", path: string, token: string, body?: unknown) {
  const response = await fetch(`${fixture.apiRoot}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown>, cache: response.headers.get("cache-control") };
}

test("CAP-1/CAP-3 reassignment is explicit, team-scoped, version-checked and append-only", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, colleague, otherOwner, otherEmployee, newTask, send, tokens } = fixture;
    const taskId = await newTask(employee);
    const beforeTask = (await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0];
    const beforeAssignment = (await pool.query("SELECT * FROM task_assignments WHERE task_id = $1", [taskId])).rows[0];
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    assert.deepEqual((await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0], beforeTask);
    assert.deepEqual((await pool.query("SELECT * FROM task_assignments WHERE task_id = $1", [taskId])).rows[0], beforeAssignment);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM task_assignment_history WHERE task_id = $1", [taskId])).rows[0]!.count, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audits WHERE task_id = $1", [taskId])).rows[0]!.count, 0);

    const malformed = await call(fixture, "POST", `/tasks/not-a-uuid/deactivated-assignee-reassignment`, tokens.owner, { successorId: colleague, expectedAssignmentVersion: 1 });
    assert.equal(malformed.status, 404);
    const employeeDenied = await call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-reassignment`, tokens.colleague, { successorId: colleague, expectedAssignmentVersion: 1 });
    assert.equal(employeeDenied.status, 403);
    const foreign = await call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-reassignment`, tokens.otherOwner, { successorId: otherEmployee, expectedAssignmentVersion: 1 });
    assert.equal(foreign.status, 404);

    const result = await call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-reassignment`, tokens.owner, { successorId: colleague, expectedAssignmentVersion: 1 });
    assert.equal(result.status, 200);
    assert.match(result.cache ?? "", /no-store/i);
    assert.deepEqual(result.body, { taskId, assigneeId: colleague, assignmentVersion: 2 });
    assert.deepEqual((await pool.query("SELECT employee_id, assignment_version FROM task_assignments WHERE task_id = $1", [taskId])).rows, [{ employee_id: colleague, assignment_version: "2" }]);
    const history = await pool.query<{ previous_employee_id: string | null; new_employee_id: string; actor_id: string; reason: string }>(
      "SELECT previous_employee_id, new_employee_id, actor_id, reason FROM task_assignment_history WHERE task_id = $1 ORDER BY created_at, id", [taskId],
    );
    assert.deepEqual(history.rows, [
      { previous_employee_id: null, new_employee_id: employee, actor_id: owner, reason: "task-created" },
      { previous_employee_id: employee, new_employee_id: colleague, actor_id: owner, reason: "deactivated-assignee-recovery" },
    ]);
    const stale = await call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-reassignment`, tokens.owner, { successorId: employee, expectedAssignmentVersion: 1 });
    assert.equal(stale.status, 409);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM task_assignment_history WHERE task_id = $1", [taskId])).rows[0]!.count, 2);
    assert.notEqual(owner, otherOwner);

    const conflictEmployeeConnection = await pool.connect();
    let conflictEmployee: string;
    try {
      const teamId = (await conflictEmployeeConnection.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [owner])).rows[0]!.id;
      conflictEmployee = await account(conflictEmployeeConnection, "employe", "Conflict Employee", teamId);
    } finally {
      conflictEmployeeConnection.release();
    }
    const conflictEmployeeToken = await addSession(pool, conflictEmployee);
    const conflictUnstarted = await newTask(conflictEmployee);
    assert.equal((await send("draft-syncs", conflictUnstarted, envelope(0), conflictEmployeeToken)).status, 200);
    assert.equal((await send("draft-syncs", conflictUnstarted, envelope(0), conflictEmployeeToken)).status, 409);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [conflictEmployee]);
    const conflictAssignment = await call(fixture, "POST", `/tasks/${conflictUnstarted}/deactivated-assignee-reassignment`, tokens.owner, { successorId: employee, expectedAssignmentVersion: 1 });
    assert.equal(conflictAssignment.status, 409);
    assert.equal((await pool.query("SELECT employee_id FROM task_assignments WHERE task_id = $1", [conflictUnstarted])).rows[0]!.employee_id, conflictEmployee);
  });
});

test("CAP-2/CAP-4 synchronized drafts create independent recovery work with immutable field provenance", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague, newTask, send, tokens } = fixture;
    const sourceTaskId = await newTask(employee);
    const values = { "header.reportNumber": "R-84", "comments.general": "Source comment" };
    assert.equal((await send("draft-syncs", sourceTaskId, envelope(0, formPayload(values)))).status, 200);
    const beforeSource = (await pool.query(
      `SELECT to_jsonb(task) AS task, to_jsonb(assignment) AS assignment, to_jsonb(audit) AS audit,
              (SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision) FROM audit_revisions revision WHERE revision.audit_id = audit.id) AS revisions
       FROM tasks task JOIN task_assignments assignment ON assignment.task_id = task.id JOIN audits audit ON audit.task_id = task.id
       WHERE task.id = $1`, [sourceTaskId],
    )).rows[0];
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    const list = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body);
    const source = list.tasks.find((task) => task.id === sourceTaskId)!;
    assert.equal(source.assigneeActive, false);
    assert.equal(source.recoveryState, "synchronized-draft");
    assert.equal(source.recoveryRevision, 1);

    const recovered = await call(fixture, "POST", `/tasks/${sourceTaskId}/deactivated-assignee-recovery`, tokens.owner, {
      successorId: colleague, expectedAssignmentVersion: source.assignmentVersion, sourceRevision: 1,
    });
    assert.equal(recovered.status, 201);
    assert.match(recovered.cache ?? "", /no-store/i);
    const body = deactivatedAssigneeRecoveryResponseSchema.parse(recovered.body);
    assert.equal(body.recoveryKind, "synchronized-draft");
    assert.equal(body.task.assigneeId, colleague);
    assert.deepEqual(body.source, { taskId: sourceTaskId, auditId: beforeSource!.audit.id, revision: 1 });
    const afterSource = (await pool.query(
      `SELECT to_jsonb(task) AS task, to_jsonb(assignment) AS assignment, to_jsonb(audit) AS audit,
              (SELECT jsonb_agg(to_jsonb(revision) ORDER BY revision) FROM audit_revisions revision WHERE revision.audit_id = audit.id) AS revisions
       FROM tasks task JOIN task_assignments assignment ON assignment.task_id = task.id JOIN audits audit ON audit.task_id = task.id
       WHERE task.id = $1`, [sourceTaskId],
    )).rows[0];
    assert.deepEqual(afterSource, beforeSource);
    const target = await pool.query<{ revision_kind: string; operation_id: string | null; actor_id: string; payload: { values: Record<string, string> }; task_creator: string }>(
      `SELECT revision.kind AS revision_kind, revision.operation_id, revision.actor_id, revision.payload, task.created_by AS task_creator
       FROM tasks task JOIN audits audit ON audit.task_id = task.id
       JOIN audit_revisions revision ON revision.audit_id = audit.id AND revision.revision = 1
       WHERE task.id = $1`, [body.task.id],
    );
    assert.deepEqual(target.rows, [{ revision_kind: "deactivated-assignee-recovery", operation_id: null, actor_id: fixture.owner, payload: formPayload(values), task_creator: fixture.owner }]);
    const link = await pool.query<{ link_type: string; source_task_id: string; successor_task_id: string; actor_id: string }>(
      "SELECT link_type, source_task_id, successor_task_id, actor_id FROM audit_deactivated_assignee_recovery_links WHERE id = $1", [body.recoveryId],
    );
    assert.deepEqual(link.rows, [{ link_type: "deactivated-assignee-recovery", source_task_id: sourceTaskId, successor_task_id: body.task.id, actor_id: fixture.owner }]);
    const provenance = await pool.query<{ destination_field: string; source_field: string; source_revision: number; origin: string }>(
      "SELECT destination_field, source_field, source_revision, origin FROM audit_recovery_field_provenance WHERE recovery_link_id = $1 ORDER BY destination_field", [body.recoveryId],
    );
    assert.deepEqual(provenance.rows, [
      { destination_field: "values.comments.general", source_field: "values.comments.general", source_revision: 1, origin: "copied-from-recovery-source" },
      { destination_field: "values.header.reportNumber", source_field: "values.header.reportNumber", source_revision: 1, origin: "copied-from-recovery-source" },
    ]);
    const successorToken = await addSession(pool, colleague);
    const seedReply = await call(fixture, "GET", `/employee/tasks/${body.task.id}/recovery-seed`, successorToken);
    assert.equal(seedReply.status, 200);
    assert.match(seedReply.cache ?? "", /no-store/i);
    assert.deepEqual(seedReply.body, { recovery: {
      recoveryId: body.recoveryId,
      source: { taskId: sourceTaskId, auditId: beforeSource!.audit.id, revision: 1, employee: { id: employee, displayName: "Employ\u00e9 Test" } },
      seed: { revision: 1, payload: formPayload(values) },
      provenance: [
        { destinationField: "values.comments.general", sourceField: "values.comments.general", sourceTaskId: sourceTaskId, sourceAuditId: beforeSource!.audit.id, sourceRevision: 1, origin: "copied-from-recovery-source" },
        { destinationField: "values.header.reportNumber", sourceField: "values.header.reportNumber", sourceTaskId: sourceTaskId, sourceAuditId: beforeSource!.audit.id, sourceRevision: 1, origin: "copied-from-recovery-source" },
      ],
    } });
    assert.equal((await call(fixture, "GET", `/employee/tasks/${body.task.id}/recovery-seed`, tokens.colleague)).status, 200);
    assert.equal((await call(fixture, "GET", `/employee/tasks/${body.task.id}/recovery-seed`, tokens.otherEmployee)).status, 404);
    assert.equal((await call(fixture, "GET", `/employee/tasks/${body.task.id}/recovery-seed`, tokens.owner)).status, 403);
    await assert.rejects(pool.query("UPDATE audit_recovery_field_provenance SET source_field = 'forged'"), /insert-only/);
    await assert.rejects(pool.query("DELETE FROM audit_deactivated_assignee_recovery_links"), /insert-only/);
    const duplicate = await call(fixture, "POST", `/tasks/${sourceTaskId}/deactivated-assignee-recovery`, tokens.owner, {
      successorId: colleague, expectedAssignmentVersion: source.assignmentVersion, sourceRevision: 1,
    });
    assert.equal(duplicate.status, 409);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_deactivated_assignee_recovery_links")).rows[0]!.count, 1);

    deactivatedRecoveryTestSeams.afterSeedInsert = () => { throw new Error("injected recovery failure"); };
    try {
      const rollbackConnection = await pool.connect();
      let rollbackEmployee: string;
      try {
        const teamId = (await rollbackConnection.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [fixture.owner])).rows[0]!.id;
        rollbackEmployee = await account(rollbackConnection, "employe", "Rollback Employee", teamId);
      } finally {
        rollbackConnection.release();
      }
      const rollbackToken = await addSession(pool, rollbackEmployee);
      const rollbackSource = await newTask(rollbackEmployee);
      assert.equal((await send("draft-syncs", rollbackSource, envelope(0, formPayload(values)), rollbackToken)).status, 200);
      await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [rollbackEmployee]);
      const beforeCounts = (await pool.query<{ tasks: number; recoveries: number }>(
        "SELECT (SELECT count(*)::int FROM tasks) AS tasks, (SELECT count(*)::int FROM audit_deactivated_assignee_recovery_links) AS recoveries",
      )).rows[0]!;
      const rollback = await call(fixture, "POST", `/tasks/${rollbackSource}/deactivated-assignee-recovery`, tokens.owner, { successorId: colleague, expectedAssignmentVersion: 1, sourceRevision: 1 });
      assert.equal(rollback.status, 500);
      assert.deepEqual((await pool.query<{ tasks: number; recoveries: number }>(
        "SELECT (SELECT count(*)::int FROM tasks) AS tasks, (SELECT count(*)::int FROM audit_deactivated_assignee_recovery_links) AS recoveries",
      )).rows[0], beforeCounts);
    } finally {
      deactivatedRecoveryTestSeams.afterSeedInsert = undefined;
    }
  });
});

test("CAP-6/CAP-7 conflicts and rejected submits remain resolution-required; correction recovery keeps both lineage types", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague, newTask, send, tokens } = fixture;
    const conflictTask = await newTask(employee);
    assert.equal((await send("draft-syncs", conflictTask, envelope(0))).status, 200);
    assert.equal((await send("draft-syncs", conflictTask, envelope(0))).status, 409);
    const conflictView = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body).tasks.find((task) => task.id === conflictTask)!;
    assert.equal(conflictView.recoveryState, "resolution-required");
    const deniedConflictRecovery = await call(fixture, "POST", `/tasks/${conflictTask}/deactivated-assignee-recovery`, tokens.owner, {
      successorId: colleague, expectedAssignmentVersion: conflictView.assignmentVersion, sourceRevision: 1,
    });
    assert.equal(deniedConflictRecovery.status, 409);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);

    // A separate source task represents a synchronized correction revision, then the original identity deactivates.
    const correctionConnection = await pool.connect();
    let correctionEmployee: string;
    try {
      const teamId = (await correctionConnection.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [fixture.owner])).rows[0]!.id;
      correctionEmployee = await account(correctionConnection, "employe", "Correction Employee", teamId);
    } finally {
      correctionConnection.release();
    }
    const correctionEmployeeToken = await addSession(pool, correctionEmployee);
    const correctionTask = await newTask(correctionEmployee);
    assert.equal((await send("draft-syncs", correctionTask, envelope(0), correctionEmployeeToken)).status, 200);
    const refused = await send("submissions", correctionTask, envelope(1, formPayload({ unknownField: "bad" })), correctionEmployeeToken);
    assert.equal(refused.status, 422);
    const rejectedBody = refused.body as { operationId: string };
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [correctionEmployee]);
    const rejectedView = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body).tasks.find((task) => task.id === correctionTask)!;
    assert.equal(rejectedView.recoveryState, "resolution-required");
    const rejectedRecovery = await call(fixture, "POST", `/tasks/${correctionTask}/deactivated-assignee-recovery`, tokens.owner, {
      successorId: colleague, expectedAssignmentVersion: rejectedView.assignmentVersion, sourceRevision: 1,
    });
    assert.equal(rejectedRecovery.status, 409);
    await pool.query("UPDATE identity_accounts SET is_active = true WHERE id = $1", [correctionEmployee]);
    const correctionSync = envelope(1, formPayload({ "header.reportNumber": "Corrected" }), { correctionOfOperationId: rejectedBody.operationId });
    assert.equal((await send("draft-syncs", correctionTask, correctionSync, correctionEmployeeToken)).status, 200);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [correctionEmployee]);
    const correctionView = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body).tasks.find((task) => task.id === correctionTask)!;
    assert.equal(correctionView.recoveryState, "correction-draft");
    const connection = await pool.connect();
    let activeSuccessor: string;
    try {
      const teamId = (await connection.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [fixture.owner])).rows[0]!.id;
      activeSuccessor = await account(connection, "employe", "Recovery Successor", teamId);
    } finally {
      connection.release();
    }
    const recovery = await call(fixture, "POST", `/tasks/${correctionTask}/deactivated-assignee-recovery`, tokens.owner, {
      successorId: activeSuccessor, expectedAssignmentVersion: correctionView.assignmentVersion, sourceRevision: 2,
    });
    assert.equal(recovery.status, 201);
    const recoveryBody = deactivatedAssigneeRecoveryResponseSchema.parse(recovery.body);
    assert.equal(recoveryBody.recoveryKind, "correction-draft");
    const correctionLink = await pool.query<{ link_type: string; predecessor_operation_id: string }>(
      `SELECT link_type, predecessor_operation_id FROM audit_lineage_links link
       JOIN audits audit ON audit.id = link.audit_id WHERE audit.task_id = $1`, [correctionTask],
    );
    assert.deepEqual(correctionLink.rows, [{ link_type: "rejected-submission-correction", predecessor_operation_id: rejectedBody.operationId }]);
    const targetOperation = await pool.query<{ operation_id: string | null }>(
      `SELECT revision.operation_id FROM audit_revisions revision JOIN audits audit ON audit.id = revision.audit_id
       WHERE audit.task_id = $1 AND revision.revision = 1`, [recoveryBody.task.id],
    );
    assert.equal(targetOperation.rows[0]!.operation_id, null, "successor work must not reuse the actor-bound correction operation");

    const acceptedConnection = await pool.connect();
    let acceptedEmployee: string;
    try {
      const teamId = (await acceptedConnection.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [fixture.owner])).rows[0]!.id;
      acceptedEmployee = await account(acceptedConnection, "employe", "Accepted Employee", teamId);
    } finally {
      acceptedConnection.release();
    }
    const acceptedEmployeeToken = await addSession(pool, acceptedEmployee);
    const acceptedTask = await newTask(acceptedEmployee);
    assert.equal((await send("submissions", acceptedTask, envelope(0), acceptedEmployeeToken)).status, 200);
    const acceptedItem = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body).tasks.find((task) => task.id === acceptedTask)!;
    assert.equal(acceptedItem.state, "submitted");
    assert.equal(acceptedItem.recoveryState, "accepted");

    const pendingTask = await newTask(acceptedEmployee);
    assert.equal((await send("submissions", pendingTask, envelope(0, formPayload({ "header.reportNumber": "Pending" })), acceptedEmployeeToken)).status, 200);
    const pendingItem = taskListResponseSchema.parse((await call(fixture, "GET", "/tasks", tokens.owner)).body).tasks.find((task) => task.id === pendingTask)!;
    assert.equal(pendingItem.recoveryState, "accepted", "server acceptance remains authoritative after acknowledgement");
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [acceptedEmployee]);
  });
});

test("CAP-9/CAP-10/CAP-11 migration backfills only known assignments and protects recovery history", async () => {
  await withPostgresTestSchema(async ({ pool, migrate }) => {
    const setup = await pool.connect();
    try {
      const owner = await account(setup, "responsable", "Migration Owner");
      await migrate({ through: "0013_replacement_lineage" });
      const team = (await setup.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [owner])).rows[0]!.id;
      const employee = await account(setup, "employe", "Migration Employee", team);
      const task = (await setup.query<{ id: string }>(
        "INSERT INTO tasks (establishment, service, task_type, created_by) VALUES ('Migration Centre', 'Service', 'graphie_mobile', $1) RETURNING id", [owner],
      )).rows[0]!.id;
      await setup.query("INSERT INTO task_assignments (task_id, team_id, employee_id) VALUES ($1, $2, $3)", [task, team, employee]);
      const assignmentBefore = (await setup.query("SELECT * FROM task_assignments WHERE task_id = $1", [task])).rows[0];
      await migrate();
      assert.deepEqual((await setup.query("SELECT * FROM task_assignments WHERE task_id = $1", [task])).rows[0], { ...assignmentBefore, assignment_version: "1" });
      const baseline = await setup.query("SELECT previous_employee_id, new_employee_id, actor_id, reason FROM task_assignment_history WHERE task_id = $1", [task]);
      assert.deepEqual(baseline.rows, [{ previous_employee_id: null, new_employee_id: employee, actor_id: owner, reason: "baseline-assignment" }]);
      await assert.rejects(setup.query("UPDATE task_assignment_history SET reason = 'edited'"), /insert-only/);
      await assert.rejects(setup.query("DELETE FROM task_assignment_history"), /insert-only/);
      await assert.rejects(setup.query("TRUNCATE task_assignment_history"), /cannot be truncated/);
    } finally {
      setup.release();
    }
  }, { migrateThrough: "0003_identity_sessions" });
});

test("Story 8.4 concurrent reassignments commit one assignment event and leave no losing write", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, colleague, newTask, tokens } = fixture;
    const connection = await pool.connect();
    let secondSuccessor: string;
    try {
      const teamId = (await connection.query<{ id: string }>("SELECT id FROM identity_teams WHERE responsable_account_id = $1", [owner])).rows[0]!.id;
      secondSuccessor = await account(connection, "employe", "Second Successor", teamId);
    } finally { connection.release(); }
    const taskId = await newTask(employee);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    const beforeTask = (await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0];
    const attempts = await Promise.all([colleague, secondSuccessor].map((successorId) => call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-reassignment`, tokens.owner,
      { successorId, expectedAssignmentVersion: 1 })));
    assert.deepEqual(attempts.map((reply) => reply.status).sort(), [200, 409], JSON.stringify(attempts));
    const assignment = (await pool.query<{ employee_id: string; assignment_version: string }>("SELECT employee_id, assignment_version FROM task_assignments WHERE task_id = $1", [taskId])).rows[0]!;
    assert.ok([colleague, secondSuccessor].includes(assignment.employee_id));
    assert.equal(assignment.assignment_version, "2");
    assert.deepEqual((await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0], beforeTask);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM task_assignment_history WHERE task_id = $1 AND reason = 'deactivated-assignee-recovery'", [taskId])).rows[0]!.count, 1);
  });
});

test("Story 8.4 concurrent recovery requests create one successor, lineage and complete provenance set", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague, newTask, send, tokens } = fixture;
    const sourceTaskId = await newTask(employee);
    assert.equal((await send("draft-syncs", sourceTaskId, envelope(0, formPayload({ "header.reportNumber": "RACE" })))).status, 200);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    const beforeTaskCount = Number((await pool.query("SELECT count(*)::int AS count FROM tasks")).rows[0]!.count);
    const body = { successorId: colleague, expectedAssignmentVersion: 1, sourceRevision: 1 };
    const attempts = await Promise.all([1, 2].map(() => call(fixture, "POST", `/tasks/${sourceTaskId}/deactivated-assignee-recovery`, tokens.owner, body)));
    assert.deepEqual(attempts.map((reply) => reply.status).sort(), [201, 409]);
    assert.equal(Number((await pool.query("SELECT count(*)::int AS count FROM tasks")).rows[0]!.count), beforeTaskCount + 1);
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_deactivated_assignee_recovery_links WHERE source_task_id = $1", [sourceTaskId])).rows[0]!.count, 1);
    const completeness = await pool.query<{ fields: number; links: number; assignments: number }>(
      `SELECT (SELECT count(*)::int FROM audit_recovery_field_provenance p WHERE p.recovery_link_id = link.id) AS fields,
              (SELECT count(*)::int FROM audit_deactivated_assignee_recovery_links WHERE id = link.id) AS links,
              (SELECT count(*)::int FROM task_assignment_history h WHERE h.task_id = link.successor_task_id) AS assignments
       FROM audit_deactivated_assignee_recovery_links link WHERE link.source_task_id = $1`, [sourceTaskId]);
    assert.deepEqual(completeness.rows, [{ fields: 1, links: 1, assignments: 1 }]);
  });
});

test("Story 8.4 reassignment racing employee status change has one serialized assignment outcome", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, owner, employee, colleague, newTask, tokens } = fixture;
    const taskId = await newTask(employee);
    await pool.query("UPDATE identity_accounts SET is_active = false WHERE id = $1", [employee]);
    const attempts = await Promise.all([
      call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-reassignment`, tokens.owner, { successorId: colleague, expectedAssignmentVersion: 1 }),
      call(fixture, "PATCH", `/employees/${employee}/status`, tokens.owner, { active: true }),
    ]);
    const reassignment = attempts[0]!;
    const statusChange = attempts[1]!;
    assert.equal(statusChange.status, 200);
    assert.ok([200, 409].includes(reassignment.status));
    const assignment = (await pool.query<{ employee_id: string; assignment_version: string }>("SELECT employee_id, assignment_version FROM task_assignments WHERE task_id = $1", [taskId])).rows[0]!;
    const historyCount = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM task_assignment_history WHERE task_id = $1 AND reason = 'deactivated-assignee-recovery'", [taskId])).rows[0]!.count;
    if (reassignment.status === 200) {
      assert.equal(assignment.employee_id, colleague);
      assert.equal(assignment.assignment_version, "2");
      assert.equal(historyCount, 1);
    } else {
      assert.equal(assignment.employee_id, employee);
      assert.equal(assignment.assignment_version, "1");
      assert.equal(historyCount, 0);
    }
    assert.notEqual(owner, employee);
  });
});

test("Story 8.4 recovery racing submission preserves whichever transaction becomes authoritative", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, colleague, newTask, send, tokens } = fixture;
    const taskId = await newTask(employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0, formPayload({ "header.reportNumber": "RACE-SUBMIT" })))).status, 200);
    const sourceBefore = (await pool.query("SELECT task.id, assignment.employee_id, audit.state, audit.current_revision FROM tasks task JOIN task_assignments assignment ON assignment.task_id = task.id JOIN audits audit ON audit.task_id = task.id WHERE task.id = $1", [taskId])).rows[0];
    const requests = await Promise.all([
      call(fixture, "PATCH", `/employees/${employee}/status`, tokens.owner, { active: false }),
      send("submissions", taskId, envelope(1, formPayload({ "header.reportNumber": "RACE-SUBMIT" })), tokens.employee),
    ]);
    assert.equal(requests[0]!.status, 200);
    const recovery = await call(fixture, "POST", `/tasks/${taskId}/deactivated-assignee-recovery`, tokens.owner,
      { successorId: colleague, expectedAssignmentVersion: 1, sourceRevision: 1 });
    const state = (await pool.query<{ state: string; employee_id: string }>("SELECT audit.state, assignment.employee_id FROM audits audit JOIN task_assignments assignment ON assignment.task_id = audit.task_id WHERE audit.task_id = $1", [taskId])).rows[0]!;
    if ((requests[1] as { status: number }).status === 200) {
      assert.equal(state.state, "submitted");
      assert.equal(recovery.status, 409);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM audit_deactivated_assignee_recovery_links WHERE source_task_id = $1", [taskId])).rows[0]!.count, 0);
    } else {
      assert.ok([401, 403].includes((requests[1] as { status: number }).status));
      assert.equal(recovery.status, 201);
      assert.equal(state.state, "draft");
    }
    assert.equal(state.employee_id, employee);
    assert.equal((await pool.query("SELECT task.id, assignment.employee_id, audit.state, audit.current_revision FROM tasks task JOIN task_assignments assignment ON assignment.task_id = task.id JOIN audits audit ON audit.task_id = task.id WHERE task.id = $1", [taskId])).rows[0]!.id, sourceBefore!.id);
  });
});











