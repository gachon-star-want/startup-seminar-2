import type { ReactNode } from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-lg font-bold text-slate-900">{children}</h2>
      {right}
    </div>
  );
}

const toneClasses: Record<string, string> = {
  gray: "bg-slate-100 text-slate-600",
  green: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-rose-100 text-rose-700",
  indigo: "bg-indigo-100 text-indigo-700",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof toneClasses; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold", toneClasses[tone])}>
      {children}
    </span>
  );
}

/** 사업자등록/통신판매업신고 등 마일스톤 상태 배지 */
export function MilestoneBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const tone = status === "done" ? "green" : status === "applied" ? "amber" : "gray";
  return <Badge tone={tone}>{labels[status] ?? status}</Badge>;
}

/** 출석 상태 배지 */
export function AttendanceBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const tone = status === "present" ? "green" : status === "late" ? "amber" : "red";
  return <Badge tone={tone}>{labels[status] ?? status}</Badge>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";

export const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50";

export const btnGhost =
  "inline-flex items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";

export const btnDanger =
  "inline-flex items-center justify-center gap-1 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50";

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{children}</p>;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
