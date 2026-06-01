/**
 * Attachments Schema
 *
 * Database schema for test and run attachments.
 * Supports two types of attachments:
 * 1. Test Attachments - Expected behavior media attached to test definitions
 * 2. Run Attachments - Actual behavior media attached during test execution
 */

import {sql} from 'drizzle-orm'
import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
  text,
} from 'drizzle-orm/mysql-core'
import {projects} from './projects'
import {tests} from './tests'
import {runs, testRunMap} from './runs'
import {users} from './users'

/**
 * Test Attachments Table
 *
 * Stores attachments that represent expected behavior for test cases.
 * These attachments are visible in all runs that include the test.
 */
export const testAttachments = mysqlTable(
  'testAttachments',
  {
    attachmentId: int('attachmentId').primaryKey().autoincrement(),
    testId: int('testId')
      .references(() => tests.testId, {onDelete: 'cascade'})
      .notNull(),
    projectId: int('projectId')
      .references(() => projects.projectId, {onDelete: 'cascade'})
      .notNull(),

    // File metadata
    storageKey: varchar('storageKey', {length: 500}).notNull(),
    originalFilename: varchar('originalFilename', {length: 255}).notNull(),
    mimeType: varchar('mimeType', {length: 100}).notNull(),
    fileSize: int('fileSize').notNull(), // Size in bytes
    mediaType: mysqlEnum('mediaType', ['image', 'video']).notNull(),

    // Optional metadata
    description: text('description'),
    displayOrder: int('displayOrder').default(0),

    // Audit fields
    createdBy: int('createdBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    createdOn: timestamp('createdOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedOn: timestamp('updatedOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => {
    return {
      testAttachmentsTestIdIndex: index('testAttachmentsTestIdIndex').on(
        table.testId,
      ),
      testAttachmentsProjectIdIndex: index('testAttachmentsProjectIdIndex').on(
        table.projectId,
      ),
    }
  },
)

/**
 * Run Attachments Table
 *
 * Stores attachments that represent actual behavior observed during test execution.
 * These attachments are specific to a test within a particular run.
 */
export const runAttachments = mysqlTable(
  'runAttachments',
  {
    attachmentId: int('attachmentId').primaryKey().autoincrement(),
    runId: int('runId')
      .references(() => runs.runId, {onDelete: 'cascade'})
      .notNull(),
    testId: int('testId')
      .references(() => tests.testId, {onDelete: 'cascade'})
      .notNull(),
    testRunMapId: int('testRunMapId').references(
      () => testRunMap.testRunMapId,
      {onDelete: 'cascade'},
    ),
    projectId: int('projectId')
      .references(() => projects.projectId, {onDelete: 'cascade'})
      .notNull(),

    // File metadata
    storageKey: varchar('storageKey', {length: 500}).notNull(),
    originalFilename: varchar('originalFilename', {length: 255}).notNull(),
    mimeType: varchar('mimeType', {length: 100}).notNull(),
    fileSize: int('fileSize').notNull(), // Size in bytes
    mediaType: mysqlEnum('mediaType', ['image', 'video']).notNull(),

    // Optional metadata
    description: text('description'),
    displayOrder: int('displayOrder').default(0),

    // Audit fields
    createdBy: int('createdBy').references(() => users.userId, {
      onDelete: 'set null',
    }),
    createdOn: timestamp('createdOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedOn: timestamp('updatedOn')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => {
    return {
      runAttachmentsRunTestIndex: index('runAttachmentsRunTestIndex').on(
        table.runId,
        table.testId,
      ),
      runAttachmentsProjectIdIndex: index('runAttachmentsProjectIdIndex').on(
        table.projectId,
      ),
    }
  },
)

// Type exports for use in DAOs and controllers
export type TestAttachment = typeof testAttachments.$inferSelect
export type NewTestAttachment = typeof testAttachments.$inferInsert
export type RunAttachment = typeof runAttachments.$inferSelect
export type NewRunAttachment = typeof runAttachments.$inferInsert

