import { describe, expect, it } from "vitest";
import {
  SESSION_WINDOWS,
  resolveAttendanceStatus,
  sessionPhase,
  verifyBirth4,
} from "./rules";
import { AttendanceDesk } from "./attendance.server";
import { createTestContext, createTestUser } from "test/fakes/context";

describe("AttendanceDesk Domain Rules: sessionPhase", () => {
  const session = {
    opensAt: new Date("2026-09-15T10:00:00+09:00"),
    lateFrom: new Date("2026-09-15T10:10:00+09:00"),
    closesAt: new Date("2026-09-15T11:00:00+09:00"),
  };

  it("should return 'scheduled' before opensAt", () => {
    const now = new Date("2026-09-15T09:59:59+09:00");
    expect(sessionPhase(session, now)).toBe("scheduled");
  });

  it("should return 'present' exactly at opensAt and up to lateFrom", () => {
    const atOpen = new Date("2026-09-15T10:00:00+09:00");
    expect(sessionPhase(session, atOpen)).toBe("present");

    const middle = new Date("2026-09-15T10:05:00+09:00");
    expect(sessionPhase(session, middle)).toBe("present");

    const justBeforeLate = new Date("2026-09-15T10:09:59+09:00");
    expect(sessionPhase(session, justBeforeLate)).toBe("present");
  });

  it("should return 'late' from lateFrom up to closesAt", () => {
    const atLate = new Date("2026-09-15T10:10:00+09:00");
    expect(sessionPhase(session, atLate)).toBe("late");

    const middleLate = new Date("2026-09-15T10:30:00+09:00");
    expect(sessionPhase(session, middleLate)).toBe("late");

    const justBeforeClose = new Date("2026-09-15T10:59:59+09:00");
    expect(sessionPhase(session, justBeforeClose)).toBe("late");
  });

  it("should return 'closed' exactly at closesAt and after", () => {
    const atClose = new Date("2026-09-15T11:00:00+09:00");
    expect(sessionPhase(session, atClose)).toBe("closed");

    const afterClose = new Date("2026-09-15T11:30:00+09:00");
    expect(sessionPhase(session, afterClose)).toBe("closed");
  });
});

describe("AttendanceDesk Domain Rules: verifyBirth4", () => {
  it("should reject non-4-digit strings", () => {
    expect(verifyBirth4(null, "123").ok).toBe(false);
    expect(verifyBirth4(null, "12345").ok).toBe(false);
    expect(verifyBirth4(null, "abcd").ok).toBe(false);
    expect(verifyBirth4(null, "").ok).toBe(false);
    expect(verifyBirth4(null, " 123 ").ok).toBe(false);
  });

  it("should accept valid 4 digits on first registration", () => {
    const res = verifyBirth4(null, "0806");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.birth4).toBe("0806");
    }
  });

  it("should verify match against registered birth4", () => {
    const resMatch = verifyBirth4("0806", "0806");
    expect(resMatch.ok).toBe(true);

    const resMismatch = verifyBirth4("0806", "0101");
    expect(resMismatch.ok).toBe(false);
    if (!resMismatch.ok) {
      expect(resMismatch.code).toBe("BIRTH4_MISMATCH");
    }
  });
});

describe("AttendanceDesk Domain Rules: resolveAttendanceStatus", () => {
  const session = {
    opensAt: new Date("2026-09-15T10:00:00+09:00"),
    lateFrom: new Date("2026-09-15T10:10:00+09:00"),
    closesAt: new Date("2026-09-15T11:00:00+09:00"),
  };

  it("should preserve existing record status", () => {
    expect(resolveAttendanceStatus(session, "present", new Date())).toBe("present");
    expect(resolveAttendanceStatus(session, "late", new Date())).toBe("late");
  });

  it("should return 'absent' when session is closed and no record exists", () => {
    const afterClose = new Date("2026-09-15T11:05:00+09:00");
    expect(resolveAttendanceStatus(session, null, afterClose)).toBe("absent");
    expect(resolveAttendanceStatus(session, undefined, afterClose)).toBe("absent");
  });

  it("should return null when session is still open or scheduled and no record exists", () => {
    const duringSession = new Date("2026-09-15T10:05:00+09:00");
    expect(resolveAttendanceStatus(session, null, duringSession)).toBeNull();

    const beforeSession = new Date("2026-09-15T09:30:00+09:00");
    expect(resolveAttendanceStatus(session, null, beforeSession)).toBeNull();
  });
});

describe("AttendanceDesk Business Invariants: checkIn", () => {
  it("should reject check-in from professor role", async () => {
    const professor = createTestUser({ role: "professor" });
    const ctx = createTestContext({ user: professor });

    const result = await AttendanceDesk.checkIn(ctx, {
      sessionId: "session-1",
      birth4Input: "0806",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PROFESSOR_EXEMPT");
    }
  });

  it("should reject invalid birth4 format before touching database", async () => {
    const ctx = createTestContext();

    const result = await AttendanceDesk.checkIn(ctx, {
      sessionId: "session-1",
      birth4Input: "invalid",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INVALID_BIRTH4_FORMAT");
    }
  });

  it("should reject birth4 mismatch before touching database", async () => {
    const user = createTestUser({ birth4: "0806" });
    const ctx = createTestContext({ user });

    const result = await AttendanceDesk.checkIn(ctx, {
      sessionId: "session-1",
      birth4Input: "9999",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BIRTH4_MISMATCH");
    }
  });
});
