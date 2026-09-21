/**
 * 창업심화세미나2 — 수업 날짜 시드 스크립트 (D1)
 * 매주 화요일(10:00 KST 기준) 세션을 attendance_sessions 에 등록한다 (이미 있으면 건너뜀).
 *
 * 사용: `npm run db:seed` (remote) / `node scripts/seed.mjs --local` (로컬 개발 DB)
 */
import { runD1, sumChanges } from "./lib/d1.mjs";

const START = "2026-09-01"; // 화요일 — 1학기 첫 수업
const END = "2026-12-08"; // 화요일 — 종강 (총 15회)
const WINDOWS = { open: "10:00", late: "10:10", close: "11:00" };

function tuesdays(startYmd, endYmd) {
  const out = [];
  const d = new Date(`${startYmd}T00:00:00Z`);
  const end = new Date(`${endYmd}T00:00:00Z`);
  // 시작일을 화요일(UTC 기준 getDay()===2)로 맞추기
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

const dates = tuesdays(START, END);
const local = process.argv.includes("--local");
const ms = (date, h) => Date.parse(`${date}T${h}:00+09:00`);

const stmts = dates.map((date) => {
  const id = crypto.randomUUID();
  return `INSERT OR IGNORE INTO attendance_sessions (id, session_date, opens_at, late_from, closes_at, created_at) VALUES ('${id}', '${date}', ${ms(date, WINDOWS.open)}, ${ms(date, WINDOWS.late)}, ${ms(date, WINDOWS.close)}, ${Date.now()});`;
});

const created = sumChanges(runD1(stmts.join("\n"), { local }));
console.log(`완료: ${created}개 신규 등록 / 총 ${dates.length}개 화요일 (${START} ~ ${END}) [${local ? "local" : "remote"}]`);
