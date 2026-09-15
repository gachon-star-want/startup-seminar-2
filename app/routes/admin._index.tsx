import { Link } from "react-router";
import type { Route } from "./+types/admin._index";
import { eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions, teamMembers, teams, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { kstYMD } from "~/lib/time";
import { Card, EmptyState, SectionTitle, Stat } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const allUsers = await db.select().from(users);
  const memberships = await db.select({ userId: teamMembers.userId, teamName: teams.name }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id));
  const teamByUser = new Map(memberships.map((m) => [m.userId, m.teamName]));

  const allTeams = await db.select().from(teams);
  const sessions = await db.select().from(attendanceSessions);

  // 오늘 세션 출석 요약
  const today = kstYMD();
  const [todaySession] = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.sessionDate, today))
    .limit(1);
  let todaySummary: { present: number; late: number; absent: number } | null = null;
  if (todaySession) {
    const records = await db
      .select({ userId: attendanceRecords.userId, status: attendanceRecords.status })
      .from(attendanceRecords)
      .where(eq(attendanceRecords.sessionId, todaySession.id));
    const recordByUser = new Map(records.map((r) => [r.userId, r.status]));
    let present = 0;
    let late = 0;
    let absent = 0;
    for (const u of allUsers) {
      const s = recordByUser.get(u.id);
      if (s === "present") present++;
      else if (s === "late") late++;
      else if (s === "absent") absent++;
      else if (todaySession.closesAt < new Date()) absent++; // 마감 후 미체크 = 결석
    }
    todaySummary = { present, late, absent };
  }

  return {
    userCount: allUsers.length,
    teamCount: allTeams.length,
    sessionCount: sessions.length,
    todaySummary,
    users: allUsers
      .map((u) => ({
        id: u.id,
        name: u.name,
        studentNumber: u.studentNumber,
        teamName: teamByUser.get(u.id) ?? null,
        createdAt: u.createdAt.toISOString(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}

export default function AdminIndexRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack-xl">
      <div className="stat-row stat-row--3">
        <Stat value={loaderData.userCount} label="학생 🧑‍🎓" />
        <Stat value={loaderData.teamCount} label="팀 🤝" />
        <Stat value={loaderData.sessionCount} label="수업 일정 📅" />
      </div>

      {loaderData.todaySummary ? (
        <Card>
          <SectionTitle
            right={
              <Link to="/admin/attendance" className="card__link">
                출석 관리 →
              </Link>
            }
          >
            오늘 출석 현황
          </SectionTitle>
          <div className="stat-row">
            <Stat value={loaderData.todaySummary.present} label="출석" tone="success" />
            <Stat value={loaderData.todaySummary.late} label="지각" tone="warning" />
            <Stat value={loaderData.todaySummary.absent} label="결석" tone="danger" />
          </div>
        </Card>
      ) : (
        <EmptyState>오늘은 수업 일정이 없어요.</EmptyState>
      )}

      <Card className="card--flush">
        <div className="card__head" style={{ padding: "0.875rem 1rem 0", margin: 0 }}>
          <h2 className="card__title">학생 명단 ({loaderData.users.length}명)</h2>
        </div>
        <div className="table-wrap">
          <table className="table table--stack">
            <thead>
              <tr>
                <th>이름</th>
                <th>학번</th>
                <th>팀</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.users.map((u) => (
                <tr key={u.id}>
                  <td data-label="이름" style={{ fontWeight: 700 }}>
                    {u.name}
                  </td>
                  <td data-label="학번" className="muted num">
                    {u.studentNumber}
                  </td>
                  <td data-label="팀" className="muted">
                    {u.teamName ?? <span className="faint">없음</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
