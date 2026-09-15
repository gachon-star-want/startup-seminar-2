# 🚀 창업심화세미나2

창업심화세미나2 수업 운영용 페이지 — 출석체크, 팀 리더보드, 과제 제출을 한 곳에서.

20명 이내 소규모 수업용이라 인증은 이름+학번(+생일 4자리) 간단 가입만 사용하고,
개인정보는 이름/학번/생일 4자리 외에 일절 수집하지 않는다.

## 기능

| 기능 | 설명 |
|---|---|
| 출석체크 | 매주 화요일 10:00 자동 오픈 · 10:10까지 출석 / 11:00까지 지각 · 체크 시 생일 4자리 입력 |
| 리더보드 | 조별 아이템/판매 채널/사업자등록/통신판매업신고 진행도 점수 순위 (최대 6점) + 비고 |
| 팀 | 누구나 팀 생성(팀장) + 6자리 초대코드로 합류 · 인원 제한 없음 (1인 조 가능) |
| 과제 | 관리자가 과제 생성(팀/개인 단위) · 텍스트+링크+파일(20MB) 제출 |
| 관리자 | 비밀번호(기본 0806) 진입 · 수업 날짜 관리, 출석 그리드 조정, 과제 CRUD, 제출물 열람/다운로드 |

## 스택 (전부 무료 플랜)

- **React Router v7/v8 (framework mode)** + TypeScript + Tailwind CSS v4
- **Cloudflare Workers (정적 에셋)** 배포 — `@cloudflare/vite-plugin`
- **Neon Postgres** (무료 0.5GB) + Drizzle ORM + `@neondatabase/serverless`
- **Cloudflare R2** (무료 10GB) — 과제 파일 저장

## 로컬 개발

```bash
npm install
cp .dev.vars.example .dev.vars   # DATABASE_URL 등 채우기
npm run dev                      # http://localhost:5173
```

## DB 스키마 적용 / 시드

```bash
# .env 에 DATABASE_URL 적어두기 (drizzle-kit/seed용)
npm run db:push    # app/db/schema.ts → Neon 반영
npm run db:seed    # 화요일 수업 날짜 세션 시드 (2026-09-15 ~ 2026-12-15)
```

## 배포

```bash
npm run build
npx wrangler deploy          # .wrangler/deploy 설정 기반 배포
```

시크릿 설정 (최초 1회):

```bash
npx wrangler secret put DATABASE_URL       # Neon 연결 문자열
npx wrangler secret put SESSION_SECRET     # 랜덤 문자열
npx wrangler secret put ADMIN_PASSWORD     # 기본값 0806
```

R2 버킷 (최초 1회): `npx wrangler r2 bucket create seminar-files`

## 시크릿 정책

모든 시크릿은 환경변수(Wrangler secrets / `.dev.vars`)로만 관리하며
`.dev.vars`, `.env` 는 `.gitignore` 처리되어 저장소에 절대 커밋되지 않는다.
