import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

interface Field {
  name: string;
  type: string;
  isUnique: boolean;
  isObjectId: boolean;
}

interface UniqueConstraint {
  fields: string[];
}

interface Index {
  fields: string[];
}

interface Model {
  name: string;
  tableName?: string; // Database table name if specified
  fields: Field[];
  idFields: string[];
  uniqueConstraints: UniqueConstraint[];
  indexes: Index[];
}

interface SchemaOutput {
  models: Model[];
  enums: {
    name: string;
    values: string[];
  }[];
}

// Basic parsing of model definitions
const parseModels = (schema: string): SchemaOutput => {
  const lines = schema.split('\n');
  const models: Model[] = [];
  let currentModel: Model | null = null;
  let inModelDefinition = false;

  const enumRegex = /enum (\w+) {([\s\S]*?)^}/gm
  const enums: { name: string, values: string[]} [] = []
  let match;
  while ((match = enumRegex.exec(schema)) !== null) {
    const enumName = match[1]
    const enumBody = match[2]

    const values = enumBody.trim().split('\n')
      .filter(line => line && !line.trim().startsWith('//') && 
        line.trim() !== '')
      .map((line) => {
        return line.trim()
      })

    enums.push({ name: enumName, values })
  }
  // console.log('enums', enums);

  for (const line of lines) {
    if (line.trim().startsWith('model ')) {
      inModelDefinition = true;
      const modelName = line.trim().split(' ')[1];
      currentModel = { name: modelName, fields: [], uniqueConstraints: [], indexes: [], idFields: [] };
    } else if (inModelDefinition && line.trim() === '}') {
      inModelDefinition = false;
      if (currentModel) {
        models.push(currentModel);
        currentModel = null;
      }
    } else if (inModelDefinition && currentModel) {
      // Process fields, constraints, and indexes here
      if (line && !line.startsWith('@') && !line.startsWith('@@') && !line.trim().startsWith('//') && line.trim() !== '') {
        const [name, ...rest] = line.trim().split(/\s+/)
        const type = rest[0]
        const isUnique = line.includes('@unique')
        const isObjectId = line.includes('@db.ObjectId')
        const isId = line.includes('@id')
        const isEnum = enums.find(e => e.name === type) !== undefined

        if (!name.includes('@')) {
          if (isId) {
            currentModel.idFields.push(name)
          }
          currentModel.fields.push({ name, type, isUnique, isObjectId, isEnum })
        }
      }

      // Extract table mapping
      const tableMappingMatch = line.match(/@@map\(["'](.+?)["']\)/)
      if (tableMappingMatch) {
        currentModel.tableName = tableMappingMatch[1]
      }

      // Extract unique constraints
      const uniqueMatch = line.match(/@@unique\(\[([^\]]+)\]\)/)
      if (uniqueMatch) {
        const fields = uniqueMatch[1].split(',').map(field => field.trim())
        currentModel.uniqueConstraints.push({ fields })
      }

      // Extract indexes
      const indexMatch = line.match(/@@index\(\[([^\]]+)\]\)/)
      if (indexMatch) {
        const fields = indexMatch[1].split(',').map(field => field.trim())
        currentModel.indexes.push({ fields })
      }

      // Extract id fields
      const modelIdMatch = line.match(/@@id\(\[([^\]]+)\]\)/)
      if (modelIdMatch) {
        currentModel.idFields = modelIdMatch[1].split(',').map(field => field.trim())
      }
    }
  }

  return { models, enums }
}
const parsePrismaSchema = (schemaPath: string): SchemaOutput => {
  const schema = readFileSync(schemaPath, 'utf8')
  return parseModels(schema)
}

const main = () => {
  const schemaPath = join(__dirname, '../prisma/schema.prisma')
  const { models, enums } = parsePrismaSchema(schemaPath)
  const schemaJsonPath = join(__dirname, '../prisma/schema.json')
  const schemaJson = JSON.stringify(models, null, 2)

  const schemaEnumJsonPath = join(__dirname, '../prisma/schema.enum.json')
  const schemaEnumJson = JSON.stringify(enums, null, 2)
  writeFileSync(schemaEnumJsonPath, schemaEnumJson)

  // console.log(schemaJson)
  writeFileSync(schemaJsonPath, schemaJson)
}

export const dumpSchema = main

if (require.main === module) {
  main()
}
