/**
 * AWS S3 Storage Provider
 *
 * Implementation for Amazon S3 and S3-compatible storage services
 * (e.g., MinIO, DigitalOcean Spaces, Cloudflare R2)
 */

import {
  StorageProvider,
  FileMetadata,
  UploadResult,
  PresignedUrlResult,
} from '../interfaces/StorageProvider'
import {logger, LogType} from '~/utils/logger'

export interface S3StorageConfig {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string // For S3-compatible services
  forcePathStyle?: boolean // For S3-compatible services
  publicUrl?: string // Custom public URL (e.g., CDN URL)
}

/**
 * S3 Storage Provider
 *
 * Note: This implementation uses the AWS SDK v3.
 * Install required packages:
 * yarn add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3'
  private config: S3StorageConfig
  private s3Client: any // AWS S3Client
  private initialized: boolean = false

  constructor(config: S3StorageConfig) {
    this.config = config
  }

  /**
   * Lazily initialize the S3 client
   * This allows the app to start even if AWS SDK is not installed
   */
  private async getClient(): Promise<any> {
    if (!this.initialized) {
      try {
        const {S3Client} = await import('@aws-sdk/client-s3')

        const clientConfig: any = {
          region: this.config.region,
          credentials: {
            accessKeyId: this.config.accessKeyId,
            secretAccessKey: this.config.secretAccessKey,
          },
        }

        if (this.config.endpoint) {
          clientConfig.endpoint = this.config.endpoint
        }

        if (this.config.forcePathStyle) {
          clientConfig.forcePathStyle = true
        }

        this.s3Client = new S3Client(clientConfig)
        this.initialized = true
      } catch (error: any) {
        logger({
          type: LogType.ERROR,
          tag: 'S3Storage',
          message: `Failed to initialize S3 client: ${error.message}. Make sure @aws-sdk/client-s3 is installed.`,
        })
        throw new Error(
          'S3 client not available. Install @aws-sdk/client-s3 package.',
        )
      }
    }
    return this.s3Client
  }

  async upload(
    file: Buffer,
    key: string,
    metadata: FileMetadata,
  ): Promise<UploadResult> {
    try {
      const client = await this.getClient()
      const {PutObjectCommand} = await import('@aws-sdk/client-s3')

      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: file,
        ContentType: metadata.contentType,
        Metadata: {
          originalFilename: metadata.originalFilename,
          size: String(metadata.size),
        },
      })

      await client.send(command)

      logger({
        type: LogType.INFO,
        tag: 'S3Storage',
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
        tag: 'S3Storage',
        message: `Failed to upload file: ${error.message}`,
      })
      throw new Error(`Failed to upload file to S3: ${error.message}`)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const client = await this.getClient()
      const {DeleteObjectCommand} = await import('@aws-sdk/client-s3')

      const command = new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })

      await client.send(command)

      logger({
        type: LogType.INFO,
        tag: 'S3Storage',
        message: `File deleted: ${key}`,
      })
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'S3Storage',
        message: `Failed to delete file: ${error.message}`,
      })
      throw new Error(`Failed to delete file from S3: ${error.message}`)
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const client = await this.getClient()
      const {GetObjectCommand} = await import('@aws-sdk/client-s3')
      const {getSignedUrl} = await import('@aws-sdk/s3-request-presigner')

      const command = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })

      const url = await getSignedUrl(client, command, {expiresIn})
      return url
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'S3Storage',
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
      const client = await this.getClient()
      const {PutObjectCommand} = await import('@aws-sdk/client-s3')
      const {getSignedUrl} = await import('@aws-sdk/s3-request-presigner')

      const command = new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: contentType,
      })

      const uploadUrl = await getSignedUrl(client, command, {expiresIn})

      return {
        uploadUrl,
        key,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      }
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'S3Storage',
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

    if (this.config.endpoint) {
      // S3-compatible service
      return `${this.config.endpoint}/${this.config.bucket}/${key}`
    }

    // Standard AWS S3 URL
    return `https://${this.config.bucket}.s3.${this.config.region}.amazonaws.com/${key}`
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = await this.getClient()
      const {HeadObjectCommand} = await import('@aws-sdk/client-s3')

      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })

      await client.send(command)
      return true
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false
      }
      throw error
    }
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      const client = await this.getClient()
      const {CopyObjectCommand} = await import('@aws-sdk/client-s3')

      const command = new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: `${this.config.bucket}/${sourceKey}`,
        Key: destinationKey,
      })

      await client.send(command)

      logger({
        type: LogType.INFO,
        tag: 'S3Storage',
        message: `File copied: ${sourceKey} -> ${destinationKey}`,
      })
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'S3Storage',
        message: `Failed to copy file: ${error.message}`,
      })
      throw new Error(`Failed to copy file in S3: ${error.message}`)
    }
  }

  async getMetadata(key: string): Promise<FileMetadata | null> {
    try {
      const client = await this.getClient()
      const {HeadObjectCommand} = await import('@aws-sdk/client-s3')

      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      })

      const response = await client.send(command)

      return {
        contentType: response.ContentType || 'application/octet-stream',
        originalFilename:
          response.Metadata?.originalFilename || key.split('/').pop() || key,
        size: response.ContentLength || 0,
      }
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null
      }
      logger({
        type: LogType.ERROR,
        tag: 'S3Storage',
        message: `Failed to get metadata: ${error.message}`,
      })
      throw new Error(`Failed to get file metadata from S3: ${error.message}`)
    }
  }
}

