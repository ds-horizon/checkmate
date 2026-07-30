CREATE TABLE `labelTestMap` (
	`labelId` int NOT NULL,
	`testId` int NOT NULL,
	`createdOn` timestamp DEFAULT CURRENT_TIMESTAMP,
	`createdBy` int,
	`projectId` int NOT NULL,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	CONSTRAINT `labelToTest` UNIQUE(`labelId`,`testId`)
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`labelId` int AUTO_INCREMENT NOT NULL,
	`labelName` varchar(100) NOT NULL,
	`labelType` enum('System','Custom'),
	`createdOn` timestamp DEFAULT CURRENT_TIMESTAMP,
	`createdBy` int,
	`editHistory` json DEFAULT ('[]'),
	`projectId` int NOT NULL,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	CONSTRAINT `labels_labelId` PRIMARY KEY(`labelId`),
	CONSTRAINT `labelProjectunique` UNIQUE(`labelName`,`projectId`)
);
--> statement-breakpoint
CREATE TABLE `organisations` (
	`orgId` int AUTO_INCREMENT NOT NULL,
	`orgName` varchar(20) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `organisations_orgId` PRIMARY KEY(`orgId`),
	CONSTRAINT `organisations_orgName_unique` UNIQUE(`orgName`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`projectId` int AUTO_INCREMENT NOT NULL,
	`projectName` varchar(50) NOT NULL,
	`projectDescription` varchar(255),
	`createdBy` int,
	`createdOn` timestamp DEFAULT CURRENT_TIMESTAMP,
	`orgId` int NOT NULL,
	`testsCount` int DEFAULT 0,
	`runsCount` int DEFAULT 0,
	`status` enum('Active','Archived','Deleted') NOT NULL DEFAULT 'Active',
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	CONSTRAINT `projects_projectId` PRIMARY KEY(`projectId`),
	CONSTRAINT `projectOrgUniqueIndex` UNIQUE(`projectName`,`orgId`)
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`runId` int AUTO_INCREMENT NOT NULL,
	`projectId` int NOT NULL,
	`status` enum('Active','Locked','Archived','Deleted'),
	`runDescription` varchar(255),
	`refrence` varchar(255),
	`createdBy` int,
	`createdOn` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	`runName` varchar(50) NOT NULL,
	`lockedBy` int,
	`lockedOn` timestamp,
	CONSTRAINT `runs_runId` PRIMARY KEY(`runId`)
);
--> statement-breakpoint
CREATE TABLE `testRunMap` (
	`testRunMapId` int AUTO_INCREMENT NOT NULL,
	`runId` int,
	`testId` int,
	`projectId` int NOT NULL,
	`isIncluded` boolean DEFAULT true,
	`status` varchar(25) NOT NULL DEFAULT 'Untested',
	`statusUpdates` json,
	`updatedBy` int,
	`createdOn` timestamp DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`comment` varchar(200),
	CONSTRAINT `testRunMap_testRunMapId` PRIMARY KEY(`testRunMapId`)
);
--> statement-breakpoint
CREATE TABLE `testRunsStatusHistory` (
	`testRunsStatusHistoryId` int AUTO_INCREMENT NOT NULL,
	`runId` int,
	`testId` int,
	`status` varchar(25) NOT NULL,
	`updatedBy` int,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`comment` text,
	`totalTestCase` int DEFAULT 0,
	`passedTestCase` int DEFAULT 0,
	`failedTestCase` int DEFAULT 0,
	`untestedTestCase` int DEFAULT 0,
	CONSTRAINT `testRunsStatusHistory_testRunsStatusHistoryId` PRIMARY KEY(`testRunsStatusHistoryId`)
);
--> statement-breakpoint
CREATE TABLE `squads` (
	`squadId` int AUTO_INCREMENT NOT NULL,
	`squadName` varchar(100) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`projectId` int NOT NULL,
	`editInfo` json DEFAULT ('[]'),
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	CONSTRAINT `squads_squadId` PRIMARY KEY(`squadId`),
	CONSTRAINT `squadNameUnique` UNIQUE(`squadName`,`projectId`)
);
--> statement-breakpoint
CREATE TABLE `automationStatus` (
	`automationStatusId` int AUTO_INCREMENT NOT NULL,
	`automationStatusName` varchar(30) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`orgId` int NOT NULL,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	`projectId` int,
	CONSTRAINT `automationStatus_automationStatusId` PRIMARY KEY(`automationStatusId`)
);
--> statement-breakpoint
CREATE TABLE `platform` (
	`platformId` int AUTO_INCREMENT NOT NULL,
	`platformName` varchar(30) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	`orgId` int NOT NULL,
	`projectId` int,
	CONSTRAINT `platform_platformId` PRIMARY KEY(`platformId`)
);
--> statement-breakpoint
CREATE TABLE `priority` (
	`priorityId` int AUTO_INCREMENT NOT NULL,
	`priorityName` varchar(30) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	`orgId` int NOT NULL,
	CONSTRAINT `priority_priorityId` PRIMARY KEY(`priorityId`)
);
--> statement-breakpoint
CREATE TABLE `sections` (
	`sectionId` int AUTO_INCREMENT NOT NULL,
	`sectionName` varchar(250) NOT NULL,
	`sectionDescription` text,
	`parentId` int,
	`editHistory` json DEFAULT ('[]'),
	`projectId` int NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	CONSTRAINT `sections_sectionId` PRIMARY KEY(`sectionId`),
	CONSTRAINT `sectionHierarchyUnique` UNIQUE(`parentId`,`sectionName`,`projectId`)
);
--> statement-breakpoint
CREATE TABLE `testCoveredBy` (
	`testCoveredById` int AUTO_INCREMENT NOT NULL,
	`testCoveredByName` varchar(30) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`updatedBy` int,
	`orgId` int NOT NULL,
	`projectId` int,
	CONSTRAINT `testCoveredBy_testCoveredById` PRIMARY KEY(`testCoveredById`)
);
--> statement-breakpoint
CREATE TABLE `tests` (
	`testId` int AUTO_INCREMENT NOT NULL,
	`sectionId` int,
	`projectId` int NOT NULL,
	`title` varchar(750) NOT NULL,
	`squadId` int,
	`priorityId` int,
	`typeId` int,
	`automationStatusId` int,
	`testCoveredById` int,
	`preConditions` text,
	`steps` text,
	`expectedResult` text,
	`assignedTo` int,
	`createdBy` int,
	`updatedBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`testStatusHistory` json,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`editInfo` json DEFAULT ('[]'),
	`platformId` int,
	`createdByName` varchar(100),
	`jiraTicket` varchar(100),
	`defects` varchar(100),
	`attachments` varchar(100),
	`status` enum('Active','Archived','Deleted') NOT NULL DEFAULT 'Active',
	`reference` text,
	`additionalGroups` text,
	`automationId` varchar(100),
	`description` text,
	`custom1` text,
	`custom2` text,
	`custom3` text,
	`custom4` text,
	CONSTRAINT `tests_testId` PRIMARY KEY(`testId`)
);
--> statement-breakpoint
CREATE TABLE `type` (
	`typeId` int AUTO_INCREMENT NOT NULL,
	`typeName` varchar(30) NOT NULL,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	`orgId` int NOT NULL,
	`projectId` int,
	CONSTRAINT `type_typeId` PRIMARY KEY(`typeId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`userId` int AUTO_INCREMENT NOT NULL,
	`userName` varchar(100) NOT NULL,
	`email` varchar(100) NOT NULL,
	`ssoId` varchar(200),
	`profileUrl` text,
	`role` enum('admin','user','reader') NOT NULL DEFAULT 'user',
	`token` varchar(500),
	`updatedBy` int,
	`status` enum('active','archive','delete') DEFAULT 'active',
	CONSTRAINT `users_userId` PRIMARY KEY(`userId`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`),
	CONSTRAINT `users_ssoId_unique` UNIQUE(`ssoId`),
	CONSTRAINT `users_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
ALTER TABLE `labelTestMap` ADD CONSTRAINT `labelTestMap_labelId_labels_labelId_fk` FOREIGN KEY (`labelId`) REFERENCES `labels`(`labelId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labelTestMap` ADD CONSTRAINT `labelTestMap_testId_tests_testId_fk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labelTestMap` ADD CONSTRAINT `labelTestMap_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labelTestMap` ADD CONSTRAINT `labelTestMap_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labelTestMap` ADD CONSTRAINT `labelTestMap_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labels` ADD CONSTRAINT `labels_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labels` ADD CONSTRAINT `labels_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `labels` ADD CONSTRAINT `labels_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `organisations` ADD CONSTRAINT `organisations_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_orgId_organisations_orgId_fk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runs` ADD CONSTRAINT `runs_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runs` ADD CONSTRAINT `runs_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runs` ADD CONSTRAINT `runs_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `runs` ADD CONSTRAINT `runs_lockedBy_users_userId_fk` FOREIGN KEY (`lockedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunMap` ADD CONSTRAINT `testRunMap_runId_runs_runId_fk` FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunMap` ADD CONSTRAINT `testRunMap_testId_tests_testId_fk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunMap` ADD CONSTRAINT `testRunMap_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunMap` ADD CONSTRAINT `testRunMap_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunsStatusHistory` ADD CONSTRAINT `testRunsStatusHistory_runId_runs_runId_fk` FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunsStatusHistory` ADD CONSTRAINT `testRunsStatusHistory_testId_tests_testId_fk` FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testRunsStatusHistory` ADD CONSTRAINT `testRunsStatusHistory_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `squads` ADD CONSTRAINT `squads_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `squads` ADD CONSTRAINT `squads_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `squads` ADD CONSTRAINT `squads_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationStatus` ADD CONSTRAINT `automationStatus_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationStatus` ADD CONSTRAINT `automationStatus_orgId_organisations_orgId_fk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationStatus` ADD CONSTRAINT `automationStatus_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `automationStatus` ADD CONSTRAINT `automationStatus_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform` ADD CONSTRAINT `platform_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform` ADD CONSTRAINT `platform_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform` ADD CONSTRAINT `platform_orgId_organisations_orgId_fk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `platform` ADD CONSTRAINT `platform_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `priority` ADD CONSTRAINT `priority_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `priority` ADD CONSTRAINT `priority_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `priority` ADD CONSTRAINT `priority_orgId_organisations_orgId_fk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sections` ADD CONSTRAINT `sections_parentId_sections_sectionId_fk` FOREIGN KEY (`parentId`) REFERENCES `sections`(`sectionId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sections` ADD CONSTRAINT `sections_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sections` ADD CONSTRAINT `sections_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sections` ADD CONSTRAINT `sections_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testCoveredBy` ADD CONSTRAINT `testCoveredBy_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testCoveredBy` ADD CONSTRAINT `testCoveredBy_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testCoveredBy` ADD CONSTRAINT `testCoveredBy_orgId_organisations_orgId_fk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `testCoveredBy` ADD CONSTRAINT `testCoveredBy_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_sectionId_sections_sectionId_fk` FOREIGN KEY (`sectionId`) REFERENCES `sections`(`sectionId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_squadId_squads_squadId_fk` FOREIGN KEY (`squadId`) REFERENCES `squads`(`squadId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_priorityId_priority_priorityId_fk` FOREIGN KEY (`priorityId`) REFERENCES `priority`(`priorityId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_typeId_type_typeId_fk` FOREIGN KEY (`typeId`) REFERENCES `type`(`typeId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_automationStatusId_automationStatus_automationStatusId_fk` FOREIGN KEY (`automationStatusId`) REFERENCES `automationStatus`(`automationStatusId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_testCoveredById_testCoveredBy_testCoveredById_fk` FOREIGN KEY (`testCoveredById`) REFERENCES `testCoveredBy`(`testCoveredById`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_assignedTo_users_userId_fk` FOREIGN KEY (`assignedTo`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_updatedBy_users_userId_fk` FOREIGN KEY (`updatedBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tests` ADD CONSTRAINT `tests_platformId_platform_platformId_fk` FOREIGN KEY (`platformId`) REFERENCES `platform`(`platformId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `type` ADD CONSTRAINT `type_createdBy_users_userId_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `type` ADD CONSTRAINT `type_orgId_organisations_orgId_fk` FOREIGN KEY (`orgId`) REFERENCES `organisations`(`orgId`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `type` ADD CONSTRAINT `type_projectId_projects_projectId_fk` FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `labelTestMapLabelIdIndex` ON `labelTestMap` (`labelId`);--> statement-breakpoint
CREATE INDEX `projectsNameIndex` ON `projects` (`projectName`);--> statement-breakpoint
CREATE INDEX `projectsProjectIdIndex` ON `projects` (`projectId`);--> statement-breakpoint
CREATE INDEX `runProjectIndex` ON `runs` (`projectId`,`status`);--> statement-breakpoint
CREATE INDEX `testRunMapRunIdIndex` ON `testRunMap` (`runId`);--> statement-breakpoint
CREATE INDEX `testRunMapStatusIndex` ON `testRunMap` (`status`);--> statement-breakpoint
CREATE INDEX `testRunsStatusHistoryRunIdIndex` ON `testRunsStatusHistory` (`runId`,`testId`);--> statement-breakpoint
CREATE INDEX `squadsSquadNameIndex` ON `squads` (`squadName`);--> statement-breakpoint
CREATE INDEX `squadsProjectIdIndex` ON `squads` (`projectId`);--> statement-breakpoint
CREATE INDEX `automationStatusNameIndex` ON `automationStatus` (`automationStatusName`);--> statement-breakpoint
CREATE INDEX `platformNameIndex` ON `platform` (`platformName`);--> statement-breakpoint
CREATE INDEX `priorityNameIndex` ON `priority` (`priorityName`);--> statement-breakpoint
CREATE INDEX `sectionNameIndex` ON `sections` (`sectionName`);--> statement-breakpoint
CREATE INDEX `testCoveredByNameIndex` ON `testCoveredBy` (`testCoveredByName`);--> statement-breakpoint
CREATE INDEX `projectSquadIndex` ON `tests` (`projectId`,`squadId`);--> statement-breakpoint
CREATE INDEX `statusIndex` ON `tests` (`status`);--> statement-breakpoint
CREATE INDEX `titleIndex` ON `tests` (`title`);--> statement-breakpoint
CREATE INDEX `typeNameIndex` ON `type` (`typeName`);