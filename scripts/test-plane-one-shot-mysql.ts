import {randomUUID} from 'node:crypto'
import mysql from 'mysql2/promise'
import {drizzle} from 'drizzle-orm/mysql2'
import type {
  Connection,
  ConnectionOptions,
  ResultSetHeader,
  RowDataPacket,
} from 'mysql2/promise'

const HARNESS_URL =
  process.env.CHECKMATE_MYSQL_HARNESS_URL ?? process.env.MYSQL_HARNESS_URL
const QUERY_TIMEOUT_MS = 5_000
const CLEANUP_TIMEOUT_MS = 5_000
const MAX_DEADLOCK_ATTEMPTS = 3

const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const withTimeout = async <T>(
  promise: Promise<T>,
  label: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${QUERY_TIMEOUT_MS}ms`)),
          QUERY_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const isMySqlDeadlock = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false
  const mysqlError = error as {
    code?: unknown
    errno?: unknown
    sqlState?: unknown
    sqlstate?: unknown
    SQLSTATE?: unknown
  }
  return (
    mysqlError.code === 'ER_LOCK_DEADLOCK' ||
    mysqlError.errno === 1213 ||
    [mysqlError.sqlState, mysqlError.sqlstate, mysqlError.SQLSTATE].includes(
      '40001',
    )
  )
}

const withDeadlockRetry = async <T>(
  operation: (attempt: number) => Promise<T>,
): Promise<T> => {
  for (let attempt = 1; attempt <= MAX_DEADLOCK_ATTEMPTS; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      if (!isMySqlDeadlock(error) || attempt === MAX_DEADLOCK_ATTEMPTS) {
        throw error
      }
    }
  }
  throw new Error('Harness deadlock retry loop exhausted')
}

const quoteIdentifier = (value: string) => `\`${value.replaceAll('`', '``')}\``

const readLocalConnectionOptions = (): ConnectionOptions => {
  if (!HARNESS_URL) {
    throw new Error(
      'CHECKMATE_MYSQL_HARNESS_URL is required when running the MySQL harness',
    )
  }
  const url = new URL(HARNESS_URL)
  if (url.protocol !== 'mysql:') {
    throw new Error('CHECKMATE_MYSQL_HARNESS_URL must use mysql://')
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(
      'The MySQL harness refuses non-local hosts; use a disposable local MySQL 8 instance',
    )
  }
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  }
}

const closeQuietly = async (connection: Connection | undefined) => {
  if (!connection) return
  try {
    await withTimeout(connection.end(), 'MySQL connection cleanup')
  } catch {
    // Cleanup must not hide the harness assertion that failed first.
    connection.destroy()
  }
}

const createSchema = async (connection: Connection, database: string) => {
  const schema = quoteIdentifier(database)
  // These are the production table names and every column selected or fenced
  // by the real one-shot service. The harness intentionally keeps the fixture
  // schema small, but all reconciliation SQL runs through Drizzle/MySQL.
  await connection.query(`
    CREATE TABLE ${schema}.runs (
      runId INT PRIMARY KEY,
      projectId INT NOT NULL,
      status VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.tests (
      testId INT PRIMARY KEY,
      projectId INT NOT NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.testRunMap (
      testRunMapId INT PRIMARY KEY,
      projectId INT NOT NULL,
      runId INT NOT NULL,
      testId INT NOT NULL,
      isIncluded BOOLEAN NOT NULL,
      currentResultRevisionId INT NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.resultRevisions (
      resultRevisionId INT PRIMARY KEY,
      testRunMapId INT NOT NULL,
      projectId INT NOT NULL,
      runId INT NOT NULL,
      testId INT NOT NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.defectCycles (
      defectCycleId INT PRIMARY KEY,
      testRunMapId INT NOT NULL,
      cycleNumber INT NOT NULL,
      activeMarker INT NULL,
      projectId INT NOT NULL,
      runId INT NOT NULL,
      testId INT NOT NULL,
      state VARCHAR(32) NOT NULL,
      currentEvidenceRevisionId INT NOT NULL,
      provider VARCHAR(32) NULL,
      providerWorkspaceId VARCHAR(64) NULL,
      providerProjectId VARCHAR(64) NULL,
      providerWorkItemId VARCHAR(64) NULL,
      providerIntakeId VARCHAR(64) NULL,
      providerStateId VARCHAR(64) NULL,
      providerSequenceId INT NULL,
      providerUrl VARCHAR(500) NULL,
      createCorrelationKey VARCHAR(128) NULL,
      lastProviderObservedOn DATETIME NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.resultOutbox (
      resultOutboxId INT PRIMARY KEY,
      eventKey VARCHAR(128) NOT NULL,
      eventType VARCHAR(64) NOT NULL,
      aggregateType VARCHAR(32) NOT NULL,
      aggregateId INT NOT NULL,
      resultRevisionId INT NOT NULL,
      payload JSON NOT NULL,
      deliveryState VARCHAR(32) NOT NULL,
      availableOn DATETIME NOT NULL,
      leaseToken VARCHAR(64) NULL,
      leaseExpiresOn DATETIME NULL,
      attemptCount INT NOT NULL,
      lastError TEXT NULL,
      deliveredOn DATETIME NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(
    `INSERT INTO ${schema}.runs (runId, projectId, status) VALUES (8, 7, 'Active')`,
  )
  await connection.query(
    `INSERT INTO ${schema}.tests (testId, projectId) VALUES (9, 7)`,
  )
  await connection.query(
    `INSERT INTO ${schema}.testRunMap
      (testRunMapId, projectId, runId, testId, isIncluded, currentResultRevisionId)
      VALUES (21, 7, 8, 9, TRUE, 41)`,
  )
  await connection.query(
    `INSERT INTO ${schema}.resultRevisions
      (resultRevisionId, testRunMapId, projectId, runId, testId)
      VALUES (41, 21, 7, 8, 9)`,
  )
  await connection.query(
    `INSERT INTO ${schema}.defectCycles
      (defectCycleId, testRunMapId, cycleNumber, activeMarker, projectId, runId, testId,
       state, currentEvidenceRevisionId, provider, providerWorkspaceId, providerProjectId,
       createCorrelationKey)
      VALUES (31, 21, 1, 1, 7, 8, 9, 'manual_attention', 41, 'plane',
        'e36dfd86-953a-4e33-a410-856208893bb9',
        '67726ee5-7d0c-4656-8bc8-b2f8a959d5da', 'checkmate:correlation-41')`,
  )
  const payload = JSON.stringify({
    resultRevisionId: 41,
    testRunMapId: 21,
    projectId: 7,
    runId: 8,
    testId: 9,
    defectCycleId: 31,
    planeDefectIntent: {
      create: true,
      defectCycleId: 31,
      correlationKey: 'checkmate:correlation-41',
      title: 'Failed Checkmate test',
      description: 'Run 8 / test 9\nCorrelation: checkmate:correlation-41',
      priority: 'high',
      attachmentKeys: [],
    },
  })
  await connection.query(
    `INSERT INTO ${schema}.resultOutbox
      (resultOutboxId, eventKey, eventType, aggregateType, aggregateId, resultRevisionId,
       payload, deliveryState, availableOn, attemptCount)
      VALUES (51, 'defect-cycle:31:plane-create', 'plane_defect_create_requested',
        'defect_cycle', 31, 41, ?, 'manual_attention', '2026-08-22 00:00:00', 0)`,
    [payload],
  )
}

const lockMapThenCycleAndOutbox = async (connection: Connection) => {
  await connection.beginTransaction()
  await connection.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 21 FOR UPDATE',
  )
  await connection.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 31 FOR UPDATE',
  )
  await connection.query(
    'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 51 FOR UPDATE',
  )
  await connection.commit()
}

const assertConcurrentMapFirstLocksDoNotDeadlock = async (
  first: Connection,
  second: Connection,
) => {
  await first.beginTransaction()
  await first.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 21 FOR UPDATE',
  )

  await second.beginTransaction()
  const secondMapLock = second.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 21 FOR UPDATE',
  )
  // Let the second transaction enter its map lock wait before the first takes
  // the cycle lock. Both paths acquire map before cycle, so this must drain
  // after the first commit rather than deadlock.
  await sleep(50)
  await first.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 31 FOR UPDATE',
  )
  await first.query(
    'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 51 FOR UPDATE',
  )
  await first.commit()

  await withTimeout(
    secondMapLock
      .then(() =>
        second.query(
          'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 31 FOR UPDATE',
        ),
      )
      .then(() =>
        second.query(
          'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 51 FOR UPDATE',
        ),
      )
      .then(() => second.commit()),
    'concurrent map-before-cycle transactions',
  )
}

const resetFixture = async (connection: Connection) => {
  await connection.query(
    "UPDATE defectCycles SET state = 'manual_attention', providerWorkItemId = NULL, providerIntakeId = NULL, providerStateId = NULL WHERE defectCycleId = 31",
  )
  await connection.query(
    "UPDATE resultOutbox SET deliveryState = 'manual_attention', leaseToken = NULL, leaseExpiresOn = NULL, lastError = NULL, deliveredOn = NULL, attemptCount = 0 WHERE resultOutboxId = 51",
  )
}

const readFixture = async (connection: Connection) => {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT c.state AS cycleState, o.deliveryState, o.leaseToken,
            o.leaseExpiresOn, o.lastError
       FROM defectCycles c CROSS JOIN resultOutbox o
      WHERE c.defectCycleId = 31 AND o.resultOutboxId = 51`,
  )
  return rows[0] ?? null
}

const productionInput = {
  projectId: 7,
  runId: 8,
  testId: 9,
  expectedWorkItemId: 'work-item-41',
  expectedIntakeId: 'intake-41',
  expectedCorrelationKey: 'checkmate:correlation-41',
  expectedDestination: 'biz-development' as const,
}

const productionConfig = {
  apiBaseUrl: 'https://plane-dev.geep-fence.ts.net',
  publicBaseUrl: 'https://plane-dev.geep-fence.ts.net',
  apiKey: 'harness-only-secret',
  workspaceId: 'e36dfd86-953a-4e33-a410-856208893bb9',
  workspaceSlug: 'infinimind',
  projectId: '67726ee5-7d0c-4656-8bc8-b2f8a959d5da',
  projectIdentifier: 'BIZ',
  timeoutMs: 1_000,
  maxRequestsPerMinute: 6,
  maxRequestWaitMs: 1_000,
}

const createProductionAdapter = (providerCalls: {count: number}) => ({
  getWorkItem: async () => {
    providerCalls.count += 1
    return {
      workItemId: productionInput.expectedWorkItemId,
      stateId: 'state-open',
      versionMarker: 'harness-version',
      raw: {
        id: productionInput.expectedWorkItemId,
        state: {id: 'state-open'},
        workspace_id: productionConfig.workspaceId,
        project_id: productionConfig.projectId,
        project_identifier: productionConfig.projectIdentifier,
        intake_id: productionInput.expectedIntakeId,
        name: 'Failed Checkmate test',
        description:
          'Run 8 / test 9\nCorrelation: checkmate:correlation-41',
      },
    }
  },
  getIntakeWorkItem: async () => {
    providerCalls.count += 1
    return {
      workItemId: productionInput.expectedWorkItemId,
      stateId: 'state-open',
      versionMarker: 'harness-version',
      source: 'intake' as const,
      raw: {
        id: productionInput.expectedIntakeId,
        issue: productionInput.expectedWorkItemId,
        issue_detail: {
          id: productionInput.expectedWorkItemId,
          state: {id: 'state-open'},
          workspace: productionConfig.workspaceId,
          project: productionConfig.projectId,
          name: 'Failed Checkmate test',
          description:
            'Run 8 / test 9\nCorrelation: checkmate:correlation-41',
          sequence_id: 41,
        },
        workspace: productionConfig.workspaceId,
        project: productionConfig.projectId,
        state: {id: 'state-open'},
        workspace_id: productionConfig.workspaceId,
        project_id: productionConfig.projectId,
        intake_id: productionInput.expectedIntakeId,
        name: 'Failed Checkmate test',
        description:
          'Run 8 / test 9\nCorrelation: checkmate:correlation-41',
        sequence_id: 41,
      },
    }
  },
})

const assertProductionVerifyOnly = async (
  database: unknown,
  reconcile: (options: Record<string, unknown>) => Promise<Record<string, unknown>>,
  connection: Connection,
) => {
  await resetFixture(connection)
  const before = await readFixture(connection)
  const providerCalls = {count: 0}
  const result = await reconcile({
    input: productionInput,
    config: productionConfig,
    planeAdapter: createProductionAdapter(providerCalls),
    database,
    enabled: true,
    verifyOnly: true,
    now: new Date('2026-08-22T00:01:00.000Z'),
  })
  const after = await readFixture(connection)
  if (result.outcome !== 'verified' || providerCalls.count !== 1) {
    throw new Error(
      `Production verify-only did not perform one GET: ${JSON.stringify(result)}`,
    )
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('Production verify-only changed the MySQL fixture')
  }
}

const assertProductionFinalizationFence = async (
  database: {
    select: (...args: unknown[]) => unknown
    transaction: (...args: unknown[]) => Promise<unknown>
  },
  reconcile: (options: Record<string, unknown>) => Promise<Record<string, unknown>>,
  connection: Connection,
) => {
  await resetFixture(connection)
  let transactionCount = 0
  const failingDatabase = {
    select: database.select.bind(database),
    transaction: async (...args: unknown[]) => {
      transactionCount += 1
      if (transactionCount >= 2) {
        throw new Error('harness permanent finalization failure')
      }
      return database.transaction(...args)
    },
  }
  const firstCalls = {count: 0}
  await reconcile({
    input: productionInput,
    config: productionConfig,
    planeAdapter: createProductionAdapter(firstCalls),
    database: failingDatabase,
    enabled: true,
    leaseMs: 1_000,
    now: new Date('2026-08-22T00:01:00.000Z'),
  }).then(
    () => {
      throw new Error('Expected production finalization failure')
    },
    () => undefined,
  )
  const fenced = await readFixture(connection)
  if (
    firstCalls.count !== 1 ||
    !String(fenced?.lastError).startsWith(
      'operator_reconciliation_required: provider call started',
    ) ||
    fenced?.leaseToken === null
  ) {
    throw new Error(
      `Production claim fence was not committed before failure: ${JSON.stringify(fenced)}`,
    )
  }

  const secondCalls = {count: 0}
  const second = await reconcile({
    input: productionInput,
    config: productionConfig,
    planeAdapter: createProductionAdapter(secondCalls),
    database,
    enabled: true,
    now: new Date('2026-08-22T00:02:00.000Z'),
  })
  if (second.outcome !== 'refused' || secondCalls.count !== 0) {
    throw new Error(
      `Production provider-call fence did not refuse before GET: ${JSON.stringify(second)}`,
    )
  }
}

const assertInverseContentionRetriesAndPeerCommits = async (
  oneShot: Connection,
  peer: Connection,
) => {
  await oneShot.query('SET SESSION innodb_lock_wait_timeout = 5')
  await peer.query('SET SESSION innodb_lock_wait_timeout = 5')

  await peer.beginTransaction()
  await peer.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 31 FOR UPDATE',
  )
  // Give the peer transaction more modified work so InnoDB selects the
  // one-shot-equivalent transaction as the deadlock victim.
  await peer.query(
    "UPDATE resultOutbox SET deliveryState = 'peer_hold' WHERE resultOutboxId = 51",
  )

  let peerCommitted = false
  let peerMapWait: Promise<unknown> | undefined
  let peerCommit: Promise<void> | undefined
  const attempts: number[] = []

  await withTimeout(
    withDeadlockRetry(async (attempt) => {
      attempts.push(attempt)
      await oneShot.beginTransaction()
      try {
        await oneShot.query(
          'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 21 FOR UPDATE',
        )
        if (attempt === 1) {
          peerMapWait = peer.query(
            'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 21 FOR UPDATE',
          )
          peerCommit = peerMapWait
            .then(() => peer.commit())
            .then(() => {
              peerCommitted = true
            })
          await sleep(50)
        }
        await oneShot.query(
          'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 31 FOR UPDATE',
        )
        await oneShot.commit()
      } catch (error) {
        await oneShot.rollback()
        throw error
      }
    }),
    'inverse cycle-before-map contention retry',
  )

  // If the peer was the deadlock victim, this await fails and the harness
  // rejects rather than treating a one-sided success as concurrency proof.
  await withTimeout(peerMapWait ?? Promise.resolve(), 'peer map lock wait')
  if (!peerCommit) throw new Error('Peer commit was not scheduled')
  await withTimeout(peerCommit, 'peer commit after inverse contention')
  if (!peerCommitted || attempts.length !== 2) {
    throw new Error(
      `Expected one deadlock retry while peer committed; attempts=${attempts.join(
        ',',
      )}`,
    )
  }
}

const assertLostClaimRollsBack = async (connection: Connection) => {
  await connection.beginTransaction()
  await connection.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 21 FOR UPDATE',
  )
  await connection.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 31 FOR UPDATE',
  )
  await connection.query(
    'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 51 FOR UPDATE',
  )
  await connection.query(
    "UPDATE defectCycles SET state = 'manual_attention' WHERE defectCycleId = 31",
  )
  const [claim] = await connection.query<ResultSetHeader>(
    "UPDATE resultOutbox SET deliveryState = 'leased', leaseToken = 'claim-token' WHERE resultOutboxId = 51 AND leaseToken = 'lost-lease'",
  )
  if (claim.affectedRows !== 0) {
    throw new Error(
      'Expected the intentionally stale outbox claim to affect zero rows',
    )
  }
  await connection.rollback()

  const [rows] = await connection.query<
    (RowDataPacket & {
      state: string
      deliveryState: string
      leaseToken: string | null
    })[]
  >(
    `SELECT c.state, o.deliveryState, o.leaseToken
       FROM defectCycles c CROSS JOIN resultOutbox o
      WHERE c.defectCycleId = 31 AND o.resultOutboxId = 51`,
  )
  const row = rows[0]
  if (
    !row ||
    row.state !== 'manual_attention' ||
    row.deliveryState !== 'manual_attention' ||
    row.leaseToken !== null
  ) {
    throw new Error('Lost outbox claim did not roll back the cycle reservation')
  }
}

const run = async () => {
  if (!HARNESS_URL) {
    process.stdout.write(
      'SKIPPED: set CHECKMATE_MYSQL_HARNESS_URL to a disposable local MySQL 8 URL\n',
    )
    return
  }

  const options = readLocalConnectionOptions()
  let admin: Connection | undefined
  let first: Connection | undefined
  let second: Connection | undefined
  let serviceClient:
    | {end: () => Promise<void>; destroy: () => void}
    | undefined
  const database = `cm599_${randomUUID().replaceAll('-', '')}`
  let cleanupPromise: Promise<void> | undefined
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      await closeQuietly(first)
      await closeQuietly(second)
      if (serviceClient) {
        try {
          await withTimeout(serviceClient.end(), 'production DB client cleanup')
        } catch {
          serviceClient.destroy()
        }
      }
      if (admin) {
        try {
          await withTimeout(
            admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`),
            'temporary MySQL database cleanup',
          )
        } catch {
          admin.destroy()
        }
      }
      await closeQuietly(admin)
    })()
    return cleanupPromise
  }
  const onSignal = (signal: string) => {
    process.stderr.write(
      `MySQL one-shot harness received ${signal}; cleaning up\n`,
    )
    const killTimer = setTimeout(() => {
      first?.destroy()
      second?.destroy()
      admin?.destroy()
      process.exit(1)
    }, CLEANUP_TIMEOUT_MS)
    void cleanup().finally(() => {
      clearTimeout(killTimer)
      process.exit(1)
    })
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  try {
    const adminConnection = await mysql.createConnection(options)
    admin = adminConnection
    const [versionRows] = await adminConnection.query<
      (RowDataPacket & {version: string})[]
    >('SELECT VERSION() AS version')
    if (!versionRows[0]?.version.startsWith('8.')) {
      throw new Error(
        `MySQL 8 is required; found ${versionRows[0]?.version ?? 'unknown'}`,
      )
    }
    await adminConnection.query(`CREATE DATABASE ${quoteIdentifier(database)}`)
    await createSchema(adminConnection, database)
    const databaseOptions = {...options, database}
    first = await mysql.createConnection(databaseOptions)
    second = await mysql.createConnection(databaseOptions)
    // Import the actual production service only after the disposable DB URL is
    // authoritative. The service's default client is never used, but setting
    // production mode prevents the repository .env from replacing this URL.
    const harnessUrl = new URL(HARNESS_URL)
    harnessUrl.pathname = `/${database}`
    process.env.NODE_ENV = 'production'
    process.env.DB_URL = harnessUrl.toString()
    const {reconcilePlaneDefectOneShot} = await import(
      '../app/services/planeOneShotReconciliation'
    )
    serviceClient = (await import('../app/db/client')).client
    const productionDatabase = drizzle(first)
    await assertProductionVerifyOnly(
      productionDatabase,
      reconcilePlaneDefectOneShot as unknown as (
        options: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>,
      first,
    )
    await assertProductionFinalizationFence(
      productionDatabase as unknown as {
        select: (...args: unknown[]) => unknown
        transaction: (...args: unknown[]) => Promise<unknown>
      },
      reconcilePlaneDefectOneShot as unknown as (
        options: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>,
      first,
    )
    await resetFixture(first)
    await assertInverseContentionRetriesAndPeerCommits(first, second)
    await resetFixture(first)
    await assertConcurrentMapFirstLocksDoNotDeadlock(first, second)
    await lockMapThenCycleAndOutbox(first)
    await assertLostClaimRollsBack(second)
    process.stdout.write(
      'PASS: MySQL 8 inverse contention retry, map/cycle concurrency, and claim rollback harness\n',
    )
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    try {
      await withTimeout(cleanup(), 'MySQL harness cleanup')
    } catch {
      first?.destroy()
      second?.destroy()
      admin?.destroy()
    }
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(
    `MySQL one-shot harness failed: ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }\n`,
  )
  process.exitCode = 1
})
