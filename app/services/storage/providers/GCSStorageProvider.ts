/**
 * Google Cloud Storage Provider
 *
 * Implementation for Google Cloud Storage
 */

import {
  StorageProvider,
  FileMetadata,
  UploadResult,
  PresignedUrlResult,
} from '../interfaces/StorageProvider'
import {logger, LogType} from '~/utils/logger'

export interface GCSStorageConfig {
  bucket: string
  projectId: string
  keyFilename?: string // Path to service account key file
  credentials?: {
    client_email: string
    private_key: string
  }
  publicUrl?: string // Custom public URL (e.g., CDN URL)
}

/**
 * Google Cloud Storage Provider
 *
 * Note: This implementation uses the @google-cloud/storage package.
 * Install required packages:
 * yarn add @google-cloud/storage
 */
export class GCSStorageProvider implements StorageProvider {
  readonly name = 'gcs'
  private config: GCSStorageConfig
  private storageClient: any
  private bucket: any
  private initialized: boolean = false

  constructor(config: GCSStorageConfig) {
    this.config = config
  }

  /**
   * Lazily initialize the GCS client
   */
  private async getClient(): Promise<any> {
    if (!this.initialized) {
      try {
        const {Storage} = await import('@google-cloud/storage')

        const clientConfig: any = {
          projectId: this.config.projectId,
        }

        if (this.config.keyFilename) {
          clientConfig.keyFilename = this.config.keyFilename
        } else if (this.config.credentials) {
          clientConfig.credentials = this.config.credentials
        }

        this.storageClient = new Storage(clientConfig)
        this.bucket = this.storageClient.bucket(this.config.bucket)
        this.initialized = true
      } catch (error: any) {
        logger({
          type: LogType.ERROR,
          tag: 'GCSStorage',
          message: `Failed to initialize GCS client: ${error.message}. Make sure @google-cloud/storage is installed.`,
        })
        throw new Error(
          'GCS client not available. Install @google-cloud/storage package.',
        )
      }
    }
    return this.bucket
  }

  async upload(
    file: Buffer,
    key: string,
    metadata: FileMetadata,
  ): Promise<UploadResult> {
    try {
      const bucket = await this.getClient()
      const blob = bucket.file(key)

      await blob.save(file, {
        contentType: metadata.contentType,
        metadata: {
          metadata: {
            originalFilename: metadata.originalFilename,
            size: String(metadata.size),
          },
        },
      })

      logger({
        type: LogType.INFO,
        tag: 'GCSStorage',
        message: `File uploaded: ${key}`,
      })

      return {
        key,
        url: this.getPublicUrl(key),
        size: metadata.size,
        contentType: metadata.contentType,
      }
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'GCSStorage',
        message: `Failed to upload file: ${error.message}`,
      })
      throw new Error(`Failed to upload file to GCS: ${error.message}`)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const bucket = await this.getClient()
      const blob = bucket.file(key)

      await blob.delete()

      logger({
        type: LogType.INFO,
        tag: 'GCSStorage',
        message: `File deleted: ${key}`,
      })
    } catch (error: any) {
      // Ignore 404 errors (file already deleted)
      if (error.code !== 404) {
        logger({
          type: LogType.ERROR,
          tag: 'GCSStorage',
          message: `Failed to delete file: ${error.message}`,
        })
        throw new Error(`Failed to delete file from GCS: ${error.message}`)
      }
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const bucket = await this.getClient()
      const blob = bucket.file(key)

      const [url] = await blob.getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresIn * 1000,
      })

      return url
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'GCSStorage',
        message: `Failed to generate signed URL: ${error.message}`,
      })
      throw new Error(`Failed to generate signed URL: ${error.message}`)
    }
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600,
  ): Promise<PresignedUrlResult> {
    try {
      const bucket = await this.getClient()
      const blob = bucket.file(key)

      const [url] = await blob.getSignedUrl({
        action: 'write',
        contentType,
        expires: Date.now() + expiresIn * 1000,
      })

      return {
        uploadUrl: url,
        key,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      }
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'GCSStorage',
        message: `Failed to generate presigned upload URL: ${error.message}`,
      })
      throw new Error(
        `Failed to generate presigned upload URL: ${error.message}`,
      )
    }
  }

  getPublicUrl(key: string): string {
    if (this.config.publicUrl) {
      return `${this.config.publicUrl.replace(/\/$/, '')}/${key}`
    }

    // Standard GCS public URL
    return `https://storage.googleapis.com/${this.config.bucket}/${key}`
  }

  async exists(key: string): Promise<boolean> {
    try {
      const bucket = await this.getClient()
      const blob = bucket.file(key)
      const [exists] = await blob.exists()
      return exists
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'GCSStorage',
        message: `Failed to check file existence: ${error.message}`,
      })
      throw error
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      const bucket = await this.getClient()
      const sourceBlob = bucket.file(sourceKey)
      const destBlob = bucket.file(destinationKey)

      await sourceBlob.copy(destBlob)

      logger({
        type: LogType.INFO,
        tag: 'GCSStorage',
        message: `File copied: ${sourceKey} -> ${destinationKey}`,
      })
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'GCSStorage',
        message: `Failed to copy file: ${error.message}`,
      })
      throw new Error(`Failed to copy file in GCS: ${error.message}`)
    }
  }

  async getMetadata(key: string): Promise<FileMetadata | null> {
    try {
      const bucket = await this.getClient()
      const blob = bucket.file(key)
      const [metadata] = await blob.getMetadata()

      return {
        contentType: metadata.contentType || 'application/octet-stream',
        originalFilename:
          metadata.metadata?.originalFilename ||
          key.split('/').pop() ||
          key,
        size: parseInt(metadata.size, 10) || 0,
      }
    } catch (error: any) {
      if (error.code === 404) {
        return null
      }
      logger({
        type: LogType.ERROR,
        tag: 'GCSStorage',
        message: `Failed to get metadata: ${error.message}`,
      })
      throw new Error(`Failed to get file metadata from GCS: ${error.message}`)
    }
  }
}

