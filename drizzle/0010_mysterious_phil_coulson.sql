ALTER TABLE `resultNotifications` ADD `readOn` timestamp;
--> statement-breakpoint
CREATE INDEX `resultNotificationRecipientIndex` ON `resultNotifications` (`recipientKey`,`readOn`,`createdOn`);
