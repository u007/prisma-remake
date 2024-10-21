import { SQLiteDriver } from './sqlite.js';
import { PostgreSQLDriver } from './postgresql.js';

export interface DatabaseDriver {
  getExistingSchema(): Promise<any>;
  createOrUpdateTable(tableName: string, tableSchema: any): Promise<void>;
  mapDataType(type: string): string;
}

export function getDriver(db: any): DatabaseDriver {
  // Determine the database type based on the db object
  console.log('Database driver:', db.config.driver);
  if (db.driver instanceof SQLiteDriver) {
    return new SQLiteDriver(db);
  } else if (db.driver instanceof PostgreSQLDriver) {
    return new PostgreSQLDriver(db);
  } else {
    console.error('Unsupported database type', db.driver.constructor.name);
    throw new Error('Unsupported database type');
  }
}