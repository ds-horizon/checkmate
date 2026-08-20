CREATE TABLE `resultAttachmentObjects` (
	`resultAttachmentObjectId` int AUTO_INCREMENT NOT NULL,
	`objectKey` varchar(500) NOT NULL,
	`testRunMapId` int NOT NULL,
	`orgId` int NOT NULL,
	`projectId` int NOT NULL,
	`runId` int NOT NULL,
	`testId` int NOT NULL,
	`uploaderUserId` int NOT NULL,
	`contentType` varchar(100) NOT NULL,
	`byteSize` int NOT NULL,
	`sha256` varchar(64) NOT NULL,
	`lifecycleState` enum('pending_upload','uploaded','committed','delete_pending','deleted','failed') NOT NULL DEFAULT 'pending_upload',
	`retentionPolicy` varchar(32) NOT NULL DEFAULT 'source_owned',
	`lastError` text,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`uploadedOn` timestamp,
	`deletedOn` timestamp,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `resultAttachmentObjects_resultAttachmentObjectId` PRIMARY KEY(`resultAttachmentObjectId`),
	CONSTRAINT `resultAttachmentObjectKeyUnique` UNIQUE(`objectKey`)
);
--> statement-breakpoint
ALTER TABLE `resultRevisionAttachments` ADD `resultAttachmentObjectId` int;--> statement-breakpoint
ALTER TABLE `resultAttachmentObjects` ADD CONSTRAINT `resultAttachmentObjectMapFk` FOREIGN KEY (`testRunMapId`) REFERENCES `testRunMap`(`testRunMapId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultAttachmentObjects` ADD CONSTRAINT `resultAttachmentObjectOrgFk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultAttachmentObjects` ADD CONSTRAINT `resultAttachmentObjectProjectFk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultAttachmentObjects` ADD CONSTRAINT `resultAttachmentObjectRunFk` FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultAttachmentObjects` ADD CONSTRAINT `resultAttachmentObjectTestFk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultAttachmentObjects` ADD CONSTRAINT `resultAttachmentObjectUploaderFk` FOREIGN KEY (`uploaderUserId`) REFERENCES `users`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `resultAttachmentObjectScopeIndex` ON `resultAttachmentObjects` (`testRunMapId`,`lifecycleState`,`createdOn`);--> statement-breakpoint
ALTER TABLE `resultRevisionAttachments` ADD CONSTRAINT `resultRevisionAttachmentObjectFk` FOREIGN KEY (`resultAttachmentObjectId`) REFERENCES `resultAttachmentObjects`(`resultAttachmentObjectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `resultRevisionAttachmentObjectIdIndex` ON `resultRevisionAttachments` (`resultAttachmentObjectId`);