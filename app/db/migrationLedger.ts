import type {FieldPacket} from 'mysql2/promise'

const MIGRATIONS_TABLE = '__drizzle_migrations'
const LEGACY_DEV_CHECKPOINT = {
  hash: '987deb2d16888a18631a5fdb797c95c1f4f375dea92cd7065be0970965aef91d',
  createdAt: 1785239850354,
}
const MISSING_MIGRATIONS = [
  {
    hash: '5934b86efd51f7e44997fbca6af867ad317e47a6c3b3db343836b60bd41b3c04',
    createdAt: 1785378090602,
  },
  {
    hash: 'c6f1ba90df1c9bc6c67f33f06ab8a2cc48dd748cae80f761dec1f8f462f7e7db',
    createdAt: 1785383340174,
  },
] as const

const INITIAL_SCHEMA_TABLES = [
  'automationStatus',
  'labelTestMap',
  'labels',
  'organisations',
  'platform',
  'priority',
  'projects',
  'runs',
  'sections',
  'squads',
  'testCoveredBy',
  'testRunMap',
  'testRunsStatusHistory',
  'tests',
  'type',
  'users',
] as const

type QueryResult = object[]

export type MigrationLedgerConnection = {
  beginTransaction(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  release(): void
  query(sql: string, values?: unknown[]): Promise<[unknown, FieldPacket[]]>
}

export type MigrationLedgerPool = {
  getConnection(): Promise<MigrationLedgerConnection>
}

type LedgerRow = {
  hash: string
  created_at: number | string
}

type TableRow = {
  table_name: string
}

type ColumnRow = {
  table_name: string
  column_name: string
  data_type: string
}

const query = <T extends QueryResult>(
  connection: MigrationLedgerConnection,
  sql: string,
  values?: unknown[],
) => connection.query(sql, values).then(([rows]) => rows as T)

/**
 * Restores only a known, fully-applied pre-ledger migration state. Drizzle uses
 * the greatest created_at checkpoint, so partial or unfamiliar states must not
 * be made to look complete.
 */
export const reconcileLegacyMigrationLedger = async (pool: MigrationLedgerPool): Promise<boolean> => {
  const connection = await pool.getConnection()
  let transactionStarted = false

  try {
    await connection.beginTransaction()
    transactionStarted = true

    const migrationTable = await query<TableRow[]>(
      connection,
      `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
      [MIGRATIONS_TABLE],
    )

    if (migrationTable.length === 0) {
      await connection.commit()
      return false
    }

    const ledger = await query<LedgerRow[]>(
      connection,
      `SELECT hash, created_at FROM \`${MIGRATIONS_TABLE}\` ORDER BY created_at FOR UPDATE`,
    )
    const legacyCheckpoint = ledger[0]
    const isExactLegacyCheckpoint = ledger.length === 1
      && legacyCheckpoint?.hash === LEGACY_DEV_CHECKPOINT.hash
      && Number(legacyCheckpoint.created_at) === LEGACY_DEV_CHECKPOINT.createdAt

    if (!isExactLegacyCheckpoint) {
      await connection.commit()
      return false
    }

    const tables = await query<TableRow[]>(
      connection,
      `SELECT table_name AS table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (${INITIAL_SCHEMA_TABLES.map(() => '?').join(', ')})`,
      [...INITIAL_SCHEMA_TABLES],
    )
    const tableNames = new Set(tables.map(({table_name}) => table_name))
    const hasInitialSchema = INITIAL_SCHEMA_TABLES.every((table) => tableNames.has(table))

    const columns = await query<ColumnRow[]>(
      connection,
      `SELECT table_name AS table_name, column_name AS column_name, data_type AS data_type FROM information_schema.columns WHERE table_schema = DATABASE() AND ((table_name = ? AND column_name = ?) OR (table_name = ? AND column_name = ?))`,
      ['testRunMap', 'comment', 'testRunsStatusHistory', 'attachments'],
    )
    const columnTypes = new Map(columns.map((column) => [`${column.table_name}.${column.column_name}`, column.data_type.toLowerCase()]))
    const hasLaterSchemaEffects = columnTypes.get('testRunMap.comment') === 'text'
      && columnTypes.get('testRunsStatusHistory.attachments') === 'json'

    if (!hasInitialSchema || !hasLaterSchemaEffects) {
      throw new Error('Refusing to reconcile an incomplete legacy Drizzle migration ledger')
    }

    for (const migration of MISSING_MIGRATIONS) {
      await connection.query(
        `INSERT INTO \`${MIGRATIONS_TABLE}\` (hash, created_at) VALUES (?, ?)`,
        [migration.hash, migration.createdAt],
      )
    }

    await connection.commit()
    return true
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback()
    }
    throw error
  } finally {
    connection.release()
  }
}
