/**
 * 의존성 없는 최소 XLSX(xlsx Open XML) 생성기.
 * sharedStrings 없이 inlineStr만 쓰는 단일 시트로, Excel·Numbers·구글시트에서 열리는
 * 최소 구성(Content_Types, rels, workbook, sheet)을 Store ZIP으로 묶는다.
 */
import { buildZip, type ZipEntry } from "./zip";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // 엑셀이 허용하는 수준에서 제어문자 제거
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** 엑셀 열 번호(A, B, …, Z, AA, …) */
export function colLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export type Cell = string | number | null | undefined;

export function buildSheetXml(rows: Cell[][]): string {
  const rowXml = rows
    .map((cells, r) => {
      const cellXml = cells
        .map((cell, c) => {
          const ref = `${colLetter(c)}${r + 1}`;
          if (cell === null || cell === undefined || cell === "") {
            return `<c r="${ref}"/>`;
          }
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cellXml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="__NAME__" sheetId="1" r:id="rId1"/></sheets></workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

/** 시트 이름은 엑셀 제약상 31자 이하, []:*?/\ 문자 불가 */
function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned || "Sheet1";
}

export function buildXlsx(sheetName: string, rows: Cell[][]): Uint8Array {
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: encoderText(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoderText(RELS) },
    { name: "xl/workbook.xml", data: encoderText(WORKBOOK.replace("__NAME__", escapeXml(safeSheetName(sheetName)))) },
    { name: "xl/_rels/workbook.xml.rels", data: encoderText(WORKBOOK_RELS) },
    { name: "xl/worksheets/sheet1.xml", data: encoderText(buildSheetXml(rows)) },
  ];
  return buildZip(entries);
}

function encoderText(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
