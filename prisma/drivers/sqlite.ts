import type { DatabaseDriver } from './index';

export class SQLiteDriver implements DatabaseDriver {
  private db: any;

  constructor(db: any) {
    this.db = db;
    console.log('SQLiteDriver initialized');
  }

  async getExistingSchema(): Promise<Record<string, { columns: Array<{ name: string; type: string; notnull: boolean; dflt_value: string | null; pk: boolean }>; indexes: Array<{ name: string; unique: boolean; columns: string[] }> }>> {
    console.log('Getting existing schema...');
    const tables = await this.db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const schema: Record<string, { columns: Array<{ name: string; type: string; notnull: boolean; dflt_value: string | null; pk: boolean }>; indexes: Array<{ name: string; unique: boolean; columns: string[] }> }> = {};

    for (const table of tables) {
      const tableName = table.name;
      console.log(`Processing table: ${tableName}`);
      const columns = await this.db.all(`PRAGMA table_info(${tableName})`);
      const indexes = await this.db.all(`PRAGMA index_list(${tableName})`);
      console.log(`Columns for ${tableName}:`, columns);
      schema[tableName] = {
        columns: columns.map((column: { name: string; type: string; notnull: number; dflt_value: string | null; pk: number }) => ({
          name: column.name,
          type: column.type || '',
          notnull: column.notnull === 1,
          dflt_value: column.dflt_value,
          pk: column.pk === 1
        })),
        indexes: await Promise.all(indexes.map(async (index: { name: string; unique: number }) => {
          const indexInfo = await this.db.all(`PRAGMA index_info(${index.name})`);
          return {
            name: index.name,
            unique: index.unique === 1,
            columns: indexInfo.map((col: { name: string }) => col.name)
          };
        }))
      };
    }

    console.log('Existing schema:', JSON.stringify(schema, null, 2));
    return schema;
  }
  async createOrUpdateTable(tableName: string, tableSchema: any): Promise<void> {
    console.log(`Creating or updating table: ${tableName}`);
    console.log('Table schema:', JSON.stringify(tableSchema, null, 2));

    const existingSchema = await this.getExistingSchema();
    const existingTable = existingSchema[tableName];

    if (!existingTable) {
      console.log(`Creating new table: ${tableName}`);
      // Create new table
      const columnDefs = tableSchema.columns.map((column: any) => 
        `${column.name} ${this.mapDataType(column.type)}${column.notnull ? ' NOT NULL' : ''}${column.pk ? ' PRIMARY KEY' : ''}${column.dflt_value ? ` DEFAULT ${column.dflt_value}` : ''}`
      ).join(', ');

      const createTableQuery = `CREATE TABLE ${tableName} (${columnDefs})`;
      console.log('Create table query:', createTableQuery);
      await this.db.run(createTableQuery);

      // Create indexes
      for (const index of tableSchema.indexes) {
        const indexDef = `CREATE${index.unique ? ' UNIQUE' : ''} INDEX ${index.name} ON ${tableName} (${index.columns.join(', ')})`;
        console.log('Create index query:', indexDef);
        await this.db.run(indexDef);
      }
    } else {
      console.log(`Updating existing table: ${tableName}`);
      // Update existing table
      for (const column of tableSchema.columns) {
        const existingColumn = existingTable.columns.find((c: any) => c.name === column.name);
        if (!existingColumn) {
          console.log(`Adding new column: ${column.name}`);
          // Add new column
          const addColumnQuery = `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${this.mapDataType(column.type)}${column.notnull ? ' NOT NULL' : ''}${column.dflt_value ? ` DEFAULT ${column.dflt_value}` : ''}`;
          console.log('Add column query:', addColumnQuery);
          await this.db.run(addColumnQuery);
        } else {
          console.log(`Column ${column.name} already exists, skipping modification`);
        }
      }

      // Update indexes
      for (const index of tableSchema.indexes) {
        const existingIndex = existingTable.indexes.find((i: any) => i.name === index.name);
        if (!existingIndex) {
          console.log(`Creating new index: ${index.name}`);
          const indexDef = `CREATE${index.unique ? ' UNIQUE' : ''} INDEX ${index.name} ON ${tableName} (${index.columns.join(', ')})`;
          console.log('Create index query:', indexDef);
          await this.db.run(indexDef);
        } else {
          console.log(`Index ${index.name} already exists, skipping creation`);
        }
      }
    }

    console.log(`Table ${tableName} created or updated successfully`);
  }

  mapDataType(type: string): string {
    const mappedType = (() => {
      switch (type.toLowerCase()) {
        case 'int':
        case 'integer':
          return 'INTEGER';
        case 'string':
          return 'TEXT';
        case 'boolean':
          return 'INTEGER';
        case 'datetime':
          return 'TEXT';
        case 'float':
          return 'REAL';
        default:
          return 'TEXT';
      }
    })();
    console.log(`Mapping data type: ${type} -> ${mappedType}`);
    return mappedType;
  }
}