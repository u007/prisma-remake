import { DatabaseDriver } from './index.js';

export class PostgreSQLDriver implements DatabaseDriver {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  async getExistingSchema(): Promise<any> {
    const tables = await this.db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    const schema: any = {};

    for (const table of tables.rows) {
      const tableName = table.table_name;
      const columns = await this.db.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = $1
      `, [tableName]);

      const indexes = await this.db.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = $1
      `, [tableName]);

      schema[tableName] = {
        columns: columns.rows.map((column: any) => ({
          name: column.column_name,
          type: column.data_type,
          notnull: column.is_nullable === 'NO',
          dflt_value: column.column_default,
          pk: column.column_default?.includes('nextval')
        })),
        indexes: indexes.rows.map((index: any) => ({
          name: index.indexname,
          unique: index.indexdef.includes('UNIQUE'),
          columns: index.indexdef.match(/\((.+?)\)/)[1].split(', ')
        }))
      };
    }

    return schema;
  }

  async createOrUpdateTable(tableName: string, tableSchema: any): Promise<void> {
    const existingSchema = await this.getExistingSchema();
    const existingTable = existingSchema[tableName];

    if (!existingTable) {
      // Create new table
      const columnDefs = tableSchema.columns.map((column: any) => 
        `${column.name} ${this.mapDataType(column.type)}${column.notnull ? ' NOT NULL' : ''}${column.pk ? ' PRIMARY KEY' : ''}${column.dflt_value ? ` DEFAULT ${column.dflt_value}` : ''}`
      ).join(', ');

      await this.db.query(`CREATE TABLE ${tableName} (${columnDefs})`);

      // Create indexes
      for (const index of tableSchema.indexes) {
        const indexDef = `CREATE${index.unique ? ' UNIQUE' : ''} INDEX ${index.name} ON ${tableName} (${index.columns.join(', ')})`;
        await this.db.query(indexDef);
      }
    } else {
      // Update existing table
      for (const column of tableSchema.columns) {
        const existingColumn = existingTable.columns.find((c: any) => c.name === column.name);
        if (!existingColumn) {
          // Add new column
          await this.db.query(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${this.mapDataType(column.type)}${column.notnull ? ' NOT NULL' : ''}${column.dflt_value ? ` DEFAULT ${column.dflt_value}` : ''}`);
        } else {
          // Modify existing column if needed
          if (existingColumn.type !== this.mapDataType(column.type) || existingColumn.notnull !== column.notnull) {
            await this.db.query(`ALTER TABLE ${tableName} ALTER COLUMN ${column.name} TYPE ${this.mapDataType(column.type)}${column.notnull ? ' SET NOT NULL' : ' DROP NOT NULL'}`);
          }
        }
      }

      // Update indexes
      for (const index of tableSchema.indexes) {
        const existingIndex = existingTable.indexes.find((i: any) => i.name === index.name);
        if (!existingIndex) {
          const indexDef = `CREATE${index.unique ? ' UNIQUE' : ''} INDEX ${index.name} ON ${tableName} (${index.columns.join(', ')})`;
          await this.db.query(indexDef);
        }
      }
    }
  }

  mapDataType(type: string): string {
    switch (type) {
      case 'Int':
        return 'INTEGER';
      case 'String':
        return 'TEXT';
      case 'Boolean':
        return 'BOOLEAN';
      case 'DateTime':
        return 'TIMESTAMP';
      case 'Float':
        return 'REAL';
      default:
        return 'TEXT';
    }
  }
}