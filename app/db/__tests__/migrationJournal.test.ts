import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import type {FieldPacket} from 'mysql2/promise'
import {
  type MigrationLedgerConnection,
  type MigrationLedgerPool,
  reconcileLegacyMigrationLedger,
} from '~/db/migrationLedger'

type MigrationEntry = {
  idx: number
  when: number
  tag: string
}

type MigrationJournal = {
  entries: MigrationEntry[]
}

const JOURNAL_CHECKPOINTS = [1785378032552, 1785378090602, 1785383340174]
const LEGACY_DEV_CHECKPOINT = 1785239850354
const LEGACY_HASH = '987deb2d16888a18631a5fdb797c95c1f4f375dea92cd7065be0970965aef91d'

const rows = <T extends object>(items: T[]) => [items, [] as FieldPacket[]] as [T[], FieldPacket[]]

const createConnection = (responses: Record<string, object[]>) => {
  const connection: MigrationLedgerConnection = {
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql: string) => {
      if (sql.startsWith('INSERT')) {
        return rows([])
      }
      if (sql.includes('information_schema.tables') && sql.includes('table_name = ?')) {
        return rows(responses.migrationTable ?? [])
      }
      if (sql.includes('FROM `__drizzle_migrations`')) {
        return rows(responses.ledger ?? [])
      }
      if (sql.includes('information_schema.tables')) {
        return rows(responses.tables ?? [])
      }
      if (sql.includes('information_schema.columns')) {
        return rows(responses.columns ?? [])
      }
      throw new Error(`Unexpected query: ${sql}`)
    }),
  }
  const pool: MigrationLedgerPool = {getConnection: jest.fn(async () => connection)}

  return {connection, pool}
}

describe('migration journal', () => {
  const journal = JSON.parse(
    readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
  ) as MigrationJournal

  it('keeps the original initial migration checkpoints', () => {
    expect(journal.entries.slice(0, 3).map((entry) => entry.when)).toEqual(JOURNAL_CHECKPOINTS)
    expect(journal.entries.slice(0, 3).map((entry) => entry.tag)).toEqual([
      '0000_broad_green_goblin',
      '0001_real_scarecrow',
      '0002_chubby_shape',
    ])
  })

  it('reconciles only the exact fully-applied legacy checkpoint', async () => {
    const {connection, pool} = createConnection({
      migrationTable: [{table_name: '__drizzle_migrations'}],
      ledger: [{hash: LEGACY_HASH, created_at: LEGACY_DEV_CHECKPOINT}],
      tables: [
        'automationStatus', 'labelTestMap', 'labels', 'organisations', 'platform', 'priority',
        'projects', 'runs', 'sections', 'squads', 'testCoveredBy', 'testRunMap',
        'testRunsStatusHistory', 'tests', 'type', 'users',
      ].map((table_name) => ({table_name})),
      columns: [
        {table_name: 'testRunMap', column_name: 'comment', data_type: 'text'},
        {table_name: 'testRunsStatusHistory', column_name: 'attachments', data_type: 'json'},
      ],
    })

    await expect(reconcileLegacyMigrationLedger(pool)).resolves.toBe(true)
    expect(connection.query).toHaveBeenCalledWith(
      'INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)',
      ['5934b86efd51f7e44997fbca6af867ad317e47a6c3b3db343836b60bd41b3c04', JOURNAL_CHECKPOINTS[1]],
    )
    expect(connection.query).toHaveBeenCalledWith(
      'INSERT INTO `__drizzle_migrations` (hash, created_at) VALUES (?, ?)',
      ['c6f1ba90df1c9bc6c67f33f06ab8a2cc48dd748cae80f761dec1f8f462f7e7db', JOURNAL_CHECKPOINTS[2]],
    )
    expect(connection.commit).toHaveBeenCalledTimes(1)
    expect(connection.rollback).not.toHaveBeenCalled()
  })

  it('fails before modifying an incomplete legacy schema', async () => {
    const {connection, pool} = createConnection({
      migrationTable: [{table_name: '__drizzle_migrations'}],
      ledger: [{hash: LEGACY_HASH, created_at: LEGACY_DEV_CHECKPOINT}],
      tables: [{table_name: 'testRunMap'}],
      columns: [{table_name: 'testRunMap', column_name: 'comment', data_type: 'varchar'}],
    })

    await expect(reconcileLegacyMigrationLedger(pool)).rejects.toThrow(
      'Refusing to reconcile an incomplete legacy Drizzle migration ledger',
    )
    expect((connection.query as jest.Mock).mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
    expect(connection.rollback).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a fresh database', async () => {
    const {connection, pool} = createConnection({migrationTable: []})

    await expect(reconcileLegacyMigrationLedger(pool)).resolves.toBe(false)
    expect((connection.query as jest.Mock).mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
    expect(connection.commit).toHaveBeenCalledTimes(1)
  })

  it('does not reconcile the original journal checkpoint', async () => {
    const {connection, pool} = createConnection({
      migrationTable: [{table_name: '__drizzle_migrations'}],
      ledger: [{hash: LEGACY_HASH, created_at: JOURNAL_CHECKPOINTS[0]}],
    })

    await expect(reconcileLegacyMigrationLedger(pool)).resolves.toBe(false)
    expect((connection.query as jest.Mock).mock.calls.some(([sql]) => sql.startsWith('INSERT'))).toBe(false)
    expect(connection.commit).toHaveBeenCalledTimes(1)
  })
})
