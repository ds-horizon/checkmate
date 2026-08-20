import {createHash} from 'node:crypto'
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
  testProjectId: 5,
  testTitle: 'Checkout completes successfully',
}

const createTransaction = ({
  selectResults,
  failOutbox = false,
}: {
  selectResults: QueryResult[]
  failOutbox?: boolean
}) => {
  const insertedValues: unknown[] = []
  const updatedValues: unknown[] = []
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
      const isDefectCycle =
        typeof values === 'object' &&
        values !== null &&
        'state' in values &&
        values.state === 'intake_pending'
      return isDefectCycle
        ? [{insertId: 73}]
        : insertedValues.length === 1
        ? [{insertId: 41}]
        : [{insertId: 1}]
    }),
  }))
  const updateWhere = jest.fn(async () => [{affectedRows: 1}])
  const updateSet = jest.fn((values: unknown) => {
    updatedValues.push(values)
    return {where: updateWhere}
  })
  const update = jest.fn(() => ({set: updateSet}))

  return {
    trx: {select, insert, update},
    insertedValues,
    updatedValues,
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

  it('includes explicit Plane creation intent in the command fingerprint', () => {
    expect(
      fingerprintResultCommand({...command, createPlaneDefect: true}),
    ).not.toBe(fingerprintResultCommand(command))
  })

  it('preserves the legacy fingerprint when Plane intent is omitted', () => {
    const legacyPayload = JSON.stringify({
      resultCommandId: command.resultCommandId,
      testRunMapId: command.testRunMapId,
      status: command.status,
      actorUserId: command.actorUserId,
      commentIncluded: true,
      comment: command.comment,
      attachmentKeys: [],
    })

    expect(fingerprintResultCommand(command)).toBe(
      createHash('sha256').update(legacyPayload, 'utf8').digest('hex'),
    )
    expect(
      fingerprintResultCommand({...command, createPlaneDefect: false}),
    ).toBe(fingerprintResultCommand(command))
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
        defectCycleId: null,
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
      defectCycleId: null,
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

  it('normalizes receipts written before defect cycle tracking', async () => {
    const legacyOutcome = {
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
            outcome: legacyOutcome,
          },
        ],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(saveHumanResult(command)).resolves.toEqual({
      ...legacyOutcome,
      defectCycleId: null,
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

  it('rejects Plane creation without eligible status and evidence', async () => {
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

    await expect(
      saveHumanResult({
        ...command,
        status: TestStatusType.Passed,
        comment: '',
        createPlaneDefect: true,
      }),
    ).rejects.toEqual(expect.objectContaining({status: 400}))
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('validates a correlated active cycle and invalidates its retest notification when a human passes', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [{defectCycleId: 73}],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(
      saveHumanResult({...command, status: TestStatusType.Passed}),
    ).resolves.toEqual(
      expect.objectContaining({defectCycleId: 73, replayed: false}),
    )

    expect(fake.update).toHaveBeenCalledTimes(4)
    expect(fake.updatedValues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'validated',
          activeMarker: null,
          closedOn: expect.any(Date),
        }),
        {defectCycleId: 73},
        {invalidatedOn: expect.any(Date)},
      ]),
    )
    expect(fake.insertedValues[2]).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({defectCycleId: 73}),
      }),
    )
    expect(fake.insertedValues[3]).toEqual(
      expect.objectContaining({
        outcome: expect.objectContaining({defectCycleId: 73}),
      }),
    )
    expect(fake.insertedValues).toHaveLength(4)
  })

  it('requires an explicit issue decision when a ready retest fails', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [
          {
            defectCycleId: 72,
            state: 'ready_for_retest',
            provider: 'plane',
            providerWorkspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
            providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
            providerWorkItemId: 'work-item-id',
          },
        ],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(
      saveHumanResult({...command, createPlaneDefect: true}),
    ).rejects.toEqual(expect.objectContaining({status: 400}))
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('queues a fenced reopen when a failed retest is the same issue', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [
          {
            defectCycleId: 72,
            state: 'ready_for_retest',
            provider: 'plane',
            providerWorkspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
            providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
            providerWorkItemId: 'work-item-id',
          },
        ],
        [],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(
      saveHumanResult({
        ...command,
        createPlaneDefect: true,
        retestIssue: 'same_issue',
      }),
    ).resolves.toEqual(expect.objectContaining({defectCycleId: 72}))

    expect(fake.insertedValues[0]).toEqual(
      expect.objectContaining({retestIssue: 'same_issue'}),
    )
    expect(fake.updatedValues).toContainEqual(
      expect.objectContaining({
        currentEvidenceRevisionId: 41,
        state: 'work_item_open',
        reopenState: 'pending',
        reopenRevisionId: 41,
      }),
    )
    expect(fake.updatedValues).toContainEqual({
      invalidatedOn: expect.any(Date),
    })
    expect(fake.insertedValues).toContainEqual(
      expect.objectContaining({
        eventKey: 'plane-cycle-action:same_issue_reopen:72:41',
        eventType: 'plane_cycle_action_requested',
        payload: expect.objectContaining({
          planeCycleActionIntent: expect.objectContaining({
            action: 'same_issue_reopen',
            workItemId: 'work-item-id',
          }),
        }),
      }),
    )
  })

  it('supersedes the old cycle and opens a new one for a different issue', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [
          {
            defectCycleId: 72,
            state: 'ready_for_retest',
            provider: 'plane',
            providerWorkspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
            providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
            providerWorkItemId: 'work-item-id',
          },
        ],
        [{cycleNumber: 1}],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await expect(
      saveHumanResult({
        ...command,
        createPlaneDefect: true,
        retestIssue: 'different_issue',
      }),
    ).resolves.toEqual(expect.objectContaining({defectCycleId: 73}))

    expect(fake.updatedValues).toContainEqual(
      expect.objectContaining({
        state: 'superseded',
        activeMarker: null,
        closedOn: expect.any(Date),
      }),
    )
    expect(fake.updatedValues).toContainEqual({
      invalidatedOn: expect.any(Date),
    })
    expect(fake.insertedValues).toContainEqual(
      expect.objectContaining({
        testRunMapId: 17,
        cycleNumber: 2,
        state: 'intake_pending',
        openingRevisionId: 41,
      }),
    )
    expect(fake.insertedValues).toContainEqual(
      expect.objectContaining({
        eventKey: 'plane-cycle-action:different_issue_superseded:72:41',
      }),
    )
    expect(fake.insertedValues).toContainEqual(
      expect.objectContaining({
        eventKey: 'defect-cycle:73:plane-create',
      }),
    )
  })

  it('reserves one active cycle and enqueues a correlated Plane create', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [],
        [],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    const result = await saveHumanResult({...command, createPlaneDefect: true})

    expect(result.defectCycleId).toBe(73)
    expect(fake.insert).toHaveBeenCalledTimes(5)
    const cycle = fake.insertedValues[2] as Record<string, unknown>
    expect(cycle).toEqual(
      expect.objectContaining({
        testRunMapId: 17,
        cycleNumber: 1,
        activeMarker: 1,
        state: 'intake_pending',
        openingRevisionId: 41,
        currentEvidenceRevisionId: 41,
        provider: 'plane',
        providerWorkspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
        providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
        createCorrelationKey: expect.stringMatching(
          /^checkmate:[0-9a-f-]{36}$/,
        ),
      }),
    )
    expect(fake.insertedValues[3]).toEqual(
      expect.objectContaining({
        eventKey: 'defect-cycle:73:plane-create',
        eventType: 'plane_defect_create_requested',
        aggregateType: 'defect_cycle',
        aggregateId: 73,
        payload: expect.objectContaining({
          defectCycleId: 73,
          planeDefectIntent: expect.objectContaining({
            create: true,
            defectCycleId: 73,
            correlationKey: cycle.createCorrelationKey,
            priority: 'none',
          }),
        }),
      }),
    )
    expect(fake.update).toHaveBeenCalledTimes(2)
  })

  it('reuses an active cycle without enqueuing a second create', async () => {
    const fake = createTransaction({
      selectResults: [
        [aggregate],
        [],
        [{testRunMapId: 17}],
        [{userId: 23, role: 'user'}],
        [],
        [
          {
            defectCycleId: 73,
            provider: 'plane',
            providerWorkspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
            providerProjectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
          },
        ],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    const result = await saveHumanResult({...command, createPlaneDefect: true})

    expect(result.defectCycleId).toBe(73)
    expect(fake.insert).toHaveBeenCalledTimes(6)
    expect(fake.insertedValues[2]).toEqual(
      expect.objectContaining({
        defectCycleId: 73,
        resultRevisionId: 41,
        sourceKind: 'note',
        sourceIdentity: 'result-revision:41:note',
        sourceText: command.comment,
      }),
    )
    expect(fake.insertedValues[3]).toEqual(
      expect.objectContaining({
        eventType: 'result_revision_committed',
        payload: expect.objectContaining({defectCycleId: 73}),
      }),
    )
    expect(fake.insertedValues[3]).toEqual(
      expect.objectContaining({
        payload: expect.not.objectContaining({
          planeDefectIntent: expect.anything(),
        }),
      }),
    )
    expect(fake.insertedValues[4]).toEqual(
      expect.objectContaining({
        eventType: 'plane_evidence_delivery_requested',
        aggregateType: 'plane_evidence',
        payload: expect.objectContaining({
          planeEvidenceIntent: expect.objectContaining({
            defectCycleId: 73,
            resultRevisionId: 41,
          }),
        }),
      }),
    )
    expect(fake.update).toHaveBeenCalledTimes(3)
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

  it('enqueues each approved screenshot as an independent Plane evidence item', async () => {
    const attachmentCommand = {
      ...command,
      createPlaneDefect: true,
      attachmentKeys: [
        'test-run-attachments/a.png',
        'test-run-attachments/b.webp',
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
            contentType: 'image/png',
            byteSize: 9,
            sha256: 'a'.repeat(64),
            lifecycleState: 'uploaded',
          },
          {
            resultAttachmentObjectId: 52,
            objectKey: 'test-run-attachments/b.webp',
            testRunMapId: 17,
            orgId: 3,
            projectId: 5,
            runId: 7,
            testId: 11,
            contentType: 'image/webp',
            byteSize: 10,
            sha256: 'b'.repeat(64),
            lifecycleState: 'uploaded',
          },
        ],
        [],
        [],
        [],
        [],
      ],
    })
    transaction.mockImplementation(async (callback) => callback(fake.trx))

    await saveHumanResult(attachmentCommand)

    const evidenceRows = fake.insertedValues.filter(
      (value): value is Record<string, unknown> =>
        typeof value === 'object' &&
        value !== null &&
        'sourceIdentity' in value,
    )
    expect(evidenceRows).toEqual([
      expect.objectContaining({
        sourceKind: 'attachment',
        sourceIdentity: `result-attachment:51:${'a'.repeat(64)}`,
        sourceObjectKey: 'test-run-attachments/a.png',
        providerResourceName: expect.stringContaining('checkmate-51-'),
      }),
      expect.objectContaining({
        sourceKind: 'attachment',
        sourceIdentity: `result-attachment:52:${'b'.repeat(64)}`,
        sourceObjectKey: 'test-run-attachments/b.webp',
        providerResourceName: expect.stringContaining('checkmate-52-'),
      }),
    ])

    const evidenceEvents = fake.insertedValues.filter(
      (value): value is Record<string, unknown> =>
        typeof value === 'object' &&
        value !== null &&
        'eventType' in value &&
        value.eventType === 'plane_evidence_delivery_requested',
    )
    expect(evidenceEvents).toHaveLength(2)
    expect(evidenceEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({aggregateType: 'plane_evidence'}),
        expect.objectContaining({aggregateType: 'plane_evidence'}),
      ]),
    )
  })
})
