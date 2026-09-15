/**
 * 창업심화세미나2 — 수업 날짜 시드 스크립트
 * 매주 화요일(10:00 KST 기준) 세션을 attendance_sessions 에 등록한다 (이미 있으면 건너뜀).
 *
 * 사용: DATABASE_URL을 .env (또는 환경변수)에 넣고 `npm run db:seed`
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env 없음
  }
  throw new Error("DATABASE_URL을 찾을 수 없어요. .env 파일을 확인해 주세요.");
}

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
const sql = neon(loadDatabaseUrl());

let created = 0;
for (const date of dates) {
  const rows = await sql`
    INSERT INTO attendance_sessions (session_date, opens_at, late_from, closes_at)
    VALUES (
      ${date},
      ${`${date}T${WINDOWS.open}:00+09:00`}::timestamptz,
      ${`${date}T${WINDOWS.late}:00+09:00`}::timestamptz,
      ${`${date}T${WINDOWS.close}:00+09:00`}::timestamptz
    )
    ON CONFLICT (session_date) DO NOTHING
    RETURNING id
  `;
  if (rows.length > 0) created++;
  console.log(`${date} ${rows.length > 0 ? "추가됨" : "이미 존재"}`);
}

console.log(`\n완료: ${created}개 생성 / 총 ${dates.length}개 화요일 (${START} ~ ${END})`);
