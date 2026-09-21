import { describe, expect, it } from "vitest";
import {
  sanitizeFilename,
  buildSubmissionR2Key,
  buildFileStreamResponse,
  uploadStreamToR2,
} from "./storage";
import { SubmissionHub } from "./submissions.server";
import { createTestContext } from "test/fakes/context";
import { FakeR2Bucket } from "test/fakes/r2";

describe("Submission Storage Utilities", () => {
  describe("sanitizeFilename", () => {
    it("should strip directory traversal characters", () => {
      expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
      expect(sanitizeFilename("..\\..\\windows\\system32\\calc.exe")).toBe("calc.exe");
    });

    it("should replace unsafe characters with underscores", () => {
      expect(sanitizeFilename('file*name?"test<>.pdf')).toBe("file_name__test__.pdf");
    });

    it("should preserve valid korean and english filenames", () => {
      expect(sanitizeFilename("중간발표자료_최종(수정본).pptx")).toBe(
        "중간발표자료_최종(수정본).pptx"
      );
      expect(sanitizeFilename("project-v2.1.tar.gz")).toBe("project-v2.1.tar.gz");
    });

    it("should provide default fallback for empty or whitespace names", () => {
      expect(sanitizeFilename("")).toBe("file");
      expect(sanitizeFilename("   ")).toBe("file");
      expect(sanitizeFilename("..//\\\\")).toBe("file");
    });

    it("should limit max length to 200 characters", () => {
      const longBase = "a".repeat(300);
      const sanitized = sanitizeFilename(`${longBase}.pdf`);
      expect(sanitized.length).toBeLessThanOrEqual(200);
    });
  });

  describe("buildSubmissionR2Key", () => {
    it("should format R2 storage key properly with assignment and owner scopes", () => {
      const key = buildSubmissionR2Key("assign-1", "user-123", "발표.pdf");
      expect(key).toMatch(/^submissions\/assign-1\/user-123\/[0-9a-f-]{36}-발표\.pdf$/);
    });
  });

  describe("buildFileStreamResponse", () => {
    it("should create Web Response with RFC 5987 encoded headers for Korean filenames", () => {
      const stream = new ReadableStream();
      const res = buildFileStreamResponse("보고서.pdf", "application/pdf", stream as any, false);

      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      const cd = res.headers.get("Content-Disposition");
      expect(cd).toContain("attachment");
      expect(cd).toContain("filename*=UTF-8''%EB%B3%B4%EA%B3%A0%EC%84%9C.pdf");
    });

    it("should use inline disposition when requested", () => {
      const stream = new ReadableStream();
      const res = buildFileStreamResponse("slide.pdf", "application/pdf", stream as any, true);
      const cd = res.headers.get("Content-Disposition");
      expect(cd).toBe("inline; filename*=UTF-8''slide.pdf");
    });
  });

  describe("uploadStreamToR2 with FakeR2Bucket", () => {
    it("should stream upload file to FakeR2Bucket zero-heap", async () => {
      const bucket = new FakeR2Bucket();
      const fileData = new TextEncoder().encode("Hello R2 Stream Test");
      const fakeFile = new File([fileData], "test.txt", { type: "text/plain" });

      await uploadStreamToR2(bucket as any, "submissions/a1/u1/test.txt", fakeFile, "text/plain");

      const saved = await bucket.get("submissions/a1/u1/test.txt");
      expect(saved).not.toBeNull();
      expect(saved?.httpMetadata.contentType).toBe("text/plain");
      const text = await saved?.text();
      expect(text).toBe("Hello R2 Stream Test");
    });
  });
});

describe("SubmissionHub Invariants & Validation", () => {
  it("should reject assignment creation with empty title or invalid unit", async () => {
    const ctx = createTestContext();

    const result1 = await SubmissionHub.createAssignment(ctx, {
      title: "   ",
      dueAtRaw: "2026-10-01T18:00",
      unit: "team",
    });
    expect(result1.ok).toBe(false);
    if (!result1.ok) expect(result1.message).toContain("제목");

    const result2 = await SubmissionHub.createAssignment(ctx, {
      title: "중간 과제",
      dueAtRaw: "2026-10-01T18:00",
      unit: "invalid_unit",
    });
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.message).toContain("제출 단위");

    const result3 = await SubmissionHub.createAssignment(ctx, {
      title: "중간 과제",
      dueAtRaw: "invalid-date",
      unit: "team",
    });
    expect(result3.ok).toBe(false);
    if (!result3.ok) expect(result3.message).toContain("마감일시");
  });

  it("should validate updateAssignment requirements", async () => {
    const ctx = createTestContext();

    const res = await SubmissionHub.updateAssignment(ctx, "a1", {
      title: "",
      dueAtRaw: "2026-10-01T18:00",
      unit: "team",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("제목");
  });
});
