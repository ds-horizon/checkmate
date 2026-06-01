#!/bin/bash
set -e

echo "════════════════════════════════════════════════════════════════"
echo "🚀 Checkmate Application Startup"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Wait for database to be ready
echo "⏳ Waiting for database connection..."
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if node -e "
    const mysql = require('mysql2/promise');
    (async () => {
      try {
        const conn = await mysql.createConnection(process.env.DB_URL);
        await conn.query('SELECT 1');
        await conn.end();
        process.exit(0);
      } catch (e) {
        process.exit(1);
      }
    })();
  " 2>/dev/null; then
    echo "✅ Database is ready!"
    echo ""
    break
  fi
  
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "   Attempt $RETRY_COUNT/$MAX_RETRIES - Database not ready, waiting..."
  sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "❌ Failed to connect to database after $MAX_RETRIES attempts"
  exit 1
fi

# Run database migrations
echo "════════════════════════════════════════════════════════════════"
echo "📦 Database Migration"
echo "════════════════════════════════════════════════════════════════"
echo ""

if npx tsx scripts/migration-runner.ts; then
  echo ""
  echo "✅ Migration process completed!"
else
  MIGRATION_EXIT_CODE=$?
  echo ""
  echo "⚠️  Migration process exited with code $MIGRATION_EXIT_CODE"
  echo "   The application will still attempt to start..."
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "🎯 Starting Application Server"
echo "════════════════════════════════════════════════════════════════"
echo ""

exec node server.mjs
