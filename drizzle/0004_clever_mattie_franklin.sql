CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`auth_method` text NOT NULL,
	`client_secret_hash` text,
	`created_at` integer NOT NULL,
	`last_granted_at` integer
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`member_id` integer NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_expires_at` integer NOT NULL,
	`code_used_at` integer,
	`access_token_hash` text,
	`access_expires_at` integer,
	`refresh_token_hash` text,
	`previous_refresh_token_hash` text,
	`refresh_expires_at` integer,
	`connect_code_tag` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_code_hash_unique` ON `oauth_grants` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_access_token_hash_unique` ON `oauth_grants` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_grants_refresh_token_hash_unique` ON `oauth_grants` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_previous_refresh_token_hash_idx` ON `oauth_grants` (`previous_refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_grants_client_id_idx` ON `oauth_grants` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_member_id_idx` ON `oauth_grants` (`member_id`);