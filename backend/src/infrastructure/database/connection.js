import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseDirectory = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(databaseDirectory, 'schema.sql');
export const DEFAULT_DATABASE_PATH = resolve(databaseDirectory, '../../../data/rolemap.sqlite');

export function initializeSchema(database) {
  database.exec(readFileSync(schemaPath, 'utf8'));
  return database;
}

/** Opens a SQLite connection, enables foreign keys and initializes the schema idempotently. */
export function openDatabase({
  databasePath = process.env.ROLEMAP_DB_PATH || DEFAULT_DATABASE_PATH,
  initializeSchema: shouldInitializeSchema = true,
} = {}) {
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });

  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = ON');
    if (shouldInitializeSchema) initializeSchema(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
