-- Manual Migration: Add attachment tables for media uploads
-- Run this SQL directly if drizzle migration fails
-- Execute with: mysql -u root -p checkmate < sql/add_attachments_tables.sql

-- Check if tables already exist and skip if they do
-- Create testAttachments table
CREATE TABLE IF NOT EXISTS `testAttachments` (
	`attachmentId` int AUTO_INCREMENT NOT NULL,
	`testId` int NOT NULL,
	`projectId` int NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`originalFilename` varchar(255) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`fileSize` int NOT NULL,
	`mediaType` enum('image','video') NOT NULL,
	`description` text,
	`displayOrder` int DEFAULT 0,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `testAttachments_attachmentId` PRIMARY KEY(`attachmentId`)
);

-- Create runAttachments table
CREATE TABLE IF NOT EXISTS `runAttachments` (
	`attachmentId` int AUTO_INCREMENT NOT NULL,
	`runId` int NOT NULL,
	`testId` int NOT NULL,
	`testRunMapId` int,
	`projectId` int NOT NULL,
	`storageKey` varchar(500) NOT NULL,
	`originalFilename` varchar(255) NOT NULL,
	`mimeType` varchar(100) NOT NULL,
	`fileSize` int NOT NULL,
	`mediaType` enum('image','video') NOT NULL,
	`description` text,
	`displayOrder` int DEFAULT 0,
	`createdBy` int,
	`createdOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedOn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `runAttachments_attachmentId` PRIMARY KEY(`attachmentId`)
);

-- Add foreign keys for testAttachments (ignore errors if already exist)
ALTER TABLE `testAttachments` 
ADD CONSTRAINT `testAttachments_testId_tests_testId_fk` 
FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `testAttachments` 
ADD CONSTRAINT `testAttachments_projectId_projects_projectId_fk` 
FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `testAttachments` 
ADD CONSTRAINT `testAttachments_createdBy_users_userId_fk` 
FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;

-- Add foreign keys for runAttachments
ALTER TABLE `runAttachments` 
ADD CONSTRAINT `runAttachments_runId_runs_runId_fk` 
FOREIGN KEY (`runId`) REFERENCES `runs`(`runId`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `runAttachments` 
ADD CONSTRAINT `runAttachments_testId_tests_testId_fk` 
FOREIGN KEY (`testId`) REFERENCES `tests`(`testId`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `runAttachments` 
ADD CONSTRAINT `runAttachments_testRunMapId_testRunMap_testRunMapId_fk` 
FOREIGN KEY (`testRunMapId`) REFERENCES `testRunMap`(`testRunMapId`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `runAttachments` 
ADD CONSTRAINT `runAttachments_projectId_projects_projectId_fk` 
FOREIGN KEY (`projectId`) REFERENCES `projects`(`projectId`) ON DELETE cascade ON UPDATE no action;

ALTER TABLE `runAttachments` 
ADD CONSTRAINT `runAttachments_createdBy_users_userId_fk` 
FOREIGN KEY (`createdBy`) REFERENCES `users`(`userId`) ON DELETE set null ON UPDATE no action;

-- Add indexes
CREATE INDEX `testAttachmentsTestIdIndex` ON `testAttachments` (`testId`);
CREATE INDEX `testAttachmentsProjectIdIndex` ON `testAttachments` (`projectId`);
CREATE INDEX `runAttachmentsRunTestIndex` ON `runAttachments` (`runId`,`testId`);
CREATE INDEX `runAttachmentsProjectIdIndex` ON `runAttachments` (`projectId`);

SELECT 'Attachment tables created successfully!' as status;

