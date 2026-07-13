CREATE TABLE `project_agents` (
	`owner_email` text NOT NULL,
	`project_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_id`, `agent_id`)
);
--> statement-breakpoint
CREATE INDEX `project_agents_owner_email_idx` ON `project_agents` (`owner_email`);--> statement-breakpoint
CREATE INDEX `project_agents_agent_id_idx` ON `project_agents` (`agent_id`);