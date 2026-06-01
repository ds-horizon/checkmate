/**
 * Attachments Controller
 *
 * Business logic layer for handling test and run attachments.
 * Orchestrates storage operations and database operations.
 */

import TestAttachmentsDao from '~/db/dao/testAttachments.dao'
import RunAttachmentsDao from '~/db/dao/runAttachments.dao'
import {
  getStorageProvider,
  getMediaTypeFromMime,
  isValidFileSize,
  isSupportedMediaType,
  generateStorageKey,
  AttachmentType,
  MediaType,
  MAX_ATTACHMENTS,
  FILE_SIZE_LIMITS,
} from '~/services/storage'
import {logger, LogType} from '~/utils/logger'
import {ErrorCause} from '~/constants'

// Types
export interface IUploadTestAttachment {
  testId: number
  projectId: number
  file: Buffer
  filename: string
  mimeType: string
  fileSize: number
  description?: string
  createdBy: number
}

export interface IUploadRunAttachment {
  runId: number
  testId: number
  testRunMapId?: number
  projectId: number
  file: Buffer
  filename: string
  mimeType: string
  fileSize: number
  description?: string
  createdBy: number
}

export interface IGetPresignedUploadUrl {
  testId: number
  projectId: number
  runId?: number
  filename: string
  mimeType: string
  fileSize: number
  attachmentType: AttachmentType
}

export interface IConfirmUpload {
  testId: number
  projectId: number
  runId?: number
  storageKey: string
  filename: string
  mimeType: string
  fileSize: number
  description?: string
  createdBy: number
  attachmentType: AttachmentType
  testRunMapId?: number
}

export interface IDeleteAttachment {
  attachmentId: number
  projectId: number
  attachmentType: AttachmentType
}

export interface IGetAttachments {
  testId: number
  projectId: number
  runId?: number
}

export interface AttachmentResponse {
  attachmentId: number
  testId: number
  projectId: number
  runId?: number
  storageKey: string
  originalFilename: string
  mimeType: string
  fileSize: number
  mediaType: 'image' | 'video'
  description: string | null
  displayOrder: number | null
  url: string
  createdOn: Date
}

const AttachmentsController = {
  /**
   * Validate file for upload
   */
  validateFile(mimeType: string, fileSize: number): void {
    if (!isSupportedMediaType(mimeType)) {
      throw new Error(
        `Unsupported file type: ${mimeType}. Supported types: images (PNG, JPEG, GIF, WebP) and videos (MP4, WebM, MOV)`,
        {cause: ErrorCause.INVALID_PARAMS},
      )
    }

    const mediaType = getMediaTypeFromMime(mimeType)
    if (!mediaType) {
      throw new Error(`Could not determine media type for: ${mimeType}`, {
        cause: ErrorCause.INVALID_PARAMS,
      })
    }

    if (!isValidFileSize(fileSize, mediaType)) {
      const maxSize =
        mediaType === MediaType.IMAGE
          ? `${FILE_SIZE_LIMITS.IMAGE / (1024 * 1024)}MB`
          : `${FILE_SIZE_LIMITS.VIDEO / (1024 * 1024)}MB`
      throw new Error(`File size exceeds limit. Maximum size for ${mediaType}: ${maxSize}`, {
        cause: ErrorCause.INVALID_PARAMS,
      })
    }
  },

  /**
   * Upload a test attachment (expected behavior)
   */
  async uploadTestAttachment(params: IUploadTestAttachment): Promise<AttachmentResponse> {
    // Validate file
    this.validateFile(params.mimeType, params.fileSize)

    // Check attachment count limit
    const currentCount = await TestAttachmentsDao.countAttachments(params.testId)
    if (currentCount >= MAX_ATTACHMENTS.PER_TEST) {
      throw new Error(
        `Maximum attachments (${MAX_ATTACHMENTS.PER_TEST}) reached for this test`,
        {cause: ErrorCause.INVALID_PARAMS},
      )
    }

    const storage = await getStorageProvider()
    const mediaType = getMediaTypeFromMime(params.mimeType)!

    // Generate storage key
    const storageKey = generateStorageKey({
      projectId: params.projectId,
      testId: params.testId,
      filename: params.filename,
      attachmentType: AttachmentType.EXPECTED,
    })

    try {
      // Upload to storage
      await storage.upload(params.file, storageKey, {
        contentType: params.mimeType,
        originalFilename: params.filename,
        size: params.fileSize,
      })

      // Create database record
      const {attachmentId} = await TestAttachmentsDao.createAttachment({
        testId: params.testId,
        projectId: params.projectId,
        storageKey,
        originalFilename: params.filename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        mediaType,
        description: params.description,
        createdBy: params.createdBy,
      })

      // Get the created attachment
      const attachment = await TestAttachmentsDao.getAttachmentById(attachmentId)
      if (!attachment) {
        throw new Error('Failed to retrieve created attachment')
      }

      // Generate URL
      const url = await storage.getSignedUrl(storageKey)

      logger({
        type: LogType.INFO,
        tag: 'AttachmentsController',
        message: `Uploaded test attachment ${attachmentId} for test ${params.testId}`,
      })

      return {
        attachmentId: attachment.attachmentId,
        testId: attachment.testId,
        projectId: attachment.projectId,
        storageKey: attachment.storageKey,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        mediaType: attachment.mediaType,
        description: attachment.description,
        displayOrder: attachment.displayOrder,
        url,
        createdOn: attachment.createdOn,
      }
    } catch (error: any) {
      // Clean up storage if database operation failed
      try {
        await storage.delete(storageKey)
      } catch (cleanupError) {
        logger({
          type: LogType.ERROR,
          tag: 'AttachmentsController',
          message: `Failed to cleanup storage after error: ${cleanupError}`,
        })
      }
      throw error
    }
  },

  /**
   * Upload a run attachment (actual behavior)
   */
  async uploadRunAttachment(params: IUploadRunAttachment): Promise<AttachmentResponse> {
    // Validate file
    this.validateFile(params.mimeType, params.fileSize)

    // Check attachment count limit
    const currentCount = await RunAttachmentsDao.countAttachments(
      params.runId,
      params.testId,
    )
    if (currentCount >= MAX_ATTACHMENTS.PER_RUN_TEST) {
      throw new Error(
        `Maximum attachments (${MAX_ATTACHMENTS.PER_RUN_TEST}) reached for this test in this run`,
        {cause: ErrorCause.INVALID_PARAMS},
      )
    }

    const storage = await getStorageProvider()
    const mediaType = getMediaTypeFromMime(params.mimeType)!

    // Generate storage key
    const storageKey = generateStorageKey({
      projectId: params.projectId,
      testId: params.testId,
      runId: params.runId,
      filename: params.filename,
      attachmentType: AttachmentType.ACTUAL,
    })

    try {
      // Upload to storage
      await storage.upload(params.file, storageKey, {
        contentType: params.mimeType,
        originalFilename: params.filename,
        size: params.fileSize,
      })

      // Create database record
      const {attachmentId} = await RunAttachmentsDao.createAttachment({
        runId: params.runId,
        testId: params.testId,
        testRunMapId: params.testRunMapId,
        projectId: params.projectId,
        storageKey,
        originalFilename: params.filename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        mediaType,
        description: params.description,
        createdBy: params.createdBy,
      })

      // Get the created attachment
      const attachment = await RunAttachmentsDao.getAttachmentById(attachmentId)
      if (!attachment) {
        throw new Error('Failed to retrieve created attachment')
      }

      // Generate URL
      const url = await storage.getSignedUrl(storageKey)

      logger({
        type: LogType.INFO,
        tag: 'AttachmentsController',
        message: `Uploaded run attachment ${attachmentId} for run ${params.runId}, test ${params.testId}`,
      })

      return {
        attachmentId: attachment.attachmentId,
        testId: attachment.testId,
        projectId: attachment.projectId,
        runId: attachment.runId,
        storageKey: attachment.storageKey,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        mediaType: attachment.mediaType,
        description: attachment.description,
        displayOrder: attachment.displayOrder,
        url,
        createdOn: attachment.createdOn,
      }
    } catch (error: any) {
      // Clean up storage if database operation failed
      try {
        await storage.delete(storageKey)
      } catch (cleanupError) {
        logger({
          type: LogType.ERROR,
          tag: 'AttachmentsController',
          message: `Failed to cleanup storage after error: ${cleanupError}`,
        })
      }
      throw error
    }
  },

  /**
   * Get presigned URL for direct client upload
   */
  async getPresignedUploadUrl(params: IGetPresignedUploadUrl): Promise<{
    uploadUrl: string
    storageKey: string
    expiresAt: Date
  }> {
    // Validate file parameters
    this.validateFile(params.mimeType, params.fileSize)

    // Check attachment count limit
    if (params.attachmentType === AttachmentType.EXPECTED) {
      const currentCount = await TestAttachmentsDao.countAttachments(params.testId)
      if (currentCount >= MAX_ATTACHMENTS.PER_TEST) {
        throw new Error(
          `Maximum attachments (${MAX_ATTACHMENTS.PER_TEST}) reached for this test`,
          {cause: ErrorCause.INVALID_PARAMS},
        )
      }
    } else {
      if (!params.runId) {
        throw new Error('runId is required for actual behavior attachments', {
          cause: ErrorCause.INVALID_PARAMS,
        })
      }
      const currentCount = await RunAttachmentsDao.countAttachments(
        params.runId,
        params.testId,
      )
      if (currentCount >= MAX_ATTACHMENTS.PER_RUN_TEST) {
        throw new Error(
          `Maximum attachments (${MAX_ATTACHMENTS.PER_RUN_TEST}) reached for this test in this run`,
          {cause: ErrorCause.INVALID_PARAMS},
        )
      }
    }

    const storage = await getStorageProvider()

    // Generate storage key
    const storageKey = generateStorageKey({
      projectId: params.projectId,
      testId: params.testId,
      runId: params.runId,
      filename: params.filename,
      attachmentType: params.attachmentType,
    })

    // Get presigned URL
    const result = await storage.getPresignedUploadUrl(
      storageKey,
      params.mimeType,
      3600, // 1 hour expiry
    )

    return {
      uploadUrl: result.uploadUrl,
      storageKey: result.key,
      expiresAt: result.expiresAt,
    }
  },

  /**
   * Confirm upload after client has uploaded to storage
   */
  async confirmUpload(params: IConfirmUpload): Promise<AttachmentResponse> {
    const storage = await getStorageProvider()
    const mediaType = getMediaTypeFromMime(params.mimeType)!

    // Verify file exists in storage
    const exists = await storage.exists(params.storageKey)
    if (!exists) {
      throw new Error('File not found in storage. Please upload the file first.', {
        cause: ErrorCause.INVALID_PARAMS,
      })
    }

    if (params.attachmentType === AttachmentType.EXPECTED) {
      // Create test attachment record
      const {attachmentId} = await TestAttachmentsDao.createAttachment({
        testId: params.testId,
        projectId: params.projectId,
        storageKey: params.storageKey,
        originalFilename: params.filename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        mediaType,
        description: params.description,
        createdBy: params.createdBy,
      })

      const attachment = await TestAttachmentsDao.getAttachmentById(attachmentId)
      if (!attachment) {
        throw new Error('Failed to retrieve created attachment')
      }

      const url = await storage.getSignedUrl(params.storageKey)

      return {
        attachmentId: attachment.attachmentId,
        testId: attachment.testId,
        projectId: attachment.projectId,
        storageKey: attachment.storageKey,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        mediaType: attachment.mediaType,
        description: attachment.description,
        displayOrder: attachment.displayOrder,
        url,
        createdOn: attachment.createdOn,
      }
    } else {
      // Create run attachment record
      if (!params.runId) {
        throw new Error('runId is required for actual behavior attachments', {
          cause: ErrorCause.INVALID_PARAMS,
        })
      }

      const {attachmentId} = await RunAttachmentsDao.createAttachment({
        runId: params.runId,
        testId: params.testId,
        testRunMapId: params.testRunMapId,
        projectId: params.projectId,
        storageKey: params.storageKey,
        originalFilename: params.filename,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        mediaType,
        description: params.description,
        createdBy: params.createdBy,
      })

      const attachment = await RunAttachmentsDao.getAttachmentById(attachmentId)
      if (!attachment) {
        throw new Error('Failed to retrieve created attachment')
      }

      const url = await storage.getSignedUrl(params.storageKey)

      return {
        attachmentId: attachment.attachmentId,
        testId: attachment.testId,
        projectId: attachment.projectId,
        runId: attachment.runId,
        storageKey: attachment.storageKey,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        mediaType: attachment.mediaType,
        description: attachment.description,
        displayOrder: attachment.displayOrder,
        url,
        createdOn: attachment.createdOn,
      }
    }
  },

  /**
   * Get test attachments (expected behavior)
   */
  async getTestAttachments(params: IGetAttachments): Promise<AttachmentResponse[]> {
    const attachments = await TestAttachmentsDao.getAttachments({
      testId: params.testId,
      projectId: params.projectId,
    })

    const storage = await getStorageProvider()

    // Generate signed URLs for all attachments
    const results: AttachmentResponse[] = await Promise.all(
      attachments.map(async (attachment) => {
        const url = await storage.getSignedUrl(attachment.storageKey)
        return {
          attachmentId: attachment.attachmentId,
          testId: attachment.testId,
          projectId: attachment.projectId,
          storageKey: attachment.storageKey,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          mediaType: attachment.mediaType,
          description: attachment.description,
          displayOrder: attachment.displayOrder,
          url,
          createdOn: attachment.createdOn,
        }
      }),
    )

    return results
  },

  /**
   * Get run attachments (actual behavior)
   */
  async getRunAttachments(params: IGetAttachments): Promise<AttachmentResponse[]> {
    if (!params.runId) {
      throw new Error('runId is required', {cause: ErrorCause.INVALID_PARAMS})
    }

    const attachments = await RunAttachmentsDao.getAttachments({
      runId: params.runId,
      testId: params.testId,
      projectId: params.projectId,
    })

    const storage = await getStorageProvider()

    // Generate signed URLs for all attachments
    const results: AttachmentResponse[] = await Promise.all(
      attachments.map(async (attachment) => {
        const url = await storage.getSignedUrl(attachment.storageKey)
        return {
          attachmentId: attachment.attachmentId,
          testId: attachment.testId,
          projectId: attachment.projectId,
          runId: attachment.runId,
          storageKey: attachment.storageKey,
          originalFilename: attachment.originalFilename,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          mediaType: attachment.mediaType,
          description: attachment.description,
          displayOrder: attachment.displayOrder,
          url,
          createdOn: attachment.createdOn,
        }
      }),
    )

    return results
  },

  /**
   * Get all attachments for a test in a run (both expected and actual)
   */
  async getAllAttachmentsForRunTest(params: IGetAttachments): Promise<{
    expected: AttachmentResponse[]
    actual: AttachmentResponse[]
  }> {
    const [expected, actual] = await Promise.all([
      this.getTestAttachments(params),
      params.runId
        ? this.getRunAttachments(params)
        : Promise.resolve([] as AttachmentResponse[]),
    ])

    return {expected, actual}
  },

  /**
   * Delete an attachment
   */
  async deleteAttachment(params: IDeleteAttachment): Promise<{deleted: boolean}> {
    const storage = await getStorageProvider()

    let result: {deleted: boolean; storageKey: string | null}

    if (params.attachmentType === AttachmentType.EXPECTED) {
      result = await TestAttachmentsDao.deleteAttachment({
        attachmentId: params.attachmentId,
        projectId: params.projectId,
      })
    } else {
      result = await RunAttachmentsDao.deleteAttachment({
        attachmentId: params.attachmentId,
        projectId: params.projectId,
      })
    }

    if (result.deleted && result.storageKey) {
      // Delete from storage
      try {
        await storage.delete(result.storageKey)
        logger({
          type: LogType.INFO,
          tag: 'AttachmentsController',
          message: `Deleted attachment ${params.attachmentId} from storage`,
        })
      } catch (error: any) {
        // Log error but don't fail - the DB record is already deleted
        logger({
          type: LogType.ERROR,
          tag: 'AttachmentsController',
          message: `Failed to delete file from storage: ${error.message}`,
        })
      }
    }

    return {deleted: result.deleted}
  },
}

export default AttachmentsController

