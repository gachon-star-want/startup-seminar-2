import type { Route } from "./+types/attendance";
import { desc, eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions } from "~/db/schema";
import { requireUser } from "~/lib/session";
import { ATTENDANCE_LABELS } from "~/lib/constants";
import { fmtKST, kstYMD, sessionPhase, ymdLabel } from "~/lib/time";
import { AttendanceBadge, Card, EmptyState, PageHeader, Stat } from "~/components/ui";

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
    <div className="stack-xl">
      <PageHeader title="내 출석 이력" sub="매주 화요일 오전 10:00 수업 · 출석체크는 10:10까지" />

      <div className="stat-row">
        <Stat value={summary.present} label="출석" tone="success" />
        <Stat value={summary.late} label="지각" tone="warning" />
        <Stat value={summary.absent} label="결석" tone="danger" />
        <Stat value={`${summary.total}회`} label="진행" />
      </div>

      {rows.length === 0 ? (
        <EmptyState>등록된 수업 일정이 아직 없어요.</EmptyState>
      ) : (
        <Card className="card--flush">
          <div className="table-wrap">
            <table className="table table--stack">
              <thead>
                <tr>
                  <th>수업 날짜</th>
                  <th>상태</th>
                  <th>체크 시각</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dateLabel}>
                    <td data-label="날짜" className="num" style={{ fontWeight: 700 }}>
                      {r.dateLabel}
                    </td>
                    <td data-label="상태">
                      {r.status ? (
                        <AttendanceBadge status={r.status} labels={ATTENDANCE_LABELS} />
                      ) : r.isFuture ? (
                        <span className="badge badge--gray">예정</span>
                      ) : (
                        <span className="badge badge--gray">진행 중</span>
                      )}
                    </td>
                    <td data-label="체크 시각" className="muted num">
                      {r.checkedAt ? fmtKST(r.checkedAt, { hour: "numeric", minute: "2-digit" }) : "—"}
                    </td>
                    <td data-label="비고" className="faint small">
                      {r.source === "admin" ? "관리자 조정" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <p className="small muted" style={{ lineHeight: 1.75 }}>
          🕙 출석체크는 수업일 <strong>오전 10:00</strong>에 자동으로 열리고,{" "}
          <strong>10:10까지 출석</strong>, 그 이후 <strong>11:00까지는 지각</strong>으로 기록돼요.
          체크할 때마다 본인의 생일 4자리를 입력해야 해요.
        </p>
      </Card>
    </div>
  );
}
