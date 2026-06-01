/**
 * Run Attachments DAO
 *
 * Data Access Object for run attachment operations.
 * Handles CRUD operations for attachments associated with test executions in runs.
 */

import {and, eq, inArray, asc} from 'drizzle-orm'
import {dbClient} from '../client'
import {
  runAttachments,
  RunAttachment,
  NewRunAttachment,
} from '@schema/attachments'
import {logger, LogType} from '~/utils/logger'
import {errorHandling} from './utils'

export interface ICreateRunAttachment {
  runId: number
  testId: number
  testRunMapId?: number
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

export interface IGetRunAttachments {
  runId: number
  testId: number
  projectId: number
}

export interface IDeleteRunAttachment {
  attachmentId: number
  projectId: number
}

export interface IUpdateRunAttachment {
  attachmentId: number
  description?: string
  displayOrder?: number
}

const RunAttachmentsDao = {
  /**
   * Create a new run attachment
   */
  async createAttachment(params: ICreateRunAttachment): Promise<{
    attachmentId: number
  }> {
    try {
      const result = await dbClient.insert(runAttachments).values({
        runId: params.runId,
        testId: params.testId,
        testRunMapId: params.testRunMapId,
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
        tag: 'RunAttachmentsDao',
        message: `Created attachment for run ${params.runId}, test ${params.testId}`,
      })

      return {attachmentId: result[0].insertId}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to create attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get all attachments for a test within a run
   */
  async getAttachments(params: IGetRunAttachments): Promise<RunAttachment[]> {
    try {
      const result = await dbClient
        .select()
        .from(runAttachments)
        .where(
          and(
            eq(runAttachments.runId, params.runId),
            eq(runAttachments.testId, params.testId),
            eq(runAttachments.projectId, params.projectId),
          ),
        )
        .orderBy(asc(runAttachments.displayOrder), asc(runAttachments.createdOn))

      return result
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to get attachments: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get a single attachment by ID
   */
  async getAttachmentById(attachmentId: number): Promise<RunAttachment | null> {
    try {
      const result = await dbClient
        .select()
        .from(runAttachments)
        .where(eq(runAttachments.attachmentId, attachmentId))
        .limit(1)

      return result[0] || null
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to get attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Delete an attachment
   */
  async deleteAttachment(params: IDeleteRunAttachment): Promise<{
    deleted: boolean
    storageKey: string | null
  }> {
    try {
      // First, get the attachment to retrieve the storage key
      const attachment = await dbClient
        .select({storageKey: runAttachments.storageKey})
        .from(runAttachments)
        .where(
          and(
            eq(runAttachments.attachmentId, params.attachmentId),
            eq(runAttachments.projectId, params.projectId),
          ),
        )
        .limit(1)

      if (!attachment[0]) {
        return {deleted: false, storageKey: null}
      }

      const storageKey = attachment[0].storageKey

      // Delete the record
      const result = await dbClient
        .delete(runAttachments)
        .where(
          and(
            eq(runAttachments.attachmentId, params.attachmentId),
            eq(runAttachments.projectId, params.projectId),
          ),
        )

      logger({
        type: LogType.INFO,
        tag: 'RunAttachmentsDao',
        message: `Deleted attachment ${params.attachmentId}`,
      })

      return {
        deleted: result[0].affectedRows > 0,
        storageKey,
      }
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to delete attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Update attachment metadata
   */
  async updateAttachment(params: IUpdateRunAttachment): Promise<{
    updated: boolean
  }> {
    try {
      const updateData: Partial<NewRunAttachment> = {}

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
        .update(runAttachments)
        .set(updateData)
        .where(eq(runAttachments.attachmentId, params.attachmentId))

      return {updated: result[0].affectedRows > 0}
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to update attachment: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Count attachments for a test within a run
   */
  async countAttachments(runId: number, testId: number): Promise<number> {
    try {
      const result = await dbClient
        .select()
        .from(runAttachments)
        .where(
          and(
            eq(runAttachments.runId, runId),
            eq(runAttachments.testId, testId),
          ),
        )

      return result.length
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to count attachments: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get all attachments for a run
   */
  async getAttachmentsForRun(runId: number): Promise<RunAttachment[]> {
    try {
      const result = await dbClient
        .select()
        .from(runAttachments)
        .where(eq(runAttachments.runId, runId))
        .orderBy(asc(runAttachments.testId), asc(runAttachments.displayOrder))

      return result
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to get attachments for run: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Delete all attachments for a run (used when deleting a run)
   * Returns all storage keys for cleanup
   */
  async deleteAllAttachmentsForRun(runId: number): Promise<string[]> {
    try {
      // Get all storage keys first
      const attachments = await dbClient
        .select({storageKey: runAttachments.storageKey})
        .from(runAttachments)
        .where(eq(runAttachments.runId, runId))

      const storageKeys = attachments.map((a) => a.storageKey)

      if (storageKeys.length > 0) {
        await dbClient
          .delete(runAttachments)
          .where(eq(runAttachments.runId, runId))
      }

      logger({
        type: LogType.INFO,
        tag: 'RunAttachmentsDao',
        message: `Deleted ${storageKeys.length} attachments for run ${runId}`,
      })

      return storageKeys
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to delete attachments for run: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },

  /**
   * Get attachments for multiple tests in a run (bulk fetch)
   */
  async getAttachmentsForTestsInRun(
    runId: number,
    testIds: number[],
  ): Promise<RunAttachment[]> {
    try {
      if (testIds.length === 0) {
        return []
      }

      const result = await dbClient
        .select()
        .from(runAttachments)
        .where(
          and(
            eq(runAttachments.runId, runId),
            inArray(runAttachments.testId, testIds),
          ),
        )
        .orderBy(asc(runAttachments.testId), asc(runAttachments.displayOrder))

      return result
    } catch (error: any) {
      logger({
        type: LogType.SQL_ERROR,
        tag: 'RunAttachmentsDao',
        message: `Failed to get attachments for tests in run: ${error.message}`,
      })
      errorHandling(error)
      throw error
    }
  },
}

export default RunAttachmentsDao

