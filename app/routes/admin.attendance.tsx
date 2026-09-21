import { useEffect, useState } from "react";
import type { Route } from "./+types/admin.attendance";
import { Form, useActionData, useNavigation } from "react-router";
import { asc, and, eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { kstInstant, SESSION_WINDOWS, sessionPhase, ymdLabel } from "~/lib/time";
import { Card, ErrorText, SectionTitle } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const [sessions, rawUsers, records] = await Promise.all([
    db.select().from(attendanceSessions).orderBy(asc(attendanceSessions.sessionDate)),
    db.select().from(users),
    db
      .select({ sessionId: attendanceRecords.sessionId, userId: attendanceRecords.userId, status: attendanceRecords.status })
      .from(attendanceRecords),
  ]);

  const allUsers = rawUsers
    .filter((u) => u.role !== "professor")
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const now = new Date();
  const recordMap = new Map(records.map((r) => [`${r.sessionId}:${r.userId}`, r.status]));

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      sessionDate: s.sessionDate,
      label: ymdLabel(s.sessionDate),
      phase: sessionPhase(s, now),
    })),
    users: allUsers.map((u) => ({ id: u.id, name: u.name })),
    recordMap: Object.fromEntries(recordMap),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db } = await requireAdmin(request, context);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "addSession") {
    const date = String(form.get("date") ?? "").trim();
    const note = String(form.get("note") ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { error: "날짜 형식이 올바르지 않아요." };
    }
    const inserted = await db
      .insert(attendanceSessions)
      .values({
        sessionDate: date,
        opensAt: kstInstant(date, SESSION_WINDOWS.open),
        lateFrom: kstInstant(date, SESSION_WINDOWS.late),
        closesAt: kstInstant(date, SESSION_WINDOWS.close),
        note: note || null,
      })
      .onConflictDoNothing({ target: attendanceSessions.sessionDate })
      .returning();
    if (inserted.length === 0) return { error: `${ymdLabel(date)} 는 이미 등록된 날짜예요.` };
    return { ok: true };
  }

  if (intent === "deleteSession") {
    const id = String(form.get("sessionId") ?? "");
    await db.delete(attendanceSessions).where(eq(attendanceSessions.id, id));
    return { ok: true };
  }

  if (intent === "setCell") {
    const sessionId = String(form.get("sessionId") ?? "");
    const userId = String(form.get("userId") ?? "");
    const next = String(form.get("next") ?? "");
    if (next === "none") {
      await db
        .delete(attendanceRecords)
        .where(and(eq(attendanceRecords.sessionId, sessionId), eq(attendanceRecords.userId, userId)));
    } else if (["present", "late", "absent"].includes(next)) {
      await db
        .insert(attendanceRecords)
        .values({ sessionId, userId, status: next, source: "admin" })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.userId],
          set: { status: next, source: "admin", checkedAt: new Date() },
        });
    }
    return { ok: true };
  }

  if (intent === "markAllPresent") {
    const sessionId = String(form.get("sessionId") ?? "");
    const [session] = await db
      .select()
      .from(attendanceSessions)
      .where(eq(attendanceSessions.id, sessionId))
      .limit(1);
    if (!session) return { error: "수업 날짜를 찾을 수 없어요." };
    if (sessionPhase(session, new Date()) === "scheduled") {
      return { error: `${ymdLabel(session.sessionDate)} 은 아직 예정된 수업이에요.` };
    }
    const students = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "student"));
    if (students.length === 0) return { error: "학생 명단이 비어 있어요." };
    await db
      .insert(attendanceRecords)
      .values(
        students.map((s) => ({
          sessionId,
          userId: s.id,
          status: "present",
          source: "admin",
        })),
      )
      .onConflictDoUpdate({
        target: [attendanceRecords.sessionId, attendanceRecords.userId],
        set: { status: "present", source: "admin", checkedAt: new Date() },
      });
    return { ok: true };
  }

  return { error: "알 수 없는 요청이에요." };
}

const cellLabel: Record<string, string> = { present: "출", late: "지", absent: "결", none: "·" };
const nextOf: Record<string, string> = { none: "present", present: "late", late: "absent", absent: "none" };

export default function AdminAttendanceRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // 제출 완료(Idle 복귀)하면 셀 pending 해제
  useEffect(() => {
    if (navigation.state === "idle") setPendingKey(null);
  }, [navigation.state]);

  return (
    <div className="stack-xl">
      <Card>
        <SectionTitle>수업 날짜 추가</SectionTitle>
        <p className="small muted">
          추가한 날짜에 자동으로 오전 10:00~10:10 출석 / 10:10~11:00 지각 창이 열려요 (한국 시간 기준).
        </p>
        <Form method="post" className="form-row mt-3">
          <input type="hidden" name="intent" value="addSession" />
          <input type="date" name="date" className="input num" required />
          <input name="note" className="input input--grow" placeholder="비고 (선택, 예: 중간발표)" />
          <button type="submit" className="btn btn--primary">
            추가
          </button>
        </Form>
        <ErrorText>{actionData?.error}</ErrorText>
      </Card>

      <Card>
        <SectionTitle>한 번에 전원 출석 처리</SectionTitle>
        <p className="small muted">
          지난 수업 전체를 출석으로 일괄 처리할 때 써요 (학생 명단 전원 · 교수 제외). 개별 조정은
          아래 그리드에서.
        </p>
        {loaderData.sessions.length === 0 ? (
          <p className="small faint mt-3">수업 날짜를 먼저 추가해 주세요.</p>
        ) : (
          <Form method="post" className="form-row mt-3">
            <input type="hidden" name="intent" value="markAllPresent" />
            <select name="sessionId" className="input input--grow" required>
              {loaderData.sessions.map((s) => (
                <option key={s.id} value={s.id} disabled={s.phase === "scheduled"}>
                  {s.label}
                  {s.phase === "scheduled" ? " (예정)" : ""}
                </option>
              ))}
            </select>
            <button type="submit" className="btn btn--primary">
              전원 출석 ✓
            </button>
          </Form>
        )}
        <ErrorText>{actionData?.error}</ErrorText>
      </Card>

      <Card className="card--flush">
        <div className="card__head card__head--flush">
          <h2 className="card__title">출석 현황 그리드</h2>
          <p className="small faint">셀을 누르면 없음 → 출석 → 지각 → 결석 → 없음 순서로 순환</p>
        </div>
        {loaderData.users.length === 0 || loaderData.sessions.length === 0 ? (
          <p className="small muted" style={{ padding: "1rem 1rem 1.25rem" }}>
            학생 또는 수업 날짜가 아직 없어요.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table att-grid">
              <thead>
                <tr>
                  <th>이름</th>
                  {loaderData.sessions.map((s) => (
                    <th key={s.id} style={{ textAlign: "center" }}>
                      <div className="num">{s.label}</div>
                      <Form method="post" style={{ marginTop: "0.125rem" }}>
                        <input type="hidden" name="intent" value="deleteSession" />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button type="submit" className="del-x" title="이 날짜 삭제">
                          ✕
                        </button>
                      </Form>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loaderData.users.map((u) => (
                  <tr key={u.id}>
                    <td className="att-grid__name">{u.name}</td>
                    {loaderData.sessions.map((s) => {
                      const status = loaderData.recordMap[`${s.id}:${u.id}`] ?? "none";
                      const isFuture = s.phase === "scheduled";
                      const key = `${s.id}:${u.id}`;
                      return (
                        <td key={s.id} style={{ textAlign: "center" }}>
                          <Form
                            method="post"
                            onSubmit={() => setPendingKey(key)}
                          >
                            <input type="hidden" name="intent" value="setCell" />
                            <input type="hidden" name="sessionId" value={s.id} />
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="next" value={nextOf[status]} />
                            <button
                              type="submit"
                              disabled={isFuture}
                              data-status={status}
                              className={`cell-btn${pendingKey === key ? " is-pending" : ""}`}
                              title={isFuture ? "예정된 수업" : `${u.name} · ${s.label} → ${cellLabel[nextOf[status]]}`}
                            >
                              {cellLabel[status]}
                            </button>
                          </Form>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
