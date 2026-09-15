import type { Route } from "./+types/attendance";
import { desc, eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { ATTENDANCE_LABELS } from "~/lib/constants";
import { fmtKST, kstYMD, sessionPhase, ymdLabel } from "~/lib/time";
import { AttendanceBadge, Card, EmptyState } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, db } = await requireUser(request, context);
  const now = new Date();
  const today = kstYMD(now);

  const sessions = await db
    .select()
    .from(attendanceSessions)
    .orderBy(desc(attendanceSessions.sessionDate));

  const records = await db
    .select()
    .from(attendanceRecords)
    .where(eq(attendanceRecords.userId, user.id));
  const recordBySession = new Map(records.map((r) => [r.sessionId, r]));

  const rows = sessions.map((s) => {
    const record = recordBySession.get(s.id);
    let status: string | null = record?.status ?? null;
    if (!status && sessionPhase(s, now) === "closed") status = "absent"; // 미체크 + 마감 = 결석
    return {
      dateLabel: ymdLabel(s.sessionDate),
      isFuture: s.sessionDate > today,
      status,
      checkedAt: record?.checkedAt ?? null,
      source: record?.source ?? null,
    };
  });

  const counted = rows.filter((r) => !r.isFuture && r.status);
  const summary = {
    total: counted.length,
    present: counted.filter((r) => r.status === "present").length,
    late: counted.filter((r) => r.status === "late").length,
    absent: counted.filter((r) => r.status === "absent").length,
  };

  return { rows, summary };
}

export default function AttendanceRoute({ loaderData }: Route.ComponentProps) {
  const { rows, summary } = loaderData;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-extrabold tracking-tight">내 출석 이력</h1>

      <div className="flex flex-wrap gap-2">
        <span className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white">
          출석 {summary.present}
        </span>
        <span className="rounded-full bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white">
          지각 {summary.late}
        </span>
        <span className="rounded-full bg-rose-500 px-4 py-1.5 text-sm font-semibold text-white">
          결석 {summary.absent}
        </span>
        <span className="rounded-full bg-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-600">
          진행 {summary.total}회
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState>등록된 수업 일정이 아직 없어요.</EmptyState>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="px-4 py-3">수업 날짜</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">체크 시각</th>
                <th className="px-4 py-3">비고</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.dateLabel} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{r.dateLabel}</td>
                  <td className="px-4 py-2.5">
                    {r.status ? (
                      <AttendanceBadge status={r.status} labels={ATTENDANCE_LABELS} />
                    ) : r.isFuture ? (
                      <span className="text-xs text-slate-400">예정</span>
                    ) : (
                      <span className="text-xs text-slate-400">진행 중</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">
                    {r.checkedAt ? fmtKST(r.checkedAt, { hour: "numeric", minute: "2-digit" }) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {r.source === "admin" ? "관리자 조정" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card>
        <p className="text-sm leading-relaxed text-slate-500">
          🕙 출석체크는 수업일 <strong>오전 10:00</strong>에 자동으로 열리고, <strong>10:10까지 출석</strong>,
          그 이후 <strong>11:00까지는 지각</strong>으로 기록돼요. 체크할 때마다 본인의 생일 4자리를 입력해야 해요.
        </p>
      </Card>
    </div>
  );
}
