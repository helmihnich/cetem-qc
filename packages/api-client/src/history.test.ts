import assert from "node:assert/strict";
import test from "node:test";
import { historyRecordFixture } from "../../schemas/src/api/history-fixture.js";
import { ApiRequestError, createApiClient } from "./v1.js";

// Story 11.5 C2: the typed history calls send the bearer token and parse the contract.

const token = "session-token";
const ID = "00000000-0000-4000-8000-000000000801";
const apiError = (code: string, message: string) => ({ error: { code, message } });

function clientFor(respond: () => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createApiClient({ baseUrl: "https://cetem-qc.example.test/", sessionToken: token, fetch: async (input, init) => { calls.push({ url: String(input), init }); return respond(); } });
  return { client, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("C2 listHistory and getHistoryRecord use the GET endpoints with the bearer token and parse the contract", async () => {
  const list = clientFor(() => json({ records: [] }));
  assert.deepEqual(await list.client.listHistory(), { status: 200, body: { records: [] } });
  assert.equal(list.calls[0]!.url, "https://cetem-qc.example.test/api/v1/history");
  assert.deepEqual(list.calls[0]!.init?.headers, { accept: "application/json", authorization: `Bearer ${token}` });
  assert.deepEqual(await clientFor(() => json(apiError("INTERNAL_ERROR", "Erreur."), 500)).client.listHistory(), { status: 500, code: "INTERNAL_ERROR", message: "Erreur." });
  await assert.rejects(clientFor(() => json({ records: [{ nope: true }] })).client.listHistory(), ApiRequestError);

  const one = clientFor(() => json(historyRecordFixture));
  const reply = await one.client.getHistoryRecord(ID);
  assert.equal(reply.status, 200);
  assert.equal(one.calls[0]!.url, `https://cetem-qc.example.test/api/v1/history/${ID}`);
  assert.deepEqual(one.calls[0]!.init?.headers, { accept: "application/json", authorization: `Bearer ${token}` });
  assert.deepEqual(await clientFor(() => json(apiError("TASK_NOT_FOUND", "Tâche introuvable."), 404)).client.getHistoryRecord(ID), { status: 404, code: "TASK_NOT_FOUND", message: "Tâche introuvable." });
  await assert.rejects(clientFor(() => json({ ...historyRecordFixture, extra: 1 })).client.getHistoryRecord(ID), ApiRequestError);
  await assert.rejects(clientFor(() => json(apiError("FORBIDDEN", "x"), 403)).client.getHistoryRecord(ID), ApiRequestError);
});

test("C2 downloadOfficialReport returns the bytes, the served file name and media type and maps 404, 409 and 500", async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
  const ok = clientFor(() => new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": "attachment; filename=\"Rapport-LCQ-officiel-20261008-12345678.pdf\"" } }));
  const reply = await ok.client.downloadOfficialReport(ID);
  assert.deepEqual(reply, { status: 200, bytes, fileName: "Rapport-LCQ-officiel-20261008-12345678.pdf", mediaType: "application/pdf" });
  assert.equal(ok.calls[0]!.url, `https://cetem-qc.example.test/api/v1/history/${ID}/official-report/file`);
  assert.deepEqual(ok.calls[0]!.init?.headers, { authorization: `Bearer ${token}` });
  assert.deepEqual(await clientFor(() => json(apiError("TASK_NOT_FOUND", "Tâche introuvable."), 404)).client.downloadOfficialReport(ID), { status: 404, code: "TASK_NOT_FOUND", message: "Tâche introuvable." });
  assert.deepEqual(await clientFor(() => json(apiError("REPORT_FILE_NOT_READY", "Indisponible."), 409)).client.downloadOfficialReport(ID), { status: 409, code: "REPORT_FILE_NOT_READY", message: "Indisponible." });
  assert.deepEqual(await clientFor(() => json(apiError("INTERNAL_ERROR", "Échec."), 500)).client.downloadOfficialReport(ID), { status: 500, code: "INTERNAL_ERROR", message: "Échec." });
  await assert.rejects(clientFor(() => json(apiError("OTHER", "x"), 418)).client.downloadOfficialReport(ID), ApiRequestError);
  await assert.rejects(clientFor(() => new Response(bytes, { status: 200 })).client.downloadOfficialReport(ID), ApiRequestError);
});
