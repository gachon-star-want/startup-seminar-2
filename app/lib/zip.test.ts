import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildZip, crc32, uniqueZipName } from "./zip";
import { readZipEntries } from "test/helpers/zip-parse";

describe("crc32", () => {
  it("should match Node zlib.crc32 for sample inputs", () => {
    const samples = [
      new TextEncoder().encode("hello world"),
      new TextEncoder().encode("창업심화세미나2 발표 자료"),
      new Uint8Array(0),
      crypto.getRandomValues(new Uint8Array(1024)),
    ];
    for (const data of samples) {
      expect(crc32(data)).toBe(nodeCrc32(data));
    }
  });
});

describe("buildZip", () => {
  it("should assemble a valid store-mode zip with korean filenames", () => {
    const a = new TextEncoder().encode("A-team file");
    const b = new TextEncoder().encode("한글 내용 테스트");
    const zip = buildZip([
      { name: "팀A/발표자료.pptx", data: a },
      { name: "팀B/보고서.pdf", data: b },
    ]);

    const entries = readZipEntries(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe("팀A/발표자료.pptx");
    expect(entries[0]!.method).toBe(0); // store
    expect(new TextDecoder().decode(entries[0]!.data)).toBe("A-team file");
    expect(new TextDecoder().decode(entries[1]!.data)).toBe("한글 내용 테스트");
  });

  it("should keep total size equal to contents plus zip overhead", () => {
    const data = new Uint8Array(10_000).fill(7);
    const zip = buildZip([{ name: "big.bin", data }]);
    // 무압축이므로 전체 크기 = 데이터 + 헤더/디렉터리 오버헤드
    expect(zip.length).toBeGreaterThanOrEqual(data.length);
    expect(zip.length).toBeLessThan(data.length + 512);
  });
});

describe("uniqueZipName", () => {
  it("should dedupe case-insensitively with (n) suffix", () => {
    const used = new Set<string>();
    expect(uniqueZipName(used, "팀/발표.pptx")).toBe("팀/발표.pptx");
    expect(uniqueZipName(used, "팀/발표.pptx")).toBe("팀/발표(2).pptx");
    expect(uniqueZipName(used, "팀/발표.PPTX")).toBe("팀/발표(3).PPTX");
  });

  it("should handle names without extension", () => {
    const used = new Set<string>();
    expect(uniqueZipName(used, "README")).toBe("README");
    expect(uniqueZipName(used, "README")).toBe("README(2)");
  });
});
