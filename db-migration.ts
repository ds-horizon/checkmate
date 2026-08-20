import 'dotenv/config'
import {migrate} from 'drizzle-orm/mysql2/migrator'
import {client, dbClient} from '~/db/client'
import {reconcileLegacyMigrationLedger} from '~/db/migrationLedger'

await reconcileLegacyMigrationLedger(client)
await migrate(dbClient, {migrationsFolder: './drizzle'})

await client.end()
