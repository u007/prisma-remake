import fs from "fs";

export type SchemaJsonEnumType = {
  name: string;
  values: string[];
}

export type SchemaJsonIndexType = {
  fields: string[];
}

export type SchemaJsonUniqueConstraintType = {
  fields: string[];
}

export type SchemaJsonTableType = {
  name: string;
  fields: SchemaJsonFieldType[];
  uniqueConstraints: SchemaJsonUniqueConstraintType[];
  indexes: SchemaJsonIndexType[];
  idFields: string[];
}

export type SchemaJsonFieldType = {
  name: string;
  type: string;
  isUnique: boolean;
  isObjectId: boolean;
  isEnum: boolean;
  isArray?: boolean;
  isOptional?: boolean;
  isRelation?: boolean;
  relation?: {
    name: string;
    fields: string[];
    references: string[];
    onDelete: string;
    onUpdate: string;
  };
}
export type SchemaJsonType = {
  schema: SchemaJsonTableType[];
  enums: SchemaJsonEnumType[];
  tables: string[] 
}

export const parsePrismaSchemaJsons = (
	schemaPath: string,
	enumSchemaPath: string,
	recreate = false,
): SchemaJsonType => {
	const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
	const schemaEnumContent = JSON.parse(fs.readFileSync(enumSchemaPath, "utf-8"));
  const schemaTypes = schemaContent.map((model: SchemaJsonTableType) => model.name);

  const schemaResult: SchemaJsonTableType[] = []
  for (const model of schemaContent) {
    const modelSchema = structuredClone(model)
    if (model.fields) {
      for (const field of modelSchema.fields) {
        field.isArray = field.type.endsWith('[]')
        field.isOptional = field.type.endsWith('?');
        field.type = field.type.replace('[]', '').replace('?', '');

        field.isRelation = !field.isEnum && schemaTypes.includes(field.type);
        if (field.relation) {
          field.relation.name = field.relation.name.replace('[]', '').replace('?', '');
        }
      }
    }

    // if any field.isUnique but not uniqueConstraints, add it to uniqueConstraints
    for (const field of modelSchema.fields) {
      if (field.isUnique && !modelSchema.uniqueConstraints.some(constraint => constraint.fields?.length === 1 && constraint.fields[0] === field.name)) {
        modelSchema.uniqueConstraints.push({
          fields: [field.name],
        })
      }
    }

    // if any uniqueConstraints not in indexes, add it to indexes
    for (const constraint of modelSchema.uniqueConstraints) {
      if (!modelSchema.indexes.some(index => index.fields.length === constraint.fields.length && index.fields.every((field, index) => field === constraint.fields[index]))) {
        modelSchema.indexes.push({
          fields: constraint.fields,
        })
      }
    }
    schemaResult.push(modelSchema)
  }


  return {
    schema: schemaResult,
    enums: schemaEnumContent,
    tables: schemaTypes,
  };
}
