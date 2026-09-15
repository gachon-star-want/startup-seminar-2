/**
 * 창업심화세미나2 — 수강 명단 시드 스크립트
 * 학생 16명 + 김호 교수(role=professor)를 users 에 등록한다 (이미 있으면 건너뜀).
 * 기존 계정(이름 기준)은 건드리지 않는다.
 *
 * 사용: DATABASE_URL을 .env (또는 환경변수)에 넣고 `node scripts/seed-users.mjs`
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

const ROSTER = [
  { name: "김호", role: "professor" },
  { name: "강재원", role: "student" },
  { name: "강태이", role: "student" },
  { name: "김범수", role: "student" },
  { name: "김민성", role: "student" },
  { name: "김소윤", role: "student" },
  { name: "김태호", role: "student" },
  { name: "신승민", role: "student" },
  { name: "신은지", role: "student" },
  { name: "송채우", role: "student" },
  { name: "양민혁", role: "student" },
  { name: "엄주원", role: "student" },
  { name: "원유청", role: "student" },
  { name: "이건후", role: "student" },
  { name: "이재빈", role: "student" },
  { name: "이원영", role: "student" },
  { name: "박성진", role: "student" },
];

const sql = neon(loadDatabaseUrl());

let created = 0;
for (const person of ROSTER) {
  const rows = await sql`
    INSERT INTO users (name, role)
    VALUES (${person.name}, ${person.role})
    ON CONFLICT (name) DO NOTHING
    RETURNING id
  `;
  if (rows.length > 0) created++;
  console.log(`${person.name} (${person.role}) ${rows.length > 0 ? "추가됨" : "이미 존재"}`);
}

console.log(`\n완료: ${created}명 생성 / 명단 총 ${ROSTER.length}명`);
