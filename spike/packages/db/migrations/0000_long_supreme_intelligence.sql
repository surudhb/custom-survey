CREATE TABLE `pings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`note` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
