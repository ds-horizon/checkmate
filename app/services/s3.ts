import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'
import {randomUUID} from 'crypto'

const SIGNED_URL_EXPIRY_SECONDS = 3600

let s3ClientSingleton: S3Client | undefined

export const getS3Client = (): S3Client => {
  if (!s3ClientSingleton) {
    s3ClientSingleton = new S3Client({region: process.env.S3_REGION})
  }
  return s3ClientSingleton
}

const MAX_FILENAME_LENGTH = 100

export const buildAttachmentKey = (fileName: string): string => {
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-MAX_FILENAME_LENGTH)
  return `test-run-attachments/${randomUUID()}-${safeName}`
}

export const uploadAttachment = async ({
  key,
  body,
  contentType,
}: {
  key: string
  body: Buffer
  contentType?: string
}): Promise<void> => {
  const bucket = process.env.S3_BUCKET
  if (!bucket) {
    throw new Error('S3_BUCKET is not configured')
  }

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export const getSignedAttachmentUrl = async (key: string): Promise<string> => {
  const bucket = process.env.S3_BUCKET
  if (!bucket) {
    throw new Error('S3_BUCKET is not configured')
  }

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentDisposition: 'attachment',
    }),
    {expiresIn: SIGNED_URL_EXPIRY_SECONDS},
  )
}
