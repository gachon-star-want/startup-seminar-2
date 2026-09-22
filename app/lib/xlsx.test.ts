import { describe, expect, it } from "vitest";
import { buildSheetXml, buildXlsx, colLetter } from "./xlsx";
import { readZipEntries } from "test/helpers/zip-parse";

describe("colLetter", () => {
  it("should map column indexes to spreadsheet letters", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(8)).toBe("I");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(27)).toBe("AB");
  });
});

describe("buildSheetXml", () => {
  it("should escape XML entities and use inlineStr for text, v for numbers", () => {
    const xml = buildSheetXml([
      ["발표 & 평가 <최종>", 5, null, ""],
      [3, "코멘트 \"좋아요\"", undefined, 15],
    ]);
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">발표 &amp; 평가 &lt;최종&gt;</t></is></c>');
    expect(xml).toContain('<c r="B1"><v>5</v></c>');
    expect(xml).toContain('<c r="C1"/>'); // null → 빈 셀
    expect(xml).toContain('<c r="D1"/>'); // "" → 빈 셀
    expect(xml).toContain('<c r="B2" t="inlineStr">');
    expect(xml).toContain("코멘트 &quot;좋아요&quot;");
    expect(xml).toContain('<row r="2">');
  });
});

describe("buildXlsx", () => {
  it("should assemble a readable xlsx package with all required parts", () => {
    const bytes = buildXlsx("발표 평가", [["발표", "총점"], ["바펄스 팀", 13]]);
    const entries = readZipEntries(bytes);
    const names = entries.map((e) => e.name);

    expect(names).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);

    const sheet = new TextDecoder().decode(entries[4]!.data);
    expect(sheet).toContain("발표");
    expect(sheet).toContain("<v>13</v>");

    const workbook = new TextDecoder().decode(entries[2]!.data);
    expect(workbook).toContain('name="발표 평가"');
  });

  it("should sanitize illegal sheet-name characters and cap length", () => {
    const bytes = buildXlsx("세션[1]: 결과/발표*?" + "x".repeat(40), [["a"]]);
    const entries = readZipEntries(bytes);
    const workbook = new TextDecoder().decode(entries[2]!.data);
    const match = workbook.match(/name="([^"]*)"/);
    expect(match).not.toBeNull();
    const name = match![1]!;
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[[\]:*?/\\]/);
  });
});
