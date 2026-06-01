/**
 * Test Attachments DAO
 *
 * Data Access Object for test attachment operations.
 * Handles CRUD operations for attachments associated with test definitions.
 */

import {and, eq, inArray, asc} from 'drizzle-orm'
import {dbClient} from '../client'
import {
  testAttachments,
  TestAttachment,
  NewTestAttachment,
} from '@schema/attachments'
import {logger, LogType} from '~/utils/logger'
import {errorHandling} from './utils'

export interface ICreateTestAttachment {
  testId: number
  projectId: number
  storageKey: string
  originalFilename: string
  mimeType: string
  fileSize: number
  mediaType: 'image' | 'video'
  description?: string
  displayOrder?: number
  createdBy: number
}

export interface IGetTestAttachments {
  testId: number
  projectId: number
}

export interface IDeleteTestAttachment {
  attachmentId: number
  projectId: number
}

export interface IUpdateTestAttachment {
  attachmentId: number
  description?: string
  displayOrder?: number
}

const TestAttachmentsDao = {
  /**
   * Create a new test attachment
   */
  async createAttachment(params: ICreateTestAttachment): Promise<{
    attachmentId: number
  }> {
    try {
      const result = await dbClient.insert(testAttachments).values({
        testId: params.testId,
        projectId: params.projectId,
        storageKey: params.storageKey,
        originalFilename: params.originalFilename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        mediaType: params.mediaType,
        description: params.description,
        displayOrder: params.displayOrder ?? 0,
        createdBy: params.createdBy,
      })

      logger({
        type: LogType.INFO,
        tag: 'TestAttachmentsDao',
        message: `Created attachment for test ${params.testId}`,
      })

      return {attachmentId: result[0].insertId}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to create attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get all attachments for a test
   */
  async getAttachments(
    params: IGetTestAttachments,
  ): Promise<TestAttachment[]> {
    try {
      const result = await dbClient
        .select()
        .from(testAttachments)
        .where(
          and(
            eq(testAttachments.testId, params.testId),
            eq(testAttachments.projectId, params.projectId),
          ),
        )
        .orderBy(asc(testAttachments.displayOrder), asc(testAttachments.createdOn))

      return result
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to get attachments: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get a single attachment by ID
   */
  async getAttachmentById(
    attachmentId: number,
  ): Promise<TestAttachment | null> {
    try {
      const result = await dbClient
        .select()
        .from(testAttachments)
        .where(eq(testAttachments.attachmentId, attachmentId))
        .limit(1)

      return result[0] || null
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to get attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Delete an attachment
   */
  async deleteAttachment(params: IDeleteTestAttachment): Promise<{
    deleted: boolean
    storageKey: string | null
  }> {
    try {
      // First, get the attachment to retrieve the storage key
      const attachment = await dbClient
        .select({storageKey: testAttachments.storageKey})
        .from(testAttachments)
        .where(
          and(
            eq(testAttachments.attachmentId, params.attachmentId),
            eq(testAttachments.projectId, params.projectId),
          ),
        )
        .limit(1)

      if (!attachment[0]) {
        return {deleted: false, storageKey: null}
      }

      const storageKey = attachment[0].storageKey

      // Delete the record
      const result = await dbClient
        .delete(testAttachments)
        .where(
          and(
            eq(testAttachments.attachmentId, params.attachmentId),
            eq(testAttachments.projectId, params.projectId),
          ),
        )

      logger({
        type: LogType.INFO,
        tag: 'TestAttachmentsDao',
        message: `Deleted attachment ${params.attachmentId}`,
      })

      return {
        deleted: result[0].affectedRows > 0,
        storageKey,
      }
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to delete attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Update attachment metadata
   */
  async updateAttachment(params: IUpdateTestAttachment): Promise<{
    updated: boolean
  }> {
    try {
      const updateData: Partial<NewTestAttachment> = {}

      if (params.description !== undefined) {
        updateData.description = params.description
      }
      if (params.displayOrder !== undefined) {
        updateData.displayOrder = params.displayOrder
      }

      if (Object.keys(updateData).length === 0) {
        return {updated: false}
      }

      const result = await dbClient
        .update(testAttachments)
        .set(updateData)
        .where(eq(testAttachments.attachmentId, params.attachmentId))

      return {updated: result[0].affectedRows > 0}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to update attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Count attachments for a test
   */
  async countAttachments(testId: number): Promise<number> {
    try {
      const result = await dbClient
        .select()
        .from(testAttachments)
        .where(eq(testAttachments.testId, testId))

      return result.length
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to count attachments: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get attachments for multiple tests (bulk fetch)
   */
  async getAttachmentsForTests(
    testIds: number[],
  ): Promise<TestAttachment[]> {
    try {
      if (testIds.length === 0) {
        return []
      }

      const result = await dbClient
        .select()
        .from(testAttachments)
        .where(inArray(testAttachments.testId, testIds))
        .orderBy(asc(testAttachments.testId), asc(testAttachments.displayOrder))

      return result
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to get attachments for tests: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Delete all attachments for a test (used when deleting a test)
   * Returns all storage keys for cleanup
   */
  async deleteAllAttachmentsForTest(testId: number): Promise<string[]> {
    try {
      // Get all storage keys first
      const attachments = await dbClient
        .select({storageKey: testAttachments.storageKey})
        .from(testAttachments)
        .where(eq(testAttachments.testId, testId))

      const storageKeys = attachments.map((a) => a.storageKey)

      if (storageKeys.length > 0) {
        await dbClient
          .delete(testAttachments)
          .where(eq(testAttachments.testId, testId))
      }

      logger({
        type: LogType.INFO,
        tag: 'TestAttachmentsDao',
        message: `Deleted ${storageKeys.length} attachments for test ${testId}`,
      })

      return storageKeys
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'TestAttachmentsDao',
        message: `Failed to delete attachments for test: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },
}

export default TestAttachmentsDao

