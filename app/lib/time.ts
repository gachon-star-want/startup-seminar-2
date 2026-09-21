const TZ = "Asia/Seoul";

/** 현재 순간의 KST 날짜를 'YYYY-MM-DD'로 반환 */
export function kstYMD(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** KST 날짜 문자열(YYYY-MM-DD) + 시각(HH:mm) → Date (절대 순간) */
export function kstInstant(ymd: string, hm: string): Date {
  return new Date(`${ymd}T${hm}:00+09:00`);
}

export function fmtKST(d: Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, ...opts }).format(d);
}

/** 예: 9/15(화) */
export function fmtKSTShort(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(d);
}

/** 예: 2026.9.15 (화) 오전 10:00 */
export function fmtKSTFull(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** 'YYYY-MM-DD' → 'M/D(요일)' 표시용 */
export function ymdLabel(ymd: string): string {
  const [, m, d] = ymd.split("-");
  const date = new Date(`${ymd}T12:00:00+09:00`);
  const wd = new Intl.DateTimeFormat("ko-KR", { timeZone: TZ, weekday: "short" }).format(date);
  return `${Number(m)}/${Number(d)}(${wd})`;
}

/** 지금 기준 목표일까지 D-day (당일 = D-day) */
export function dDay(target: Date, now: Date = new Date()): number {
  const kstNow = kstYMD(now);
  const kstTarget = kstYMD(target);
  const a = new Date(`${kstNow}T00:00:00Z`).getTime();
  const b = new Date(`${kstTarget}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}
