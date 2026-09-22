import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

/** UUID — SQLite엔 uuid 타입이 없어 text + 런타임 생성으로 대체 */
const uuid = (name: string) => text(name);
/** 가변 문자열 — SQLite는 길이 제한이 없어 text로 통일 (원 pg 스키마의 제약은 주석으로 보존) */
const varchar = (name: string, _length: number) => text(name);
/** ISO timestamp — 밀리초 정수로 저장, JS Date로 주고받음 */
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = () => new Date();
const randomId = () => crypto.randomUUID();

export const users = sqliteTable(
  "users",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    name: varchar("name", 60).notNull(),
    studentNumber: varchar("student_number", 30),
    birth4: varchar("birth4", 4),
    // student | professor
    role: varchar("role", 16).notNull().default("student"),
    createdAt: timestamp("created_at").$defaultFn(now).notNull(),
  },
  (t) => [
    uniqueIndex("users_student_number_key").on(t.studentNumber),
    uniqueIndex("users_name_key").on(t.name),
  ],
);

export const teams = sqliteTable(
  "teams",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    name: varchar("name", 80).notNull(),
    inviteCode: varchar("invite_code", 8).notNull(),
    itemName: varchar("item_name", 200),
    salesChannel: varchar("sales_channel", 200),
    // none | applied | done
    businessStatus: varchar("business_status", 16).notNull().default("none"),
    // none | applied | done
    mailOrderStatus: varchar("mail_order_status", 16).notNull().default("none"),
    memo: text("memo"),
    createdAt: timestamp("created_at").$defaultFn(now).notNull(),
    updatedAt: timestamp("updated_at").$defaultFn(now).notNull(),
  },
  (t) => [uniqueIndex("teams_invite_code_key").on(t.inviteCode)],
);

export const teamMembers = sqliteTable(
  "team_members",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // leader | member
    role: varchar("role", 16).notNull().default("member"),
    createdAt: timestamp("created_at").$defaultFn(now).notNull(),
  },
  (t) => [uniqueIndex("team_members_team_user_key").on(t.teamId, t.userId)],
);

export const attendanceSessions = sqliteTable(
  "attendance_sessions",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    sessionDate: text("session_date").notNull(), // 'YYYY-MM-DD' (KST 기준 수업 날짜)
    opensAt: timestamp("opens_at").notNull(), // 10:00 KST
    lateFrom: timestamp("late_from").notNull(), // 10:10 KST
    closesAt: timestamp("closes_at").notNull(), // 11:00 KST
    note: varchar("note", 200),
    createdAt: timestamp("created_at").$defaultFn(now).notNull(),
  },
  (t) => [uniqueIndex("attendance_sessions_date_key").on(t.sessionDate)],
);

export const attendanceRecords = sqliteTable(
  "attendance_records",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // present | late | absent
    status: varchar("status", 16).notNull(),
    // self | admin
    source: varchar("source", 16).notNull().default("self"),
    checkedAt: timestamp("checked_at").$defaultFn(now).notNull(),
  },
  (t) => [uniqueIndex("attendance_records_session_user_key").on(t.sessionId, t.userId)],
);

export const assignments = sqliteTable("assignments", {
  id: uuid("id").$defaultFn(randomId).primaryKey(),
  title: varchar("title", 200).notNull(),
  description: text("description"),
  dueAt: timestamp("due_at").notNull(),
  // team | individual
  unit: varchar("unit", 16).notNull().default("team"),
  createdAt: timestamp("created_at").$defaultFn(now).notNull(),
});

export const submissions = sqliteTable("submissions", {
  id: uuid("id").$defaultFn(randomId).primaryKey(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => assignments.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  content: text("content"),
  link: varchar("link", 1000),
  createdAt: timestamp("created_at").$defaultFn(now).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(now).notNull(),
});

export const submissionFiles = sqliteTable("submission_files", {
  id: uuid("id").$defaultFn(randomId).primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  filename: varchar("filename", 300).notNull(),
  r2Key: varchar("r2_key", 500).notNull(),
  size: integer("size").notNull(),
  mime: varchar("mime", 200),
  createdAt: timestamp("created_at").$defaultFn(now).notNull(),
});

/** 발표 평가 세션 — 언제, 어떤 내용의 발표가 있고 평가 창이 언제 열리는지 */
export const presentationSessions = sqliteTable("presentation_sessions", {
  id: uuid("id").$defaultFn(randomId).primaryKey(),
  sessionDate: text("session_date").notNull(), // 'YYYY-MM-DD' (KST 발표 날짜)
  title: varchar("title", 200).notNull(), // 무슨 내용의 발표인지 (예: 3주차 팀별 발표)
  description: text("description"),
  assignmentId: uuid("assignment_id").references(() => assignments.id, {
    onDelete: "set null",
  }), // 평가 대상이 되는 발표 과제(제출물 모음)
  opensAt: timestamp("opens_at").notNull(), // 평가 시작
  closesAt: timestamp("closes_at").notNull(), // 평가 마감
  createdAt: timestamp("created_at").$defaultFn(now).notNull(),
});

/** 발표(제출물=팀) 단위 평가 — 별점 1~5 + 코멘트(300바이트) */
export const presentationEvaluations = sqliteTable(
  "presentation_evaluations",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => presentationSessions.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    evaluatorId: uuid("evaluator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    starScore: integer("star_score").notNull(), // 별 5개 만점, 1개 단위
    comment: text("comment"), // 최대 300바이트 (앱에서 검증)
    createdAt: timestamp("created_at").$defaultFn(now).notNull(),
    updatedAt: timestamp("updated_at").$defaultFn(now).notNull(),
  },
  (t) => [
    uniqueIndex("presentation_evaluations_session_submission_evaluator_key").on(
      t.sessionId,
      t.submissionId,
      t.evaluatorId
    ),
  ],
);

/** 팀 안 개개인(팀원)에 대한 평가 — 팀 평가와 동일한 별점+코멘트 구조 */
export const presentationMemberEvaluations = sqliteTable(
  "presentation_member_evaluations",
  {
    id: uuid("id").$defaultFn(randomId).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => presentationSessions.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    evaluatorId: uuid("evaluator_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    starScore: integer("star_score").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").$defaultFn(now).notNull(),
    updatedAt: timestamp("updated_at").$defaultFn(now).notNull(),
  },
  (t) => [
    uniqueIndex("presentation_member_evaluations_key").on(
      t.sessionId,
      t.submissionId,
      t.evaluatorId,
      t.targetUserId
    ),
  ],
);

