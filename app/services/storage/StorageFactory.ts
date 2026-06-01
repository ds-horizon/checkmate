/**
 * Storage Factory
 *
 * Factory for creating storage provider instances based on configuration.
 * Implements singleton pattern to reuse provider instances.
 * 
 * Uses dynamic imports to avoid bundling cloud provider SDKs unless needed.
 */

import {StorageProvider, StorageConfig} from './interfaces/StorageProvider'
import {LocalStorageProvider} from './providers/LocalStorageProvider'
import {logger, LogType} from '~/utils/logger'
import * as path from 'path'

// Singleton instance
let storageInstance: StorageProvider | null = null

/**
 * Get storage configuration from environment variables
 */
function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || 'local') as
    | 'local'
    | 's3'
    | 'gcs'

  return {
    provider,
    bucket: process.env.STORAGE_BUCKET,
    region: process.env.STORAGE_REGION || 'us-east-1',
    endpoint: process.env.STORAGE_ENDPOINT,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
    publicUrl: process.env.STORAGE_PUBLIC_URL,
    localPath: process.env.STORAGE_LOCAL_PATH,
  }
}

/**
 * Create a storage provider based on configuration
 * 
 * Cloud providers (S3, GCS) are loaded dynamically to avoid bundling
 * their SDKs unless they're actually used.
 */
export async function createStorageProvider(
  config?: Partial<StorageConfig>,
): Promise<StorageProvider> {
  const resolvedConfig = config
    ? {...getStorageConfig(), ...config}
    : getStorageConfig()

  logger({
    type: LogType.INFO,
    tag: 'StorageFactory',
    message: `Creating storage provider: ${resolvedConfig.provider}`,
  })

  switch (resolvedConfig.provider) {
    case 'local':
      return new LocalStorageProvider({
        basePath:
          resolvedConfig.localPath ||
          path.join(process.cwd(), 'uploads', 'attachments'),
        baseUrl: resolvedConfig.publicUrl || '/api/v1/attachments/serve',
      })

    case 's3': {
      if (
        !resolvedConfig.bucket ||
        !resolvedConfig.accessKeyId ||
        !resolvedConfig.secretAccessKey
      ) {
        throw new Error(
          'S3 storage requires bucket, accessKeyId, and secretAccessKey configuration',
        )
      }
      // Dynamic import to avoid bundling AWS SDK unless needed
      const {S3StorageProvider} = await import('./providers/S3StorageProvider')
      return new S3StorageProvider({
        bucket: resolvedConfig.bucket,
        region: resolvedConfig.region || 'us-east-1',
        accessKeyId: resolvedConfig.accessKeyId,
        secretAccessKey: resolvedConfig.secretAccessKey,
        endpoint: resolvedConfig.endpoint,
        publicUrl: resolvedConfig.publicUrl,
      })
    }

    case 'gcs': {
      if (!resolvedConfig.bucket) {
        throw new Error('GCS storage requires bucket configuration')
      }
      // Dynamic import to avoid bundling GCS SDK unless needed
      const {GCSStorageProvider} = await import('./providers/GCSStorageProvider')
      return new GCSStorageProvider({
        bucket: resolvedConfig.bucket,
        projectId: process.env.GCS_PROJECT_ID || '',
        keyFilename: process.env.GCS_KEY_FILENAME,
        publicUrl: resolvedConfig.publicUrl,
      })
    }

    default:
      throw new Error(`Unsupported storage provider: ${resolvedConfig.provider}`)
  }
}

/**
 * Get the singleton storage provider instance
 */
export async function getStorageProvider(): Promise<StorageProvider> {
  if (!storageInstance) {
    storageInstance = await createStorageProvider()
  }
  return storageInstance
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetStorageProvider(): void {
  storageInstance = null
}

/**
 * Set a custom storage provider instance (useful for testing)
 */
export function setStorageProvider(provider: StorageProvider): void {
  storageInstance = provider
}
