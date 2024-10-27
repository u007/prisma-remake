import fs from "fs";

export type SchemaJsonEnumType = {
  schemaContent: {
    name: string;
    fields: {
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
    }[];
    uniqueConstraints: { fields: string[] }[];
    indexes: { fields: string[] }[];
    idFields: string[];
  }[];
  schemaEnumContent: {
    name: string;
    values: string[];
  }[];
  schemaTypes: string[] 
}

export const parsePrismaSchemaJsons = (
	schemaPath: string,
	enumSchemaPath: string,
	recreate = false,
): SchemaJsonEnumType => {
	const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
	const schemaEnumContent = JSON.parse(fs.readFileSync(enumSchemaPath, "utf-8"));
  const schemaTypes = schemaContent.map((model: any) => model.name);

  const schemaResult: SchemaJsonEnumType["schemaContent"] = []
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
    schemaResult.push(modelSchema)
  }
  return {
    schemaContent: schemaResult,
    schemaEnumContent,
    schemaTypes,
  };
}
