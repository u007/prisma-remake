import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { promisify } from 'util';

interface ColumnInfo {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  is_nullable: string;
}

interface IndexInfo {
  indexname: string;
  indexdef: string;
}

async function syncTableSchema(schemaPath: string, enumSchemaPath: string) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();

    // Get all tables
    const tablesResult = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tables = tablesResult.rows.map(row => row.table_name);

    for (const table of tables) {
      // Get current columns
      const columnsResult = await client.query<ColumnInfo>(
        `SELECT column_name, data_type, character_maximum_length, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = $1`,
        [table]
      );
      
      // Get current indexes
      const indexesResult = await client.query<IndexInfo>(
        `SELECT indexname, indexdef 
         FROM pg_indexes 
         WHERE tablename = $1`,
        [table]
      );

      const currentColumns = columnsResult.rows;
      const currentIndexes = indexesResult.rows;

      // Read schema file for expected structure
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
      const expectedStructure = parseSchemaFile(schemaContent, table);

      // Compare and update columns
      for (const expectedColumn of expectedStructure.columns) {
        const currentColumn = currentColumns.find(
          col => col.column_name === expectedColumn.name
        );

        if (!currentColumn) {
          // Add missing column
          await client.query(
            `ALTER TABLE "${table}" ADD COLUMN "${expectedColumn.name}" ${expectedColumn.type}`
          );
        } else if (currentColumn.data_type !== expectedColumn.type) {
          // Check if type can be safely converted
          if (canConvertType(currentColumn.data_type, expectedColumn.type)) {
            await client.query(
              `ALTER TABLE "${table}" ALTER COLUMN "${expectedColumn.name}" TYPE ${expectedColumn.type} USING "${expectedColumn.name}"::${expectedColumn.type}`
            );
          } else {
            throw new Error(
              `Cannot safely convert column ${expectedColumn.name} from ${currentColumn.data_type} to ${expectedColumn.type}`
            );
          }
        }

        // Update length if different
        if (expectedColumn.length && currentColumn?.character_maximum_length !== expectedColumn.length) {
          await client.query(
            `ALTER TABLE "${table}" ALTER COLUMN "${expectedColumn.name}" TYPE ${expectedColumn.type}(${expectedColumn.length})`
          );
        }
      }

      // Handle indexes
      for (const expectedIndex of expectedStructure.indexes) {
        const currentIndex = currentIndexes.find(
          idx => idx.indexname === expectedIndex.name
        );

        if (currentIndex && currentIndex.indexdef !== expectedIndex.definition) {
          // Drop and recreate if different
          await client.query(`DROP INDEX IF EXISTS "${expectedIndex.name}"`);
          await client.query(expectedIndex.definition);
        } else if (!currentIndex) {
          // Create missing index
          await client.query(expectedIndex.definition);
        }
      }
    }
  } finally {
    await client.end();
  }
}

function parseSchemaFile(content: string, tableName: string) {
  // Parse schema file to extract expected structure
  // This is a placeholder - implement actual parsing logic based on your schema format
  return {
    columns: [],
    indexes: []
  };
}

function canConvertType(fromType: string, toType: string): boolean {
  const safeConversions = new Map([
    ['varchar:text', true],
    ['text:varchar', true],
    ['integer:bigint', true],
    ['smallint:integer', true],
    ['numeric:decimal', true],
    ['timestamp:timestamptz', true],
  ]);

  const conversionKey = `${fromType}:${toType}`;
  return safeConversions.has(conversionKey) && safeConversions.get(conversionKey);
}

export default syncTableSchema;
