/**
 * Storage Module
 *
 * Main entry point for the storage abstraction layer.
 * Provides a unified interface for file storage operations.
 * 
 * Note: Cloud providers (S3, GCS) are loaded dynamically by the factory
 * to avoid requiring their SDKs unless actually used.
 */

// Export interfaces and types
export {
  StorageProvider,
  StorageConfig,
  FileMetadata,
  UploadResult,
  PresignedUrlResult,
  MediaType,
  AttachmentType,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_VIDEO_TYPES,
  SUPPORTED_MEDIA_TYPES,
  FILE_SIZE_LIMITS,
  MAX_ATTACHMENTS,
  getMediaTypeFromMime,
  isValidFileSize,
  isSupportedMediaType,
  generateStorageKey,
} from './interfaces/StorageProvider'

// Export local provider (always available, no external dependencies)
export {LocalStorageProvider} from './providers/LocalStorageProvider'

// Note: S3StorageProvider and GCSStorageProvider are NOT exported directly
// They are loaded dynamically by the factory to avoid bundling cloud SDKs
// unless the provider is actually configured.

// Export factory
export {
  createStorageProvider,
  getStorageProvider,
  resetStorageProvider,
  setStorageProvider,
} from './StorageFactory'
