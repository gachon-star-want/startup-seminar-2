/**
 * D1 시드 공통 헬퍼 — SQL 문장을 wrangler d1 execute로 실행하고 결과 JSON 반환
 * 사용: runD1(sqlText, { local: true })  (기본은 remote)
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runD1(sqlText, { local = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "d1seed-"));
  const file = join(dir, "seed.sql");
  writeFileSync(file, sqlText);
  try {
    const args = ["d1", "execute", "startup-seminar-2", "--file", file, "--json"];
    args.push(local ? "--local" : "--remote");
    const out = execFileSync("npx", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 결과 배열에서 실제 반영된 행 수(INSERT OR IGNORE로 건너뛴 것 제외) 합산 */
export function sumChanges(results) {
  return results.reduce((n, r) => n + (r.meta?.changes ?? r.meta?.rows_written ?? 0), 0);
}
