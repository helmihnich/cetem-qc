import assert from "node:assert/strict";
import test from "node:test";
import { buildPdf, pdfWithToken } from "../../test-support/pdf-fixtures.js";
import { PDF_ABSOLUTE_MAX_BYTES, validatePdf } from "./index.js";

// Story 11.2 (V1–V8): the pure structural validator on synthetic PDFs.

const check = (bytes: Uint8Array | Buffer, maxBytes = PDF_ABSOLUTE_MAX_BYTES) => validatePdf(new Uint8Array(bytes), { maxBytes });
const text = (bytes: Buffer) => bytes.toString("latin1");
const bytesOf = (value: string) => Buffer.from(value, "latin1");

test("V1 valid classic, xref-stream, PDF 2.0 and trailing-bytes files pass", () => {
  assert.deepEqual(check(buildPdf()), { result: "passed" });
  assert.deepEqual(check(buildPdf({ xrefStream: true })), { result: "passed" });
  assert.deepEqual(check(buildPdf({ version: "2.0" })), { result: "passed" });
  assert.deepEqual(check(buildPdf({ after: "\n".repeat(200) })), { result: "passed" });
  assert.deepEqual(check(buildPdf({ catalog: "/OpenAction 5 0 R /AA << >>" })), { result: "passed" }, "OpenAction and AA alone do not quarantine");
});

test("V2 anything that is not a PDF at offset 0 is rejected as not-pdf", () => {
  const pdf = buildPdf();
  for (const sample of [bytesOf("just some text"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), Buffer.from("PK\u0003\u0004zip", "latin1"),
    Buffer.concat([bytesOf("\n"), pdf]), bytesOf(text(pdf).replace("%PDF-1.4", "%PDF-3.0")), bytesOf(text(pdf).replace("%PDF-1.4", "%PDF-1.x"))]) {
    assert.deepEqual(check(sample), { result: "rejected", class: "not-pdf" });
  }
});

test("V3 a file cut before %%EOF is truncated; cut mid-body is truncated or corrupt", () => {
  const pdf = buildPdf();
  assert.deepEqual(check(pdf.subarray(0, pdf.length - 8)), { result: "rejected", class: "truncated" });
  const cut = check(pdf.subarray(0, 60));
  assert.equal(cut.result, "rejected");
  assert.ok(["truncated", "corrupt-structure"].includes((cut as { class: string }).class));
});

test("V4 missing or wrong startxref, no xref at the offset, no /Root: corrupt-structure", () => {
  const pdf = text(buildPdf());
  const corrupt = { result: "rejected", class: "corrupt-structure" };
  assert.deepEqual(check(bytesOf(pdf.replace(/startxref\s+\d+/, "startxrf 1"))), corrupt);
  assert.deepEqual(check(bytesOf(pdf.replace(/startxref\s+\d+/, "startxref\n999999"))), corrupt);
  assert.deepEqual(check(bytesOf(pdf.replace(/startxref\s+\d+/, "startxref\n12"))), corrupt, "offset not at xref or an object");
  assert.deepEqual(check(bytesOf(pdf.replace("/Root 1 0 R", "/Rooted 1 0 R"))), corrupt, "no /Root name");
  assert.deepEqual(check(bytesOf(pdf.replace("/Root 1 0 R", ""))), corrupt);
  assert.deepEqual(check(bytesOf(text(buildPdf({ xrefStream: true })).replace("/Root 1 0 R", ""))), corrupt);
  assert.deepEqual(check(bytesOf(pdf.replace(/trailer[\s\S]*?startxref/, "startxref"))), corrupt, "no trailer");
});

test("V5 /Encrypt in the trailer or the cross-reference stream is encrypted", () => {
  const encrypted = { result: "rejected", class: "encrypted" };
  assert.deepEqual(check(buildPdf({ trailer: "/Encrypt 9 0 R" })), encrypted);
  assert.deepEqual(check(buildPdf({ trailer: "/Encrypt << /Filter /Standard >>" })), encrypted);
  assert.deepEqual(check(buildPdf({ xrefStream: true, trailer: "/Encrypt 9 0 R" })), encrypted);
});

test("V6 each unsafe name token quarantines; look-alike names do not", () => {
  for (const token of ["/JavaScript", "/JS", "/Launch", "/EmbeddedFile", "/RichMedia", "/SubmitForm", "/ImportData", "/GoToR", "/GoToE"]) {
    assert.deepEqual(check(pdfWithToken(token)), { result: "quarantined", class: "active-content" }, token);
  }
  for (const token of ["/JSON", "/JSX", "/Launcher", "/GoToRemote", "/JavaScripts"]) {
    assert.deepEqual(check(pdfWithToken(token)), { result: "passed" }, token);
  }
});

test("V7 rejection precedence: encrypted before active content, truncated before everything", () => {
  assert.deepEqual(check(buildPdf({ trailer: "/Encrypt 9 0 R", catalog: "/JavaScript" })), { result: "rejected", class: "encrypted" });
  const truncated = pdfWithToken("/JavaScript");
  assert.deepEqual(check(truncated.subarray(0, truncated.length - 8)), { result: "rejected", class: "truncated" });
});

test("V8 empty and over-limit buffers do not pass; the exact limit is accepted", () => {
  assert.equal(check(Buffer.alloc(0)).result, "rejected");
  const pdf = buildPdf();
  assert.equal(check(pdf, pdf.length - 1).result, "rejected");
  assert.deepEqual(check(pdf, pdf.length), { result: "passed" });
  assert.equal(PDF_ABSOLUTE_MAX_BYTES, 20971520);
});
