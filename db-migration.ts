import 'dotenv/config'
import {migrate} from 'drizzle-orm/mysql2/migrator'
import {client, dbClient} from '~/db/client'

async function runMigrations() {
  console.log('🔄 Starting database migration...')
  
  try {
    await migrate(dbClient, {migrationsFolder: './drizzle'})
    console.log('✅ Database migrations completed successfully!')
  } catch (error: any) {
    // Handle "table already exists" errors gracefully
    if (error.code === 'ER_TABLE_EXISTS_ERROR' || error.errno === 1050) {
      console.log('ℹ️  Some tables already exist - this is expected for existing databases')
      console.log('   Migration may have been partially applied or tables were created manually')
    } else if (error.message?.includes('already exists')) {
      console.log('ℹ️  Migration already applied or tables exist')
    } else {
      console.error('❌ Migration failed:', error.message)
      throw error
    }
  } finally {
    await client.end()
  }
}

runMigrations()
  .then(() => {
    console.log('🏁 Migration process finished')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Migration process failed:', error)
    process.exit(1)
  })
