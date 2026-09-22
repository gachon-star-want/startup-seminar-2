CREATE TABLE `presentation_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`evaluator_id` text NOT NULL,
	`idea_score` integer NOT NULL,
	`feasibility_score` integer NOT NULL,
	`delivery_score` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `presentation_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_evaluations_session_submission_evaluator_key` ON `presentation_evaluations` (`session_id`,`submission_id`,`evaluator_id`);--> statement-breakpoint
CREATE TABLE `presentation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_date` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`assignment_id` text,
	`opens_at` integer NOT NULL,
	`closes_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE set null
);
