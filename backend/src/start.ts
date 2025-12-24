import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  try {
    console.log('Running database migrations...');
    const sql = postgres(connectionString, { max: 1 });
    const db = drizzle(sql);
    
    // Run migrations - path is relative to dist/start.js location
    // dist/start.js is in dist/, so we go up one level to find drizzle/migrations
    const migrationsFolder = path.join(__dirname, '../drizzle/migrations');
    await migrate(db, { migrationsFolder });
    console.log('Migrations completed successfully!');
    
    await sql.end();
  } catch (error) {
    console.error('Migration failed:', error);
    // Exit on migration failure to prevent starting with wrong schema
    process.exit(1);
  }
}

// Run migrations, then start the server
runMigrations()
  .then(() => {
    console.log('Starting server...');
    // Import and start server after migrations complete
    require('./server');
  })
  .catch((err) => {
    console.error('Failed to run migrations:', err);
    process.exit(1);
  });

