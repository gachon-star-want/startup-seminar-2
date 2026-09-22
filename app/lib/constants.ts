/** 판매 채널 옵션 — 온라인 채널은 링크를 추가로 입력받는다 */
export type SalesChannelOption = { label: string; online: boolean };

export const SALES_CHANNEL_ETC = "기타 (직접 입력)";

export const SALES_CHANNEL_OPTIONS: SalesChannelOption[] = [
  { label: "자사몰 (직접 만든 쇼핑몰)", online: true },
  { label: "쿠팡", online: true },
  { label: "네이버 스마트스토어", online: true },
  { label: "SNS (인스타그램/유튜브 등)", online: true },
  { label: "온라인 커뮤니티/동네장터", online: true },
  { label: "오프라인", online: false },
  { label: SALES_CHANNEL_ETC, online: false },
];

/** 저장된 판매채널 문자열을 옵션과 매칭 — datalist 시절 자유 입력값은 기타로 본다 */
export function matchSalesChannelOption(value: string | null): SalesChannelOption | null {
  if (!value) return null;
  return SALES_CHANNEL_OPTIONS.find((o) => o.label === value) ?? null;
}

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
export const MAX_FILE_MB = 100;
export const MAX_FILES_PER_SUBMISSION = 10;


/** 발표 평가 코멘트 바이트 제한 (UTF-8) */
export const MAX_EVAL_COMMENT_BYTES = 300;
