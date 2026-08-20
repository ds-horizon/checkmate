import {
  DeleteObjectCommand,
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
const ATTACHMENT_KEY_PREFIX = 'test-run-attachments/'
// test-run-attachments/<uuid>-<sanitized filename>
const ATTACHMENT_KEY_PATTERN =
  /^test-run-attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[a-zA-Z0-9._-]+$/

export const buildAttachmentKey = (fileName: string): string => {
  const safeName = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-MAX_FILENAME_LENGTH)
  return `${ATTACHMENT_KEY_PREFIX}${randomUUID()}-${safeName}`
}

// Only keys shaped like buildAttachmentKey's output are allowed through to a
// PutObject/GetObject/DeleteObject call, so a client can never reference or
// sign an arbitrary key elsewhere in the bucket.
export const isValidAttachmentKey = (key: string): boolean =>
  ATTACHMENT_KEY_PATTERN.test(key)

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
  if (!isValidAttachmentKey(key)) {
    throw new Error(`Refusing to sign an unexpected attachment key: ${key}`)
  }

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

export const downloadAttachment = async (
  key: string,
  {timeoutMs}: {timeoutMs?: number} = {},
): Promise<Buffer> => {
  if (!isValidAttachmentKey(key)) {
    throw new Error(`Refusing to read an unexpected attachment key: ${key}`)
  }

  const bucket = process.env.S3_BUCKET
  if (!bucket) {
    throw new Error('S3_BUCKET is not configured')
  }

  const controller = new AbortController()
  let cancelBody = () => controller.abort()
  let budgetError: Error | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const budget =
    timeoutMs === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            budgetError = new Error('Attachment download exceeded its delivery budget')
            cancelBody()
            reject(budgetError)
          }, timeoutMs)
        })
  let response
  try {
    const request = getS3Client().send(
      new GetObjectCommand({Bucket: bucket, Key: key}),
      {abortSignal: controller.signal},
    )
    response = budget ? await Promise.race([request, budget]) : await request
  } finally {
    if (!response && timeout) clearTimeout(timeout)
  }
  if (!response.Body) {
    if (timeout) clearTimeout(timeout)
    throw new Error('Attachment object did not include a body')
  }

  if (!budget) {
    return Buffer.from(await response.Body.transformToByteArray())
  }

  const body = response.Body
  if ('destroy' in body && typeof body.destroy === 'function') {
    cancelBody = () => {
      controller.abort()
      body.destroy(budgetError)
    }
  }
  try {
    const bytes = await Promise.race([body.transformToByteArray(), budget])
    return Buffer.from(bytes)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export const deleteAttachment = async (key: string): Promise<void> => {
  if (!isValidAttachmentKey(key)) {
    throw new Error(`Refusing to delete an unexpected attachment key: ${key}`)
  }

  const bucket = process.env.S3_BUCKET
  if (!bucket) {
    throw new Error('S3_BUCKET is not configured')
  }

  await getS3Client().send(new DeleteObjectCommand({Bucket: bucket, Key: key}))
}
