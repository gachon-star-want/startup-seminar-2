/**
 * 리더보드 점수 (최대 6점)
 * - 아이템 확정 1점
 * - 판매 채널 확정 1점
 * - 사업자등록: 신청중 1점 / 완료 2점
 * - 통신판매업신고: 신고중 1점 / 완료 2점
 */
export function milestonePoints(status: string): number {
  if (status === "done") return 2;
  if (status === "applied") return 1;
  return 0;
}

export function teamScore(team: {
  itemName: string | null;
  salesChannel: string | null;
  businessStatus: string;
  mailOrderStatus: string;
}): number {
  return (
    (team.itemName?.trim() ? 1 : 0) +
    (team.salesChannel?.trim() ? 1 : 0) +
    milestonePoints(team.businessStatus) +
    milestonePoints(team.mailOrderStatus)
  );
}

export const MAX_TEAM_SCORE = 6;
