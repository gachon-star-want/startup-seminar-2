import { defineConfig } from "drizzle-kit";

// D1(SQLite) 워크플로: `npm run db:generate`로 ./drizzle에 SQL 마이그레이션 생성 →
// `npm run db:migrate`로 D1에 적용 (remote) / `npm run db:migrate:local` (로컬 개발)
export default defineConfig({
  dialect: "sqlite",
  schema: "./app/db/schema.ts",
  out: "./drizzle",
});
