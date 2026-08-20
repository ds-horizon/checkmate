const transaction = jest.fn()
const directSelect = jest.fn()
const directUpdate = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {
    transaction,
    select: directSelect,
    update: directUpdate,
  },
}))

import {
  assertResultAttachmentReadScope,
  recordResultAttachmentUploaded,
  registerResultAttachmentUpload,
  reserveResultAttachmentDeletion,
} from '../resultAttachments'

const createQuery = (rows: unknown[]) => {
  const query: any = {}
  for (const method of ['from', 'innerJoin', 'where', 'for', 'limit']) {
    query[method] = jest.fn(() => query)
  }
  query.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(rows).then(resolve)
  return query
}

const createUpdateQuery = (affectedRows = 1) => {
  const where = jest.fn(async () => [{affectedRows}])
  const set = jest.fn(() => ({where}))
  return {set, where}
}

const aggregate = {
  testRunMapId: 17,
  mapRunId: 7,
  mapTestId: 11,
  mapProjectId: 5,
  isIncluded: true,
  runId: 7,
  runProjectId: 5,
  runStatus: 'Active',
  orgId: 3,
  projectCreatedBy: 23,
}

describe('result attachment ownership', () => {
  beforeEach(() => {
    transaction.mockReset()
    directSelect.mockReset()
    directUpdate.mockReset()
  })

  it('registers immutable upload metadata from the locked aggregate', async () => {
    const rows = [[aggregate], [{userId: 23, role: 'user'}]]
    const values = jest.fn(async () => [{insertId: 51}])
    const trx = {
      select: jest.fn(() => createQuery(rows.shift() ?? [])),
      insert: jest.fn(() => ({values})),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await registerResultAttachmentUpload({
      objectKey: 'test-run-attachments/a.png',
      testRunMapId: 17,
      uploaderUserId: 23,
      contentType: 'image/png',
      byteSize: 1234,
      sha256: 'a'.repeat(64),
    })

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        testRunMapId: 17,
        orgId: 3,
        projectId: 5,
        runId: 7,
        testId: 11,
        uploaderUserId: 23,
        lifecycleState: 'pending_upload',
      }),
    )
  })

  it('rejects uploads outside an active included result', async () => {
    const trx = {
      select: jest.fn(() => createQuery([{...aggregate, runStatus: 'Locked'}])),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      registerResultAttachmentUpload({
        objectKey: 'test-run-attachments/a.png',
        testRunMapId: 17,
        uploaderUserId: 23,
        contentType: 'image/png',
        byteSize: 1234,
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({status: 409})
    expect(trx.insert).not.toHaveBeenCalled()
  })

  it('rejects a non-owner non-admin before registering an upload', async () => {
    const rows = [[aggregate], [{userId: 99, role: 'user'}]]
    const trx = {
      select: jest.fn(() => createQuery(rows.shift() ?? [])),
      insert: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      registerResultAttachmentUpload({
        objectKey: 'test-run-attachments/a.png',
        testRunMapId: 17,
        uploaderUserId: 99,
        contentType: 'image/png',
        byteSize: 1234,
        sha256: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({status: 403})
    expect(trx.insert).not.toHaveBeenCalled()
  })

  it('records upload completion with a fenced lifecycle transition', async () => {
    const updateQuery = createUpdateQuery()
    directUpdate.mockReturnValue(updateQuery)

    await recordResultAttachmentUploaded('test-run-attachments/a.png')

    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({lifecycleState: 'uploaded', lastError: null}),
    )
  })

  it('does not reserve deletion for evidence referenced by a revision', async () => {
    const rows = [
      [
        {
          resultAttachmentObjectId: 51,
          uploaderUserId: 23,
          lifecycleState: 'uploaded',
        },
      ],
      [{resultRevisionAttachmentId: 61}],
    ]
    const trx = {
      select: jest.fn(() => createQuery(rows.shift() ?? [])),
      update: jest.fn(),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await expect(
      reserveResultAttachmentDeletion({
        objectKey: 'test-run-attachments/a.png',
        actorUserId: 23,
      }),
    ).rejects.toMatchObject({status: 409})
    expect(trx.update).not.toHaveBeenCalled()
  })

  it('reserves an uploader-owned uncommitted draft for deletion', async () => {
    const rows = [
      [
        {
          resultAttachmentObjectId: 51,
          uploaderUserId: 23,
          lifecycleState: 'uploaded',
        },
      ],
      [],
    ]
    const updateQuery = createUpdateQuery()
    const trx = {
      select: jest.fn(() => createQuery(rows.shift() ?? [])),
      update: jest.fn(() => updateQuery),
    }
    transaction.mockImplementation(async (callback) => callback(trx))

    await reserveResultAttachmentDeletion({
      objectKey: 'test-run-attachments/a.png',
      actorUserId: 23,
    })

    expect(updateQuery.set).toHaveBeenCalledWith({
      lifecycleState: 'delete_pending',
      lastError: null,
    })
  })

  it.each(['pending_upload', 'failed'] as const)(
    'reserves an uploader-owned %s draft for deletion',
    async (lifecycleState) => {
      const rows = [
        [
          {
            resultAttachmentObjectId: 51,
            uploaderUserId: 23,
            lifecycleState,
          },
        ],
        [],
      ]
      const updateQuery = createUpdateQuery()
      const trx = {
        select: jest.fn(() => createQuery(rows.shift() ?? [])),
        update: jest.fn(() => updateQuery),
      }
      transaction.mockImplementation(async (callback) => callback(trx))

      await expect(
        reserveResultAttachmentDeletion({
          objectKey: 'test-run-attachments/a.png',
          actorUserId: 23,
        }),
      ).resolves.toBe(lifecycleState)
    },
  )

  it('allows a valid legacy attachment key returned by scoped history', async () => {
    directSelect.mockReturnValue(
      createQuery([{objectKey: 'test-run-attachments/a.png'}]),
    )

    await expect(
      assertResultAttachmentReadScope({
        objectKeys: [
          'test-run-attachments/123e4567-e89b-12d3-a456-426614174000-a.png',
        ],
        runId: 7,
        testId: 11,
      }),
    ).resolves.toBeUndefined()
  })

  it('rejects metadata-bearing objects outside the requested scope', async () => {
    directSelect.mockReturnValue(
      createQuery([
        {
          objectKey: 'test-run-attachments/a.png',
          objectRunId: 8,
          objectTestId: 11,
          lifecycleState: 'committed',
        },
      ]),
    )

    await expect(
      assertResultAttachmentReadScope({
        objectKeys: ['test-run-attachments/a.png'],
        runId: 7,
        testId: 11,
      }),
    ).rejects.toMatchObject({status: 403})
  })
})
