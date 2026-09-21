import { describe, it, expect } from "vitest";
import { createFakeR2 } from "./fakes/r2";
import { createTestContext, createTestUser } from "./fakes/context";
import { kstYMD, sessionPhase, dDay } from "~/lib/time";

describe("Phase 0 Test Harness: FakeR2Bucket", () => {
  it("should store and retrieve data with stream and metadata", async () => {
    const r2 = createFakeR2();
    const content = "Hello Cloudflare R2!";

    await r2.put("test/file.txt", content, {
      httpMetadata: { contentType: "text/plain" },
    });

    expect(r2.has("test/file.txt")).toBe(true);

    const obj = await r2.get("test/file.txt");
    expect(obj).not.toBeNull();
    expect(obj!.size).toBe(content.length);
    expect(obj!.httpMetadata.contentType).toBe("text/plain");

    const text = await obj!.text();
    expect(text).toBe(content);
  });

  it("should support deletion of objects", async () => {
    const r2 = createFakeR2();
    await r2.put("key1", "data1");
    await r2.put("key2", "data2");
    expect(r2.count()).toBe(2);

    await r2.delete("key1");
    expect(r2.has("key1")).toBe(false);
    expect(r2.has("key2")).toBe(true);
    expect(r2.count()).toBe(1);
  });
});

describe("Phase 0 Test Harness: AppContext Seam", () => {
  it("should create default test context with correct properties", () => {
    const ctx = createTestContext();
    expect(ctx.user.name).toBe("테스트학생");
    expect(ctx.user.role).toBe("student");
    expect(ctx.env.SESSION_SECRET).toBeDefined();
    expect(ctx.now.toISOString()).toBe("2026-09-15T01:00:00.000Z"); // 10:00 KST
  });

  it("should allow time-travel testing by overriding now", () => {
    const customTime = new Date("2026-09-15T10:05:00+09:00");
    const ctx = createTestContext({ now: customTime });
    expect(kstYMD(ctx.now)).toBe("2026-09-15");
  });

  it("should allow overriding user details", () => {
    const professor = createTestUser({ role: "professor", name: "김교수" });
    const ctx = createTestContext({ user: professor });
    expect(ctx.user.role).toBe("professor");
    expect(ctx.user.name).toBe("김교수");
  });
});

describe("Phase 0 Test Harness: Time utilities", () => {
  it("should evaluate session phase accurately with injected time", () => {
    const session = {
      opensAt: new Date("2026-09-15T10:00:00+09:00"),
      lateFrom: new Date("2026-09-15T10:10:00+09:00"),
      closesAt: new Date("2026-09-15T11:00:00+09:00"),
    };

    // 09:59 -> scheduled
    expect(sessionPhase(session, new Date("2026-09-15T09:59:59+09:00"))).toBe("scheduled");
    // 10:05 -> present
    expect(sessionPhase(session, new Date("2026-09-15T10:05:00+09:00"))).toBe("present");
    // 10:15 -> late
    expect(sessionPhase(session, new Date("2026-09-15T10:15:00+09:00"))).toBe("late");
    // 11:01 -> closed
    expect(sessionPhase(session, new Date("2026-09-15T11:01:00+09:00"))).toBe("closed");
  });
});
