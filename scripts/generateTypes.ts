import fs from 'fs';
import path from 'path';

const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
const outputPath = path.join(process.cwd(), 'src', 'db', 'generatedTypes.ts');

interface Field {
  name: string;
  type: string;
  isUnique: boolean;
  isOptional: boolean;
  isList: boolean;
  relation?: {
    name: string;
    fields: string[];
    references: string[];
  };
}

interface Model {
  name: string;
  fields: Field[];
  uniqueConstraints: string[][];
  indexes: string[][];
}

function parseSchema(schema: string): Model[] {
  if (!schema) {
    throw new Error('Schema content is empty or undefined');
  }

  const models: Model[] = [];
  let currentModel: Model | null = null;

  schema.split('\n').forEach((line, index) => {
    try {
      line = line.trim();
      if (line.startsWith('model')) {
        if (currentModel) models.push(currentModel);
        currentModel = {
          name: line.split(' ')[1],
          fields: [],
          uniqueConstraints: [],
          indexes: []
        };
      } else if (currentModel && line.includes(' ')) {
        const [name, ...rest] = line.split(' ');
        const type = rest[0];
        const isUnique = line.includes('@unique');
        const isOptional = type.endsWith('?');
        const isList = type.endsWith('[]');
        
        const field: Field = {
          name,
          type: type.replace('?', '').replace('[]', ''),
          isUnique,
          isOptional,
          isList
        };

        if (line.includes('@relation')) {
          const relationMatch = line.match(/@relation\((.*?)\)/);
          if (relationMatch) {
            const relationParts = relationMatch[1].split(',');
            field.relation = {
              name: relationParts[0].trim().replace(/['"]/g, ''),
              fields: relationParts[1].split(':')[1].trim().replace(/[\[\]]/g, '').split(','),
              references: relationParts[2].split(':')[1].trim().replace(/[\[\]]/g, '').split(',')
            };
          }
        }

        currentModel.fields.push(field);
      } else if (currentModel && line.startsWith('@@unique')) {
        const fieldsMatch = line.match(/\[(.*?)\]/);
        if (fieldsMatch) {
          currentModel.uniqueConstraints.push(fieldsMatch[1].split(',').map(f => f.trim()));
        }
      } else if (currentModel && line.startsWith('@@index')) {
        const fieldsMatch = line.match(/\[(.*?)\]/);
        if (fieldsMatch) {
          currentModel.indexes.push(fieldsMatch[1].split(',').map(f => f.trim()));
        }
      }
    } catch (error) {
      console.error(`Error parsing line ${index + 1}: ${line}`);
      console.error(error);
    }
  });

  if (currentModel) models.push(currentModel);
  return models;
}

function generateTypes(models: Model[]): string {
  let output = `// This file is auto-generated. Do not edit it directly.\n\n`;

  output += `export interface ORM {\n`;
  
  for (const model of models) {
    output += `  ${model.name}: {\n`;
    output += `    findFirst: (where: Partial<${model.name}>) => Promise<${model.name} | null>;\n`;
    output += `    findMany: (where?: Partial<${model.name}>) => Promise<${model.name}[]>;\n`;
    output += `    create: (data: Omit<${model.name}, 'id'>) => Promise<{ id: number }>;\n`;
    output += `    update: (where: { id: number }, data: Partial<${model.name}>) => Promise<{ affected: number }>;\n`;
    output += `    delete: (where: { id: number }) => Promise<{ affected: number }>;\n`;
    output += `  };\n`;
  }

  output += `}\n\n`;

  for (const model of models) {
    output += `export interface ${model.name} {\n`;
    for (const field of model.fields) {
      let tsType = 'string';
      if (field.type === 'Int') tsType = 'number';
      if (field.type === 'Boolean') tsType = 'boolean';
      if (field.type === 'DateTime') tsType = 'Date';
      if (field.relation) tsType = field.relation.references[0];
      if (field.isList) tsType += '[]';
      output += `  ${field.name}${field.isOptional ? '?' : ''}: ${tsType};\n`;
    }
    output += `}\n\n`;

    if (model.uniqueConstraints.length > 0) {
      output += `export type ${model.name}UniqueConstraints = {\n`;
      model.uniqueConstraints.forEach((constraint, index) => {
        output += `  constraint${index + 1}: { ${constraint.map(field => `${field}: ${model.name}['${field}']`).join(', ')} };\n`;
      });
      output += `};\n\n`;
    }

    if (model.indexes.length > 0) {
      output += `export type ${model.name}Indexes = {\n`;
      model.indexes.forEach((index, i) => {
        output += `  index${i + 1}: { ${index.map(field => `${field}: ${model.name}['${field}']`).join(', ')} };\n`;
      });
      output += `};\n\n`;
    }
  }

  return output;
}

try {
  console.log(`Reading schema from: ${schemaPath}`);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found at ${schemaPath}`);
  }
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  console.log('Schema content length:', schemaContent.length);
  console.log('First 100 characters of schema:', schemaContent.slice(0, 100));

  console.log('Parsing schema...');
  const parsedSchema = parseSchema(schemaContent);
  console.log('Parsed schema:', JSON.stringify(parsedSchema, null, 2));

  console.log('Generating types...');
  const generatedTypes = generateTypes(parsedSchema);

  console.log(`Writing generated types to: ${outputPath}`);
  fs.writeFileSync(outputPath, generatedTypes);
  console.log(`Types generated successfully at ${outputPath}`);
} catch (error) {
  console.error('Error generating types:', error);
}