/**
 * Storage Provider Interface
 *
 * This interface defines the contract for all storage providers.
 * Implement this interface to add support for new storage backends
 * (e.g., AWS S3, Google Cloud Storage, Azure Blob, MinIO, etc.)
 */

export interface FileMetadata {
  contentType: string
  originalFilename: string
  size: number
  [key: string]: unknown
}

export interface UploadResult {
  key: string
  url: string
  size: number
  contentType: string
}

export interface PresignedUrlResult {
  uploadUrl: string
  key: string
  expiresAt: Date
}

export interface StorageProvider {
  /**
   * Get the provider name/identifier
   */
  readonly name: string

  /**
   * Upload a file directly to storage
   * @param file - File buffer to upload
   * @param key - Storage key/path for the file
   * @param metadata - File metadata including content type
   * @returns Upload result with URL and metadata
   */
  upload(
    file: Buffer,
    key: string,
    metadata: FileMetadata,
  ): Promise<UploadResult>

  /**
   * Delete a file from storage
   * @param key - Storage key/path of the file to delete
   */
  delete(key: string): Promise<void>

  /**
   * Get a signed URL for reading a file (time-limited access)
   * @param key - Storage key/path of the file
   * @param expiresIn - Expiration time in seconds (default: 3600)
   * @returns Signed URL string
   */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>

  /**
   * Get a presigned URL for uploading a file directly to storage
   * This is useful for client-side uploads to bypass server bandwidth
   * @param key - Storage key/path where the file will be stored
   * @param contentType - MIME type of the file to upload
   * @param expiresIn - Expiration time in seconds (default: 3600)
   * @returns Presigned URL result with upload URL and metadata
   */
  getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn?: number,
  ): Promise<PresignedUrlResult>

  /**
   * Get the public URL for a file (if bucket is public)
   * @param key - Storage key/path of the file
   * @returns Public URL string
   */
  getPublicUrl(key: string): string

  /**
   * Check if a file exists in storage
   * @param key - Storage key/path to check
   * @returns True if file exists, false otherwise
   */
  exists(key: string): Promise<boolean>

  /**
   * Copy a file within storage
   * @param sourceKey - Source storage key
   * @param destinationKey - Destination storage key
   */
  copy(sourceKey: string, destinationKey: string): Promise<void>

  /**
   * Get file metadata without downloading the file
   * @param key - Storage key/path of the file
   * @returns File metadata or null if not found
   */
  getMetadata(key: string): Promise<FileMetadata | null>
}

/**
 * Storage configuration interface
 */
export interface StorageConfig {
  provider: 'local' | 's3' | 'gcs'
  bucket?: string
  region?: string
  endpoint?: string
  accessKeyId?: string
  secretAccessKey?: string
  publicUrl?: string
  localPath?: string
}

/**
 * Media type enum for categorizing uploads
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video',
}

/**
 * Attachment type enum for categorizing attachment context
 */
export enum AttachmentType {
  EXPECTED = 'expected', // Attached to test definition (expected behavior)
  ACTUAL = 'actual', // Attached during run execution (actual behavior)
}

/**
 * Supported image MIME types
 */
export const SUPPORTED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
] as const

/**
 * Supported video MIME types
 */
export const SUPPORTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime', // .mov
] as const

/**
 * All supported media types
 */
export const SUPPORTED_MEDIA_TYPES = [
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_VIDEO_TYPES,
] as const

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number]
export type SupportedVideoType = (typeof SUPPORTED_VIDEO_TYPES)[number]
export type SupportedMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number]

/**
 * File size limits in bytes
 */
export const FILE_SIZE_LIMITS = {
  IMAGE: 10 * 1024 * 1024, // 10MB
  VIDEO: 100 * 1024 * 1024, // 100MB
} as const

/**
 * Maximum attachments per test/run
 */
export const MAX_ATTACHMENTS = {
  PER_TEST: 10,
  PER_RUN_TEST: 10,
} as const

/**
 * Helper function to determine media type from MIME type
 */
export function getMediaTypeFromMime(mimeType: string): MediaType | null {
  if (SUPPORTED_IMAGE_TYPES.includes(mimeType as SupportedImageType)) {
    return MediaType.IMAGE
  }
  if (SUPPORTED_VIDEO_TYPES.includes(mimeType as SupportedVideoType)) {
    return MediaType.VIDEO
  }
  return null
}

/**
 * Helper function to validate file size based on media type
 */
export function isValidFileSize(size: number, mediaType: MediaType): boolean {
  const limit =
    mediaType === MediaType.IMAGE
      ? FILE_SIZE_LIMITS.IMAGE
      : FILE_SIZE_LIMITS.VIDEO
  return size <= limit
}

/**
 * Helper function to check if a MIME type is supported
 */
export function isSupportedMediaType(mimeType: string): boolean {
  return SUPPORTED_MEDIA_TYPES.includes(mimeType as SupportedMediaType)
}

/**
 * Generate a storage key for attachments
 */
export function generateStorageKey(params: {
  projectId: number
  testId: number
  runId?: number
  filename: string
  attachmentType: AttachmentType
}): string {
  const {projectId, testId, runId, filename, attachmentType} = params
  const timestamp = Date.now()
  const randomSuffix = Math.random().toString(36).substring(2, 8)
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_')

  if (attachmentType === AttachmentType.EXPECTED) {
    return `projects/${projectId}/tests/${testId}/expected/${timestamp}-${randomSuffix}-${sanitizedFilename}`
  }

  return `projects/${projectId}/runs/${runId}/tests/${testId}/actual/${timestamp}-${randomSuffix}-${sanitizedFilename}`
}

