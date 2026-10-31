DROP INDEX `members_name_lower_unique`;--> statement-breakpoint
ALTER TABLE `members` ADD `name_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Backfill before the unique index so existing rows don't all collide on ''.
UPDATE `members` SET `name_key` = lower(`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_name_key_unique` ON `members` (`name_key`);