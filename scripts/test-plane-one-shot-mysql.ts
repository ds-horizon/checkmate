import {randomUUID} from 'node:crypto'
import mysql from 'mysql2/promise'
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
  await connection.query(`
    CREATE TABLE ${schema}.testRunMap (
      testRunMapId INT PRIMARY KEY,
      state VARCHAR(32) NOT NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.defectCycles (
      defectCycleId INT PRIMARY KEY,
      testRunMapId INT NOT NULL,
      state VARCHAR(32) NOT NULL,
      FOREIGN KEY (testRunMapId) REFERENCES ${schema}.testRunMap(testRunMapId)
    ) ENGINE=InnoDB
  `)
  await connection.query(`
    CREATE TABLE ${schema}.resultOutbox (
      resultOutboxId INT PRIMARY KEY,
      deliveryState VARCHAR(32) NOT NULL,
      leaseToken VARCHAR(64) NULL,
      leaseExpiresOn DATETIME NULL
    ) ENGINE=InnoDB
  `)
  await connection.query(
    `INSERT INTO ${schema}.testRunMap VALUES (1, 'included')`,
  )
  await connection.query(
    `INSERT INTO ${schema}.defectCycles VALUES (1, 1, 'intake_pending')`,
  )
  await connection.query(
    `INSERT INTO ${schema}.resultOutbox VALUES (1, 'pending', NULL, NULL)`,
  )
}

const lockMapThenCycleAndOutbox = async (connection: Connection) => {
  await connection.beginTransaction()
  await connection.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 1 FOR UPDATE',
  )
  await connection.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 1 FOR UPDATE',
  )
  await connection.query(
    'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 1 FOR UPDATE',
  )
  await connection.commit()
}

const assertConcurrentMapFirstLocksDoNotDeadlock = async (
  first: Connection,
  second: Connection,
) => {
  await first.beginTransaction()
  await first.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 1 FOR UPDATE',
  )

  await second.beginTransaction()
  const secondMapLock = second.query(
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 1 FOR UPDATE',
  )
  // Let the second transaction enter its map lock wait before the first takes
  // the cycle lock. Both paths acquire map before cycle, so this must drain
  // after the first commit rather than deadlock.
  await sleep(50)
  await first.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 1 FOR UPDATE',
  )
  await first.query(
    'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 1 FOR UPDATE',
  )
  await first.commit()

  await withTimeout(
    secondMapLock
      .then(() =>
        second.query(
          'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 1 FOR UPDATE',
        ),
      )
      .then(() =>
        second.query(
          'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 1 FOR UPDATE',
        ),
      )
      .then(() => second.commit()),
    'concurrent map-before-cycle transactions',
  )
}

const resetFixture = async (connection: Connection) => {
  await connection.query(
    "UPDATE defectCycles SET state = 'intake_pending' WHERE defectCycleId = 1",
  )
  await connection.query(
    "UPDATE resultOutbox SET deliveryState = 'pending', leaseToken = NULL, leaseExpiresOn = NULL WHERE resultOutboxId = 1",
  )
}

const assertInverseContentionRetriesAndPeerCommits = async (
  oneShot: Connection,
  peer: Connection,
) => {
  await oneShot.query('SET SESSION innodb_lock_wait_timeout = 5')
  await peer.query('SET SESSION innodb_lock_wait_timeout = 5')

  await peer.beginTransaction()
  await peer.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 1 FOR UPDATE',
  )
  // Give the peer transaction more modified work so InnoDB selects the
  // one-shot-equivalent transaction as the deadlock victim.
  await peer.query(
    "UPDATE resultOutbox SET deliveryState = 'peer_hold' WHERE resultOutboxId = 1",
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
          'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 1 FOR UPDATE',
        )
        if (attempt === 1) {
          peerMapWait = peer.query(
            'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 1 FOR UPDATE',
          )
          peerCommit = peerMapWait
            .then(() => peer.commit())
            .then(() => {
              peerCommitted = true
            })
          await sleep(50)
        }
        await oneShot.query(
          'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 1 FOR UPDATE',
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
    'SELECT testRunMapId FROM testRunMap WHERE testRunMapId = 1 FOR UPDATE',
  )
  await connection.query(
    'SELECT defectCycleId FROM defectCycles WHERE defectCycleId = 1 FOR UPDATE',
  )
  await connection.query(
    'SELECT resultOutboxId FROM resultOutbox WHERE resultOutboxId = 1 FOR UPDATE',
  )
  await connection.query(
    "UPDATE defectCycles SET state = 'manual_attention' WHERE defectCycleId = 1",
  )
  const [claim] = await connection.query<ResultSetHeader>(
    "UPDATE resultOutbox SET deliveryState = 'leased', leaseToken = 'claim-token' WHERE resultOutboxId = 1 AND leaseToken = 'lost-lease'",
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
      WHERE c.defectCycleId = 1 AND o.resultOutboxId = 1`,
  )
  const row = rows[0]
  if (
    !row ||
    row.state !== 'intake_pending' ||
    row.deliveryState !== 'pending' ||
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
  const database = `cm599_${randomUUID().replaceAll('-', '')}`
  let cleanupPromise: Promise<void> | undefined
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      await closeQuietly(first)
      await closeQuietly(second)
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
      error instanceof Error ? error.message : String(error)
    }\n`,
  )
  process.exitCode = 1
})
