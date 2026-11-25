/**
 * 창업심화세미나2 — 학기 결과 보고서 생성 (D1 스냅샷 → 정제 → HTML → PDF)
 *
 * 사용 (프로젝트 루트에서):
 *   npm run report                               스냅샷을 새로 내려받아 ~/Desktop 에 PDF 생성
 *   npm run report -- --until 2026-11-24         기준일 지정 (기본: 마감 처리된 마지막 출석일)
 *   npm run report -- --snapshot export.sql      이미 내려받은 스냅샷 재사용 — 원격 조회 없음
 *   npm run report -- --html report.html         HTML 까지만 만들고 끝
 *   npm run report -- --out ~/Desktop/보고서.pdf 저장 위치
 *
 * - 원격 DB 는 읽기만 한다 (wrangler d1 export). account 를 못 찾으면 CLOUDFLARE_ACCOUNT_ID 를 함께 지정한다.
 * - 스냅샷·HTML 은 OS 임시 폴더에 남는다(개인정보 포함) — 쓴 뒤 지운다. 공개 저장소에는 올리지 않는다.
 * - PDF 변환은 설치된 Playwright CLI(chromium)를 쓴다. 없으면 HTML 경로를 알려 주고 멈춘다(자동 설치 안 함).
 * - Node 22.13+ 필요 (node:sqlite).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildReportData } from "./data.mjs";
import { renderReport } from "./template.mjs";

const DB_NAME = "startup-seminar-2";
/** 표지 '작성' 란 */
const DEFAULT_AUTHOR = "이원영";

function parseArgs(argv) {
  const args = { until: undefined, snapshot: null, out: null, html: null, author: DEFAULT_AUTHOR };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} 에 값이 필요해요.`);
      i++;
      return value;
    };
    if (arg === "--until") args.until = next();
    else if (arg === "--snapshot") args.snapshot = next();
    else if (arg === "--out") args.out = next();
    else if (arg === "--html") args.html = next();
    else if (arg === "--author") args.author = next();
    else throw new Error(`알 수 없는 옵션이에요: ${arg}`);
  }
  return args;
}

/** 원격 D1 를 읽기 전용으로 통째로 내려받는다 */
function exportSnapshot(workDir) {
  const out = join(workDir, "export.sql");
  execFileSync("npx", ["wrangler", "d1", "export", DB_NAME, "--remote", "--output", out], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  return out;
}

/** 로컬에 설치된 Pretendard 를 찾아 @font-face 규칙으로 만든다 — 없으면 시스템 글꼴로 내려간다 */
function findFontFaces() {
  const weights = [
    [400, "Regular"],
    [500, "Medium"],
    [600, "SemiBold"],
    [700, "Bold"],
  ];
  for (const dir of [join(homedir(), "Library", "Fonts"), "/Library/Fonts"]) {
    if (!weights.every(([, file]) => existsSync(join(dir, `Pretendard-${file}.otf`)))) continue;
    return weights
      .map(
        ([weight, file]) =>
          `@font-face { font-family: "Pretendard"; font-weight: ${weight}; src: url("${pathToFileURL(join(dir, `Pretendard-${file}.otf`)).href}") format("opentype"); }`
      )
      .join("\n");
  }
  return "";
}

/** 글꼴 준비 표식(html[data-ready])이 생길 때까지 기다렸다가 PDF 로 내보낸다 */
function renderPdf(htmlPath, outPath) {
  try {
    execFileSync(
      "playwright",
      [
        "pdf",
        "--paper-format",
        "A4",
        "--wait-for-selector",
        'html[data-ready="1"]',
        "--lang",
        "ko-KR",
        "--timezone",
        "Asia/Seoul",
        pathToFileURL(htmlPath).href,
        outPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (err) {
    const stderr = String(err.stderr ?? "").trim().split("\n").slice(-4).join("\n");
    throw new Error(
      `PDF 변환에 실패했어요. Playwright CLI 와 chromium 이 설치돼 있어야 해요.\n${stderr}\nHTML 은 만들어 두었으니 다른 도구로 변환해도 돼요.`
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workDir = mkdtempSync(join(tmpdir(), "sem2-report-"));

  const snapshotPath = args.snapshot ?? exportSnapshot(workDir);
  const generatedAt = statSync(snapshotPath).mtimeMs;

  // 스냅샷 적용 중에는 외래 키 검사를 끈다 — 내보내기 SQL 은 테이블을 이름순으로 만들므로
  // 자식 테이블(attribution_records 등)의 INSERT 시점에 부모 users 가 아직 없다. 읽기 전용이라 검사가 필요 없다.
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  db.exec(readFileSync(snapshotPath, "utf8"));
  const data = buildReportData(db, { until: args.until });
  db.close();

  const htmlPath = args.html ?? join(workDir, "report.html");
  writeFileSync(
    htmlPath,
    renderReport(data, { generatedAt, fontFaces: findFontFaces(), author: args.author })
  );
  console.log(`HTML  ${htmlPath}`);

  const { meta } = data;
  console.log(
    `데이터  기준일 ${meta.until} · ${meta.sessionCount}회 · 학생 ${meta.studentCount}명 · 팀 ${meta.teamCount}개 · 과제 ${meta.assignmentCount}건`
  );

  if (args.html) return;
  const outPath = args.out ?? join(homedir(), "Desktop", "창업심화세미나2_수업결과보고서.pdf");
  renderPdf(htmlPath, outPath);
  console.log(`PDF   ${outPath}`);
  console.log(`임시 폴더(스냅샷 포함) ${workDir}`);
}

try {
  main();
} catch (err) {
  console.error(`오류: ${err.message}`);
  process.exit(1);
}
