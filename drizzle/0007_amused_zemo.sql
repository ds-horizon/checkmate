ALTER TABLE `defectCycles` ADD `providerIntakeId` varchar(64);--> statement-breakpoint
ALTER TABLE `defectCycles` ADD `createCorrelationKey` varchar(64);--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleIntakeUnique` UNIQUE(`provider`,`providerWorkspaceId`,`providerProjectId`,`providerIntakeId`);--> statement-breakpoint
ALTER TABLE `defectCycles` ADD CONSTRAINT `defectCycleCorrelationUnique` UNIQUE(`createCorrelationKey`);
