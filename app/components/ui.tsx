import type { ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** 페이지 상단 타이틀 블록 */
export function PageHeader({
  title,
  sub,
  right,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="cluster cluster--between">
        <h1 className="page-head__title">{title}</h1>
        {right}
      </div>
      {sub ? <p className="page-head__sub">{sub}</p> : null}
    </div>
  );
}

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={cn("card", className)}>{children}</section>;
}

export function SectionTitle({
  children,
  right,
}: {
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="card__head">
      <h2 className="card__title">{children}</h2>
      {right}
    </div>
  );
}

/** 통계 카드 */
export function Stat({
  value,
  label,
  tone,
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "success" | "warning" | "danger" | "primary";
}) {
  return (
    <div className={cn("stat", tone && `stat--${tone}`)}>
      <span className="stat__value num">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

const toneClasses: Record<string, string> = {
  gray: "badge--gray",
  green: "badge--green",
  amber: "badge--amber",
  red: "badge--red",
  indigo: "badge--indigo",
};

export function Badge({
  tone = "gray",
  children,
}: {
  tone?: keyof typeof toneClasses;
  children: ReactNode;
}) {
  return <span className={cn("badge", toneClasses[tone])}>{children}</span>;
}

/** 사업자등록/통신판매업신고 등 마일스톤 상태 배지 */
export function MilestoneBadge({
  status,
  labels,
}: {
  status: string;
  labels: Record<string, string>;
}) {
  const tone = status === "done" ? "green" : status === "applied" ? "amber" : "gray";
  return <Badge tone={tone}>{labels[status] ?? status}</Badge>;
}

/** 출석 상태 배지 */
export function AttendanceBadge({
  status,
  labels,
}: {
  status: string;
  labels: Record<string, string>;
}) {
  const tone = status === "present" ? "green" : status === "late" ? "amber" : "red";
  return <Badge tone={tone}>{labels[status] ?? status}</Badge>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/** 폼 필드 래퍼: label + input + hint */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

/* 기존 라우트와의 호환용 클래스 상수 */
export const inputClass = "input";
export const labelClass = "label";

export const btnPrimary = "btn btn--primary";
export const btnGhost = "btn btn--ghost";
export const btnDanger = "btn btn--danger btn--sm";

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="error-text">{children}</p>;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
