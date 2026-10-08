// Synthetic PDFs for Story 11.2 tests: generated here, never real client data.

export interface PdfOptions {
  version?: string;
  /** Extra entries inside the catalog dictionary. */
  catalog?: string;
  /** Extra entries inside the trailer (or cross-reference stream) dictionary. */
  trailer?: string;
  /** Build a cross-reference stream instead of a classic table. */
  xrefStream?: boolean;
  /** Bytes appended after the final %%EOF. */
  after?: string;
}

/** A minimal well-formed PDF with correct cross-reference offsets. */
export function buildPdf(options: PdfOptions = {}): Buffer {
  const header = `%PDF-${options.version ?? "1.4"}\n`;
  const one = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ""} >>\nendobj\n`;
  const two = "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n";
  const offsetOne = header.length;
  const offsetTwo = offsetOne + one.length;
  const body = header + one + two;
  if (options.xrefStream) {
    const startxref = body.length;
    const tail = `3 0 obj\n<< /Type /XRef /Size 4 /Root 1 0 R /W [1 2 1] /Length 0 ${options.trailer ?? ""} >>\nstream\n\nendstream\nendobj\nstartxref\n${startxref}\n%%EOF\n`;
    return Buffer.from(body + tail + (options.after ?? ""), "latin1");
  }
  const startxref = body.length;
  const pad = (value: number) => String(value).padStart(10, "0");
  const table = `xref\n0 3\n0000000000 65535 f \n${pad(offsetOne)} 00000 n \n${pad(offsetTwo)} 00000 n \n`;
  const trailer = `trailer\n<< /Size 3 /Root 1 0 R ${options.trailer ?? ""} >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(body + table + trailer + (options.after ?? ""), "latin1");
}

/** A PDF whose catalog carries the given active-content name token. */
export const pdfWithToken = (token: string): Buffer => buildPdf({ catalog: `/OpenAction << /S ${token} /X (y) >>` });
