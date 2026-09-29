CREATE TABLE `substitute_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `substitute_files` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `substitute_submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `substitute_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`content` text,
	`link` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`review_note` text,
	`submitted_at` integer NOT NULL,
	`reviewed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `substitute_assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `attendance_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `substitute_submissions_assignment_user_session_key` ON `substitute_submissions` (`assignment_id`,`user_id`,`session_id`);