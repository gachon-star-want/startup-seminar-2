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
import { LiveCountdown } from "~/components/countdown";
import {
  AttendanceBadge,
  Badge,
  Card,
  EmptyState,
  ErrorText,
  PageHeader,
  SectionTitle,
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
    isProfessor: user.role === "professor",
    birth4Set: Boolean(user.birth4),
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

  if (user.role === "professor") {
    return data({ error: "교수 계정은 출석 대상이 아니에요." }, { status: 400 });
  }

  if (!/^\d{4}$/.test(birth4)) {
    return data({ error: "생일 4자리(MMDD)를 숫자 4자리로 입력해 주세요." }, { status: 400 });
  }

  if (user.birth4) {
    if (birth4 !== user.birth4) {
      return data({ error: "생일 4자리(MMDD)가 일치하지 않아요." }, { status: 400 });
    }
  } else {
    // 첫 출석체크 — 이번에 입력한 생일 4자리를 본인 확인용으로 등록
    await db.update(users).set({ birth4 }).where(eq(users.id, user.id));
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

/** 'M/D(요일)' 라벨만으로 다음 세션 D-day 계산 (연도는 오늘 기준 정합) */
function ddayFromLabel(label: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\((.)\)$/.exec(label);
  if (!m) return null;
  const year = Number(kstYMD().slice(0, 4));
  for (const y of [year, year + 1]) {
    const target = new Date(
      `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}T10:00:00+09:00`,
    );
    if (!Number.isNaN(target.getTime()) && target.getTime() >= Date.now()) {
      return dDay(target);
    }
  }
  return null;
}

/** 생일 4자리 인라인 폼 (출석/지각 공통) */
function BirthForm({ sessionId, warn, firstTime }: { sessionId: string; warn?: boolean; firstTime?: boolean }) {
  return (
    <Form method="post" className="cluster mt-3 fade-in">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input
        name="birth4"
        className="input input--birth num"
        placeholder={firstTime ? "생일 4자리 등록 (MMDD)" : "생일 4자리 (MMDD)"}
        inputMode="numeric"
        maxLength={4}
        required
        autoFocus
      />
      <button type="submit" className={warn ? "btn btn--warn" : "btn btn--primary"}>
        확인
      </button>
    </Form>
  );
}

export default function IndexRoute({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const [showForm, setShowForm] = useState(false);
  const a = loaderData.attendance;
  const team = loaderData.team;

  return (
    <div className="stack-xl">
      <PageHeader
        title={`${loaderData.userName}님, 반가워요 👋`}
        sub={`${loaderData.todayLabel} 기준`}
      />

      {/* 출석 히어로 카드 */}
      {!a ? (
        <EmptyState>등록된 수업 일정이 없어요. 관리자가 일정을 등록하면 여기에 표시돼요.</EmptyState>
      ) : (
        <section className="hero">
          <div className="cluster cluster--between">
            <div>
              <p className="hero__label">{a.isToday ? "TODAY · 오늘 수업" : "NEXT · 다음 수업"}</p>
              <p className="hero__date num">{a.dateLabel}</p>
            </div>
            <Link to="/attendance" className="card__link">
              전체 기록 →
            </Link>
          </div>

          <div className="hero__body">
            {loaderData.isProfessor ? (
              <p className="notice notice--neutral">
                🧑‍🏫 교수 계정이에요 — 출석체크 대상에서는 제외돼요. 학생들의 출석은 관리자
                페이지에서 확인할 수 있어요.
              </p>
            ) : a.my ? (
              <div className="done-box">
                <span className="done-box__icon" aria-hidden>
                  ✅
                </span>
                <div>
                  <div className="cluster">
                    <strong>{a.isToday ? "오늘" : a.dateLabel}</strong>
                    <AttendanceBadge status={a.my.status} labels={ATTENDANCE_LABELS} />
                  </div>
                  <p className="small faint num">
                    체크 시각 {fmtKST(a.my.checkedAt, { hour: "numeric", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            ) : a.isToday && a.phase === "present" ? (
              <div>
                <LiveCountdown phase={a.phase} isToday={a.isToday} />
                <p className="hero__hint">지금 출석 체크 가능해요 — 10:10까지 출석, 이후 11:00까지는 지각.</p>
                {!showForm ? (
                  <button type="button" className="btn btn--primary btn--lg mt-3" onClick={() => setShowForm(true)}>
                    ✋ 출석체크하기
                  </button>
                ) : (
                  <BirthForm sessionId={a.sessionId} firstTime={!loaderData.birth4Set} />
                )}
              </div>
            ) : a.isToday && a.phase === "late" ? (
              <div>
                <LiveCountdown phase={a.phase} isToday={a.isToday} />
                <p className="notice notice--warning mt-3">
                  ⏰ 출석 시간이 지나 <strong>지각</strong>으로 기록돼요. (11:00까지 체크 가능)
                </p>
                {!showForm ? (
                  <button type="button" className="btn btn--warn mt-3" onClick={() => setShowForm(true)}>
                    지각이라도 체크하기
                  </button>
                ) : (
                  <BirthForm sessionId={a.sessionId} warn firstTime={!loaderData.birth4Set} />
                )}
              </div>
            ) : a.isToday && (a.phase === "scheduled" || a.phase === null) ? (
              <div>
                <LiveCountdown phase={a.phase} isToday={a.isToday} />
                <p className="hero__hint">오전 10:00에 출석체크가 열려요 · 10:10까지 출석</p>
              </div>
            ) : a.isToday && a.phase === "closed" ? (
              <p className="notice notice--danger">
                오늘 출석체크가 마감됐어요. 문제가 있으면 관리자에게 문의해 주세요.
              </p>
            ) : (
              <div>
                {(() => {
                  const dd = ddayFromLabel(a.dateLabel);
                  return dd != null ? (
                    <div className="count">
                      <span className="count__digits">D{dd === 0 ? "-day" : `-${dd}`}</span>
                    </div>
                  ) : null;
                })()}
                <p className="notice notice--neutral mt-2">
                  다음 수업은 <strong>{a.dateLabel}</strong> — 오전 10:00에 출석체크가 열려요.
                </p>
              </div>
            )}

            <ErrorText>{actionData?.error}</ErrorText>
          </div>
        </section>
      )}

      <div className="grid-2">
        {/* 내 팀 카드 */}
        <Card>
          <SectionTitle
            right={
              <Link to="/team" className="card__link">
                관리 →
              </Link>
            }
          >
            내 팀
          </SectionTitle>
          {!team ? (
            <EmptyState>
              아직 팀이 없어요.{" "}
              <Link to="/team" className="card__link">
                팀 만들기 / 초대코드로 합류 →
              </Link>
            </EmptyState>
          ) : (
            <div className="stack-md">
              <div className="cluster cluster--between">
                <strong className="team-name">{team.name}</strong>
                <Badge tone="indigo">
                  {team.score} / {MAX_TEAM_SCORE}점
                </Badge>
              </div>
              <div
                className="progress"
                role="progressbar"
                aria-valuenow={team.score}
                aria-valuemin={0}
                aria-valuemax={MAX_TEAM_SCORE}
                aria-label="팀 진행도"
              >
                <div
                  className="progress__bar"
                  style={{ width: `${(team.score / MAX_TEAM_SCORE) * 100}%` }}
                />
              </div>
              {team.missing.length === 0 ? (
                <p className="notice notice--success">🎉 모든 항목 완료!</p>
              ) : (
                <ul className="stack-xs small muted bare-list">
                  {team.missing.map((m) => (
                    <li key={m}>· {m}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>

        {/* 진행 중 과제 */}
        <Card>
          <SectionTitle
            right={
              <Link to="/assignments" className="card__link">
                전체 →
              </Link>
            }
          >
            진행 중 과제
          </SectionTitle>
          {loaderData.assignments.length === 0 ? (
            <EmptyState>진행 중인 과제가 없어요.</EmptyState>
          ) : (
            <ul className="stack-sm bare-list">
              {loaderData.assignments.map((as) => {
                const dd = dDay(as.dueAt);
                return (
                  <li key={as.id}>
                    <Link to={`/assignments/${as.id}`} className="item-link">
                      <div className="minw-0">
                        <div className="item-link__title">{as.title}</div>
                        <div className="item-link__meta num">
                          {as.unit === "team" ? "팀 과제" : "개인 과제"} · 마감{" "}
                          {fmtKST(as.dueAt, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
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
