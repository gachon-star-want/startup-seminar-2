/**
 * 창업심화세미나2 — 수강 명단 시드 스크립트 (D1)
 * 학생 17명 + 김호 교수(role=professor)를 users 에 등록한다 (이름이 이미 있으면 건너뜀).
 *
 * 사용: `npm run db:seed:users` (remote) / `node scripts/seed-users.mjs --local` (로컬 개발 DB)
 */
import { runD1, sumChanges } from "./lib/d1.mjs";

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
  { name: "최찬미", role: "student" },
];

const local = process.argv.includes("--local");

const stmts = ROSTER.map((person) => {
  const id = crypto.randomUUID();
  return `INSERT OR IGNORE INTO users (id, name, role, created_at) VALUES ('${id}', '${person.name.replace(/'/g, "''")}', '${person.role}', ${Date.now()});`;
});

const created = sumChanges(runD1(stmts.join("\n"), { local }));
console.log(`완료: ${created}명 신규 등록 / 명단 총 ${ROSTER.length}명 [${local ? "local" : "remote"}]`);
