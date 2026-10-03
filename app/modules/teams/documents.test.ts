import { describe, expect, it } from "vitest";
import {
  MAX_DOC_MB,
  TEAM_DOC_EXTENSIONS,
  TEAM_DOC_LABELS,
  isAllowedDocFile,
  isTeamDocKind,
} from "~/lib/constants";
import { buildTeamDocumentR2Key } from "~/modules/submissions/storage";
import { TeamDocuments } from "./documents.server";
import { createTestContext } from "test/fakes/context";

describe("Team Document Storage Utilities", () => {
  describe("buildTeamDocumentR2Key", () => {
    it("should format R2 storage key with team scope", () => {
      const key = buildTeamDocumentR2Key("team-1", "사업자등록증.pdf");
      expect(key).toMatch(/^team-documents\/team-1\/[0-9a-f-]{36}-사업자등록증\.pdf$/);
    });

    it("should sanitize unsafe filenames in the key", () => {
      const key = buildTeamDocumentR2Key("team-1", "bad/name?.pdf");
      expect(key.endsWith("-name_.pdf")).toBe(true);
    });
  });

  describe("isTeamDocKind", () => {
    it("should accept only the two defined kinds", () => {
      expect(isTeamDocKind("business")).toBe(true);
      expect(isTeamDocKind("mail_order")).toBe(true);
      expect(isTeamDocKind("")).toBe(false);
      expect(isTeamDocKind("business ")).toBe(false);
      expect(isTeamDocKind("substitute")).toBe(false);
    });
  });

  describe("isAllowedDocFile", () => {
    it("should accept whitelisted document extensions", () => {
      for (const ext of TEAM_DOC_EXTENSIONS) {
        expect(isAllowedDocFile(`증명서.${ext}`)).toBe(true);
      }
    });

    it("should accept image mime types even without a known extension (HEIC 등)", () => {
      expect(isAllowedDocFile("photo", "image/heic")).toBe(true);
      expect(isAllowedDocFile("scan", "application/pdf")).toBe(true);
    });

    it("should reject executables, archives and svg", () => {
      expect(isAllowedDocFile("악성코드.exe", "application/x-msdownload")).toBe(false);
      expect(isAllowedDocFile("자료.zip", "application/zip")).toBe(false);
      expect(isAllowedDocFile("스크립트.svg", "image/svg+xml")).toBe(false);
      expect(isAllowedDocFile("파일명없는파일")).toBe(false);
    });
  });
});

describe("TeamDocuments Validation (DB 접근 전 검증 순서)", () => {
  it("should reject unknown kind before touching the database", async () => {
    const ctx = createTestContext();
    const result = await TeamDocuments.upload(ctx, "hacked", new File(["x"], "a.pdf"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("올바르지 않아요");
  });

  it("should reject empty uploads", async () => {
    const ctx = createTestContext();
    const result = await TeamDocuments.upload(ctx, "business", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("선택해 주세요");

    const empty = await TeamDocuments.upload(
      ctx,
      "business",
      new File([], "empty.pdf", { type: "application/pdf" })
    );
    expect(empty.ok).toBe(false);
  });

  it("should reject files over the size limit", async () => {
    const ctx = createTestContext();
    const big = new File([new Uint8Array(MAX_DOC_MB * 1024 * 1024 + 1)], "큰사진.jpg", {
      type: "image/jpeg",
    });
    const result = await TeamDocuments.upload(ctx, "business", big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(`${MAX_DOC_MB}MB를 초과`);
  });

  it("should reject non document files", async () => {
    const ctx = createTestContext();
    const zip = new File([new Uint8Array(10)], "자료.zip", { type: "application/zip" });
    const result = await TeamDocuments.upload(ctx, "mail_order", zip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("PDF 또는 이미지");
  });

  it("should label each kind in the rejection message", async () => {
    const ctx = createTestContext();
    const result = await TeamDocuments.upload(ctx, "mail_order", null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(TEAM_DOC_LABELS.mail_order);
  });

  it("should reject unknown kind on delete before touching the database", async () => {
    const ctx = createTestContext();
    const result = await TeamDocuments.deleteDocument(ctx, "other");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("올바르지 않아요");
  });
});
