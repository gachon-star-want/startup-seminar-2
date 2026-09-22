PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_presentation_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`evaluator_id` text NOT NULL,
	`star_score` real NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `presentation_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_presentation_evaluations`("id", "session_id", "submission_id", "evaluator_id", "star_score", "comment", "created_at", "updated_at") SELECT "id", "session_id", "submission_id", "evaluator_id", "star_score", "comment", "created_at", "updated_at" FROM `presentation_evaluations`;--> statement-breakpoint
DROP TABLE `presentation_evaluations`;--> statement-breakpoint
ALTER TABLE `__new_presentation_evaluations` RENAME TO `presentation_evaluations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_evaluations_session_submission_evaluator_key` ON `presentation_evaluations` (`session_id`,`submission_id`,`evaluator_id`);--> statement-breakpoint
CREATE TABLE `__new_presentation_member_evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`evaluator_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`star_score` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `presentation_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_presentation_member_evaluations`("id", "session_id", "submission_id", "evaluator_id", "target_user_id", "star_score", "created_at", "updated_at") SELECT "id", "session_id", "submission_id", "evaluator_id", "target_user_id", "star_score", "created_at", "updated_at" FROM `presentation_member_evaluations`;--> statement-breakpoint
DROP TABLE `presentation_member_evaluations`;--> statement-breakpoint
ALTER TABLE `__new_presentation_member_evaluations` RENAME TO `presentation_member_evaluations`;--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_member_evaluations_key` ON `presentation_member_evaluations` (`session_id`,`submission_id`,`evaluator_id`,`target_user_id`);