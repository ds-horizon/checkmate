import {
  buildAttachmentKey,
  deleteAttachment,
  downloadAttachment,
  getSignedAttachmentUrl,
  isValidAttachmentKey,
  uploadAttachment,
} from '@services/s3'

const sendMock = jest.fn()

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({send: sendMock})),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({input})),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({input})),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({input})),
}))

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example.com/x'),
}))

describe('s3 service', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {...OLD_ENV, S3_BUCKET: 'test-bucket', S3_REGION: 'us-west-2'}
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  describe('buildAttachmentKey / isValidAttachmentKey', () => {
    it('builds a key that satisfies isValidAttachmentKey', () => {
      const key = buildAttachmentKey('screenshot.png')
      expect(isValidAttachmentKey(key)).toBe(true)
      expect(key).toMatch(/^test-run-attachments\/.+-screenshot\.png$/)
    })

    it('sanitizes unsafe characters and path separators out of the filename', () => {
      const key = buildAttachmentKey('../../../etc/passwd')
      expect(key).not.toContain('/../')
      expect(key.startsWith('test-run-attachments/')).toBe(true)
      expect(isValidAttachmentKey(key)).toBe(true)
    })

    it('rejects keys outside the expected prefix/shape', () => {
      expect(isValidAttachmentKey('db-backups/nightly.sql.gz')).toBe(false)
      expect(isValidAttachmentKey('test-run-attachments/../secret')).toBe(false)
      expect(isValidAttachmentKey('test-run-attachments/not-a-uuid.png')).toBe(
        false,
      )
    })
  })

  describe('getSignedAttachmentUrl', () => {
    it('signs a valid attachment key', async () => {
      const key = buildAttachmentKey('screenshot.png')
      const url = await getSignedAttachmentUrl(key)
      expect(url).toBe('https://signed.example.com/x')
    })

    it('throws instead of signing an arbitrary/unscoped key', async () => {
      await expect(
        getSignedAttachmentUrl('db-backups/nightly.sql.gz'),
      ).rejects.toThrow()
    })
  })

  describe('deleteAttachment', () => {
    it('deletes a valid attachment key', async () => {
      const key = buildAttachmentKey('screenshot.png')
      await deleteAttachment(key)
      expect(sendMock).toHaveBeenCalledTimes(1)
    })

    it('throws instead of deleting an arbitrary/unscoped key', async () => {
      await expect(
        deleteAttachment('db-backups/nightly.sql.gz'),
      ).rejects.toThrow()
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('downloadAttachment', () => {
    it('downloads a valid attachment into a buffer', async () => {
      const key = buildAttachmentKey('screenshot.png')
      sendMock.mockResolvedValueOnce({
        Body: {transformToByteArray: async () => new Uint8Array([1, 2, 3])},
      })

      await expect(downloadAttachment(key)).resolves.toEqual(
        Buffer.from([1, 2, 3]),
      )
    })

    it('aborts a body download that exceeds its delivery budget', async () => {
      jest.useFakeTimers()
      const key = buildAttachmentKey('screenshot.png')
      const transformToByteArray = jest.fn(
        () => new Promise<Uint8Array>(() => {}),
      )
      const destroy = jest.fn()
      sendMock.mockResolvedValueOnce({
        Body: {transformToByteArray, destroy},
      })

      const download = downloadAttachment(key, {timeoutMs: 10})
      const assertion = expect(download).rejects.toThrow(
        'exceeded its delivery budget',
      )
      await jest.advanceTimersByTimeAsync(10)
      await assertion
      expect(destroy).toHaveBeenCalled()
      jest.useRealTimers()
    })

    it('refuses to read an arbitrary key', async () => {
      await expect(
        downloadAttachment('db-backups/nightly.sql.gz'),
      ).rejects.toThrow('Refusing to read')
      expect(sendMock).not.toHaveBeenCalled()
    })
  })

  describe('uploadAttachment', () => {
    it('throws when S3_BUCKET is not configured', async () => {
      delete process.env.S3_BUCKET
      await expect(
        uploadAttachment({
          key: 'test-run-attachments/x',
          body: Buffer.from('a'),
        }),
      ).rejects.toThrow('S3_BUCKET is not configured')
    })

    it('uploads when configured', async () => {
      const key = buildAttachmentKey('screenshot.png')
      await uploadAttachment({
        key,
        body: Buffer.from('a'),
        contentType: 'image/png',
      })
      expect(sendMock).toHaveBeenCalledTimes(1)
    })
  })
})
