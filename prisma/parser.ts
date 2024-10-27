import fs from "fs";

export const parsePrismaSchemaJsons = (
	schemaPath: string,
	enumSchemaPath: string,
	recreate = false,
) => {
	const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
	const schemaEnumContent = JSON.parse(fs.readFileSync(enumSchemaPath, "utf-8"));
  const schemaTypes = schemaContent.map((model: any) => model.name);
  for (const model of schemaContent) {
    if (model.fields) {
      for (const field of model.fields) {
        field.isArray = field.type.endsWith('[]')
        field.isOptional = field.type.endsWith('?');
        field.type = field.type.replace('[]', '').replace('?', '');

        field.isRelation = !field.isEnum && schemaTypes.includes(field.type);
        if (field.relation) {
          field.relation.name = field.relation.name.replace('[]', '').replace('?', '');
        }
      }
    }
  }
  return {
    schemaContent,
    schemaEnumContent,
    schemaTypes,
  };
}
