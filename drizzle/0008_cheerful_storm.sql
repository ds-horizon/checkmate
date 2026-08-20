CREATE TABLE `planeEvidenceDeliveries` (
	`planeEvidenceDeliveryId` int AUTO_INCREMENT NOT NULL,
	`defectCycleId` int NOT NULL,
	`resultRevisionId` int NOT NULL,
	`resultAttachmentObjectId` int,
	`sourceKind` enum('note','attachment') NOT NULL,
	`sourceIdentity` varchar(160) NOT NULL,
	`sourceText` text,
	`sourceObjectKey` varchar(500),
	`sourceSha256` varchar(64) NOT NULL,
	`sourceContentType` varchar(100),
	`sourceByteSize` int,
	`providerResourceName` varchar(255),
	`provider` varchar(32) NOT NULL,
	`providerWorkspaceId` varchar(64) NOT NULL,
	`providerProjectId` varchar(64) NOT NULL,
	`providerWorkItemId` varchar(64),
	`providerCommentId` varchar(64),
	`providerAssetId` varchar(128),
	`providerAttachmentId` varchar(128),
	`deliveryState` enum('pending','reserved','retry_due','delivered','manual_attention') NOT NULL DEFAULT 'pending',
	`leaseToken` varchar(64),
	`attemptCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`deliveredOn` timestamp,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `planeEvidenceDeliveries_planeEvidenceDeliveryId` PRIMARY KEY(`planeEvidenceDeliveryId`),
	CONSTRAINT `planeEvidenceSourceUnique` UNIQUE(`defectCycleId`,`sourceIdentity`),
	CONSTRAINT `planeEvidenceProviderCommentUnique` UNIQUE(`provider`,`providerWorkspaceId`,`providerProjectId`,`providerCommentId`),
	CONSTRAINT `planeEvidenceProviderAssetUnique` UNIQUE(`provider`,`providerWorkspaceId`,`providerProjectId`,`providerAssetId`)
);
--> statement-breakpoint
ALTER TABLE `planeEvidenceDeliveries` ADD CONSTRAINT `planeEvidenceCycleFk` FOREIGN KEY (`defectCycleId`) REFERENCES `defectCycles`(`defectCycleId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `planeEvidenceDeliveries` ADD CONSTRAINT `planeEvidenceRevisionFk` FOREIGN KEY (`resultRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `planeEvidenceDeliveries` ADD CONSTRAINT `planeEvidenceAttachmentObjectFk` FOREIGN KEY (`resultAttachmentObjectId`) REFERENCES `resultAttachmentObjects`(`resultAttachmentObjectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `planeEvidenceDeliveryIndex` ON `planeEvidenceDeliveries` (`deliveryState`,`updatedOn`);--> statement-breakpoint
CREATE INDEX `planeEvidenceCycleIndex` ON `planeEvidenceDeliveries` (`defectCycleId`,`resultRevisionId`);