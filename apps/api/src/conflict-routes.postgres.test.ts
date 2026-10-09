import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SyncOperationRequest } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { auditCommandTestSeams } from "./modules/audits/commands/audit-revisions.js";
import { requestFingerprint } from "./modules/sync/commands/process-sync-operation.js";
import { counts, envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { SyncFixture } from "./test-support/sync-fixture.js";

// Story 8.1: the current server version for the assigned Employé and the sync-conflict-revision lineage.

async function auditVersion(fixture: SyncFixture, taskId: string, token: string | null = fixture.tokens.employee) {
  const response = await fetch(`${fixture.apiRoot}/employee/tasks/${taskId}/audit-version`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as Record<string, unknown>, cacheControl: response.headers.get("cache-control") };
}

async function lineage(pool: Pool) {
  const result = await pool.query(
    `SELECT link.link_type, link.revision, link.predecessor_operation_id, link.actor_id, audit.task_id
     FROM audit_lineage_links link JOIN audits audit ON audit.id = link.audit_id ORDER BY link.created_at`,
  );
  return result.rows;
}

async function allCounts(pool: Pool) {
  const lineageRows = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_lineage_links");
  return { ...await counts(pool), lineage: lineageRows.rows[0]!.count };
}

/** Revision 1 accepted, then a stale draft-sync (base 0) stored as conflict C. */
async function conflictedTask(fixture: SyncFixture) {
  const taskId = await fixture.newTask(fixture.employee);
  assert.equal((await fixture.send("draft-syncs", taskId, envelope(0, formPayload({ "header.reportNumber": "R-SERVEUR" })))).status, 200);
  const stale = envelope(0, formPayload({ "header.reportNumber": "R-LOCAL" }));
  const conflict = await fixture.send("draft-syncs", taskId, stale);
  assert.equal(conflict.status, 409);
  return { taskId, conflictOperationId: stale.operationId };
}

test("S1 the assigned Employé reads revision 0 and nulls for a task without audit, with no-store", async () => {
  await withSyncFixture(async (fixture) => {
    const taskId = await fixture.newTask(fixture.employee);
    const reply = await auditVersion(fixture, taskId);
    assert.equal(reply.status, 200);
    assert.match(reply.cacheControl ?? "", /no-store/i);
    assert.deepEqual(reply.body, { revision: 0, state: "draft", lastChangedAt: null, lastChangedBy: null, payload: null });
  });
});

test("S2 after two draft-syncs the current revision, its payload, author and date are returned", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, send } = fixture;
    const taskId = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0))).status, 200);
    const second = formPayload({ "header.reportNumber": "R-002", "comments.general": "Commentaire « test »" });
    assert.equal((await send("draft-syncs", taskId, envelope(1, second))).status, 200);
    const reply = await auditVersion(fixture, taskId);
    const audit = (await pool.query("SELECT updated_at FROM audits WHERE task_id = $1", [taskId])).rows[0];
    assert.deepEqual(reply.body, {
      revision: 2, state: "draft", lastChangedAt: audit.updated_at.toISOString(),
      lastChangedBy: { id: employee, displayName: "Employé Test" }, payload: second,
    });
    // Every stored key and raw string unchanged (jsonb does not keep the key order).
    assert.deepEqual(reply.body.payload, ((await pool.query(
      "SELECT revision.payload FROM audit_revisions revision JOIN audits audit ON audit.id = revision.audit_id WHERE audit.task_id = $1 AND revision.revision = 2",
      [taskId],
    )).rows[0].payload));
  });
});

test("S3 after an accepted submission the state is submitted with the submission payload", async () => {
  await withSyncFixture(async (fixture) => {
    const taskId = await fixture.newTask(fixture.employee);
    const submitted = formPayload({ "header.reportNumber": "R-SOUMIS" });
    assert.equal((await fixture.send("submissions", taskId, envelope(0, submitted))).status, 200);
    const reply = await auditVersion(fixture, taskId);
    assert.equal(reply.status, 200);
    assert.deepEqual([reply.body.revision, reply.body.state, reply.body.payload], [1, "submitted", submitted]);
  });
});

test("S4 no session, a Responsable, another Employé, an unknown or invalid task get 401/403/404 and nothing is written", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, tokens, send } = fixture;
    const taskId = await fixture.newTask(fixture.employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0, formPayload({ "header.reportNumber": "R-SECRET" })))).status, 200);
    const before = await allCounts(pool);
    const cases: Array<[string, string | null, number, unknown]> = [
      [taskId, null, 401, { error: { code: "AUTHENTICATION_FAILED", message: "Email ou mot de passe invalide." } }],
      [taskId, tokens.owner, 403, { error: { code: "FORBIDDEN", message: "Accès réservé au Technicien." } }],
      [taskId, tokens.otherOwner, 403, { error: { code: "FORBIDDEN", message: "Accès réservé au Technicien." } }],
      [taskId, tokens.colleague, 404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
      [taskId, tokens.otherEmployee, 404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
      [randomUUID(), tokens.employee, 404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
      ["pas-une-tache", tokens.employee, 404, { error: { code: "TASK_NOT_FOUND", message: "Tâche introuvable." } }],
    ];
    for (const [id, token, status, body] of cases) {
      const reply = await auditVersion(fixture, id, token);
      assert.deepEqual([reply.status, reply.body], [status, body], `${id} ${status}`);
      assert.equal(reply.text.includes("R-SECRET"), false);
    }
    assert.deepEqual(await allCounts(pool), before);
  });
});

test("L1 a keep-local draft-sync referencing the conflict is accepted as revision 2 with exactly one lineage row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    const keepLocal = envelope(1, formPayload({ "header.reportNumber": "R-LOCAL" }), { conflictOperationId });
    const reply = await send("draft-syncs", taskId, keepLocal);
    assert.deepEqual([reply.status, reply.body.outcome, reply.body.serverRevision], [200, "accepted", 2]);
    assert.deepEqual(await lineage(pool), [{
      link_type: "sync-conflict-revision", revision: 2, predecessor_operation_id: conflictOperationId, actor_id: employee, task_id: taskId,
    }]);
    assert.deepEqual((await auditVersion(fixture, taskId)).body.payload, formPayload({ "header.reportNumber": "R-LOCAL" }));
  });
});

test("L2 the replay of the keep-local operation returns its stored body and adds no lineage row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    const keepLocal = envelope(1, formPayload(), { conflictOperationId });
    const first = await send("draft-syncs", taskId, keepLocal);
    const before = await allCounts(pool);
    const replay = await send("draft-syncs", taskId, keepLocal);
    assert.deepEqual([replay.status, replay.text], [200, first.text]);
    assert.deepEqual(await allCounts(pool), before);
    assert.equal(before.lineage, 1);
    // The same key without the reference is another request.
    const { conflictOperationId: _reference, ...withoutReference } = keepLocal as typeof keepLocal & { conflictOperationId?: string };
    assert.equal((await send("draft-syncs", taskId, withoutReference)).status, 422);
  });
});

test("L3 an unknown, accepted, foreign, other-task or already linked reference is a stored INVALID_CONFLICT_REFERENCE", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, otherEmployee, otherOwner, tokens, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    const accepted = (await pool.query<{ operation_id: string }>(
      "SELECT operation_id FROM sync_operation_outcomes WHERE task_id = $1 AND outcome = 'accepted'", [taskId],
    )).rows[0]!.operation_id;
    // Another actor's conflict: the other Employé's own task.
    const foreignTask = await fixture.newTask(otherEmployee, otherOwner);
    assert.equal((await send("draft-syncs", foreignTask, envelope(0), tokens.otherEmployee)).status, 200);
    const foreignConflict = envelope(0);
    assert.equal((await send("draft-syncs", foreignTask, foreignConflict, tokens.otherEmployee)).status, 409);
    // A conflict of the same actor on another task.
    const sideTask = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", sideTask, envelope(0))).status, 200);
    const sideConflict = envelope(0);
    assert.equal((await send("draft-syncs", sideTask, sideConflict)).status, 409);
    // An already linked conflict.
    assert.equal((await send("draft-syncs", taskId, envelope(1, formPayload(), { conflictOperationId }))).status, 200);

    const before = await allCounts(pool);
    const references = [randomUUID(), accepted, foreignConflict.operationId, sideConflict.operationId, conflictOperationId];
    for (const reference of references) {
      const request = envelope(2, formPayload({ "header.reportNumber": "R-INTERDIT" }), { conflictOperationId: reference });
      const reply = await send("draft-syncs", taskId, request);
      assert.equal(reply.status, 422, reference);
      assert.deepEqual(reply.body, {
        outcome: "rejected", operationId: request.operationId, kind: "sync-draft", code: "INVALID_CONFLICT_REFERENCE",
        message: "La référence du conflit de synchronisation est invalide.", issues: [{ path: "conflictOperationId", code: "invalid-reference" }],
      });
      assert.equal(reply.text.includes("R-INTERDIT"), false);
      const replay = await send("draft-syncs", taskId, request);
      assert.deepEqual([replay.status, replay.text], [422, reply.text], "stored and replayed");
    }
    assert.deepEqual(await allCounts(pool), { ...before, outcomes: before.outcomes + references.length });
  });
});

test("L4 a valid reference with a stale base conflicts again, writes no lineage and stays usable", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    const stale = await send("draft-syncs", taskId, envelope(0, formPayload(), { conflictOperationId }));
    assert.equal(stale.status, 409);
    assert.equal((await allCounts(pool)).lineage, 0);
    assert.equal((await send("draft-syncs", taskId, envelope(1, formPayload(), { conflictOperationId }))).status, 200);
    assert.equal((await allCounts(pool)).lineage, 1);
  });
});

test("L5 a valid reference on a submitted audit is refused AUDIT_ALREADY_SUBMITTED without lineage", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    assert.equal((await send("submissions", taskId, envelope(1))).status, 200);
    const reply = await send("draft-syncs", taskId, envelope(2, formPayload(), { conflictOperationId }));
    assert.deepEqual([reply.status, reply.body.code], [422, "AUDIT_ALREADY_SUBMITTED"]);
    assert.equal((await allCounts(pool)).lineage, 0);
  });
});

test("L6 a request without the reference keeps the 7.3 fingerprint; with it the fingerprint changes", () => {
  const request = envelope(3, formPayload({ "header.reportNumber": "R-006" })) as SyncOperationRequest;
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };
  const taskId = randomUUID();
  const { operationId, baseRevision, localDraftRevision, clientSavedAt, payload } = request;
  const story73 = createHash("sha256")
    .update(canonical({ kind: "sync-draft", taskId, operationId, baseRevision, localDraftRevision, clientSavedAt, payload })).digest("hex");
  assert.equal(requestFingerprint("sync-draft", taskId, request), story73);
  assert.notEqual(requestFingerprint("sync-draft", taskId, { ...request, conflictOperationId: randomUUID() }), story73);
});

test("L7 a failure injected after the lineage insert rolls back the revision, the lineage and the outcome", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    const before = await allCounts(pool);
    auditCommandTestSeams.afterRevisionInsert = async () => {
      // The seam runs after the lineage insert of the same transaction.
      throw new Error("injected failure");
    };
    for (const kind of ["draft-syncs", "submissions"] as const) {
      const reply = await send(kind, taskId, envelope(1, formPayload(), { conflictOperationId }));
      assert.deepEqual([reply.status, reply.body], [500, { error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }]);
    }
    assert.deepEqual(await allCounts(pool), before);
    auditCommandTestSeams.afterRevisionInsert = undefined;
    assert.equal((await send("submissions", taskId, envelope(1, formPayload(), { conflictOperationId }))).status, 200);
    assert.deepEqual((await lineage(pool)).map((row) => [row.link_type, row.revision]), [["sync-conflict-revision", 2]]);
  });
});

test("L8 lineage rows cannot be updated, deleted or truncated", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const { taskId, conflictOperationId } = await conflictedTask(fixture);
    assert.equal((await send("draft-syncs", taskId, envelope(1, formPayload(), { conflictOperationId }))).status, 200);
    const rows = await lineage(pool);
    for (const statement of [
      "UPDATE audit_lineage_links SET revision = 1",
      "DELETE FROM audit_lineage_links",
    ]) {
      await assert.rejects(pool.query(statement), (error: Error & { code?: string }) => {
        assert.match(error.message, /insert-only/);
        assert.equal(error.code, "23001");
        return true;
      });
    }
    await assert.rejects(pool.query("TRUNCATE audit_lineage_links"), /Evidence table audit_lineage_links cannot be truncated/);
    await assert.rejects(pool.query("DELETE FROM sync_operation_outcomes WHERE operation_id = $1", [conflictOperationId]));
    assert.deepEqual(await lineage(pool), rows);
  });
});

test("L8 migrating 0010 to 0011 keeps every row, and outcomes stored before replay byte-equal", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, newTask, send } = fixture;
    const taskId = await newTask(employee);
    const accepted = envelope(0);
    const acceptedReply = await send("draft-syncs", taskId, accepted);
    const stale = envelope(0);
    const conflictReply = await send("draft-syncs", taskId, stale);
    assert.deepEqual([acceptedReply.status, conflictReply.status], [200, 409]);
    const dump = () => pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audits row)::text AS audits,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.audit_id, row.revision) FROM audit_revisions row)::text AS revisions,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.idempotency_key) FROM sync_operation_outcomes row)::text AS outcomes`,
    ).then((result) => result.rows[0]);
    const before = await dump();
    await migrate(pool);
    assert.deepEqual(await dump(), before);
    assert.deepEqual([(await send("draft-syncs", taskId, accepted)).text, (await send("draft-syncs", taskId, stale)).text], [acceptedReply.text, conflictReply.text]);
    assert.equal((await send("draft-syncs", taskId, envelope(1, formPayload(), { conflictOperationId: stale.operationId }))).status, 200);
    assert.equal((await allCounts(pool)).lineage, 1);
  }, { migrateThrough: "0010_freeze_submitted_audits" });
});
