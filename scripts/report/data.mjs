/**
 * 창업심화세미나2 — 학기 결과 보고서 데이터 (build-report.mjs 의 데이터 단계)
 * D1 스냅샷(wrangler d1 export 로 내려받은 export.sql)에서 표에 들어갈 값만 뽑아 정제한다.
 *
 * 정제 규칙
 *  - 개최 회차: session_date 가 기준일(--until)까지인 출석 세션. 열리지 않은 미래 날짜는 빠진다
 *  - 출석: present·substituted → 출석, late → 지각, absent 또는 기록 없음 → 결석
 *  - 발표 점수: 공지된 규칙 그대로 평가자 총점(star_score)의 산술 평균 (소수 둘째 자리)
 *  - 평가 집계에서 평가자가 그 팀 소속인 행(자기 팀 평가)과 미완성 임시저장(star_score = 0)은 제외
 *
 * 읽지 않는 값: 생일 4자리·학번(users.birth4·student_number), 평가자 이름·코멘트.
 * PDF 에 실리지 않는 값은 조회조차 하지 않는다 — evaluator_id 는 자기 팀 평가를 걸러 내기 위해서만 쓰인다.
 */

/** 소수 둘째 자리 — 앱 rubric.ts 의 round2 와 같은 계산 */
const round2 = (n) => Math.round(n * 100) / 100;

/** 산술 평균 — 앱 rubric.ts 의 mean 과 같은 계산 */
const mean = (values) => values.reduce((s, v) => s + v, 0) / values.length;

/** 이름 가나다순 — 한글 음절은 코드 포인트 순서가 가나다순이라 그대로 비교한다 */
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// 표시 라벨 — app/lib/constants.ts 와 같은 값 (스크립트는 TS 모듈을 가져오지 않으므로 복제)
const BUSINESS_STATUS_LABELS = { none: "미등록", applied: "신청중", done: "등록완료" };
const MAIL_ORDER_STATUS_LABELS = { none: "미신고", applied: "신고중", done: "신고완료" };
const DOC_KIND_LABELS = { business: "사업자등록증", mail_order: "통신판매업신고증" };

const label = (labels, value) => labels[value] ?? value;

/**
 * 스냅샷이 올라간 인메모리 DB 에서 보고서 데이터를 만든다.
 * until 을 생략하면 마감 처리(absent_sealed_at)까지 끝난 가장 최근 출석일이 기준일이 된다.
 */
export function buildReportData(db, { until } = {}) {
  if (until !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    throw new Error(`--until 은 YYYY-MM-DD 형식이어야 해요: ${until}`);
  }

  const cutoff =
    until ??
    db
      .prepare(`SELECT max(session_date) AS date FROM attendance_sessions WHERE absent_sealed_at IS NOT NULL`)
      .get()?.date;
  if (!cutoff) throw new Error("기준일을 정할 수 없어요. --until YYYY-MM-DD 로 지정해 주세요.");

  const sessionCount = db
    .prepare(`SELECT count(*) AS n FROM attendance_sessions WHERE session_date <= ?`)
    .get(cutoff).n;
  const period = db
    .prepare(`SELECT min(session_date) AS first, max(session_date) AS last FROM attendance_sessions WHERE session_date <= ?`)
    .get(cutoff);
  if (!sessionCount) throw new Error(`기준일(${cutoff})까지 개최된 출석 세션이 없어요.`);

  const students = db.prepare(`SELECT id, name FROM users WHERE role = 'student'`).all().sort(byName);
  const teams = db
    .prepare(`SELECT id, name, business_status AS businessStatus, mail_order_status AS mailOrderStatus FROM teams`)
    .all()
    .sort(byName);
  const teamRank = new Map(teams.map((t, i) => [t.id, i]));

  // 팀 소속 — 학생별 팀 목록(팀명 가나다순), 팀별 팀원 목록(이름 가나다순)
  const teamsOf = new Map(students.map((s) => [s.id, []]));
  const membersOf = new Map(teams.map((t) => [t.id, []]));
  for (const m of db
    .prepare(
      `SELECT tm.team_id AS teamId, u.id AS userId, u.name AS name
       FROM team_members tm JOIN users u ON u.id = tm.user_id
       WHERE u.role = 'student'`
    )
    .all()) {
    teamsOf.get(m.userId)?.push(m.teamId);
    membersOf.get(m.teamId)?.push({ id: m.userId, name: m.name });
  }
  for (const list of teamsOf.values()) list.sort((a, b) => teamRank.get(a) - teamRank.get(b));
  for (const list of membersOf.values()) list.sort(byName);

  // 출석 — 개최 회차 × 학생 전원을 먼저 펼친 뒤 기록을 붙이므로 기록 없는 날은 결석으로 집계된다
  const attendance = db
    .prepare(
      `SELECT u.id, u.name,
              count(*) AS sessions,
              coalesce(sum(r.status IN ('present', 'substituted')), 0) AS present,
              coalesce(sum(r.status = 'late'), 0) AS late,
              coalesce(sum(r.status IS NULL OR r.status = 'absent'), 0) AS absent
       FROM users u
       CROSS JOIN (SELECT id FROM attendance_sessions WHERE session_date <= ?) s
       LEFT JOIN attendance_records r ON r.session_id = s.id AND r.user_id = u.id
       WHERE u.role = 'student'
       GROUP BY u.id`
    )
    .all(cutoff)
    .sort(byName);
  for (const row of attendance) {
    // 세 칸의 합이 회차 수와 다르면 알 수 없는 상태값이 낀 것 — 어긋난 표를 내지 않고 멈춘다
    if (row.present + row.late + row.absent !== row.sessions) {
      throw new Error(
        `${row.name} 출석 집계가 회차 수와 맞지 않아요 (출석 ${row.present}·지각 ${row.late}·결석 ${row.absent}, ${row.sessions}회)`
      );
    }
    row.teamNames = (teamsOf.get(row.id) ?? []).map((id) => teams[teamRank.get(id)].name);
  }

  // 과제 — 팀 과제는 그 팀의 제출을 팀원 전원에게, 개인 과제는 본인 제출만 인정
  const submissions = db
    .prepare(`SELECT assignment_id AS assignmentId, user_id AS userId, team_id AS teamId FROM submissions`)
    .all();
  const teamless = students.filter((s) => (teamsOf.get(s.id) ?? []).length === 0);
  const assignments = db
    .prepare(`SELECT id, title, unit, due_at AS dueAt FROM assignments ORDER BY due_at, title`)
    .all()
    .map((a) => {
      const rows = submissions.filter((s) => s.assignmentId === a.id);
      const byTeam = new Set(rows.map((s) => s.teamId).filter(Boolean));
      const byUser = new Set(rows.map((s) => s.userId));
      const isTeam = a.unit === "team";
      const submitted = (student) =>
        byUser.has(student.id) ||
        (isTeam && (teamsOf.get(student.id) ?? []).some((teamId) => byTeam.has(teamId)));
      return {
        title: a.title,
        isTeam,
        dueAt: a.dueAt,
        total: (isTeam ? teams.length : 0) + (isTeam ? teamless.length : students.length),
        submittedCount: isTeam
          ? teams.filter((t) => byTeam.has(t.id)).length + teamless.filter((s) => byUser.has(s.id)).length
          : students.filter((s) => byUser.has(s.id)).length,
        results: attendance.map(submitted),
      };
    });

  // 팀 사업 서류 — 상태는 관리자가 기록한 값, 서류는 실제 업로드된 파일
  const documents = db
    .prepare(`SELECT team_id AS teamId, kind, filename FROM team_documents ORDER BY uploaded_at, filename`)
    .all();
  const teamRows = teams.map((t) => ({
    name: t.name,
    members: (membersOf.get(t.id) ?? []).map((m) => m.name),
    businessLabel: label(BUSINESS_STATUS_LABELS, t.businessStatus),
    mailOrderLabel: label(MAIL_ORDER_STATUS_LABELS, t.mailOrderStatus),
    documents: documents
      .filter((d) => d.teamId === t.id)
      .map((d) => ({ kindLabel: label(DOC_KIND_LABELS, d.kind), filename: d.filename })),
  }));

  // 발표 평가 — 세션 × 팀 별 평균. 자기 팀 평가와 미완성(0점)은 세션 종류와 무관하게 같은 규칙으로 뺀다
  const evaluationRows = db
    .prepare(
      `SELECT pe.session_id AS sessionId, pe.team_id AS teamId, pe.evaluator_id AS evaluatorId, pe.star_score AS score
       FROM presentation_evaluations pe`
    )
    .all();
  const scoresOf = (sessionId, teamId) => {
    const own = new Set((membersOf.get(teamId) ?? []).map((m) => m.id));
    const values = evaluationRows
      .filter(
        (r) => r.sessionId === sessionId && r.teamId === teamId && r.score > 0 && !own.has(r.evaluatorId)
      )
      .map((r) => r.score);
    return values.length ? { score: round2(mean(values)), count: values.length } : { score: null, count: 0 };
  };
  const presentationSessions = db
    .prepare(`SELECT id, title, session_date AS date FROM presentation_sessions ORDER BY session_date, created_at`)
    .all();
  // 가장 최근 세션이 최종 발표 — 점수 내림차순, 같은 점수는 팀명 가나다순
  const finalSession = presentationSessions.at(-1) ?? null;
  const final = finalSession
    ? teams
        .map((t) => ({ name: t.name, members: (membersOf.get(t.id) ?? []).map((m) => m.name), ...scoresOf(finalSession.id, t.id) }))
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || byName(a, b))
    : [];
  // 그 전 세션은 순위 없이 참고용 — 팀명 가나다순
  const previous = presentationSessions.slice(0, -1).map((session) => ({
    title: session.title,
    date: session.date,
    teams: teams.map((t) => ({
      name: t.name,
      members: (membersOf.get(t.id) ?? []).map((m) => m.name),
      ...scoresOf(session.id, t.id),
    })),
  }));

  const professor = db
    .prepare(`SELECT name FROM users WHERE role = 'professor' ORDER BY created_at LIMIT 1`)
    .get()?.name;

  return {
    meta: {
      until: cutoff,
      fromDate: period.first,
      toDate: period.last,
      sessionCount,
      studentCount: students.length,
      teamCount: teams.length,
      assignmentCount: assignments.length,
      evaluationCount: presentationSessions.length,
      professor: professor ?? null,
    },
    attendance,
    assignments,
    teams: teamRows,
    final: finalSession
      ? { title: finalSession.title, date: finalSession.date, teams: final }
      : null,
    previous,
  };
}
