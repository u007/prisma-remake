import assert from 'assert';
import { SQLiteDriver } from './sqlite.js';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { afterAll, beforeAll, describe, it } from 'bun:test';

describe('SQLiteDriver', () => {
  let driver: SQLiteDriver;
  let db: any;

  beforeAll(async () => {
    db = await open({
      filename: ':memory:',
      driver: sqlite3.Database
    });
    driver = new SQLiteDriver(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('should get existing schema', async () => {
    // Create a test table
    await db.exec(`
      CREATE TABLE TestTable (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        age INTEGER
      )
    `);

    const schema = await driver.getExistingSchema();
    assert.deepStrictEqual(
      Object.fromEntries(
        Object.entries(schema.TestTable).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.sort((a, b) => a.name.localeCompare(b.name)) : value
        ])
      ),
      {
        columns: [
          { name: 'age', type: 'INTEGER', notnull: false, dflt_value: null, pk: false },
          { name: 'id', type: 'INTEGER', notnull: false, dflt_value: null, pk: true },
          { name: 'name', type: 'TEXT', notnull: true }
        ],
        indexes: []
      }
    );
  });

  it('should create or update table', async () => {
    const tableSchema = {
      columns: [
        { name: 'id', type: 'INTEGER', notnull: 1, pk: 1 },
        { name: 'email', type: 'TEXT', notnull: 1 },
        { name: 'created_at', type: 'DATETIME', notnull: 1, dflt_value: 'CURRENT_TIMESTAMP' }
      ],
      indexes: [
        { name: 'email_idx', unique: true, columns: ['email'] }
      ]
    };

    console.debug('Creating or updating Users table with schema:', JSON.stringify(tableSchema, null, 2));
    await driver.createOrUpdateTable('Users', tableSchema);

    console.debug('Verifying table creation');
    // Verify the table was created correctly
    const schema = await driver.getExistingSchema();
    console.debug('Existing schema:', JSON.stringify(schema, null, 2));
    assert.deepStrictEqual(schema.Users, tableSchema);

    console.debug('Testing table update');
    // Test updating the table
    tableSchema.columns.push({ name: 'age', type: 'INTEGER', notnull: 0 });
    console.debug('Updated schema:', JSON.stringify(tableSchema, null, 2));
    await driver.createOrUpdateTable('Users', tableSchema);

    console.debug('Verifying table update');
    const updatedSchema = await driver.getExistingSchema();
    console.debug('Updated existing schema:', JSON.stringify(updatedSchema, null, 2));
    assert.deepStrictEqual(updatedSchema.Users, tableSchema);
  });

  it('should map data types correctly', () => {
    assert.strictEqual(driver.mapDataType('Int'), 'INTEGER');
    assert.strictEqual(driver.mapDataType('String'), 'TEXT');
    assert.strictEqual(driver.mapDataType('Boolean'), 'INTEGER');
    assert.strictEqual(driver.mapDataType('DateTime'), 'TEXT');
    assert.strictEqual(driver.mapDataType('Float'), 'REAL');
  });
});