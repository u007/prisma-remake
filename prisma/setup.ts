import { orm } from '../src/db/orm';
import fs from 'fs';
import path from 'path';
import { type DatabaseDriver, getDriver } from './drivers/index';

async function getExistingSchema(driver: DatabaseDriver) {
  return await driver.getExistingSchema();
}

function parseSchema(schema: string): Record<string, { columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean; dflt_value: string | null }>; indexes: Array<{ name: string; unique: boolean; columns: string[] }> }> {
  const models: Record<string, { columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean; dflt_value: string | null }>; indexes: Array<{ name: string; unique: boolean; columns: string[] }> }> = {};
  let currentModel: { name: string; columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean; dflt_value: string | null }>; indexes: Array<{ name: string; unique: boolean; columns: string[] }>; driver: { mapDataType: (type: string) => string } } | null = null;

  for (const line of schema.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('model')) {
      const modelName = trimmedLine.split(' ')[1];
      currentModel = { name: modelName, columns: [], indexes: [], driver: { mapDataType: (type: string) => type } };
      models[modelName] = currentModel;
    } else if (currentModel && trimmedLine.includes(' ')) {
      const [name, ...rest] = trimmedLine.split(' ');
      const type = rest[0];
      const isUnique = trimmedLine.includes('@unique');
      const isOptional = type.endsWith('?');
      const isList = type.endsWith('[]');
      
      let sqlType = currentModel.driver.mapDataType(type);

      currentModel.columns.push({
        name,
        type: sqlType,
        notnull: !isOptional,
        pk: name === 'id',
        dflt_value: name === 'createdAt' ? 'CURRENT_TIMESTAMP' : null
      });

      if (isUnique) {
        currentModel.indexes.push({
          name: `${currentModel.name}_${name}_key`,
          unique: true,
          columns: [name]
        });
      }
    } else if (currentModel && trimmedLine.startsWith('@@index')) {
      const indexMatch = trimmedLine.match(/\[(.*?)\]/);
      if (indexMatch) {
        const columns = indexMatch[1].split(',').map(c => c.trim());
        currentModel.indexes.push({
          name: `${currentModel.name}_${columns.join('_')}_idx`,
          unique: false,
          columns
        });
      }
    } else if (currentModel && trimmedLine.startsWith('@@unique')) {
      const uniqueMatch = trimmedLine.match(/\[(.*?)\]/);
      if (uniqueMatch) {
        const columns = uniqueMatch[1].split(',').map(c => c.trim());
        currentModel.indexes.push({
          name: `${currentModel.name}_${columns.join('_')}_key`,
          unique: true,
          columns
        });
      }
    }
  }

  return models;
}function generateDesiredSchema(driver: DatabaseDriver): any {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const parsedSchema = parseSchema(schemaContent);
  
  // Inject the driver into each model for type mapping
  for (const model of Object.values(parsedSchema)) {
    model.driver = driver;
  }

  return parsedSchema;
}
async function createOrUpdateTable(driver: DatabaseDriver, tableName: string, tableSchema: any) {
  await driver.createOrUpdateTable(tableName, tableSchema);
}

export async function setupDatabase() {
  await orm.connect();
  console.log('Database connected successfully.', orm);
  const driver = getDriver(orm.db);
  const existingSchema = await getExistingSchema(driver);
  const desiredSchema = generateDesiredSchema(driver);

  for (const [tableName, tableSchema] of Object.entries(desiredSchema)) {
    await createOrUpdateTable(driver, tableName, tableSchema);
  }

  console.log('Database schema updated successfully.');
}