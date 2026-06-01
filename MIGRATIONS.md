# Database Migrations Guide

This document explains how database migrations work in Checkmate and how to add new schema changes.

## Overview

Checkmate uses [Drizzle ORM](https://orm.drizzle.team/) for database migrations. The migration system is designed to work seamlessly with both:

- **Fresh Docker deployments** (new databases)
- **Existing databases** (upgrades)

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Migration Flow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Fresh Deployment              Existing Database                 │
│  ─────────────────             ─────────────────                 │
│         │                              │                         │
│         ▼                              │                         │
│  seedData.sql runs                     │                         │
│  (creates all tables)                  │                         │
│         │                              │                         │
│         ▼                              ▼                         │
│  migration-runner.ts ◄────────► migration-runner.ts              │
│         │                              │                         │
│         ▼                              ▼                         │
│  Detects tables exist          Checks __drizzle_migrations       │
│  Marks as "baseline"           Runs only pending migrations      │
│         │                              │                         │
│         ▼                              ▼                         │
│      App Starts                    App Starts                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Migration Files

Migrations are stored in the `drizzle/` directory:

```
drizzle/
├── 0000_lush_lyja.sql          # First migration (attachments)
├── 0001_next_migration.sql     # Future migrations...
└── meta/
    ├── _journal.json           # Migration registry
    └── 0000_snapshot.json      # Schema snapshots
```

## Adding New Migrations

### Step 1: Update the Schema

Edit or create schema files in `app/db/schema/`:

```typescript
// app/db/schema/newFeature.ts
import { mysqlTable, int, varchar } from 'drizzle-orm/mysql-core'

export const newTable = mysqlTable('newTable', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  // ... more columns
})
```

### Step 2: Generate Migration

```bash
yarn db:generate
```

This creates a new migration file in `drizzle/` with only the incremental changes.

### Step 3: Review the Migration

Check the generated SQL file to ensure it only contains your new changes:

```bash
cat drizzle/0001_*.sql
```

### Step 4: Test Locally

```bash
# Apply migration to your local database
yarn db:migrate

# Or use the production runner
yarn db:migrate:run
```

### Step 5: Update seedData.sql

For fresh deployments, add the new table(s) to `seedData.sql`:

```sql
-- Add after existing table definitions

CREATE TABLE `newTable` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

### Step 6: Commit and Deploy

```bash
git add drizzle/ seedData.sql app/db/schema/
git commit -m "feat: add newTable migration"
```

## Available Commands

| Command | Description |
|---------|-------------|
| `yarn db:generate` | Generate migration from schema changes |
| `yarn db:migrate` | Run migrations (Drizzle default) |
| `yarn db:migrate:run` | Run migrations (production runner with baseline support) |
| `yarn db:seed` | Seed database with test data |

## Docker Deployment

When Docker containers start, the entrypoint script automatically:

1. Waits for database connectivity
2. Runs `migration-runner.ts`
3. Starts the application

```bash
# Deploy with automatic migrations
docker-compose up --build -d

# Check migration logs
docker logs checkmate-app | grep -A 20 "Migration"
```

## Troubleshooting

### "Table already exists" Error

This happens when Drizzle tries to create tables that already exist. Solutions:

1. **For development**: Drop and recreate the database
2. **For production**: The migration-runner handles this automatically by detecting existing tables

### Migration Not Applied

Check if the migration is tracked:

```sql
SELECT * FROM __drizzle_migrations;
```

If missing, you can manually mark it:

```sql
INSERT INTO __drizzle_migrations (hash, created_at) 
VALUES ('0001_migration_tag', UNIX_TIMESTAMP() * 1000);
```

### Reset Migrations (Development Only)

```bash
# Remove migration tracking
mysql -e "DROP TABLE IF EXISTS __drizzle_migrations" your_database

# Remove migration files
rm -rf drizzle/

# Regenerate from current schema
yarn db:generate
```

## Best Practices

1. **One Change Per Migration**: Keep migrations focused on a single feature
2. **Test Before Deploy**: Always test migrations on a copy of production data
3. **Backwards Compatible**: Avoid breaking changes to existing columns
4. **Document Changes**: Add comments in migration SQL files
5. **Keep seedData.sql Updated**: Always sync fresh deployment schema

## Architecture

```
┌────────────────────┐     ┌────────────────────┐
│  Schema Files      │     │  Migration Files   │
│  app/db/schema/*   │────▶│  drizzle/*.sql     │
└────────────────────┘     └────────────────────┘
        │                           │
        │                           ▼
        │                  ┌────────────────────┐
        │                  │  migration-runner  │
        │                  │  (Docker startup)  │
        │                  └────────────────────┘
        │                           │
        ▼                           ▼
┌────────────────────┐     ┌────────────────────┐
│  seedData.sql      │     │  MySQL Database    │
│  (fresh deploys)   │────▶│  __drizzle_migrations
└────────────────────┘     └────────────────────┘
```

