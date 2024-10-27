import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { dumpSchema } from "./dumpSchema";

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

async function generateTableSchema(
	schemaPath: string,
	enumSchemaPath: string,
	recreate = false,
) {
	const url = (process.env.DATABASE_URL || ":memory:")
		.replace("sqlite://", "")
		.replace("sqlite:", "");

	if (DB_DEBUG) console.log(`Opening database at ${url}`);

	const db = await open({
		filename: url,
		driver: sqlite3.Database,
	});

	let needRereate = !recreate;
	try {
		if (DB_DEBUG)
			console.log(`Reading schema files: ${schemaPath}, ${enumSchemaPath}`);
		const schemaContent = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
		const schemaEnumContent = JSON.parse(
			fs.readFileSync(enumSchemaPath, "utf-8"),
		);

		if (recreate) {
			if (DB_DEBUG) console.log("Dropping all tables...");
			for (const tableSchema of schemaContent) {
				console.log("dropping table", tableSchema.name);
				await db.exec(`DROP TABLE IF EXISTS "${tableSchema.name}"`);
			}
			if (DB_DEBUG) console.log("All tables dropped successfully");
		}

		// Get all tables
		const tables = await db.all(
			"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
		);
		if (DB_DEBUG) console.log(`Found ${tables.length} tables`);

		const schemaTypes = schemaContent.map((s) => s.name);
		console.log("tables", schemaTypes);
		for (const tableSchema of schemaContent) {
			if (DB_DEBUG) console.log(`Processing table: ${tableSchema.name}`);

			// Create table if it doesn't exist
			const createTableFields = tableSchema.fields
				.map((field) => {
					const sqliteType = getSQLiteType(
						field.type,
						field.isEnum,
						schemaEnumContent,
					);
					let fieldDef = `"${field.name}" ${sqliteType}`;
					if (field.type === "String" && field.isId) {
						fieldDef += " PRIMARY KEY";
					}

					if (schemaTypes.includes(field.type)) {
						const fkName = `fk_${tableSchema.name}_${field.name}`;

						fieldDef += ` CONSTRAINT "${fkName}" REFERENCES "${field.type}" ("${field.name}Id")`;
					}
					return fieldDef;
				})
				.join(", ");
			console.log("createTableFields", createTableFields);
			await db.exec(
				`CREATE TABLE IF NOT EXISTS "${tableSchema.name}" (${createTableFields})`,
			);
			// Get current columns
			const columnsResult = await db.all<ColumnInfo>(
				`PRAGMA table_info(${tableSchema.name})`,
			);

			// Get current indexes
			const indexesResult = await db.all<IndexInfo>(
				`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?`,
				[tableSchema.name],
			);

			const currentColumns = columnsResult;
			const currentIndexes = indexesResult;

			// Compare and update columns
			for (const field of tableSchema.fields) {
				// if (DB_DEBUG) console.log(`Processing field: ${field.name}`);
				const currentColumn = currentColumns.find(
					(col: ColumnInfo) => col.name === field.name,
				);

				const sqliteType = getSQLiteType(
					field.type,
					field.isEnum,
					schemaEnumContent,
				);

				if (!currentColumn) {
					if (DB_DEBUG) console.log(`Adding missing column: ${field.name}`);
					// Add missing column
					await db.exec(
						`ALTER TABLE "${tableSchema.name}" ADD COLUMN "${field.name}" ${sqliteType}`,
					);
				} else if (currentColumn.type !== sqliteType) {
					// SQLite doesn't support ALTER COLUMN, need to recreate table
					if (DB_DEBUG)
						console.log(
							`Column type mismatch for ${field.name}: ${currentColumn.type} vs ${sqliteType}`,
						);
					console.warn(
						`Column type change for ${field.name} requires table recreation`,
					);
					needRereate = true;
				}
			}

			// Handle indexes
			for (const index of tableSchema.indexes) {
				const indexName = `idx_${tableSchema.name}_${index.fields.join("_")}`;
				const uniqueClause = index.unique ? "UNIQUE" : "";
				const indexDefinition = `CREATE ${uniqueClause} INDEX "${indexName}" ON "${tableSchema.name}" (${index.fields.map((f: string) => `"${f}"`).join(", ")})`;

				if (DB_DEBUG) console.log(`Processing index: ${indexName}`);
				const currentIndex = currentIndexes.find(
					(idx: IndexInfo) => idx.name === indexName,
				);

				if (currentIndex && currentIndex.sql !== indexDefinition) {
					if (DB_DEBUG) console.log(`Recreating index: ${indexName}`);
					// Drop and recreate if different
					await db.exec(`DROP INDEX IF EXISTS "${indexName}"`);
					await db.exec(indexDefinition);
				} else if (!currentIndex) {
					if (DB_DEBUG) console.log(`Creating new index: ${indexName}`);
					// Create missing index
					await db.exec(indexDefinition);
				}
			}

			// Handle foreign keys
			for (const field of tableSchema.fields) {
				// Check if field is a relation field (not array type)
				if (field.type.endsWith("[]")) continue;

				if (schemaTypes.includes(field.type)) {
					const fkName = `fk_${tableSchema.name}_${field.name}`;
					const referencedTable = field.type;
					const fkDefinition = `FOREIGN KEY ("${field.name}Id") REFERENCES "${referencedTable}" ("id")`;

					// Check if foreign key exists
					const fkExists = await db.get(
						`SELECT 1 FROM sqlite_master 
						WHERE type='table' AND name=? AND sql LIKE '%${fkDefinition}%'`,
						[tableSchema.name],
					);

					if (!fkExists) {
						needRereate = true;
						console.warn(`Foreign key ${fkName} requires table recreation`);
					}
				}
			}
		}
	} finally {
		if (!recreate && needRereate) {
			console.error(
				"Cannot amend some schema, please pass in --force-reset to recrate database **WARNING DATA LOST**",
			);
		}
		// if (DB_DEBUG) console.log("Closing database connection");
		await db.close();
	}
}
function getSQLiteType(
	prismaType: string,
	isEnum: boolean,
	enumContent: any[],
): string {
	if (isEnum) {
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
			return "TEXT";
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

export default generateTableSchema;

if (require.main === module) {
	await dumpSchema();
	const schemaPath = path.join(process.cwd(), "prisma", "schema.json");
	const enumSchemaPath = path.join(process.cwd(), "prisma", "schema.enum.json");
	const recreate = process.argv.includes("--force-reset");
	generateTableSchema(schemaPath, enumSchemaPath, recreate);
}
