import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SyncOperationRequest } from "@cetem-qc/schemas/api/v1";
import type { Pool } from "pg";
import { migrate } from "./db/migrate.js";
import { auditCommandTestSeams } from "./modules/audits/commands/audit-revisions.js";
import { requestFingerprint } from "./modules/sync/commands/process-sync-operation.js";
import { counts, envelope, formPayload, withSyncFixture } from "./test-support/sync-fixture.js";
import type { Kind, SyncFixture } from "./test-support/sync-fixture.js";

// Story 8.2: the optional correctionOfOperationId and the rejected-submission-correction lineage.

const LONE_SURROGATE = formPayload({ "header.reportNumber": "R-\uD800" });
const INVALID_REFERENCE = {
  code: "INVALID_CORRECTION_REFERENCE",
  message: "La référence de la soumission corrigée est invalide.",
  issues: [{ path: "correctionOfOperationId", code: "invalid-reference" }],
};

async function lineage(pool: Pool) {
  const result = await pool.query(
    `SELECT link.link_type, link.revision, link.predecessor_operation_id, link.actor_id, audit.task_id
     FROM audit_lineage_links link JOIN audits audit ON audit.id = link.audit_id ORDER BY link.link_type, link.created_at`,
  );
  return result.rows;
}

async function allCounts(pool: Pool) {
  const lineageRows = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM audit_lineage_links");
  return { ...await counts(pool), lineage: lineageRows.rows[0]!.count };
}

/** A submission at `baseRevision` refused with a stored 422 INVALID_PAYLOAD (lone surrogate). */
async function refusedSubmission(fixture: SyncFixture, taskId: string, baseRevision = 0, token = fixture.tokens.employee) {
  const refused = envelope(baseRevision, LONE_SURROGATE);
  const reply = await fixture.send("submissions", taskId, refused, token);
  assert.equal(reply.status, 422);
  assert.deepEqual(reply.body.issues, [{ path: "values.header.reportNumber", code: "unpaired-surrogate" }]);
  return refused.operationId;
}

test("L9 a lone surrogate is a stored 422; a submission correcting it is accepted with exactly one correction lineage row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, send } = fixture;
    const taskId = await fixture.newTask(employee);
    const refused = envelope(0, LONE_SURROGATE);
    const refusal = await send("submissions", taskId, refused);
    assert.deepEqual([refusal.status, refusal.body], [422, {
      outcome: "rejected", operationId: refused.operationId, kind: "submit", code: "INVALID_PAYLOAD",
      message: "Les données du contrôle sont invalides.", issues: [{ path: "values.header.reportNumber", code: "unpaired-surrogate" }],
    }]);
    assert.equal((await send("submissions", taskId, refused)).text, refusal.text, "the refusal replays");

    const correction = envelope(0, formPayload({ "header.reportNumber": "R-CORRIGE" }), { correctionOfOperationId: refused.operationId });
    const reply = await send("submissions", taskId, correction);
    assert.deepEqual([reply.status, reply.body.outcome, reply.body.serverRevision], [200, "accepted", 1]);
    assert.deepEqual(await lineage(pool), [{
      link_type: "rejected-submission-correction", revision: 1, predecessor_operation_id: refused.operationId, actor_id: employee, task_id: taskId,
    }]);
    assert.equal((await send("submissions", taskId, correction)).text, reply.text, "the correction replays");
    assert.equal((await allCounts(pool)).lineage, 1);
  });
});

test("L10 a draft-sync carrying the reference links it once; a later submission with the same reference adds no row", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const taskId = await fixture.newTask(fixture.employee);
    const refusedId = await refusedSubmission(fixture, taskId);
    const draft = await send("draft-syncs", taskId, envelope(0, formPayload({ "header.reportNumber": "R-1" }), { correctionOfOperationId: refusedId }));
    assert.equal(draft.status, 200);
    assert.deepEqual((await lineage(pool)).map((row) => [row.link_type, row.revision]), [["rejected-submission-correction", 1]]);
    // Upper case is the same reference.
    const submit = await send("submissions", taskId, envelope(1, formPayload({ "header.reportNumber": "R-2" }), { correctionOfOperationId: refusedId.toUpperCase() }));
    assert.deepEqual([submit.status, submit.body.serverRevision], [200, 2]);
    assert.deepEqual((await lineage(pool)).map((row) => [row.link_type, row.revision]), [["rejected-submission-correction", 1]]);
  });
});

test("L11 every invalid reference is a stored INVALID_CORRECTION_REFERENCE and writes no revision", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, otherEmployee, otherOwner, tokens, send } = fixture;
    const taskId = await fixture.newTask(employee);
    // Accepted revision 1, a conflict, a refused sync-draft.
    const accepted = envelope(0);
    assert.equal((await send("draft-syncs", taskId, accepted)).status, 200);
    const conflict = envelope(0);
    assert.equal((await send("draft-syncs", taskId, conflict)).status, 409);
    const refusedDraft = envelope(1, formPayload({ "future.field": "x" }));
    assert.equal((await send("draft-syncs", taskId, refusedDraft)).status, 422);
    // Another actor's refusal on their own task, and the same actor's refusal on another task.
    const foreignTask = await fixture.newTask(otherEmployee, otherOwner);
    const foreignRefusal = await refusedSubmission(fixture, foreignTask, 0, tokens.otherEmployee);
    const sideTask = await fixture.newTask(employee);
    const sideRefusal = await refusedSubmission(fixture, sideTask);
    // A refused submission with AUDIT_ALREADY_SUBMITTED cannot arise on a draft task: it is stored directly as fixture.
    const alreadySubmitted = randomUUID();
    await pool.query(
      `INSERT INTO sync_operation_outcomes (idempotency_key, operation_id, actor_id, task_id, kind, request_fingerprint, outcome, http_status, response)
       VALUES ($1, $2, $3, $4, 'submit', 'fixture', 'rejected', 422, $5)`,
      [randomUUID(), alreadySubmitted, employee, taskId, JSON.stringify({
        outcome: "rejected", operationId: alreadySubmitted, kind: "submit", code: "AUDIT_ALREADY_SUBMITTED", message: "Ce contrôle a déjà été soumis et accepté.", issues: [],
      })],
    );
    // A refused submission already used as the predecessor of a sync-conflict-revision link.
    const conflictLinked = await refusedSubmission(fixture, taskId, 1);
    const audit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!.id;
    await pool.query(
      `INSERT INTO audit_lineage_links (link_type, audit_id, revision, predecessor_operation_id, actor_id) VALUES ('sync-conflict-revision', $1, 1, $2, $3)`,
      [audit, conflictLinked, employee],
    );

    const before = await allCounts(pool);
    const references = [randomUUID(), accepted.operationId, conflict.operationId, refusedDraft.operationId, alreadySubmitted, foreignRefusal, sideRefusal, conflictLinked];
    for (const reference of references) {
      for (const kind of ["submissions", "draft-syncs"] as Kind[]) {
        const request = envelope(1, formPayload({ "header.reportNumber": "R-INTERDIT" }), { correctionOfOperationId: reference });
        const reply = await send(kind, taskId, request);
        assert.deepEqual([reply.status, reply.body], [422, {
          outcome: "rejected", operationId: request.operationId, kind: kind === "submissions" ? "submit" : "sync-draft", ...INVALID_REFERENCE,
        }], `${reference} ${kind}`);
        assert.equal(reply.text.includes("R-INTERDIT"), false);
        const replay = await send(kind, taskId, request);
        assert.deepEqual([replay.status, replay.text], [422, reply.text], "stored and replayed");
      }
    }
    assert.deepEqual(await allCounts(pool), { ...before, outcomes: before.outcomes + references.length * 2 });
  });
});

test("L12 a stale base with a valid reference conflicts first; the reference stays usable; replays return the stored bytes", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const taskId = await fixture.newTask(fixture.employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0))).status, 200);
    const refusedId = await refusedSubmission(fixture, taskId, 1);
    const stale = envelope(0, formPayload(), { correctionOfOperationId: refusedId });
    const conflict = await send("submissions", taskId, stale);
    assert.deepEqual([conflict.status, conflict.body.outcome], [409, "conflict"]);
    assert.equal((await allCounts(pool)).lineage, 0);
    assert.equal((await send("submissions", taskId, stale)).text, conflict.text);
    const fresh = envelope(1, formPayload(), { correctionOfOperationId: refusedId });
    const accepted = await send("submissions", taskId, fresh);
    assert.equal(accepted.status, 200);
    assert.equal((await send("submissions", taskId, fresh)).text, accepted.text);
    assert.equal((await allCounts(pool)).lineage, 1);
  });
});

test("L13 requests without the field keep their 8.1 fingerprint; adding the field to a replay is a reused key", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const taskId = await fixture.newTask(fixture.employee);
    const request = envelope(0, formPayload({ "header.reportNumber": "R-013" }));
    assert.equal((await send("draft-syncs", taskId, request)).status, 200);
    const stored = (await pool.query<{ request_fingerprint: string }>(
      "SELECT request_fingerprint FROM sync_operation_outcomes WHERE operation_id = $1", [request.operationId],
    )).rows[0]!.request_fingerprint;
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
      }
      return JSON.stringify(value) ?? "null";
    };
    const { operationId, baseRevision, localDraftRevision, clientSavedAt, payload } = request;
    const story81 = createHash("sha256")
      .update(canonical({ kind: "sync-draft", taskId, operationId, baseRevision, localDraftRevision, clientSavedAt, payload })).digest("hex");
    assert.equal(stored, story81);
    assert.equal(requestFingerprint("sync-draft", taskId, request as SyncOperationRequest), story81);
    assert.notEqual(requestFingerprint("sync-draft", taskId, { ...request, correctionOfOperationId: randomUUID() } as SyncOperationRequest), story81);

    const before = await allCounts(pool);
    const reused = await send("draft-syncs", taskId, { ...request, correctionOfOperationId: randomUUID() });
    assert.deepEqual([reused.status, (reused.body.error as { code: string }).code], [422, "IDEMPOTENCY_KEY_REUSED"]);
    assert.deepEqual(await allCounts(pool), before);
  });
});

test("L14 a valid conflict reference and a valid correction reference record one lineage row of each type", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, send } = fixture;
    const taskId = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0))).status, 200);
    const conflict = envelope(0);
    assert.equal((await send("draft-syncs", taskId, conflict)).status, 409);
    const refusedId = await refusedSubmission(fixture, taskId, 1);
    const reply = await send("submissions", taskId, envelope(1, formPayload(), { conflictOperationId: conflict.operationId, correctionOfOperationId: refusedId }));
    assert.deepEqual([reply.status, reply.body.serverRevision], [200, 2]);
    assert.deepEqual(await lineage(pool), [
      { link_type: "rejected-submission-correction", revision: 2, predecessor_operation_id: refusedId, actor_id: employee, task_id: taskId },
      { link_type: "sync-conflict-revision", revision: 2, predecessor_operation_id: conflict.operationId, actor_id: employee, task_id: taskId },
    ]);
  });
});

test("L15 migrating 0011 to 0012 keeps every row; lineage stays insert-only and refuses an unknown link type", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, employee, send } = fixture;
    const taskId = await fixture.newTask(employee);
    assert.equal((await send("draft-syncs", taskId, envelope(0))).status, 200);
    const conflict = envelope(0);
    assert.equal((await send("draft-syncs", taskId, conflict)).status, 409);
    assert.equal((await send("draft-syncs", taskId, envelope(1, formPayload(), { conflictOperationId: conflict.operationId }))).status, 200);
    const refusedId = await refusedSubmission(fixture, taskId, 2);
    // Before 0012 the correction link type does not exist.
    const audit = (await pool.query<{ id: string }>("SELECT id FROM audits WHERE task_id = $1", [taskId])).rows[0]!.id;
    await assert.rejects(pool.query(
      `INSERT INTO audit_lineage_links (link_type, audit_id, revision, predecessor_operation_id, actor_id) VALUES ('rejected-submission-correction', $1, 2, $2, $3)`,
      [audit, refusedId, employee],
    ), /check constraint/);
    const dump = () => pool.query(
      `SELECT (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audits row)::text AS audits,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.audit_id, row.revision) FROM audit_revisions row)::text AS revisions,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.idempotency_key) FROM sync_operation_outcomes row)::text AS outcomes,
              (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM audit_lineage_links row)::text AS lineage`,
    ).then((result) => result.rows[0]);
    const before = await dump();
    await migrate(pool);
    assert.deepEqual(await dump(), before);

    for (const statement of ["UPDATE audit_lineage_links SET revision = 1", "DELETE FROM audit_lineage_links"]) {
      await assert.rejects(pool.query(statement), /insert-only/);
    }
    await assert.rejects(pool.query("TRUNCATE audit_lineage_links"), /cannot be truncated/);
    await assert.rejects(pool.query(
      `INSERT INTO audit_lineage_links (link_type, audit_id, revision, predecessor_operation_id, actor_id) VALUES ('replacement-control', $1, 2, $2, $3)`,
      [audit, refusedId, employee],
    ), /check constraint/);
    assert.deepEqual(await dump(), before);

    assert.equal((await send("submissions", taskId, envelope(2, formPayload(), { correctionOfOperationId: refusedId }))).status, 200);
    assert.deepEqual((await lineage(pool)).map((row) => [row.link_type, row.revision]), [["rejected-submission-correction", 3], ["sync-conflict-revision", 2]]);
  }, { migrateThrough: "0011_audit_lineage" });
});

test("L16 a failure after the correction lineage insert rolls back the revision, the lineage and the outcome", async () => {
  await withSyncFixture(async (fixture) => {
    const { pool, send } = fixture;
    const taskId = await fixture.newTask(fixture.employee);
    const refusedId = await refusedSubmission(fixture, taskId);
    const before = await allCounts(pool);
    auditCommandTestSeams.afterRevisionInsert = async () => {
      // The seam runs after the lineage insert of the same transaction.
      throw new Error("injected failure");
    };
    for (const kind of ["draft-syncs", "submissions"] as const) {
      const reply = await send(kind, taskId, envelope(0, formPayload(), { correctionOfOperationId: refusedId }));
      assert.deepEqual([reply.status, reply.body], [500, { error: { code: "INTERNAL_ERROR", message: "Une erreur est survenue." } }]);
    }
    assert.deepEqual(await allCounts(pool), before);
    auditCommandTestSeams.afterRevisionInsert = undefined;
    assert.equal((await send("submissions", taskId, envelope(0, formPayload(), { correctionOfOperationId: refusedId }))).status, 200);
    assert.deepEqual((await lineage(pool)).map((row) => [row.link_type, row.revision]), [["rejected-submission-correction", 1]]);
  });
});
