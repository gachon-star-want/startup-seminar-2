export const SALES_CHANNEL_OPTIONS = [
  "자사몰 (직접 만든 쇼핑몰)",
  "쿠팡",
  "네이버 스마트스토어",
  "SNS (인스타그램/유튜브 등)",
  "온라인 커뮤니티/동네장터",
  "오프라인",
] as const;

export type MilestoneStatus = "none" | "applied" | "done";

export const BUSINESS_STATUS_LABELS: Record<string, string> = {
  none: "미등록",
  applied: "신청중",
  done: "등록완료",
};

export const MAIL_ORDER_STATUS_LABELS: Record<string, string> = {
  none: "미신고",
  applied: "신고중",
  done: "신고완료",
};

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
};

/** 파일 업로드 제한 */
export const MAX_FILE_MB = 20;
export const MAX_FILES_PER_SUBMISSION = 5;
