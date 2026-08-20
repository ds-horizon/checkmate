CREATE TABLE `defectCycles` (
	`defectCycleId` int AUTO_INCREMENT NOT NULL,
	`testRunMapId` int NOT NULL,
	`cycleNumber` int NOT NULL,
	`activeMarker` int,
	`orgId` int NOT NULL,
	`projectId` int NOT NULL,
	`runId` int NOT NULL,
	`testId` int NOT NULL,
	`state` enum('intake_pending','intake_open','work_item_open','ready_for_retest','validated','resolved_before_sync','intake_rejected','canceled','superseded','orphaned','manual_attention') NOT NULL,
	`openingRevisionId` int NOT NULL,
	`currentEvidenceRevisionId` int NOT NULL,
	`readinessGeneration` int NOT NULL DEFAULT 0,
	`provider` varchar(32),
	`providerWorkspaceId` varchar(64),
	`providerProjectId` varchar(64),
	`providerWorkItemId` varchar(64),
	`providerSequenceId` int,
	`providerUrl` varchar(500),
	`providerStateId` varchar(64),
	`lastProviderObservedOn` timestamp,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`closedOn` timestamp,
	CONSTRAINT `defectCycles_defectCycleId` PRIMARY KEY(`defectCycleId`),
	CONSTRAINT `defectCycleNumberUnique` UNIQUE(`testRunMapId`,`cycleNumber`),
	CONSTRAINT `defectCycleActiveUnique` UNIQUE(`testRunMapId`,`activeMarker`),
	CONSTRAINT `defectCycleProviderUnique` UNIQUE(`provider`,`providerWorkspaceId`,`providerProjectId`,`providerWorkItemId`)
);
--> statement-breakpoint
CREATE TABLE `integrationInbox` (
	`integrationInboxId` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(32) NOT NULL,
	`providerDeliveryId` varchar(128) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`eventFingerprint` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`signatureState` enum('verified','rejected','not_applicable') NOT NULL,
	`deliveryState` enum('pending','leased','retry_due','applied','no_op','rejected','manual_attention') NOT NULL DEFAULT 'pending',
	`availableOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`leaseToken` varchar(64),
	`leaseExpiresOn` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`receivedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`appliedOn` timestamp,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationInbox_integrationInboxId` PRIMARY KEY(`integrationInboxId`),
	CONSTRAINT `integrationInboxDeliveryUnique` UNIQUE(`provider`,`providerDeliveryId`)
);
--> statement-breakpoint
CREATE TABLE `integrationPollCursors` (
	`integrationPollCursorId` int AUTO_INCREMENT NOT NULL,
	`provider` varchar(32) NOT NULL,
	`destinationKey` varchar(128) NOT NULL,
	`cursorValue` varchar(500),
	`leaseToken` varchar(64),
	`leaseExpiresOn` timestamp,
	`lastPolledOn` timestamp,
	`lastError` text,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `integrationPollCursors_integrationPollCursorId` PRIMARY KEY(`integrationPollCursorId`),
	CONSTRAINT `integrationPollCursorUnique` UNIQUE(`provider`,`destinationKey`)
);
--> statement-breakpoint
CREATE TABLE `integrationReconciliations` (
	`integrationReconciliationId` int AUTO_INCREMENT NOT NULL,
	`findingKey` varchar(128) NOT NULL,
	`findingType` varchar(64) NOT NULL,
	`aggregateType` varchar(32) NOT NULL,
	`aggregateId` int NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL,
	`state` enum('open','manual_attention','resolved') NOT NULL DEFAULT 'open',
	`expectedSnapshot` json NOT NULL,
	`actualSnapshot` json NOT NULL,
	`assignedUserId` int,
	`firstDetectedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`lastDetectedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`resolvedOn` timestamp,
	`resolutionNote` text,
	CONSTRAINT `integrationReconciliations_integrationReconciliationId` PRIMARY KEY(`integrationReconciliationId`),
	CONSTRAINT `integrationReconciliations_findingKey_unique` UNIQUE(`findingKey`)
);
--> statement-breakpoint
CREATE TABLE `resultNotifications` (
	`resultNotificationId` int AUTO_INCREMENT NOT NULL,
	`notificationKey` varchar(128) NOT NULL,
	`defectCycleId` int,
	`resultRevisionId` int NOT NULL,
	`channel` varchar(32) NOT NULL,
	`recipientKey` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`deliveryState` enum('pending','leased','delivered','retry_due','manual_attention') NOT NULL DEFAULT 'pending',
	`leaseToken` varchar(64),
	`leaseExpiresOn` timestamp,
	`availableOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`attemptCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`providerMessageId` varchar(255),
	`deliveredOn` timestamp,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `resultNotifications_resultNotificationId` PRIMARY KEY(`resultNotificationId`),
	CONSTRAINT `resultNotifications_notificationKey_unique` UNIQUE(`notificationKey`)
);
--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleMapFk` FOREIGN KEY (`testRunMapId`) REFERENCES `testRunMap`(`testRunMapId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleOrgFk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleProjectFk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleRunFk` FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleTestFk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleOpeningRevisionFk` FOREIGN KEY (`openingRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleEvidenceRevisionFk` FOREIGN KEY (`currentEvidenceRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `integrationReconciliations` ADD CONSTRAINT `integrationReconciliationAssigneeFk` FOREIGN KEY (`assignedUserId`) REFERENCES `users`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultNotifications` ADD CONSTRAINT `resultNotificationCycleFk` FOREIGN KEY (`defectCycleId`) REFERENCES `defectCycles`(`defectCycleId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultNotifications` ADD CONSTRAINT `resultNotificationRevisionFk` FOREIGN KEY (`resultRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `defectCycleStateIndex` ON `defectCycles` (`state`,`updatedOn`);--> statement-breakpoint
CREATE INDEX `integrationInboxDeliveryIndex` ON `integrationInbox` (`deliveryState`,`availableOn`,`leaseExpiresOn`);--> statement-breakpoint
CREATE INDEX `integrationPollCursorLeaseIndex` ON `integrationPollCursors` (`leaseExpiresOn`);--> statement-breakpoint
CREATE INDEX `integrationReconciliationStateIndex` ON `integrationReconciliations` (`state`,`severity`,`lastDetectedOn`);--> statement-breakpoint
CREATE INDEX `integrationReconciliationAggregateIndex` ON `integrationReconciliations` (`aggregateType`,`aggregateId`,`state`);--> statement-breakpoint
CREATE INDEX `resultNotificationDeliveryIndex` ON `resultNotifications` (`deliveryState`,`availableOn`,`leaseExpiresOn`);