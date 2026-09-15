import { Link } from "react-router";
import type { Route } from "./+types/admin._index";
import { eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions, teamMembers, teams, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { kstYMD } from "~/lib/time";
import { Card, EmptyState, SectionTitle } from "~/components/ui";

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
  const stats = [
    { label: "학생", value: loaderData.userCount, emoji: "🧑‍🎓" },
    { label: "팀", value: loaderData.teamCount, emoji: "🤝" },
    { label: "수업 일정", value: loaderData.sessionCount, emoji: "📅" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <Card key={s.label} className="text-center">
            <div className="text-2xl">{s.emoji}</div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">{s.value}</div>
            <div className="text-xs font-medium text-slate-500">{s.label}</div>
          </Card>
        ))}
      </div>

      {loaderData.todaySummary ? (
        <Card>
          <SectionTitle right={<Link to="/admin/attendance" className="text-sm font-medium text-indigo-600">출석 관리 →</Link>}>
            오늘 출석 현황
          </SectionTitle>
          <div className="flex gap-2">
            <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-sm font-bold text-emerald-700">
              출석 {loaderData.todaySummary.present}
            </span>
            <span className="rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-700">
              지각 {loaderData.todaySummary.late}
            </span>
            <span className="rounded-full bg-rose-100 px-4 py-1.5 text-sm font-bold text-rose-700">
              결석 {loaderData.todaySummary.absent}
            </span>
          </div>
        </Card>
      ) : (
        <EmptyState>오늘은 수업 일정이 없어요.</EmptyState>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-bold text-slate-900">학생 명단 ({loaderData.users.length}명)</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="px-4 py-2.5">이름</th>
              <th className="px-4 py-2.5">학번</th>
              <th className="px-4 py-2.5">팀</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-medium text-slate-800">{u.name}</td>
                <td className="px-4 py-2.5 text-slate-500">{u.studentNumber}</td>
                <td className="px-4 py-2.5 text-slate-600">{u.teamName ?? <span className="text-slate-400">없음</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
