/**
 * Local Storage Provider
 *
 * Implementation for local filesystem storage.
 * Useful for development and testing environments.
 */

import {
  StorageProvider,
  FileMetadata,
  UploadResult,
  PresignedUrlResult,
} from '../interfaces/StorageProvider'
import * as fs from 'fs'
import * as path from 'path'
import {logger, LogType} from '~/utils/logger'

export interface LocalStorageConfig {
  basePath: string // Base directory for file storage
  baseUrl: string // Base URL for serving files (e.g., http://localhost:3000/uploads)
}

export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local'
  private basePath: string
  private baseUrl: string

  constructor(config: LocalStorageConfig) {
    this.basePath = config.basePath
    this.baseUrl = config.baseUrl.replace(/\/$/, '') // Remove trailing slash

    // Ensure base directory exists
    this.ensureDirectoryExists(this.basePath)
  }

  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, {recursive: true})
    }
  }

  private getFullPath(key: string): string {
    return path.join(this.basePath, key)
  }

  async upload(
    file: Buffer,
    key: string,
    metadata: FileMetadata,
  ): Promise<UploadResult> {
    try {
      const fullPath = this.getFullPath(key)
      const dirPath = path.dirname(fullPath)

      // Ensure directory exists
      this.ensureDirectoryExists(dirPath)

      // Write file
      fs.writeFileSync(fullPath, file)

      // Store metadata in a sidecar file
      const metadataPath = `${fullPath}.meta.json`
      fs.writeFileSync(
        metadataPath,
        JSON.stringify({
          ...metadata,
          uploadedAt: new Date().toISOString(),
        }),
      )

      logger({
        type: LogType.INFO,
        tag: 'LocalStorage',
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
        tag: 'LocalStorage',
        message: `Failed to upload file: ${error.message}`,
      })
      throw new Error(`Failed to upload file: ${error.message}`)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const fullPath = this.getFullPath(key)
      const metadataPath = `${fullPath}.meta.json`

      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }

      if (fs.existsSync(metadataPath)) {
        fs.unlinkSync(metadataPath)
      }

      logger({
        type: LogType.INFO,
        tag: 'LocalStorage',
        message: `File deleted: ${key}`,
      })
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'LocalStorage',
        message: `Failed to delete file: ${error.message}`,
      })
      throw new Error(`Failed to delete file: ${error.message}`)
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    // For local storage, we return the public URL with a token parameter
    // In production, you'd want to implement proper token-based access
    const token = Buffer.from(
      JSON.stringify({
        key,
        expires: Date.now() + expiresIn * 1000,
      }),
    ).toString('base64url')

    return `${this.baseUrl}/${key}?token=${token}`
  }

  async getPresignedUploadUrl(
    key: string,
    contentType: string,
    expiresIn: number = 3600,
  ): Promise<PresignedUrlResult> {
    // For local storage, we use a special upload endpoint
    const token = Buffer.from(
      JSON.stringify({
        key,
        contentType,
        expires: Date.now() + expiresIn * 1000,
      }),
    ).toString('base64url')

    return {
      uploadUrl: `${this.baseUrl}/upload?token=${token}`,
      key,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    }
  }

  getPublicUrl(key: string): string {
    return `${this.baseUrl}/${key}`
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key)
    return fs.existsSync(fullPath)
  }

  async copy(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      const sourcePath = this.getFullPath(sourceKey)
      const destPath = this.getFullPath(destinationKey)
      const destDir = path.dirname(destPath)

      // Ensure destination directory exists
      this.ensureDirectoryExists(destDir)

      // Copy file
      fs.copyFileSync(sourcePath, destPath)

      // Copy metadata if it exists
      const sourceMetaPath = `${sourcePath}.meta.json`
      const destMetaPath = `${destPath}.meta.json`
      if (fs.existsSync(sourceMetaPath)) {
        fs.copyFileSync(sourceMetaPath, destMetaPath)
      }

      logger({
        type: LogType.INFO,
        tag: 'LocalStorage',
        message: `File copied: ${sourceKey} -> ${destinationKey}`,
      })
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'LocalStorage',
        message: `Failed to copy file: ${error.message}`,
      })
      throw new Error(`Failed to copy file: ${error.message}`)
    }
  }

  async getMetadata(key: string): Promise<FileMetadata | null> {
    try {
      const fullPath = this.getFullPath(key)
      const metadataPath = `${fullPath}.meta.json`

      if (!fs.existsSync(metadataPath)) {
        // Try to get basic metadata from the file itself
        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath)
          return {
            contentType: 'application/octet-stream',
            originalFilename: path.basename(key),
            size: stats.size,
          }
        }
        return null
      }

      const metadataContent = fs.readFileSync(metadataPath, 'utf-8')
      return JSON.parse(metadataContent)
    } catch (error: any) {
      logger({
        type: LogType.ERROR,
        tag: 'LocalStorage',
        message: `Failed to get metadata: ${error.message}`,
      })
      return null
    }
  }
}

