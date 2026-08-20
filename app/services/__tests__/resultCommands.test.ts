import {TestStatusType} from '~/dataController/types'

const transaction = jest.fn()

jest.mock('~/db/client', () => ({
  dbClient: {transaction},
}))

import {fingerprintResultCommand, saveHumanResult} from '../resultCommands'

type QueryResult = unknown[]

const createQuery = (result: QueryResult) => {
  const query: any = {}
  for (const method of [
    'from',
    'innerJoin',
    'where',
    'for',
    'limit',
    'orderBy',
  ]) {
    query[method] = jest.fn(() => query)
  }
  query.then = (resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)
  return query
}

const command = {
  resultCommandId: '2fc3cc24-4149-45c4-a8e8-5d9c62c71c36',
  testRunMapId: 17,
  status: TestStatusType.Failed,
  comment: 'Checkout fails after submit',
  actorUserId: 23,
}

const aggregate = {
  testRunMapId: 17,
  mapRunId: 7,
  mapTestId: 11,
  mapProjectId: 5,
  isIncluded: true,
  currentComment: null,
  runId: 7,
  runProjectId: 5,
  runStatus: 'Active',
  orgId: 3,
  projectCreatedBy: 23,
}

const createTransaction = ({
  selectResults,
  failOutbox = false,
}: {
  selectResults: QueryResult[]
  failOutbox?: boolean
}) => {
  const insertedValues: unknown[] = []
  const select = jest.fn(() => createQuery(selectResults.shift() ?? []))
  const insert = jest.fn(() => ({
    values: jest.fn(async (values: unknown) => {
      insertedValues.push(values)
      if (
        failOutbox &&
        typeof values === 'object' &&
        values !== null &&
        'eventType' in values
      ) {
        throw new Error('outbox unavailable')
      }
      return insertedValues.length === 1 ? [{insertId: 41}] : [{insertId: 1}]
    }),
  }))
  const updateWhere = jest.fn(async () => [{affectedRows: 1}])
  const updateSet = jest.fn(() => ({where: updateWhere}))
  const update = jest.fn(() => ({set: updateSet}))

  return {
    trx: {select, insert, update},
    insertedValues,
    insert,
    update,
  }
}

describe('result commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scopes the command fingerprint to the authenticated actor', () => {
    const samePayloadWithAnotherActor = {...command, actorUserId: 999}
    const first = fingerprintResultCommand(command)
    const second = fingerprintResultCommand(samePayloadWithAnotherActor)

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('distinguishes preserving a comment from explicitly clearing it', () => {
    const withoutComment = fingerprintResultCommand({
      resultCommandId: command.resultCommandId,
      testRunMapId: command.testRunMapId,
      status: command.status,
      actorUserId: command.actorUserId,
    })
    const clearedComment = fingerprintResultCommand({
      resultCommandId: command.resultCommandId,
      testRunMapId: command.testRunMapId,
      status: command.status,
      comment: null,
      actorUserId: command.actorUserId,
    })

    expect(withoutComment).not.toBe(clearedComment)
  })

  it('writes revision, projection, outbox, and receipt in one transaction', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    const result = await saveHumanResult(command)

    expect(transaction).toHaveBeenCalledTimes(1)
    expect(fake.update).toHaveBeenCalledTimes(1)
    expect(fake.insert).toHaveBeenCalledTimes(4)
    expect(fake.insertedValues[0]).toEqual(
      expect.objectContaining({
        testRunMapId: 17,
        orgId: 3,
        projectId: 5,
        runId: 7,
        testId: 11,
        actorUserId: 23,
        actorType: 'human',
        sourceSystem: 'checkmate',
        sourceEventId: command.resultCommandId,
      }),
    )
    expect(fake.insertedValues[1]).toEqual(
      expect.objectContaining({
        runId: 7,
        testId: 11,
        status: TestStatusType.Failed,
        attachments: [],
      }),
    )
    expect(fake.insertedValues[2]).toEqual(
      expect.objectContaining({
        eventKey: 'result-revision:41:committed',
        eventType: 'result_revision_committed',
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        resultRevisionId: 41,
        revisionNumber: 1,
        orgId: 3,
        projectId: 5,
        attachmentKeys: [],
        replayed: false,
      }),
    )
  })

  it('replays the stored outcome without writing again', async () => {
    const outcome = {
      resultCommandId: command.resultCommandId,
      resultRevisionId: 41,
      revisionNumber: 1,
      testRunMapId: 17,
      orgId: 3,
      projectId: 5,
      runId: 7,
      testId: 11,
      status: TestStatusType.Failed,
      comment: command.comment,
      attachmentKeys: [],
    }
    const fake = createTransaction({
      selectResults: [
        [{...aggregate, runStatus: 'Locked'}],
        [
          {
            requestFingerprint: fingerprintResultCommand(command),
            outcome,
          },
        ],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(saveHumanResult(command)).resolves.toEqual({
      ...outcome,
      replayed: true,
    })
    expect(fake.insert).not.toHaveBeenCalled()
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('rejects a reused command ID with a different payload', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [
          {
            requestFingerprint: 'different',
            outcome: {},
          },
        ],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(saveHumanResult(command)).rejects.toEqual(
      expect.objectContaining({status: 409}),
    )
    expect(fake.insert).not.toHaveBeenCalled()
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('propagates an outbox failure so the database transaction can roll back', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
      ],
      failOutbox: true,
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(saveHumanResult(command)).rejects.toThrow('outbox unavailable')
    expect(fake.insert).toHaveBeenCalledTimes(3)
  })

  it('rejects inactive runs inside the transaction', async () => {
    const fake = createTransaction({
      selectResults: [[{...aggregate, runStatus: 'Locked'}], []],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(saveHumanResult(command)).rejects.toEqual(
      expect.objectContaining({status: 423}),
    )
    expect(fake.insert).not.toHaveBeenCalled()
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('rejects duplicate result mappings before writing a revision', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}, {testRunMapId: 18}],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(saveHumanResult(command)).rejects.toEqual(
      expect.objectContaining({status: 409}),
    )
    expect(fake.insert).not.toHaveBeenCalled()
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('rejects a non-owner non-admin after checking for a replay receipt', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 99, role: 'user'}],
        [],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(
      saveHumanResult({...command, actorUserId: 99}),
    ).rejects.toEqual(expect.objectContaining({status: 403}))
    expect(fake.insert).not.toHaveBeenCalled()
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('allows an administrator to save a result outside their project', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 99, role: 'admin'}],
        [],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(
      saveHumanResult({...command, actorUserId: 99}),
    ).resolves.toEqual(expect.objectContaining({replayed: false}))
  })

  it('stores normalized revision attachment ownership and compatibility history', async () => {
    const attachmentCommand = {
      ...command,
      attachmentKeys: [
        'test-run-attachments/b.png',
        'test-run-attachments/a.png',
        'test-run-attachments/b.png',
      ],
    }
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [
          {
            resultAttachmentObjectId: 51,
            objectKey: 'test-run-attachments/a.png',
            testRunMapId: 17,
            orgId: 3,
            projectId: 5,
            runId: 7,
            testId: 11,
            lifecycleState: 'uploaded',
          },
          {
            resultAttachmentObjectId: 52,
            objectKey: 'test-run-attachments/b.png',
            testRunMapId: 17,
            orgId: 3,
            projectId: 5,
            runId: 7,
            testId: 11,
            lifecycleState: 'committed',
          },
        ],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    const result = await saveHumanResult(attachmentCommand)

    expect(fake.insert).toHaveBeenCalledTimes(5)
    expect(fake.insertedValues[1]).toEqual([
      {
        resultRevisionId: 41,
        resultAttachmentObjectId: 51,
        objectKey: 'test-run-attachments/a.png',
        retentionPolicy: 'source_owned',
      },
      {
        resultRevisionId: 41,
        resultAttachmentObjectId: 52,
        objectKey: 'test-run-attachments/b.png',
        retentionPolicy: 'source_owned',
      },
    ])
    expect(fake.update).toHaveBeenCalledTimes(2)
    expect(fake.insertedValues[2]).toEqual(
      expect.objectContaining({
        attachments: [
          'test-run-attachments/a.png',
          'test-run-attachments/b.png',
        ],
      }),
    )
    expect(result.attachmentKeys).toEqual([
      'test-run-attachments/a.png',
      'test-run-attachments/b.png',
    ])
  })
})
