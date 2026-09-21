# 창업심화세미나2 시스템 아키텍처 (System Architecture)

> **Cloudflare Workers (Edge Serverless) + React Router v7 + Neon Serverless Postgres + Cloudflare R2**

본 문서는 대규모 아키텍처 리팩토링(Phase 0 ~ Phase 4)을 통해 확립된 모듈 구조와 계층별 규칙을 정의합니다.

---

## 1. 핵심 아키텍처 원칙

1. **Zero-Downtime, Zero-Schema-Mutation**: 기존 PostgreSQL 데이터베이스 스키마는 0바이트 변경 없이 유지됩니다.
2. **Zero-Heap Buffering (128MB Memory Limit)**: Cloudflare Workers의 128MB 메모리 제한을 초과하지 않도록 파일 업로드 및 서빙 시 `ArrayBuffer` 전체 적재를 금지하고, Web 표준 `ReadableStream` 파이프라인을 사용합니다.
3. **WeakMap Request-Scoped Seam**: 동일한 HTTP 요청 라이프사이클 내에서 다중 loader/action 호출 시 중복 DB 쿼리를 방지하기 위해 `WeakMap` 캐시 기반 `requireAppContext`를 사용합니다.
4. **Functional Deep Modules**: 비즈니스 로직과 복잡한 쿼리는 `app/modules/*`에 캡슐화하고, 라우트 파일(`app/routes/*`)은 50줄 이내의 단순 위임자로 유지합니다.

---

## 2. 디렉토리 구조

```
app/
├── modules/                        # 핵심 비즈니스 도메인 (Functional Deep Modules)
│   ├── attendance/                 # 출석 도메인
│   │   ├── rules.ts                # 출석 시간 윈도우, 상태 판정 순수 함수
│   │   ├── types.ts                # 출석 도메인 불변 인터페이스
│   │   ├── attendance.server.ts    # AttendanceDesk (체크인, 출석부 집계, 교수 일괄 처리)
│   │   ├── attendance.test.ts      # 단위 테스트 (13 tests)
│   │   └── index.server.ts         # Seam 배럴 파일
│   ├── teams/                      # 팀 및 마일스톤 도메인
│   │   ├── score.ts                # 6점 만점 리더보드 점수 계산 순수 함수
│   │   ├── types.ts                # 팀 도메인 타입
│   │   ├── team.server.ts          # TeamRoster (팀 생성, 코드 가입, 프로필 수정, 리더 승격 탈퇴)
│   │   ├── team.test.ts            # 단위 테스트 (4 tests)
│   │   └── index.server.ts         # Seam 배럴 파일
│   └── submissions/                # 과제 및 R2 스토리지 도메인
│       ├── storage.ts              # Zero-Heap R2 스트리밍 및 RFC 5987 헤더 인코딩
│       ├── types.ts                # 과제/제출/발표 뷰 타입
│       ├── submissions.server.ts   # SubmissionHub (과제 CRUD, 제출, 파일 스트리밍 서빙)
│       ├── submissions.test.ts     # 단위 테스트 (11 tests)
│       └── index.server.ts         # Seam 배럴 파일
├── lib/                            # 횡단 관심사 및 인프라 Seam
│   ├── context.server.ts           # requireAppContext, requireAdminAppContext (WeakMap 캐싱)
│   ├── session.ts                  # 세션 토큰 검증 및 Non-null User 보장
│   ├── constants.ts                # 상수 (마일스톤, 파일 크기 한도 등)
│   ├── time.ts                     # KST 날짜/시각 포맷터 (순수 헬퍼)
│   ├── mime.ts                     # 확장자 기반 MIME 추론
│   └── auth.ts                     # HMAC 서명 세션 토큰 유틸리티
├── routes/                         # React Router v7 라우트 핸들러 (Presentation Layer)
│   ├── _index.tsx                  # 메인 대시보드
│   ├── attendance.tsx              # 학생 출석 이력
│   ├── team.tsx                    # 내 팀 관리
│   ├── board.tsx                   # 팀 리더보드
│   ├── assignments.$id.tsx         # 과제 상세 및 파일 제출
│   ├── files.$fileId.tsx           # 학생 파일 스트리밍 다운로드
│   ├── admin.assignments.*         # 관리자 과제 관리 및 발표 모드
│   └── admin.attendance.tsx        # 관리자 출석부 매트릭스
└── db/
    ├── schema.ts                   # Drizzle ORM 테이블 스키마
    └── index.ts                    # Neon HTTP Serverless 드라이버
```

---

## 3. 도메인 모듈 세부 명세

### ① `AttendanceDesk` (`app/modules/attendance`)
- **시간 윈도우 규칙**: 
  - `09:30 ~ 10:00`: 오픈 대기 (`scheduled`)
  - `10:00 ~ 10:10`: 출석 인정 (`present`)
  - `10:10 ~ 10:30`: 지각 인정 (`late`)
  - `10:30 이후`: 결석 처리 (`absent`)
- **생일 4자리 검증**: 최초 체크인 시 등록, 이후 체크인 시 본인 확인 비밀번호로 동작.
- **제공 기능**: `checkIn`, `getMyHistory`, `getAdminBoard`, `addSession`, `deleteSession`, `setCellStatus`, `markAllPresent`.

### ② `TeamRoster` (`app/modules/teams`)
- **마일스톤 점수 체계**: 
  - 아이템 입력 (1점), 판매 채널 입력 (1점), 사업자등록 완료 (2점), 통신판매업 완료 (2점) = 총 6점 만점.
- **원자적 팀장 탈퇴 처리**: Neon Serverless 드라이버의 특성을 고려하여, 팀장이 탈퇴할 때 차기 리더를 선(先)승격한 후 본인을 탈퇴 처리하며, 마지막 1인이 탈퇴할 경우 팀 레코드까지 연쇄 정리.
- **제공 기능**: `getMyTeam`, `create`, `joinByCode`, `updateProfile`, `leaveTeam`, `getLeaderboard`.

### ③ `SubmissionHub` (`app/modules/submissions`)
- **Zero-Heap R2 Streaming**: `uploadStreamToR2`를 통해 브라우저 `FormData`의 `File.stream()`을 Cloudflare R2 버킷에 직접 배관.
- **RFC 5987 파일명 인코딩**: 한글 파일명 다운로드 시 깨짐을 방지하는 `filename*=UTF-8''...` 표준 헤더 생성.
- **단일 서빙 Seam**: 학생 다운로드와 관리자 발표 모드(`PdfStage`/`PptxStage`) 프리뷰가 단일 `SubmissionHub.serveFile` 메서드를 공유.
- **제공 기능**: `getStudentAssignment`, `saveSubmission`, `deleteSubmissionFile`, `serveFile`, `getAdminOverview`, `getAdminPresentOverview`, `getAdminList`, `createAssignment`, `updateAssignment`, `deleteAssignment`.

---

## 4. 테스트 하네스 (Test Harness)

- **테스트 러너**: Vitest (`npm test`)
- **Fake R2 Bucket** (`test/fakes/r2.ts`): 인메모리 `Map<string, { body: Uint8Array; httpMetadata: ... }>` 기반으로 동작하여 로컬 환경에서 Cloudflare 인프라 없이 0.3초 내에 전체 테스트 완료.
- **Time-Traveling Context** (`test/fakes/context.ts`): `ctx.now`를 가상으로 조작하여 출석 윈도우 시간 여행 단위 테스트 지원.
