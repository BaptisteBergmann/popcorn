CREATE TABLE `titles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`type` text NOT NULL,
	`imdb_id` text,
	`title` text NOT NULL,
	`year` integer,
	`poster_path` text,
	`overview` text,
	`genres` text DEFAULT '[]' NOT NULL,
	`runtime` integer,
	`added_by` text,
	`status` text DEFAULT 'to_watch' NOT NULL,
	`added_at` integer NOT NULL,
	`watched_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `titles_tmdb_id_type_unique` ON `titles` (`tmdb_id`,`type`);