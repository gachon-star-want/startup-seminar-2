import type { Route } from "./+types/admin.attendance";
import { useActionData } from "react-router";
import { asc, and, eq } from "drizzle-orm";
import { attendanceRecords, attendanceSessions, users } from "~/db/schema";
import { requireAdmin } from "~/lib/session";
import { kstInstant, SESSION_WINDOWS, sessionPhase, ymdLabel } from "~/lib/time";
import { Card, ErrorText, SectionTitle, btnPrimary, inputClass } from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await requireAdmin(request, context);

  const sessions = await db.select().from(attendanceSessions).orderBy(asc(attendanceSessions.sessionDate));
  const allUsers = (await db.select().from(users)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const records = await db
    .select({ sessionId: attendanceRecords.sessionId, userId: attendanceRecords.userId, status: attendanceRecords.status })
    .from(attendanceRecords);

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

  return { error: "알 수 없는 요청이에요." };
}

const cellStyle: Record<string, string> = {
  present: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
  late: "bg-amber-100 text-amber-700 hover:bg-amber-200",
  absent: "bg-rose-100 text-rose-700 hover:bg-rose-200",
  none: "bg-slate-100 text-slate-400 hover:bg-slate-200",
};
const cellLabel: Record<string, string> = { present: "출", late: "지", absent: "결", none: "·" };
const nextOf: Record<string, string> = { none: "present", present: "late", late: "absent", absent: "none" };

export default function AdminAttendanceRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle>수업 날짜 추가</SectionTitle>
        <p className="mb-3 text-xs text-slate-500">
          추가한 날짜에 자동으로 오전 10:00~10:10 출석 / 10:10~11:00 지각 창이 열려요 (한국 시간 기준).
        </p>
        <form method="post" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="intent" value="addSession" />
          <div>
            <input type="date" name="date" className={inputClass} required />
          </div>
          <div className="min-w-40 flex-1">
            <input name="note" className={inputClass} placeholder="비고 (선택, 예: 중간발표)" />
          </div>
          <button type="submit" className={btnPrimary}>
            추가
          </button>
        </form>
        <ErrorText>{actionData?.error}</ErrorText>
      </Card>

      <Card className="p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="font-bold text-slate-900">출석 현황 그리드</h2>
          <p className="text-xs text-slate-400">셀을 누르면 없음 → 출석 → 지각 → 결석 → 없음 순서로 순환</p>
        </div>
        {loaderData.users.length === 0 || loaderData.sessions.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-slate-500">학생 또는 수업 날짜가 아직 없어요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-[1] border-b border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-500">
                    이름
                  </th>
                  {loaderData.sessions.map((s) => (
                    <th key={s.id} className="border-b border-slate-200 px-1.5 py-2 text-center text-xs font-semibold text-slate-500">
                      <div className="whitespace-nowrap">{s.label}</div>
                      <form method="post" className="mt-0.5">
                        <input type="hidden" name="intent" value="deleteSession" />
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button
                          type="submit"
                          className="text-[10px] font-normal text-slate-300 hover:text-rose-500"
                          title="이 날짜 삭제"
                        >
                          ✕
                        </button>
                      </form>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loaderData.users.map((u) => (
                  <tr key={u.id}>
                    <td className="sticky left-0 z-[1] whitespace-nowrap border-b border-slate-100 bg-white px-3 py-1.5 font-medium text-slate-800">
                      {u.name}
                    </td>
                    {loaderData.sessions.map((s) => {
                      const status = loaderData.recordMap[`${s.id}:${u.id}`] ?? "none";
                      const isFuture = s.phase === "scheduled";
                      return (
                        <td key={s.id} className="border-b border-slate-100 px-1 py-1 text-center">
                          <form method="post">
                            <input type="hidden" name="intent" value="setCell" />
                            <input type="hidden" name="sessionId" value={s.id} />
                            <input type="hidden" name="userId" value={u.id} />
                            <input type="hidden" name="next" value={nextOf[status]} />
                            <button
                              type="submit"
                              disabled={isFuture}
                              title={isFuture ? "예정된 수업" : `${u.name} · ${s.label} → ${cellLabel[nextOf[status]]}`}
                              className={`h-8 w-9 rounded-lg text-xs font-bold transition disabled:opacity-40 ${cellStyle[status]}`}
                            >
                              {cellLabel[status]}
                            </button>
                          </form>
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
