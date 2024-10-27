import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { dumpSchema } from "./dumpSchema";
import {
	parsePrismaSchemaJsons,
	type SchemaJsonType,
	type SchemaJsonFieldType,
	type SchemaJsonTableType,
	type SchemaJsonEnumType,
	type SchemaJsonIndexType,
	type SchemaJsonUniqueConstraintType,
} from "../prisma/parser";
interface ColumnInfo {
	name: string;
	type: string;
	notnull: number;
}

interface IndexInfo {
	name: string;
	sql: string;
}

const DB_DEBUG = process.env.DB_DEBUG === "true";
let promptYesToAll = false;

const DB_REFERENTIAL_ACTION_MAP = {
	Cascade: "CASCADE",
	SetNull: "SET NULL",
	SetDefault: "SET DEFAULT",
	Restrict: "RESTRICT",
	NoAction: "NO ACTION",
};

interface CurrentColumnType {
	name: string;
	type: string;
}

async function initializeDatabase() {
	const url = (process.env.DATABASE_URL || ":memory:")
		.replace("sqlite://", "")
		.replace("sqlite:", "");

	if (DB_DEBUG) console.log(`Opening database at ${url}`);

	return await open({
		filename: url,
		driver: sqlite3.Database,
	});
}

async function dropAllTables(
	db: any,
	schemas: SchemaJsonTableType[],
) {
	if (DB_DEBUG) console.log("Dropping all tables...");
	if (!promptYesToAll) {
		const answer = prompt("Are you sure you want to drop all tables? (y/n/A) ");
		if (answer?.toLowerCase() === "a") {
			promptYesToAll = true;
		} else if (answer?.toLowerCase() !== "y") {
			return;
		}
	}

	for (const tableSchema of schemas) {
		console.log("dropping table", tableSchema.name);
		await db.exec(`DROP TABLE IF EXISTS "${tableSchema.name}"`);
	}

	if (DB_DEBUG) console.log("All tables dropped successfully");
}

async function syncTableSchema(
	schemaPath: string,
	enumSchemaPath: string,
	recreate = false,
) {
	const db = await initializeDatabase();
	const schemas = await parsePrismaSchemaJsons(schemaPath, enumSchemaPath);

	if (recreate) {
		await dropAllTables(db, schemas.schema);
	}

	const existingTables = await getExistingTables(db);

	for (const tableSchema of schemas.schema) {
		if (!existingTables.some((t) => t.name === tableSchema.name)) {
			await createNewTable(db, tableSchema, schemas.enums);
		} else {
			await updateExistingTable(db, tableSchema, schemas.enums);
		}
	}
}

async function getExistingTables(db: any) {
	const tables = await db.all(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
	);

	if (DB_DEBUG) console.log(`Found ${tables.length} tables`);

	return tables;
}

function createNewTable(db, tableSchema: SchemaJsonTableType, enums: SchemaJsonEnumType[]) {
	const fields = buildTableFields(tableSchema, enums);
	const constraints = buildTableConstraints(tableSchema);
	const primaryKey = buildPrimaryKeyDefinition(tableSchema);
	const sql = buildCreateTableSQL(tableSchema.name, fields, constraints, primaryKey)
	if (DB_DEBUG) console.log(sql);
	return db.exec(
		sql
	);
}

function updateExistingTable(
	db: any,
	tableSchema: SchemaJsonTableType,
	enumSchema: SchemaJsonEnumType[],
) {
	console.log('updating table', tableSchema.name);
	return Promise.all([
		updateColumns(db, tableSchema, enumSchema),
		updateIndexes(db, tableSchema),
		updateForeignKeys(db, tableSchema),
		updatePrimaryKey(db, tableSchema),
	]);
}

async function updatePrimaryKey(db: any, tableSchema: SchemaJsonTableType) {
	const currentColumns = await db.all(
		`PRAGMA table_info(${tableSchema.name})`,
	) as ColumnInfo[];

	const existingIdFields = currentColumns
		.filter((col: ColumnInfo) => col.name === "id")
		.map((col: ColumnInfo) => col.name);

	if (existingIdFields.length > 0) {
		if (
			!tableSchema.idFields ||
			tableSchema.idFields.join(",") !== existingIdFields.join(",")
		) {
			console.log("Primary key mismatch", {
				new: tableSchema.idFields,
				old: existingIdFields,
			});
			await alterTableAddPrimaryKey(db, tableSchema.name, tableSchema.idFields);
		}
	} else if (tableSchema.idFields?.length) {
		await alterTableAddPrimaryKey(
			db,
			tableSchema.name,
			tableSchema.idFields,
		);
	}
}
async function updateForeignKeys(db: any, tableSchema: SchemaJsonTableType) {
	for (const field of tableSchema.fields) {
		if (field.isArray || !field.relation) continue;

		const fkName = `fk_${tableSchema.name}_${field.name}`;
		const referencedTable = field.relation.name.replace("?", "");

		const fkExists = await db.get(
			`SELECT COUNT(*) as count FROM pragma_foreign_key_list(?) 
            WHERE "table" = ? AND "to" IN (${field.relation.references.map(() => "?").join(",")}) 
            AND "from" IN (${field.relation.fields.map(() => "?").join(",")})`,
			[
				tableSchema.name,
				referencedTable,
				...field.relation.references,
				...field.relation.fields,
			],
		);

		if (!fkExists?.count) {
			console.warn(
				`Foreign key ${fkName} requires table recreation (${field.relation.fields[0]} -> ${referencedTable}.${field.relation.references[0]})`,
			);

			await addForeignKeyConstraint(
				db,
				tableSchema.name,
				field.relation.fields.join(", "),
				referencedTable,
				field.relation.references.join(", "),
			);

			if (DB_DEBUG) console.log(`Added foreign key: ${fkName}`);
		}
	}
}

function buildPrimaryKeyDefinition(tableSchema: any): string {
	if (!tableSchema.idFields?.length) {
		return "";
	}

	return `PRIMARY KEY (${tableSchema.idFields.join(", ")})`;
}

async function updateColumns(db: any, tableSchema: SchemaJsonTableType, enums: SchemaJsonEnumType[]) {
	const currentColumns = await db.all(
		`PRAGMA table_info(${tableSchema.name})`,
	) as ColumnInfo[];

	for (const field of tableSchema.fields) {
		if (field.isRelation) continue;

		const currentColumn = currentColumns.find(
			(col: ColumnInfo) => col.name === field.name,
		);

		const sqliteType = getSQLiteType(
			field.type,
			field.isEnum,
			enums,
		);

		if (! currentColumn) {
			if (DB_DEBUG) console.log(`Adding missing column: ${tableSchema.name} ${field.name}`);
			await db.exec(
				`ALTER TABLE "${tableSchema.name}" ADD COLUMN "${field.name}" ${sqliteType}`,
			);
			continue;
		}
		
		if (currentColumn.type !== sqliteType) {
			if (DB_DEBUG) {
				console.log(
					`Column type mismatch for ${field.name}: ${currentColumn.type} vs ${sqliteType}`,
				);
			}

			if (!canConvertType(currentColumn.type, sqliteType)) {
				console.error(
					`Column type change for ${field.name} requires table recreation`,
				);
				throw new Error("Table recreation required");
			}

			await db.exec(
				`ALTER TABLE "${tableSchema.name}" ALTER COLUMN "${field.name}" SET DATA TYPE ${sqliteType}`,
			);
		}
	}
}
// Helper functions for table components
function buildTableFields(tableSchema: SchemaJsonTableType, enums: SchemaJsonEnumType[]) {
	return tableSchema.fields
		.filter((field) => !field.isRelation)
		.map((field) => buildFieldDefinition(field, enums))
		.join(", ");
}

function buildTableConstraints(tableSchema: SchemaJsonTableType) {
	return tableSchema.fields
		.filter((field) => field.isRelation && field.relation)
		.map((field) => buildForeignKeyConstraint(field))
		.join(", ");
}

// SQL builders
function buildCreateTableSQL(
	tableName: string,
	fields: string,
	constraints: string,
	primaryKey: string,
) {
	return `CREATE TABLE IF NOT EXISTS "${tableName}" (
        ${fields}
        ${primaryKey ? `, ${primaryKey}` : ""}
        ${constraints ? `, ${constraints}` : ""}
    )`;
}

async function alterColumnType(
	db: any,
	tableName: string,
	field: SchemaJsonFieldType,
	existingType: string,
	enums: SchemaJsonEnumType[],
) {
	const sqliteType = getSQLiteType(
		field.type,
		field.isEnum,
		enums,
	);

	if (DB_DEBUG) {
		console.log(`Altering column type: ${field.name} to ${sqliteType}`);
	}

	// Check if type conversion is possible
	if (!canConvertType(existingType, sqliteType)) {
		console.error(`Type conversion not possible for column: ${field.name}`);
		throw new Error("Type conversion not possible");
	}
	await db.exec(
		`ALTER TABLE "${tableName}" ALTER COLUMN "${field.name}" SET DATA TYPE ${sqliteType}`,
	);
}

function needsTypeChange(currentColumn: ColumnInfo, field: SchemaJsonFieldType, enums: SchemaJsonEnumType[]): boolean {
	const sqliteType = getSQLiteType(
		field.type,
		field.isEnum,
		enums,
	);

	return currentColumn.type !== sqliteType;
}

async function addColumn(db: any, tableName: string, field: SchemaJsonFieldType, enums: SchemaJsonEnumType[]) {
	const sqliteType = getSQLiteType(
		field.type,
		field.isEnum,
		enums,
	);

	if (DB_DEBUG) console.log(`Adding column: ${field.name}`);

	await db.exec(
		`ALTER TABLE "${tableName}" ADD COLUMN "${field.name}" ${sqliteType}`,
	);
}

// Index management
async function updateIndexes(
	db: any,
	tableSchema: SchemaJsonTableType,
) {
	const currentIndexes = await db.all(
		`PRAGMA index_list(${tableSchema.name})`,
	) as IndexInfo[];
	for (const index of tableSchema.indexes) {
		const indexName = buildIndexName(tableSchema.name, index);
		await recreateIndexIfNeeded(
			db,
			indexName,
			tableSchema,
			index,
			currentIndexes,
			tableSchema.uniqueConstraints,
		);
	}
}
function buildIndexName(tableName: string, index: SchemaJsonIndexType): string {
	return `idx_${tableName}_${index.fields.join("_")}`;
}

async function recreateIndexIfNeeded(
	db: any,
	indexName: string,
	tableSchema: SchemaJsonTableType,
	index: SchemaJsonIndexType,
	currentIndexes: IndexInfo[],
	uniques: SchemaJsonUniqueConstraintType[],
) {
	console.log('checking uniques', tableSchema.name, uniques)
	const foundUnique = uniques.find((unique) =>	unique.fields.every((f: string) => index.fields.includes(f)))
	const indexDefinition = `CREATE ${foundUnique ? "UNIQUE" : ""} INDEX "${indexName}" 
        ON "${tableSchema.name}" (${index.fields.map((f: string) => `"${f}"`).join(", ")})`;

	const currentIndex = currentIndexes.find((idx) => idx.name === indexName);
	if (currentIndex) {
		await db.exec(`DROP INDEX IF EXISTS "${indexName}"`);
	}
	await db.exec(indexDefinition);
}

function buildFieldDefinition(field: SchemaJsonFieldType, enums: SchemaJsonEnumType[]): string {
	const sqliteType = getSQLiteType(
		field.type,
		field.isEnum,
		enums,
	);
	const fieldDef = `"${field.name}" ${sqliteType}`;
	return fieldDef;
}

function buildForeignKeyConstraint(field: SchemaJsonFieldType): string {
	if (!field.relation) return "";
	const referencedTable = field.relation.name;
	let fkDefinition = `FOREIGN KEY ("${field.relation.fields.join('", "')}") 
        REFERENCES "${referencedTable}" ("${field.relation.references.join('", "')}")`;

	if (field.relation.onDelete) {
		fkDefinition += ` ON DELETE ${DB_REFERENTIAL_ACTION_MAP[field.relation.onDelete]}`;
	}
	if (field.relation.onUpdate && field.relation.onUpdate !== "NoAction") {
		fkDefinition += ` ON UPDATE ${DB_REFERENTIAL_ACTION_MAP[field.relation.onUpdate]}`;
	}

	return fkDefinition;
}

function getSQLiteType(
	prismaType: string,
	isEnum: boolean,
	enumContent: SchemaJsonEnumType[],
): string {
	if (isEnum) {
		//TODO
		return "TEXT";
	}

	switch (prismaType) {
		case "String":
			return "TEXT";
		case "Int":
			return "INTEGER";
		case "Boolean":
			return "INTEGER";
		case "DateTime":
			return "DATETIME";
		case "Float":
			return "REAL";
		default:
			if (prismaType.endsWith("[]")) {
				return "TEXT";
			}
			if (prismaType.endsWith("?")) {
				return getSQLiteType(prismaType.slice(0, -1), isEnum, enumContent);
			}
			throw new Error(`Unsupported type: ${prismaType}`);
		// return "TEXT";
	}
}
function parseSchemaFile(content: string, tableName: string) {
	// Parse schema file to extract expected structure
	// This is a placeholder - implement actual parsing logic based on your schema format
	return {
		columns: [],
		indexes: [],
	};
}

function canConvertType(fromType: string, toType: string): boolean {
	const safeConversions = new Map([
		["TEXT:VARCHAR", true],
		["VARCHAR:TEXT", true],
		["INTEGER:BIGINT", true],
		["NUMERIC:DECIMAL", true],
		["DATETIME:TIMESTAMP", true],
	]);

	const conversionKey = `${fromType.toUpperCase()}:${toType.toUpperCase()}`;
	return safeConversions.get(conversionKey) ?? false;
}

async function alterTableAddPrimaryKey(
	db: any,
	tableName: string,
	columnNames: string[],
): Promise<string> {
	const tempTableName = `${tableName}_temp`;

	const countResult = await db.get(
		`SELECT COUNT(*) as count FROM ${tableName}`,
	);
	if (countResult.count >= 10000) {
		throw new Error(
			`Table ${tableName} has too many records (${countResult.count}) to drop and recreate. Maximum allowed is 10000.`,
		);
	}

	if (!promptYesToAll) {
		const answer = prompt(
			`Are you sure you want to add foreign key constraint to table ${tableName}? (y/n/A) `,
		);
		if (answer?.toLowerCase() === "a") {
			promptYesToAll = true;
		} else if (answer?.toLowerCase() !== "y") {
			return "";
		}
	}

	// Get existing table schema
	const tableInfo = await db.get(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
		[tableName],
	);

	// Create temp table with same schema as original
	const createTempTableSQL = tableInfo.sql.replace(
		new RegExp(`"?${tableName}"?`, "g"),
		`"${tempTableName}"`,
	);
	const createSQL = `${tableInfo.sql.replace(/,?\s+PRIMARY\s+KEY(\s*\([^)]+)?/gi, `, PRIMARY KEY (${columnNames.join(", ")}`)}`;
	const sql = `
		PRAGMA foreign_keys=off;
		
		BEGIN TRANSACTION;
		
		-- Create temp table with existing schema
		${createTempTableSQL};
		
		-- Copy data
		INSERT INTO ${tempTableName} SELECT * FROM ${tableName};
		
		-- Drop original
		DROP TABLE ${tableName};
		
		-- Create new table with primary key
		${createSQL};
		
		-- Copy data back
		INSERT INTO ${tableName} SELECT * FROM ${tempTableName};
		DROP TABLE ${tempTableName};
		
		COMMIT;
		
		PRAGMA foreign_keys=on;
	`;

	console.log("changing/adding primary field", tableName, sql);
	return await db.exec(sql);
}

async function alterTableAddForeignKey(
	tableName: string,
	columnName: string,
	referenceTable: string,
	referenceColumn: string,
	db: any,
): Promise<string> {
	const tempTableName = `${tableName}_temp`;

	// Get existing table schema
	const tableInfo = await db.get(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
		[tableName],
	);

	// Create temp table with same schema as original, including foreign keys
	const createTempTableSQL = tableInfo.sql.replace(
		new RegExp(`"?${tableName}"?`, "g"),
		`"${tempTableName}"`,
	);

	return `
		PRAGMA foreign_keys=off;
		
		BEGIN TRANSACTION;
		
		-- Create temp table with existing schema
		${createTempTableSQL};
		
		-- Copy data
		INSERT INTO ${tempTableName} SELECT * FROM ${tableName};
		
		-- Drop original
		DROP TABLE ${tableName};
		
		-- Create new table with foreign key
		${tableInfo.sql},
		FOREIGN KEY (${columnName}) REFERENCES ${referenceTable}(${referenceColumn});
		
		-- Copy data back
		INSERT INTO ${tableName} SELECT * FROM ${tempTableName};
		DROP TABLE ${tempTableName};
		
		COMMIT;
		
		PRAGMA foreign_keys=on;
	`;
}
async function addForeignKeyConstraint(
	db: any,
	tableName: string,
	columnName: string,
	referenceTable: string,
	referenceColumn: string,
): Promise<void> {
	// Check if table has less than 10000 records
	const countResult = await db.get(
		`SELECT COUNT(*) as count FROM ${tableName}`,
	);
	if (countResult.count >= 10000) {
		throw new Error(
			`Table ${tableName} has too many records (${countResult.count}) to drop and recreate. Maximum allowed is 10000.`,
		);
	}

	if (!promptYesToAll) {
		const answer = prompt(
			`Are you sure you want to add foreign key constraint to table ${tableName}? (y/n/A) `,
		);
		if (answer?.toLowerCase() === "a") {
			promptYesToAll = true;
		} else if (answer?.toLowerCase() !== "y") {
			return;
		}
	}

	const sql = await alterTableAddForeignKey(
		tableName,
		columnName,
		referenceTable,
		referenceColumn,
		db,
	);

	try {
		await db.exec(sql);
	} catch (error: any) {
		console.error("sql failed: ", sql);
		throw new Error(`Failed to add foreign key constraint: ${error.message}`);
	}
}

export default syncTableSchema;

if (require.main === module) {
	await dumpSchema();
	const schemaPath = path.join(process.cwd(), "prisma", "schema.json");
	const enumSchemaPath = path.join(process.cwd(), "prisma", "schema.enum.json");
	const recreate = process.argv.includes("--force-reset");
	syncTableSchema(schemaPath, enumSchemaPath, recreate);
}
