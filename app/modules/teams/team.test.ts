import { describe, expect, it } from "vitest";
import { milestonePoints, teamScore, MAX_TEAM_SCORE } from "./score";
import { TeamRoster } from "./team.server";
import { createTestContext, createTestUser } from "test/fakes/context";

describe("TeamRoster Domain Rules: Milestone & Score", () => {
  it("should calculate milestone points correctly", () => {
    expect(milestonePoints("none")).toBe(0);
    expect(milestonePoints("applied")).toBe(1);
    expect(milestonePoints("done")).toBe(2);
    expect(milestonePoints("unknown")).toBe(0);
  });

  it("should compute full team score accurately", () => {
    const emptyTeam = {
      itemName: null,
      salesChannel: null,
      businessStatus: "none",
      mailOrderStatus: "none",
    };
    expect(teamScore(emptyTeam)).toBe(0);

    const fullTeam = {
      itemName: "스마트 화분",
      salesChannel: "네이버 스마트스토어",
      businessStatus: "done",
      mailOrderStatus: "done",
    };
    expect(teamScore(fullTeam)).toBe(MAX_TEAM_SCORE); // 1 + 1 + 2 + 2 = 6

    const partialTeam = {
      itemName: "아이템만 있음",
      salesChannel: "  ", // whitespace only
      businessStatus: "applied",
      mailOrderStatus: "none",
    };
    expect(teamScore(partialTeam)).toBe(2); // 1 + 0 + 1 + 0 = 2
  });
});

describe("TeamRoster Business Invariants: Validation", () => {
  it("should reject team name with less than 2 characters", async () => {
    const ctx = createTestContext();
    const result = await TeamRoster.create(ctx, "a");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("2자 이상");
    }
  });

  it("should reject empty invite code on join", async () => {
    const ctx = createTestContext();
    const result = await TeamRoster.joinByCode(ctx, "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("초대코드");
    }
  });
});
