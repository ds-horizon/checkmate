CREATE TABLE `resultCommands` (
	`resultCommandReceiptId` int AUTO_INCREMENT NOT NULL,
	`resultCommandId` varchar(36) NOT NULL,
	`testRunMapId` int NOT NULL,
	`requestFingerprint` varchar(64) NOT NULL,
	`resultRevisionId` int NOT NULL,
	`orgId` int NOT NULL,
	`projectId` int NOT NULL,
	`runId` int NOT NULL,
	`testId` int NOT NULL,
	`actorUserId` int NOT NULL,
	`outcome` json NOT NULL,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `resultCommands_resultCommandReceiptId` PRIMARY KEY(`resultCommandReceiptId`),
	CONSTRAINT `resultCommandAggregateUnique` UNIQUE(`testRunMapId`,`resultCommandId`),
	CONSTRAINT `resultCommandRevisionUnique` UNIQUE(`resultRevisionId`)
);
--> statement-breakpoint
CREATE TABLE `resultOutbox` (
	`resultOutboxId` int AUTO_INCREMENT NOT NULL,
	`eventKey` varchar(128) NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`aggregateType` varchar(32) NOT NULL,
	`aggregateId` int NOT NULL,
	`resultRevisionId` int NOT NULL,
	`payload` json NOT NULL,
	`deliveryState` enum('pending','leased','delivered','retry_due','failed','manual_attention') NOT NULL DEFAULT 'pending',
	`availableOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`leaseToken` varchar(64),
	`leaseExpiresOn` timestamp,
	`attemptCount` int NOT NULL DEFAULT 0,
	`lastError` text,
	`deliveredOn` timestamp,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `resultOutbox_resultOutboxId` PRIMARY KEY(`resultOutboxId`),
	CONSTRAINT `resultOutbox_eventKey_unique` UNIQUE(`eventKey`)
);
--> statement-breakpoint
CREATE TABLE `resultRevisions` (
	`resultRevisionId` int AUTO_INCREMENT NOT NULL,
	`testRunMapId` int NOT NULL,
	`revisionNumber` int NOT NULL,
	`resultCommandId` varchar(36) NOT NULL,
	`orgId` int NOT NULL,
	`projectId` int NOT NULL,
	`runId` int NOT NULL,
	`testId` int NOT NULL,
	`status` varchar(25) NOT NULL,
	`comment` text,
	`actorUserId` int NOT NULL,
	`actorType` enum('human','system') NOT NULL,
	`sourceSystem` varchar(32) NOT NULL,
	`sourceEventId` varchar(128) NOT NULL,
	`defectCycleId` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `resultRevisions_resultRevisionId` PRIMARY KEY(`resultRevisionId`),
	CONSTRAINT `resultRevisionNumberUnique` UNIQUE(`testRunMapId`,`revisionNumber`),
	CONSTRAINT `resultRevisionCommandUnique` UNIQUE(`testRunMapId`,`resultCommandId`)
);
--> statement-breakpoint
ALTER TABLE `testRunMap` ADD `currentResultRevisionId` int;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandMapFk` FOREIGN KEY (`testRunMapId`) REFERENCES `testRunMap`(`testRunMapId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandRevisionFk` FOREIGN KEY (`resultRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandOrgFk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandProjectFk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandRunFk` FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandTestFk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultCommands` ADD CONSTRAINT `resultCommandActorFk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultOutbox` ADD CONSTRAINT `resultOutboxRevisionFk` FOREIGN KEY (`resultRevisionId`) REFERENCES `resultRevisions`(`resultRevisionId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD CONSTRAINT `resultRevisionMapFk` FOREIGN KEY (`testRunMapId`) REFERENCES `testRunMap`(`testRunMapId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD CONSTRAINT `resultRevisionOrgFk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD CONSTRAINT `resultRevisionProjectFk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD CONSTRAINT `resultRevisionRunFk` FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD CONSTRAINT `resultRevisionTestFk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resultRevisions` ADD CONSTRAINT `resultRevisionActorFk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`userId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `resultCommandTenantIndex` ON `resultCommands` (`orgId`,`projectId`,`createdOn`);--> statement-breakpoint
CREATE INDEX `resultOutboxDeliveryIndex` ON `resultOutbox` (`deliveryState`,`availableOn`,`leaseExpiresOn`);--> statement-breakpoint
CREATE INDEX `resultOutboxAggregateIndex` ON `resultOutbox` (`aggregateType`,`aggregateId`,`createdOn`);--> statement-breakpoint
CREATE INDEX `resultRevisionRunIndex` ON `resultRevisions` (`runId`,`testRunMapId`);--> statement-breakpoint
CREATE INDEX `testRunMapCurrentResultRevisionIndex` ON `testRunMap` (`currentResultRevisionId`);