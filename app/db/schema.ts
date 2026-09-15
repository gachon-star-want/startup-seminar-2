import { pgTable, uuid, varchar, text, timestamp, date, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 60 }).notNull(),
    studentNumber: varchar("student_number", { length: 30 }).notNull(),
    birth4: varchar("birth4", { length: 4 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_student_number_key").on(t.studentNumber)],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 80 }).notNull(),
    inviteCode: varchar("invite_code", { length: 8 }).notNull(),
    itemName: varchar("item_name", { length: 200 }),
    salesChannel: varchar("sales_channel", { length: 200 }),
    // none | applied | done
    businessStatus: varchar("business_status", { length: 16 }).notNull().default("none"),
    // none | applied | done
    mailOrderStatus: varchar("mail_order_status", { length: 16 }).notNull().default("none"),
    memo: text("memo"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("teams_invite_code_key").on(t.inviteCode)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // leader | member
    role: varchar("role", { length: 16 }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("team_members_team_user_key").on(t.teamId, t.userId)],
);

export const attendanceSessions = pgTable(
  "attendance_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionDate: date("session_date").notNull(), // 'YYYY-MM-DD' (KST 기준 수업 날짜)
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(), // 10:00 KST
    lateFrom: timestamp("late_from", { withTimezone: true }).notNull(), // 10:10 KST
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(), // 11:00 KST
    note: varchar("note", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("attendance_sessions_date_key").on(t.sessionDate)],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // present | late | absent
    status: varchar("status", { length: 16 }).notNull(),
    // self | admin
    source: varchar("source", { length: 16 }).notNull().default("self"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("attendance_records_session_user_key").on(t.sessionId, t.userId)],
);

export const assignments = pgTable("assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  // team | individual
  unit: varchar("unit", { length: 16 }).notNull().default("team"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const submissions = pgTable("submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  assignmentId: uuid("assignment_id")
    .notNull()
    .references(() => assignments.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  content: text("content"),
  link: varchar("link", { length: 1000 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const submissionFiles = pgTable("submission_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 300 }).notNull(),
  r2Key: varchar("r2_key", { length: 500 }).notNull(),
  size: integer("size").notNull(),
  mime: varchar("mime", { length: 200 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
