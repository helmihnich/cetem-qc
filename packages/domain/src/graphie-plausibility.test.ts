import assert from "node:assert/strict";
import test from "node:test";
import { checkGraphiePlausibility, localIsoDay, parseControlDate } from "./graphie-plausibility.js";

const context = { today: "2026-10-09", earliestDate: "2026-10-01" };
const codes = (values: Record<string, string>, requireMandatory = false) =>
  Object.fromEntries(checkGraphiePlausibility(values, context, { requireMandatory }).map((issue) => [issue.path, issue.code]));

test("P1 control dates accept real JJ/MM/AAAA or AAAA-MM-JJ days only", () => {
  assert.equal(parseControlDate("09/10/2026"), "2026-10-09");
  assert.equal(parseControlDate("9/10/2026"), "2026-10-09");
  assert.equal(parseControlDate("2026-10-09"), "2026-10-09");
  for (const raw of ["31/02/2026", "00/10/2026", "12/13/2026", "hier", "09/10/26", "1/1/1800"]) assert.equal(parseControlDate(raw), undefined, raw);
});

test("P2 the control date must be a real day between the task creation and today", () => {
  assert.deepEqual(codes({ "controlPerformedBy.dateControle": "05/10/2026" }), {});
  assert.deepEqual(codes({ "controlPerformedBy.dateControle": "09/10/2026" }), {});
  assert.deepEqual(codes({ "controlPerformedBy.dateControle": "10/10/2026" }), { "values.controlPerformedBy.dateControle": "future-date" });
  assert.deepEqual(codes({ "controlPerformedBy.dateControle": "30/09/2026" }), { "values.controlPerformedBy.dateControle": "date-before-task" });
  assert.deepEqual(codes({ "controlPerformedBy.dateControle": "31/02/2026" }), { "values.controlPerformedBy.dateControle": "invalid-date" });
});

test("P3 readings outside the physical range of their unit or unreadable are refused; blanks are not", () => {
  assert.deepEqual(codes({ "voltage.accuracy.row1.kvMeasured": "72,4", "lightField.gap1": "-3", "output.linearity.dfc": "" }), {});
  assert.deepEqual(codes({ "voltage.accuracy.row1.kvMeasured": "900" }), { "values.voltage.accuracy.row1.kvMeasured": "out-of-range" });
  assert.deepEqual(codes({ "output.linearity.dfc": "40" }), { "values.output.linearity.dfc": "out-of-range" });
  assert.deepEqual(codes({ "voltage.repeatability.row1.kerma": "-1" }), { "values.voltage.repeatability.row1.kerma": "out-of-range" });
  assert.deepEqual(codes({ "lightField.kv": "abc" }), { "values.lightField.kv": "invalid-number" });
});

test("P4 a submission needs the controller name and the control date", () => {
  assert.deepEqual(codes({}, true), { "values.controlPerformedBy.nom": "required", "values.controlPerformedBy.dateControle": "required" });
  assert.deepEqual(codes({ "controlPerformedBy.nom": "A. Ben Salah", "controlPerformedBy.dateControle": "08/10/2026" }, true), {});
  assert.deepEqual(codes({}), {}, "while typing, empty mandatory fields are not reported");
});

test("P5 the local day is formatted as AAAA-MM-JJ", () => {
  assert.equal(localIsoDay(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
});
