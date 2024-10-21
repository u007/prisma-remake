import { orm } from '../src/db/orm.js';
import fs from 'fs';
import path from 'path';
import { DatabaseDriver, getDriver } from './drivers/index.js';

async function getExistingSchema(driver: DatabaseDriver) {
  return await driver.getExistingSchema();
}

function parseSchema(schema: string): any {
  const models: any = {};
  let currentModel: any = null;

  schema.split('\n').forEach((line) => {
    line = line.trim();
    if (line.startsWith('model')) {
      const modelName = line.split(' ')[1];
      currentModel = { columns: [], indexes: [] };
      models[modelName] = currentModel;
    } else if (currentModel && line.includes(' ')) {
      const [name, ...rest] = line.split(' ');
      const type = rest[0];
      const isUnique = line.includes('@unique');
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
    } else if (currentModel && line.startsWith('@@index')) {
      const indexMatch = line.match(/\[(.*?)\]/);
      if (indexMatch) {
        const columns = indexMatch[1].split(',').map(c => c.trim());
        currentModel.indexes.push({
          name: `${currentModel.name}_${columns.join('_')}_idx`,
          unique: false,
          columns
        });
      }
    } else if (currentModel && line.startsWith('@@unique')) {
      const uniqueMatch = line.match(/\[(.*?)\]/);
      if (uniqueMatch) {
        const columns = uniqueMatch[1].split(',').map(c => c.trim());
        currentModel.indexes.push({
          name: `${currentModel.name}_${columns.join('_')}_key`,
          unique: true,
          columns
        });
      }
    }
  });

  return models;
}

function generateDesiredSchema(driver: DatabaseDriver): any {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const parsedSchema = parseSchema(schemaContent);
  
  // Inject the driver into each model for type mapping
  Object.values(parsedSchema).forEach((model: any) => {
    model.driver = driver;
  });

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