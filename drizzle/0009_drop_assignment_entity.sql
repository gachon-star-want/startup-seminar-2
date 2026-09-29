PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_substitute_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`content` text,
	`link` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`approved_from` text,
	`review_note` text,
	`submitted_at` integer NOT NULL,
	`reviewed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_substitute_submissions`("id", "user_id", "session_id", "content", "link", "status", "approved_from", "review_note", "submitted_at", "reviewed_at", "updated_at")
SELECT "id", "user_id", "session_id", "content", "link", "status", "approved_from", "review_note", "submitted_at", "reviewed_at", "updated_at"
FROM `substitute_submissions`
WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", ROW_NUMBER() OVER (PARTITION BY "user_id", "session_id" ORDER BY "updated_at" DESC, "submitted_at" DESC) AS rn
		FROM `substitute_submissions`
	)
	WHERE rn = 1
);--> statement-breakpoint
CREATE TABLE `__substitute_files_backup` AS SELECT * FROM `substitute_files`;--> statement-breakpoint
DROP TABLE `substitute_files`;--> statement-breakpoint
DROP TABLE `substitute_submissions`;--> statement-breakpoint
ALTER TABLE `__new_substitute_submissions` RENAME TO `substitute_submissions`;--> statement-breakpoint
CREATE TABLE `substitute_files` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `substitute_submissions`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `substitute_files`("id", "submission_id", "filename", "r2_key", "size", "mime", "created_at")
SELECT "id", "submission_id", "filename", "r2_key", "size", "mime", "created_at"
FROM `__substitute_files_backup`
WHERE "submission_id" IN (SELECT "id" FROM `substitute_submissions`);--> statement-breakpoint
DROP TABLE `__substitute_files_backup`;--> statement-breakpoint
DROP TABLE `substitute_assignments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `substitute_submissions_user_session_key` ON `substitute_submissions` (`user_id`,`session_id`);