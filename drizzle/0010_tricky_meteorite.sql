CREATE TABLE `team_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`kind` text NOT NULL,
	`filename` text NOT NULL,
	`r2_key` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text,
	`uploaded_by_id` text,
	`uploaded_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_documents_team_kind_key` ON `team_documents` (`team_id`,`kind`);