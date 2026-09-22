import { Form, Link, data } from "react-router";
import type { Route } from "./+types/admin._index";
import { eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions, teamMembers, teams, users } from "~/db/schema";
import { requireAdminAppContext } from "~/lib/context.server";
import { requireAdmin } from "~/lib/session";
import { kstYMD } from "~/lib/time";
import { UserRoster } from "~/modules/users/index.server";
import { Card, EmptyState, SectionTitle, Stat } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const today = kstYMD();

  // 대시보드 기초 데이터를 단 1회 왕복에 병렬 조회
  const [allUsers, memberships, allTeams, sessions, [todaySession]] = await Promise.all([
    db.select().from(users),
    db
      .select({ userId: teamMembers.userId, teamName: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id)),
    db.select().from(teams),
    db.select().from(attendanceSessions),
    db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.sessionDate, today))
      .limit(1),
  ]);
  const teamByUser = new Map(memberships.map((m) => [m.userId, m.teamName]));
  const students = allUsers.filter((u) => u.role !== "professor");
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
    for (const u of students) {
      const s = recordByUser.get(u.id);
      if (s === "present") present++;
      else if (s === "late") late++;
      else if (s === "absent") absent++;
      else if (todaySession.closesAt < new Date()) absent++; // 마감 후 미체크 = 결석
    }
    todaySummary = { present, late, absent };
  }

  return {
    studentCount: students.length,
    teamCount: allTeams.length,
    sessionCount: sessions.length,
    todaySummary,
    users: allUsers
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        teamName: teamByUser.get(u.id) ?? null,
      }))
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === "professor" ? -1 : 1;
        return a.name.localeCompare(b.name, "ko");
      }),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const ctx = await requireAdminAppContext(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "deleteUser") {
    const userId = String(form.get("userId") ?? "");
    const res = await UserRoster.remove(ctx, userId);
    if (!res.ok) return data({ error: res.message }, { status: 400 });
    return { ok: true as const };
  }

  return data({ error: "알 수 없는 요청이에요." }, { status: 400 });
}

export default function AdminIndexRoute({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack-xl">
      <div className="stat-row stat-row--3">
        <Stat value={loaderData.studentCount} label="학생 🧑‍🎓" />
        <Stat value={loaderData.teamCount} label="팀 🤝" />
        <Stat value={loaderData.sessionCount} label="수업 일정 📅" />
      </div>

      {loaderData.todaySummary ? (
        <Card>
          <SectionTitle
            right={
              <Link to="/admin/attendance" prefetch="intent" className="card__link">
                출석 관리 →
              </Link>
            }
          >
            오늘 출석 현황 (학생 {loaderData.studentCount}명)
          </SectionTitle>
          <div className="stat-row stat-row--3">
            <Stat value={loaderData.todaySummary.present} label="출석" tone="success" />
            <Stat value={loaderData.todaySummary.late} label="지각" tone="warning" />
            <Stat value={loaderData.todaySummary.absent} label="결석" tone="danger" />
          </div>
        </Card>
      ) : (
        <EmptyState>오늘은 수업 일정이 없어요.</EmptyState>
      )}

      <Card className="card--flush">
        <div className="card__head card__head--flush">
          <h2 className="card__title">명단 ({loaderData.users.length}명)</h2>
        </div>
        <div className="table-wrap">
          <table className="table table--stack">
            <thead>
              <tr>
                <th>이름</th>
                <th>구분</th>
                <th>팀</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {loaderData.users.map((u) => {
                const isProfessor = u.role === "professor";
                return (
                  <tr key={u.id}>
                    <td data-label="이름" style={{ fontWeight: 700 }}>
                      {u.name}
                    </td>
                    <td data-label="구분" className="muted">
                      {isProfessor ? (
                        <span className="badge badge--indigo">교수</span>
                      ) : (
                        <span className="faint">학생</span>
                      )}
                    </td>
                    <td data-label="팀" className="muted">
                      {u.teamName ?? <span className="faint">없음</span>}
                    </td>
                    <td data-label="관리">
                      {isProfessor ? (
                        <span className="faint">—</span>
                      ) : (
                        <Form
                          method="post"
                          className="inline-form"
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                `${u.name} 학생을 명단에서 삭제할까요?\n출석·제출물·평가 기록이 모두 지워지고 되돌릴 수 없어요.`
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="deleteUser" />
                          <input type="hidden" name="userId" value={u.id} />
                          <button type="submit" className="btn btn--danger btn--sm">
                            삭제
                          </button>
                        </Form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
