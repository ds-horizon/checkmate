/**
 * Production Migration Runner
 * 
 * This script handles database migrations properly for both:
 * - Fresh deployments (seedData.sql creates baseline, mark as applied)
 * - Existing databases (apply only pending migrations)
 * 
 * How it works:
 * 1. Checks if __drizzle_migrations table exists
 * 2. If not, this is likely a fresh DB from seedData.sql
 *    - Creates the migration tracking table
 *    - Marks existing migrations as applied (baseline)
 * 3. Runs any pending migrations using Drizzle
 * 
 * This approach is scalable - just add new Drizzle migrations
 * and they'll be automatically applied on next deployment.
 */

import 'dotenv/config'
import {sql} from 'drizzle-orm'
import {migrate} from 'drizzle-orm/mysql2/migrator'
import * as fs from 'fs'
import * as path from 'path'
import {client, dbClient} from '~/db/client'

interface MigrationEntry {
  idx: number
  version: string
  when: number
  tag: string
  breakpoints: boolean
}

interface MigrationJournal {
  version: string
  dialect: string
  entries: MigrationEntry[]
}

interface TableCheckResult {
  count: number
}

async function tableExists(tableName: string): Promise<boolean> {
  const result = await dbClient.execute(sql`
    SELECT COUNT(*) as count 
    FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = ${tableName}
  `)
  const rows = result[0] as TableCheckResult[]
  return rows[0]?.count > 0
}

async function getMigrationJournal(): Promise<MigrationJournal | null> {
  const journalPath = path.join(process.cwd(), 'drizzle', 'meta', '_journal.json')
  
  if (!fs.existsSync(journalPath)) {
    console.log('⚠️  No migration journal found at', journalPath)
    return null
  }
  
  const content = fs.readFileSync(journalPath, 'utf-8')
  return JSON.parse(content) as MigrationJournal
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const applied = new Set<string>()
  
  try {
    const result = await dbClient.execute(sql`
      SELECT hash FROM __drizzle_migrations
    `)
    const rows = result[0] as {hash: string}[]
    for (const row of rows) {
      applied.add(row.hash)
    }
  } catch {
    // Table doesn't exist yet
  }
  
  return applied
}

async function markMigrationAsApplied(tag: string, hash: string): Promise<void> {
  const timestamp = Date.now()
  await dbClient.execute(sql`
    INSERT INTO __drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${timestamp})
  `)
  console.log(`   ✓ Marked migration ${tag} as applied`)
}

async function createMigrationTable(): Promise<void> {
  await dbClient.execute(sql`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      hash VARCHAR(255) NOT NULL,
      created_at BIGINT NOT NULL
    )
  `)
}

async function checkIfMigrationTablesExist(journal: MigrationJournal): Promise<Map<string, boolean>> {
  const tablesForMigration = new Map<string, boolean>()
  
  // For each migration, check if its tables already exist
  // This is a heuristic - we check known table patterns
  for (const entry of journal.entries) {
    const migrationFile = path.join(process.cwd(), 'drizzle', `${entry.tag}.sql`)
    if (fs.existsSync(migrationFile)) {
      const content = fs.readFileSync(migrationFile, 'utf-8')
      
      // Extract table names from CREATE TABLE statements
      const createTableMatches = content.matchAll(/CREATE TABLE [`"]?(\w+)[`"]?/gi)
      let allTablesExist = true
      
      for (const match of createTableMatches) {
        const tableName = match[1]
        const exists = await tableExists(tableName)
        if (!exists) {
          allTablesExist = false
          break
        }
      }
      
      tablesForMigration.set(entry.tag, allTablesExist)
    }
  }
  
  return tablesForMigration
}

async function runMigrations(): Promise<void> {
  console.log('🔄 Starting Migration Runner...')
  console.log('')
  
  // Step 1: Read migration journal
  const journal = await getMigrationJournal()
  if (!journal) {
    console.log('ℹ️  No migrations to run')
    return
  }
  
  console.log(`📋 Found ${journal.entries.length} migration(s) in journal`)
  
  // Step 2: Check if migration tracking table exists
  const migrationTableExists = await tableExists('__drizzle_migrations')
  
  if (!migrationTableExists) {
    console.log('📦 Creating migration tracking table...')
    await createMigrationTable()
    
    // Step 3: Check which migrations' tables already exist (from seedData.sql)
    console.log('🔍 Checking for baseline tables...')
    const existingTables = await checkIfMigrationTablesExist(journal)
    
    // Mark migrations as applied if their tables already exist
    for (const entry of journal.entries) {
      const tablesExist = existingTables.get(entry.tag)
      if (tablesExist) {
        console.log(`   📌 Migration ${entry.tag} - tables already exist (baseline)`)
        await markMigrationAsApplied(entry.tag, entry.tag)
      }
    }
  }
  
  // Step 4: Get list of applied migrations
  const appliedMigrations = await getAppliedMigrations()
  console.log(`✅ ${appliedMigrations.size} migration(s) already applied`)
  
  // Step 5: Determine pending migrations
  const pendingMigrations = journal.entries.filter(
    entry => !appliedMigrations.has(entry.tag)
  )
  
  if (pendingMigrations.length === 0) {
    console.log('')
    console.log('🎉 Database is up to date! No pending migrations.')
    return
  }
  
  console.log(`⏳ ${pendingMigrations.length} migration(s) pending...`)
  console.log('')
  
  // Step 6: Run pending migrations using Drizzle
  for (const migration of pendingMigrations) {
    console.log(`🔧 Applying migration: ${migration.tag}`)
    
    try {
      // Run the specific migration
      await migrate(dbClient, {
        migrationsFolder: './drizzle',
      })
      console.log(`   ✅ Migration ${migration.tag} applied successfully`)
    } catch (error: any) {
      if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.errno === 1050) {
        // Table already exists - mark as applied
        console.log(`   ⚠️  Tables already exist, marking as applied`)
        await markMigrationAsApplied(migration.tag, migration.tag)
      } else if (error.code === 'ER_DUP_ENTRY') {
        // Migration already tracked
        console.log(`   ℹ️  Migration already tracked`)
      } else {
        throw error
      }
    }
  }
  
  console.log('')
  console.log('🏁 Migration runner completed!')
}

// Main execution
runMigrations()
  .then(async () => {
    await client.end()
    process.exit(0)
  })
  .catch(async (error) => {
    console.error('')
    console.error('❌ Migration failed:', error.message)
    console.error('')
    await client.end()
    process.exit(1)
  })

