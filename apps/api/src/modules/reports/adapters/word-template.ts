import { readFileSync } from "node:fs";
import path from "node:path";
import { REPORT_TEMPLATE_ID, REPORT_TEMPLATE_VERSION } from "@cetem-qc/i18n/report-document";
import type { ReportBlock, ReportCell, ReportDocument } from "@cetem-qc/i18n/report-document";
import { fr } from "@cetem-qc/i18n";
import type { ReportDocumentGenerator } from "../ports/report-document-generator.js";
import { writeZip } from "./zip-writer.js";
import type { ZipEntry } from "./zip-writer.js";

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PAGE_CONTENT_WIDTH_TWIPS = 9638; // A4 (11906) minus 2 x 1134 margins.
const LOGO_HEIGHT_EMU = 648000; // 1.8 cm

/** XML text: control characters (except tab, LF, CR) and unpaired surrogates are stripped, markup is escaped. */
export function escapeXml(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

let logoBytes: Buffer | undefined;
const loadLogo = (): Buffer => logoBytes ??= readFileSync(path.join(__dirname, "..", "assets", "cetem-logo.png"));

/** Width and height from the PNG header (IHDR), used only to keep the logo's aspect ratio. */
function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const run = (value: string, options: { bold?: boolean; font?: string } = {}): string =>
  `<w:r><w:rPr>${options.font ? `<w:rFonts w:ascii="${options.font}" w:hAnsi="${options.font}" w:cs="${options.font}"/>` : ""}${options.bold ? "<w:b/>" : ""}</w:rPr><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>`;
const paragraphXml = (inner: string, properties = ""): string => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${inner}</w:p>`;

function cellXml(cell: ReportCell, width: number): string {
  const span = cell.colSpan && cell.colSpan > 1 ? `<w:gridSpan w:val="${cell.colSpan}"/>` : "";
  const properties = `<w:tcPr><w:tcW w:w="${width * (cell.colSpan ?? 1)}" w:type="dxa"/>${span}</w:tcPr>`;
  let content: string;
  switch (cell.kind) {
    case "text": content = paragraphXml(run(cell.text, { bold: cell.bold })); break;
    case "mark": content = paragraphXml(run(cell.checked ? fr.report.doc.checked : fr.report.doc.unchecked, { font: "Segoe UI Symbol" })); break;
    case "empty": content = "<w:p/>"; break;
  }
  return `<w:tc>${properties}${content}</w:tc>`;
}

function tableXml(rows: ReportCell[][]): string {
  const span = (cell: ReportCell) => cell.colSpan ?? 1;
  const columns = Math.max(1, ...rows.map((row) => row.reduce((total, cell) => total + span(cell), 0)));
  const width = Math.floor(PAGE_CONTENT_WIDTH_TWIPS / columns);
  const grid = Array.from({ length: columns }, () => `<w:gridCol w:w="${width}"/>`).join("");
  const body = rows.map((row) => {
    const used = row.reduce((total, cell) => total + span(cell), 0);
    // A short row is completed with empty cells so the grid stays rectangular.
    const padded = used < columns ? [...row, { kind: "empty", colSpan: columns - used } as ReportCell] : row;
    return `<w:tr><w:trPr><w:cantSplit/></w:trPr>${padded.map((cell) => cellXml(cell, width)).join("")}</w:tr>`;
  }).join("");
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${width * columns}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}

function blockXml(block: ReportBlock): string {
  switch (block.kind) {
    case "heading":
      return paragraphXml(run(block.text), `<w:pStyle w:val="Heading${block.level}"/>`);
    case "paragraph":
      return paragraphXml(run(block.text, { bold: block.bold }));
    case "table":
      // Word requires a paragraph between two consecutive tables.
      return `${tableXml(block.rows)}<w:p/>`;
    case "pageBreak":
      return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }
}

function documentXml(document: ReportDocument): string {
  const sectionProperties = '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  return `${XML_DECLARATION}<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>${document.blocks.map(blockXml).join("")}${sectionProperties}</w:body></w:document>`;
}

function headerXml(): string {
  const { width, height } = pngSize(loadLogo());
  const cy = LOGO_HEIGHT_EMU;
  const cx = Math.round((LOGO_HEIGHT_EMU * width) / height);
  const drawing = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Logo CETEM BH" descr="Logo CETEM BH"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="logo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  return `${XML_DECLARATION}<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}"><w:p><w:pPr><w:jc w:val="left"/></w:pPr>${drawing}</w:p></w:hdr>`;
}

function footerXml(): string {
  const field = '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>';
  return `${XML_DECLARATION}<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${field}${run(fr.report.doc.pageNumbering)}</w:p></w:ftr>`;
}

function stylesXml(): string {
  const heading = (level: number, size: number, extra: string) =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/>${level === 1 ? '<w:jc w:val="center"/>' : ""}</w:pPr><w:rPr><w:b/>${extra}<w:sz w:val="${size}"/></w:rPr></w:style>`;
  return `${XML_DECLARATION}<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 28, "")}${heading(2, 24, "")}${heading(3, 22, "<w:u w:val=\"single\"/>")}<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
}

const contentTypesXml = `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const relationship = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const relationshipsXml = (...items: string[]) => `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;

const rootRelationshipsXml = relationshipsXml(
  relationship("rId1", `${REL}/officeDocument`, "word/document.xml"),
  relationship("rId2", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"),
);
const documentRelationshipsXml = relationshipsXml(
  relationship("rId1", `${REL}/styles`, "styles.xml"),
  relationship("rId2", `${REL}/header`, "header1.xml"),
  relationship("rId3", `${REL}/footer`, "footer1.xml"),
);
const headerRelationshipsXml = relationshipsXml(relationship("rId1", `${REL}/image`, "media/logo.png"));
const corePropertiesXml = `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(fr.report.doc.title)}</dc:title></cp:coreProperties>`;

/** The zero-dependency adapter: renders the report document to an OOXML package (`.docx`). Deterministic bytes. */
export function createWordTemplateGenerator(): ReportDocumentGenerator {
  return {
    templateId: REPORT_TEMPLATE_ID,
    templateVersion: REPORT_TEMPLATE_VERSION,
    async generate(document) {
      const text = (name: string, xml: string): ZipEntry => ({ name, data: Buffer.from(xml, "utf8"), method: "deflate" });
      const entries: ZipEntry[] = [
        text("[Content_Types].xml", contentTypesXml),
        text("_rels/.rels", rootRelationshipsXml),
        text("word/document.xml", documentXml(document)),
        text("word/_rels/document.xml.rels", documentRelationshipsXml),
        text("word/styles.xml", stylesXml()),
        text("word/header1.xml", headerXml()),
        text("word/_rels/header1.xml.rels", headerRelationshipsXml),
        text("word/footer1.xml", footerXml()),
        { name: "word/media/logo.png", data: loadLogo(), method: "store" },
        text("docProps/core.xml", corePropertiesXml),
      ];
      return { bytes: writeZip(entries) };
    },
  };
}
