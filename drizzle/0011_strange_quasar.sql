ALTER TABLE `defectCycles` ADD `reopenState` enum('pending','delivered','observed','manual_attention');--> statement-breakpoint
ALTER TABLE `defectCycles` ADD `reopenRevisionId` int;--> statement-breakpoint
ALTER TABLE `resultNotifications` ADD `invalidatedOn` timestamp;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD `retestIssue` enum('same_issue','different_issue');--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleReopenRevisionFk` FOREIGN KEY (`reopenRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `defectCycleReopenIndex` ON `defectCycles` (`reopenState`,`updatedOn`);
