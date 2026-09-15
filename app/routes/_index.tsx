import { useState } from "react";
import { data, Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/_index";
import { and, asc, eq, gt } from "drizzle-orm";
import {
  assignments as assignmentsTable,
  attendanceRecords,
  attendanceSessions,
  submissions,
  teamMembers,
  teams,
  users,
} from "~/db/schema";
import { requireUser } from "~/lib/session";
import {
  ATTENDANCE_LABELS,
  BUSINESS_STATUS_LABELS,
  MAIL_ORDER_STATUS_LABELS,
} from "~/lib/constants";
import { teamScore, MAX_TEAM_SCORE } from "~/lib/score";
import { dDay, fmtKST, fmtKSTFull, kstYMD, sessionPhase, ymdLabel, type SessionPhase } from "~/lib/time";
import {
  AttendanceBadge,
  Badge,
  Card,
  EmptyState,
  ErrorText,
  SectionTitle,
  inputClass,
  btnPrimary,
} from "~/components/ui";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user, db } = await requireUser(request, context);
  const now = new Date();
  const today = kstYMD(now);

  const [todaySession] = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.sessionDate, today))
    .limit(1);

  const [nextSession] = todaySession
    ? [undefined]
    : await db
        .select()
        .from(attendanceSessions)
        .where(gt(attendanceSessions.opensAt, now))
        .orderBy(asc(attendanceSessions.opensAt))
        .limit(1);

  const focus = todaySession ?? nextSession ?? null;

  let myAttendance: { status: string; checkedAt: Date } | null = null;
  let focusPhase: SessionPhase | null = null;
  if (focus) {
    focusPhase = sessionPhase(focus, now);
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.sessionId, focus.id), eq(attendanceRecords.userId, user.id)))
      .limit(1);
    if (record) myAttendance = { status: record.status, checkedAt: record.checkedAt };
  }

  const [membership] = await db
    .select({ team: teams, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(eq(teamMembers.userId, user.id))
    .limit(1);

  let teamInfo: {
    name: string;
    score: number;
    members: string[];
    role: string;
    missing: string[];
  } | null = null;
  if (membership) {
    const memberRows = await db
      .select({ userName: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.teamId, membership.team.id));
    const t = membership.team;
    const missing: string[] = [];
    if (!t.itemName?.trim()) missing.push("아이템 미정");
    if (!t.salesChannel?.trim()) missing.push("판매 채널 미정");
    if (t.businessStatus !== "done")
      missing.push(`사업자등록 ${BUSINESS_STATUS_LABELS[t.businessStatus]}`);
    if (t.mailOrderStatus !== "done")
      missing.push(`통신판매업신고 ${MAIL_ORDER_STATUS_LABELS[t.mailOrderStatus]}`);
    teamInfo = {
      name: t.name,
      score: teamScore(t),
      members: memberRows.map((r) => r.userName),
      role: membership.role,
      missing,
    };
  }

  const openAssignments = await db
    .select()
    .from(assignmentsTable)
    .where(gt(assignmentsTable.dueAt, now))
    .orderBy(asc(assignmentsTable.dueAt))
    .limit(3);

  const assignmentInfos = [];
  for (const a of openAssignments) {
    const conditions = [eq(submissions.assignmentId, a.id)];
    if (a.unit === "team") {
      if (membership) conditions.push(eq(submissions.teamId, membership.team.id));
    } else {
      conditions.push(eq(submissions.userId, user.id));
    }
    const [sub] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(...conditions))
      .limit(1);
    assignmentInfos.push({ id: a.id, title: a.title, dueAt: a.dueAt, unit: a.unit, submitted: Boolean(sub) });
  }

  return {
    userName: user.name,
    todayLabel: fmtKSTFull(now),
    attendance: focus
      ? {
          sessionId: focus.id,
          dateLabel: ymdLabel(focus.sessionDate),
          isToday: focus.sessionDate === today,
          phase: focusPhase,
          my: myAttendance,
        }
      : null,
    team: teamInfo,
    assignments: assignmentInfos,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { user, db } = await requireUser(request, context);
  const form = await request.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  const birth4 = String(form.get("birth4") ?? "").trim();

  const [session] = await db
    .select()
    .from(attendanceSessions)
    .where(eq(attendanceSessions.id, sessionId))
    .limit(1);
  if (!session) {
    return data({ error: "출석 세션을 찾을 수 없어요." }, { status: 400 });
  }

  const [existingRecord] = await db
    .select()
    .from(attendanceRecords)
    .where(and(eq(attendanceRecords.sessionId, sessionId), eq(attendanceRecords.userId, user.id)))
    .limit(1);
  if (existingRecord) {
    return data({ error: "이미 출석체크 했어요!" }, { status: 400 });
  }

  if (!/^\d{4}$/.test(birth4) || birth4 !== user.birth4) {
    return data({ error: "생일 4자리(MMDD)가 일치하지 않아요." }, { status: 400 });
  }

  const phase = sessionPhase(session);
  if (phase !== "present" && phase !== "late") {
    return data({ error: "지금은 체크 가능한 시간이 아니에요 (10:00~11:00)." }, { status: 400 });
  }

  const inserted = await db
    .insert(attendanceRecords)
    .values({
      sessionId,
      userId: user.id,
      status: phase === "present" ? "present" : "late",
      source: "self",
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length === 0) {
    return data({ error: "이미 출석체크 했어요!" }, { status: 400 });
  }

  return redirect("/");
}

export default function IndexRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const [showForm, setShowForm] = useState(false);
  const a = loaderData.attendance;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {loaderData.userName}님, 반가워요 👋
        </h1>
        <p className="mt-1 text-sm text-slate-500">{loaderData.todayLabel} 기준</p>
      </div>

      {/* 오늘 출석 카드 */}
      <Card>
        <SectionTitle right={<Link to="/attendance" className="text-sm font-medium text-indigo-600">전체 기록 →</Link>}>
          출석체크
        </SectionTitle>

        {!a && <EmptyState>등록된 수업 일정이 없어요. 관리자가 일정을 등록하면 여기에 표시돼요.</EmptyState>}

        {a && a.my && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3">
            <span className="text-2xl">✅</span>
            <div>
              <div className="flex items-center gap-2 font-semibold text-slate-800">
                {a.isToday ? "오늘" : a.dateLabel} <AttendanceBadge status={a.my.status} labels={ATTENDANCE_LABELS} />
              </div>
              <p className="text-xs text-slate-500">체크 시각 {fmtKST(a.my.checkedAt, { hour: "numeric", minute: "2-digit" })}</p>
            </div>
          </div>
        )}

        {a && !a.my && a.isToday && a.phase === "present" && (
          <div>
            <p className="text-sm text-slate-600">
              지금 출석 체크 가능해요 (10:10까지 출석, 이후 11:00까지는 지각).
            </p>
            {!showForm ? (
              <button type="button" className={`${btnPrimary} mt-3 text-base`} onClick={() => setShowForm(true)}>
                ✋ 출석체크하기
              </button>
            ) : (
              <Form method="post" className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="sessionId" value={a.sessionId} />
                <input
                  name="birth4"
                  className={`${inputClass} max-w-40`}
                  placeholder="생일 4자리 (MMDD)"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  autoFocus
                />
                <button type="submit" className={btnPrimary}>
                  확인
                </button>
              </Form>
            )}
            <ErrorText>{actionData?.error}</ErrorText>
          </div>
        )}

        {a && !a.my && a.isToday && a.phase === "late" && (
          <div>
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
              ⏰ 출석 시간이 지나 <strong>지각</strong>으로 기록돼요. (11:00까지 체크 가능)
            </div>
            {!showForm ? (
              <button type="button" className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600" onClick={() => setShowForm(true)}>
                지각이라도 체크하기
              </button>
            ) : (
              <Form method="post" className="mt-3 flex flex-wrap items-center gap-2">
                <input type="hidden" name="sessionId" value={a.sessionId} />
                <input
                  name="birth4"
                  className={`${inputClass} max-w-40`}
                  placeholder="생일 4자리 (MMDD)"
                  inputMode="numeric"
                  maxLength={4}
                  required
                  autoFocus
                />
                <button type="submit" className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
                  확인
                </button>
              </Form>
            )}
            <ErrorText>{actionData?.error}</ErrorText>
          </div>
        )}

        {a && !a.my && a.isToday && (a.phase === "scheduled" || a.phase === null) && (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            오늘 수업! <strong>오전 10:00</strong>에 출석체크가 열려요.
          </p>
        )}

        {a && !a.my && a.isToday && a.phase === "closed" && (
          <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            오늘 출석체크가 마감됐어요. 문제가 있으면 관리자에게 문의해 주세요.
          </p>
        )}

        {a && !a.my && !a.isToday && (
          <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
            다음 수업은 <strong>{a.dateLabel}</strong> — 오전 10:00에 출석체크가 열려요.
          </p>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 내 팀 카드 */}
        <Card>
          <SectionTitle right={<Link to="/team" className="text-sm font-medium text-indigo-600">관리 →</Link>}>
            내 팀
          </SectionTitle>
          {!loaderData.team ? (
            <EmptyState>
              아직 팀이 없어요.{' '}
              <Link to="/team" className="font-semibold text-indigo-600">
                팀 만들기 / 초대코드로 합류
              </Link>
            </EmptyState>
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{loaderData.team.name}</span>
                <Badge tone="indigo">
                  {loaderData.team.score} / {MAX_TEAM_SCORE}점
                </Badge>
              </div>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-all"
                  style={{ width: `${(loaderData.team.score / MAX_TEAM_SCORE) * 100}%` }}
                />
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {loaderData.team.missing.length === 0 ? (
                  <li className="font-medium text-emerald-600">🎉 모든 항목 완료!</li>
                ) : (
                  loaderData.team.missing.map((m) => (
                    <li key={m} className="flex items-center gap-2">
                      <span className="text-slate-400">•</span> {m}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </Card>

        {/* 진행 중 과제 */}
        <Card>
          <SectionTitle right={<Link to="/assignments" className="text-sm font-medium text-indigo-600">전체 →</Link>}>
            진행 중 과제
          </SectionTitle>
          {loaderData.assignments.length === 0 ? (
            <EmptyState>진행 중인 과제가 없어요.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {loaderData.assignments.map((as) => {
                const dd = dDay(as.dueAt);
                return (
                  <li key={as.id}>
                    <Link
                      to={`/assignments/${as.id}`}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5 transition hover:border-indigo-300 hover:bg-indigo-50/40"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-800">{as.title}</div>
                        <div className="text-xs text-slate-500">
                          {as.unit === "team" ? "팀 과제" : "개인 과제"} · 마감 {fmtKST(as.dueAt, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                      {as.submitted ? (
                        <Badge tone="green">제출완료</Badge>
                      ) : (
                        <Badge tone={dd <= 1 ? "red" : "amber"}>{dd === 0 ? "D-day" : `D-${dd}`}</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
