CREATE TABLE `resultRevisionAttachments` (
	`resultRevisionAttachmentId` int AUTO_INCREMENT NOT NULL,
	`resultRevisionId` int NOT NULL,
	`objectKey` varchar(500) NOT NULL,
	`lifecycleState` enum('active','deleted') NOT NULL DEFAULT 'active',
	`retentionPolicy` varchar(32) NOT NULL DEFAULT 'source_owned',
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`deletedOn` timestamp,
	CONSTRAINT `resultRevisionAttachments_resultRevisionAttachmentId` PRIMARY KEY(`resultRevisionAttachmentId`),
	CONSTRAINT `resultRevisionAttachmentUnique` UNIQUE(`resultRevisionId`,`objectKey`)
);
--> statement-breakpoint
ALTER TABLE `resultRevisionAttachments` ADD CONSTRAINT `resultRevisionAttachmentRevisionFk` FOREIGN KEY (`resultRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `resultRevisionAttachmentObjectIndex` ON `resultRevisionAttachments` (`objectKey`,`lifecycleState`);