-- 학생 상태(재학/휴학), 판매채널 링크, 발표 평가 테이블 팀 기반 전환
ALTER TABLE `users` ADD COLUMN `status` text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE `teams` ADD COLUMN `sales_channel_link` text;
--> statement-breakpoint
CREATE TABLE `presentation_evaluations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`team_id` text NOT NULL,
	`submission_id` text,
	`evaluator_id` text NOT NULL,
	`star_score` real NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `presentation_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`evaluator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 기존 평가 이전: 제출물 → 팀 역산. 개인 제출물(team_id 없음)은 스킵,
-- (세션, 팀, 평가자) 중복은 최신 1건만 유지
INSERT INTO `presentation_evaluations_new` (`id`, `session_id`, `team_id`, `submission_id`, `evaluator_id`, `star_score`, `comment`, `created_at`, `updated_at`)
SELECT e.`id`, e.`session_id`, s.`team_id`, e.`submission_id`, e.`evaluator_id`, e.`star_score`, e.`comment`, e.`created_at`, e.`updated_at`
FROM `presentation_evaluations` e
JOIN `submissions` s ON s.`id` = e.`submission_id`
WHERE s.`team_id` IS NOT NULL
  AND e.`id` = (
    SELECT e2.`id` FROM `presentation_evaluations` e2
    JOIN `submissions` s2 ON s2.`id` = e2.`submission_id`
    WHERE e2.`session_id` = e.`session_id` AND s2.`team_id` = s.`team_id` AND e2.`evaluator_id` = e.`evaluator_id`
    ORDER BY e2.`updated_at` DESC, e2.`id` LIMIT 1
  );
--> statement-breakpoint
DROP TABLE `presentation_evaluations`;
--> statement-breakpoint
ALTER TABLE `presentation_evaluations_new` RENAME TO `presentation_evaluations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_evaluations_session_team_evaluator_key` ON `presentation_evaluations` (`session_id`,`team_id`,`evaluator_id`);
--> statement-breakpoint
CREATE TABLE `presentation_member_evaluations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`team_id` text NOT NULL,
	`evaluator_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`star_score` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `presentation_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- 기존 팀원 평가 이전: 제출물 → 팀 역산 (중복은 최신 1건만)
INSERT INTO `presentation_member_evaluations_new` (`id`, `session_id`, `team_id`, `evaluator_id`, `target_user_id`, `star_score`, `created_at`, `updated_at`)
SELECT m.`id`, m.`session_id`, s.`team_id`, m.`evaluator_id`, m.`target_user_id`, m.`star_score`, m.`created_at`, m.`updated_at`
FROM `presentation_member_evaluations` m
JOIN `submissions` s ON s.`id` = m.`submission_id`
WHERE s.`team_id` IS NOT NULL
  AND m.`id` = (
    SELECT m2.`id` FROM `presentation_member_evaluations` m2
    JOIN `submissions` s2 ON s2.`id` = m2.`submission_id`
    WHERE m2.`session_id` = m.`session_id` AND s2.`team_id` = s.`team_id` AND m2.`evaluator_id` = m.`evaluator_id` AND m2.`target_user_id` = m.`target_user_id`
    ORDER BY m2.`updated_at` DESC, m2.`id` LIMIT 1
  );
--> statement-breakpoint
DROP TABLE `presentation_member_evaluations`;
--> statement-breakpoint
ALTER TABLE `presentation_member_evaluations_new` RENAME TO `presentation_member_evaluations`;
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_member_evaluations_key` ON `presentation_member_evaluations` (`session_id`,`team_id`,`evaluator_id`,`target_user_id`);
