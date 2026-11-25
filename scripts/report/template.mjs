/**
 * 창업심화세미나2 — 학기 결과 보고서 HTML (손으로 짠 인쇄용 CSS)
 * 색·글꼴 토큰은 app/tailwind.css 의 라이트 테마와 같다. A4 세로 한 장 기준이며 표만 싣는다 — 해설·의견은 쓰지 않는다.
 */

const KST = "Asia/Seoul";
const FONT_STACK = `"Pretendard", -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", system-ui, sans-serif`;
const DOC_TITLE = "창업심화세미나2 수업 결과 보고서";

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** DB 에서 온 문자열은 전부 이걸 거쳐 HTML 에 넣는다.
 *  macOS 에서 올라온 파일명은 자모가 분해된(NFD) 형태로 저장되므로 합친다(NFC). */
const esc = (value) =>
  String(value ?? "")
    .normalize("NFC")
    .replace(/[&<>"']/g, (ch) => ENTITIES[ch]);

const WEEKDAY = new Intl.DateTimeFormat("ko-KR", { timeZone: KST, weekday: "short" });
const fmt = (locale, date, options) => new Intl.DateTimeFormat(locale, { timeZone: KST, ...options }).format(date);

/** 'YYYY-MM-DD' → 'M/D(요일)' — 앱 time.ts 의 ymdLabel 과 같은 꼴 */
const ymdLabel = (ymd) => {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}(${WEEKDAY.format(new Date(`${ymd}T12:00:00+09:00`))})`;
};

/** 'YYYY-MM-DD' → '2026. 9. 1.' */
const dotted = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
};

/** 밀리초 → KST 기준 'YYYY-MM-DD' */
const kstYMD = (ms) => fmt("en-CA", new Date(ms), { year: "numeric", month: "2-digit", day: "2-digit" });

/** 밀리초 → KST 기준 '2026년 11월 25일 수 오후 12:29' */
const kstStamp = (ms) =>
  fmt("ko-KR", new Date(ms), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** 개강월 기준 학기 표기 — 7월 이후 시작이면 2학기 */
const termLabel = (ymd) => {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}학년도 ${m >= 7 ? 2 : 1}학기`;
};

// ---------- 표 ----------

function attendanceTable({ attendance }) {
  const total = attendance.reduce(
    (acc, s) => ({ present: acc.present + s.present, late: acc.late + s.late, absent: acc.absent + s.absent }),
    { present: 0, late: 0, absent: 0 }
  );
  const count = (n, tone) => `<td class="num ${n ? `hit hit--${tone}` : "dim"}">${n}</td>`;
  const rows = attendance
    .map(
      (s) => `<tr>
        <td class="name">${esc(s.name)}</td>
        <td>${s.teamNames.length ? esc(s.teamNames.join(" · ")) : '<span class="dim">—</span>'}</td>
        <td class="num">${s.present}</td>
        ${count(s.late, "late")}
        ${count(s.absent, "absent")}
      </tr>`
    )
    .join("");
  return `<table class="grid grid--counts">
    <thead>
      <tr><th scope="col">이름</th><th scope="col">소속 팀</th><th scope="col" class="num">출석</th><th scope="col" class="num">지각</th><th scope="col" class="num">결석</th></tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><th scope="row" colspan="2">합계 (${attendance.length}명)</th><td class="num">${total.present}</td><td class="num ${total.late ? "hit hit--late" : "dim"}">${total.late}</td><td class="num ${total.absent ? "hit hit--absent" : "dim"}">${total.absent}</td></tr>
    </tfoot>
  </table>`;
}

function assignmentTable({ attendance, assignments }) {
  const head = assignments
    .map(
      (a) => `<th scope="col" class="asg"><span class="asg__title">${esc(a.title)}</span><span class="asg__meta">${a.isTeam ? "팀" : "개인"} · ${ymdLabel(kstYMD(a.dueAt))} 마감</span></th>`
    )
    .join("");
  const rows = attendance
    .map(
      (s, i) => `<tr>
        <td class="name">${esc(s.name)}</td>
        <td>${s.teamNames.length ? esc(s.teamNames.join(" · ")) : '<span class="dim">—</span>'}</td>
        ${assignments
          .map(
            (a) => `<td>${a.results[i] ? '<span class="pill">제출</span>' : '<span class="pill pill--none">미제출</span>'}</td>`
          )
          .join("")}
      </tr>`
    )
    .join("");
  const foot = assignments
    .map((a) => `<td>${a.submittedCount} / ${a.total}</td>`)
    .join("");
  return `<table class="grid grid--asg">
    <colgroup><col class="c-name"><col class="c-team">${assignments.map(() => "<col>").join("")}</colgroup>
    <thead>
      <tr><th scope="col">이름</th><th scope="col">소속 팀</th>${head}</tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr><th scope="row" colspan="2">제출 수</th>${foot}</tr>
    </tfoot>
  </table>`;
}

function documentTable({ teams }) {
  const rows = teams
    .map(
      (t) => `<tr>
        <td class="name">${esc(t.name)}</td>
        <td>${t.members.length ? esc(t.members.join(" · ")) : '<span class="dim">—</span>'}</td>
        <td>${esc(t.businessLabel)}</td>
        <td>${esc(t.mailOrderLabel)}</td>
        <td class="docs">${
          t.documents.length
            ? t.documents
                .map(
                  (d) => `<span class="doc"><b>${esc(d.kindLabel)}</b> ${esc(d.filename)}</span>`
                )
                .join("")
            : '<span class="dim">—</span>'
        }</td>
      </tr>`
    )
    .join("");
  return `<table class="grid grid--docs">
    <thead>
      <tr><th scope="col">팀</th><th scope="col">팀원</th><th scope="col">사업자등록</th><th scope="col">통신판매업</th><th scope="col">올린 서류</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function finalTable({ final }) {
  const rows = final.teams
    .map(
      (t) => `<tr>
        <td class="name">${esc(t.name)}</td>
        <td>${t.members.length ? esc(t.members.join(" · ")) : '<span class="dim">—</span>'}</td>
        <td class="num score">${t.score === null ? '<span class="dim">—</span>' : `${t.score.toFixed(2)}<span class="of">/ 5</span>`}</td>
      </tr>`
    )
    .join("");
  return `<table class="grid grid--score">
    <thead>
      <tr><th scope="col">팀</th><th scope="col">소속 인원</th><th scope="col" class="num">최종 평가 점수</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function previousTable({ teams }) {
  const rows = teams
    .map(
      (t) => `<tr>
        <td class="name">${esc(t.name)}</td>
        <td>${t.members.length ? esc(t.members.join(" · ")) : '<span class="dim">—</span>'}</td>
        <td class="num score">${t.score === null ? '<span class="dim">—</span>' : `${t.score.toFixed(2)}<span class="of">/ 5</span>`}</td>
        <td class="num">${t.count}</td>
      </tr>`
    )
    .join("");
  return `<table class="grid grid--score">
    <thead>
      <tr><th scope="col">팀</th><th scope="col">소속 인원</th><th scope="col" class="num">평균</th><th scope="col" class="num">평가 수</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---------- 페이지 ----------

const section = (no, title, sub, body) => `<section class="sheet">
  <header class="sec">
    <span class="sec__no">${no}</span>
    <div>
      <h2 class="sec__title">${esc(title)}</h2>
      <p class="sec__sub">${esc(sub)}</p>
    </div>
  </header>
  ${body}
</section>`;

const CSS = `
  @page {
    size: A4;
    margin: 18mm 16mm 20mm;
    @bottom-left { content: "${DOC_TITLE}"; font: 500 8pt ${FONT_STACK}; color: #9496ab; }
    @bottom-right { content: counter(page) " / " counter(pages); font: 500 8pt ${FONT_STACK}; color: #9496ab; }
  }
  @page :first {
    @bottom-left { content: none; }
    @bottom-right { content: none; }
  }
  :root {
    --text: #1a1b25;
    --text-2: #5c5e70;
    --text-3: #9496ab;
    --border: #e2e3ee;
    --border-strong: #cbccdd;
    --surface-2: #f6f7fb;
    --primary: #4f46e5;
    --primary-border: #c9c6f6;
    --success: #047857;
    --success-soft: #e0f4ea;
    --late: #b45309;
    --danger: #be123c;
    --danger-soft: #fdebee;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    color: var(--text);
    font-family: ${FONT_STACK};
    font-size: 10.5pt;
    line-height: 1.55;
    /* 한글은 단어 중간에서 끊지 않고, 넘치는 긴 단어만 마지막에 줄바꿈 */
    word-break: keep-all;
    overflow-wrap: break-word;
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, p, dl, dd, ul { margin: 0; }
  ul { padding: 0; list-style: none; }

  /* ---------- 표지 ---------- */
  .cover {
    break-after: page;
    margin-top: 76mm;
    padding: 12mm 0 12mm 9mm;
    border-left: 4px solid var(--primary);
  }
  .cover__kicker { font-size: 11pt; font-weight: 600; color: var(--primary); }
  .cover__title { margin-top: 6mm; font-size: 34pt; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
  .cover__sub { margin-top: 3mm; font-size: 17pt; font-weight: 500; color: var(--text-2); }
  .cover__period { margin-top: 7mm; font-size: 12pt; }
  .cover__meta {
    display: grid;
    grid-template-columns: 26mm 1fr;
    row-gap: 2.2mm;
    margin-top: 16mm;
    padding-top: 8mm;
    border-top: 1px solid var(--border-strong);
    font-size: 10.5pt;
  }
  .cover__meta dt { color: var(--text-3); font-weight: 500; }
  .cover__facts {
    display: flex;
    flex-wrap: wrap;
    gap: 2mm 4mm;
    margin-top: 10mm;
    font-size: 10pt;
    color: var(--text-2);
  }
  .cover__facts span { padding: 1mm 3.5mm; border: 1px solid var(--border); border-radius: 999px; background: var(--surface-2); }
  .cover__facts b { color: var(--text); font-weight: 700; }

  /* ---------- 장 ---------- */
  .sheet { break-before: page; }
  .sec {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 5mm;
    padding-bottom: 3mm;
    border-bottom: 2px solid var(--primary-border);
  }
  .sec__no { font-size: 11pt; font-weight: 700; color: var(--primary); font-variant-numeric: tabular-nums; }
  .sec__title { font-size: 16pt; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; }
  .sec__sub { margin-top: 1mm; font-size: 9pt; color: var(--text-2); }

  /* ---------- 표 ---------- */
  .grid { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .grid thead { display: table-header-group; }
  .grid tr { break-inside: avoid; }
  .grid th, .grid td {
    padding: 2.1mm 2.6mm;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: middle;
  }
  .grid thead th {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-strong);
    font-size: 9pt;
    font-weight: 600;
    color: var(--text-2);
  }
  .grid tbody tr:last-child td { border-bottom: 1px solid var(--border-strong); }
  .grid tfoot th, .grid tfoot td { padding-top: 2.6mm; background: var(--surface-2); font-weight: 600; }
  .num { text-align: right; }
  .name { font-weight: 600; }
  .dim { color: var(--text-3); font-weight: 400; }
  .hit { font-weight: 700; }
  .hit--late { color: var(--late); }
  .hit--absent { color: var(--danger); }

  .grid--counts .name { width: 22%; }
  .grid--counts td:nth-child(2) { width: 46%; }

  /* 고정 배치 — 과제 칸 다섯 개가 남는 너비를 똑같이 나눠 머리글이 단어 중간에서 끊기지 않게 한다 */
  .grid--asg { table-layout: fixed; }
  .grid--asg .c-name { width: 12%; }
  .grid--asg .c-team { width: 24%; }
  .grid--asg thead th { padding-left: 1.6mm; padding-right: 1.6mm; }
  .grid--asg thead th:not(:first-child):not(:nth-child(2)), .grid--asg tbody td:not(:first-child):not(:nth-child(2)), .grid--asg tfoot td { text-align: center; }
  .asg__title, .asg__meta { display: block; }
  .asg__title { color: var(--text); font-size: 9.5pt; line-height: 1.35; }
  .asg__meta { margin-top: 1mm; font-size: 8pt; color: var(--text-3); font-weight: 500; }
  .pill {
    display: inline-block;
    padding: 0.3mm 2.4mm;
    border-radius: 999px;
    background: var(--success-soft);
    color: var(--success);
    font-size: 8.5pt;
    font-weight: 600;
    white-space: nowrap;
  }
  .pill--none { background: var(--danger-soft); color: var(--danger); }

  .grid--docs .name { width: 21%; white-space: nowrap; }
  .grid--docs td:nth-child(2) { width: 16%; }
  .grid--docs th:nth-child(3), .grid--docs td:nth-child(3), .grid--docs th:nth-child(4), .grid--docs td:nth-child(4) { width: 11%; white-space: nowrap; }
  .docs { overflow-wrap: anywhere; word-break: normal; font-size: 9.5pt; }
  .doc { display: block; }
  .doc + .doc { margin-top: 1.2mm; }
  .doc b { font-weight: 600; }

  .grid--score .name { width: 36%; }
  .grid--score td:nth-child(2) { width: 36%; }
  .grid--score tbody td { padding-top: 2.6mm; padding-bottom: 2.6mm; }
  .score { font-size: 12.5pt; font-weight: 700; }
  .score .of { margin-left: 1.5mm; font-size: 9pt; font-weight: 500; color: var(--text-3); }
`;

/**
 * 보고서 전체 HTML.
 * fontFaces — build-report.mjs 가 찾은 로컬 글꼴의 @font-face 규칙 (없으면 시스템 글꼴로 내려간다)
 */
export function renderReport(data, { generatedAt, fontFaces = "", author }) {
  const { meta } = data;
  const period = `${dotted(meta.fromDate)} – ${dotted(meta.toDate)}`;
  const cover = `<section class="cover">
    <p class="cover__kicker">${esc(termLabel(meta.fromDate))}</p>
    <h1 class="cover__title">창업심화세미나2</h1>
    <p class="cover__sub">수업 결과 보고서</p>
    <p class="cover__period">${period} · ${meta.sessionCount}회</p>
    <dl class="cover__meta">
      <dt>지도교수</dt><dd>${esc(meta.professor ?? "—")}</dd>
      <dt>작성</dt><dd>${esc(author)}</dd>
      <dt>데이터 기준</dt><dd>${kstStamp(generatedAt)} (KST)</dd>
      <dt>기록 출처</dt><dd>수업 운영 사이트 — 출석 체크, 과제 제출, 사업 서류 제출, 발표 평가</dd>
    </dl>
    <p class="cover__facts">
      <span>학생 <b>${meta.studentCount}</b>명</span>
      <span>팀 <b>${meta.teamCount}</b>개</span>
      <span>과제 <b>${meta.assignmentCount}</b>건</span>
      <span>발표 평가 <b>${meta.evaluationCount}</b>회</span>
    </p>
  </section>`;

  const appendix = data.previous
    .map((session) =>
      section("부록", session.title, `${ymdLabel(session.date)} 발표 · 별점 평균 (5점 만점) · 자기 팀 평가 제외`, previousTable(session))
    )
    .join("");

  return `<!doctype html>
<html lang="ko" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(DOC_TITLE)}</title>
<style>
${fontFaces}${CSS}
</style>
</head>
<body>
${cover}
${section("01", "학생별 출석 현황", `${period} · ${meta.sessionCount}회 · 대체출석은 출석에 포함`, attendanceTable(data))}
${section("02", "학생별 과제 제출 현황", `제출 여부는 데이터 기준 시각 기준 · 팀 과제는 팀원 전원에게 같이 적용`, assignmentTable(data))}
${section("03", "팀별 사업 서류 제출 현황", "상태는 관리자 기록 기준", documentTable(data))}
${data.final ? section("04", "최종 발표 평가 점수", `${ymdLabel(data.final.date)} 발표 · 평가자 총점의 평균 (5점 만점)`, finalTable(data)) : ""}
${appendix}
<script>
  // 글꼴이 다 올라온 뒤 PDF 로 내보내도록 준비 표식 — build-report.mjs 가 이걸 기다린다
  document.fonts.ready.then(() => { document.documentElement.dataset.ready = "1"; });
</script>
</body>
</html>
`;
}
