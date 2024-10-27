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

const DB_REFERENTIAL_ACTION_MAP = {
	Cascade: "CASCADE",
	SetNull: "SET NULL",
	SetDefault: "SET DEFAULT",
	Restrict: "RESTRICT",
	NoAction: "NO ACTION",
};

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
				.filter((field) => !schemaTypes.includes(field.type))
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

					return fieldDef;
				})
				.join(", ");

			const contraints = (() => {
				const constraints = [];
				for (const field of tableSchema.fields) {
					if (schemaTypes.includes(field.type)) {
						const fkName = `fk_${tableSchema.name}_${field.name}`;
						const referencedTable = field.relation.name;
						let fkDefinition = `FOREIGN KEY ("${field.relation.fields.join('", "')}") REFERENCES "${referencedTable}" ("${field.relation.references.join('", "')}")`;

						if (field.relation) {
							if (field.relation.onDelete) {
								fkDefinition += ` ON DELETE ${DB_REFERENTIAL_ACTION_MAP[field.relation.onDelete]}`;
							}
							if (
								field.relation.onUpdate &&
								field.relation.onUpdate !== "NoAction"
							) {
								fkDefinition += ` ON UPDATE ${DB_REFERENTIAL_ACTION_MAP[field.relation.onUpdate]}`;
							}
						}

						constraints.push(fkDefinition);
					}
				}
				return constraints.join(", ");
			})();
			console.log("createTableFields", tableSchema.name, {
				createTableFields,
				contraints,
			});
			await db.exec(
				`CREATE TABLE IF NOT EXISTS "${tableSchema.name}" (${createTableFields} ${contraints ? `, ${contraints}` : ""})`,
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

				if (!schemaTypes.includes(field.type)) {
					continue;
				}
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

				if (currentIndex) {
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

				if (field.relation) {
					const fkName = `fk_${tableSchema.name}_${field.name}`;
					const referencedTable = field.relation.name.replace("?", "");
					const fkDefinition = `FOREIGN KEY ("${field.relation.fields[0]}") REFERENCES "${referencedTable}" ("${field.relation.references[0]}")`;

					// Check if foreign key exists
					const fkExists = await db.get(
						`SELECT COUNT(*) as count FROM pragma_foreign_key_list(?) 
						WHERE "table" = ? AND "to" = ? AND "from" = ?`,
						[
							tableSchema.name,
							referencedTable,
							field.relation.references[0],
							field.relation.fields[0],
						],
					);

					if (!fkExists?.count) {
						// needRereate = true;
						console.warn(
							`Foreign key ${fkName} requires table recreation (${field.relation.fields[0]} -> ${referencedTable}.${field.relation.references[0]})`,
						);
						try {
							// await db.exec(`ALTER TABLE "${tableSchema.name}" ADD ${fkDefinition}`);
							addForeignKeyConstraint(
								db,
								tableSchema.name,
								field.relation.fields.join(", "),
								referencedTable,
								field.relation.references.join(", "),
							);
							if (DB_DEBUG) console.log(`Added foreign key: ${fkName}`);
						} catch (error) {
							console.error(
								`Failed to add foreign key ${fkName}: ${fkDefinition}`,
								error,
							);
							throw error;
						}
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

function alterTableAddForeignKey(
	tableName: string,
	columnName: string,
	referenceTable: string,
	referenceColumn: string,
	db: any,
): string {
	// SQLite doesn't support ALTER TABLE ADD CONSTRAINT directly
	// We need to recreate the table with the foreign key
	const tempTableName = `${tableName}_temp`;

	return `
		PRAGMA foreign_keys=off;
		
		BEGIN TRANSACTION;
		
		-- Create new temporary table with foreign key
		CREATE TABLE ${tempTableName} AS SELECT * FROM ${tableName};
		DROP TABLE ${tableName};
		CREATE TABLE ${tableName} (
			${columnName} INTEGER,
			FOREIGN KEY (${columnName}) REFERENCES ${referenceTable}(${referenceColumn})
		);
		
		-- Copy data from temporary table
		INSERT INTO ${tableName} SELECT * FROM ${tempTableName};
		DROP TABLE ${tempTableName};
		
		COMMIT;
		
		PRAGMA foreign_keys=on;
	`;
}

function addForeignKeyConstraint(
	db: any,
	tableName: string,
	columnName: string,
	referenceTable: string,
	referenceColumn: string,
): void {
	// Check if table has less than 10000 records
	const countResult = db
		.prepare(`SELECT COUNT(*) as count FROM ${tableName}`)
		.get();
	if (countResult.count >= 10000) {
		throw new Error(
			`Table ${tableName} has too many records (${countResult.count}) to drop and recreate. Maximum allowed is 10000.`,
		);
	}

	const sql = alterTableAddForeignKey(
		tableName,
		columnName,
		referenceTable,
		referenceColumn,
		db,
	);

	try {
		db.exec(sql);
	} catch (error: any) {
		throw new Error(`Failed to add foreign key constraint: ${error.message}`);
	}
}

export default generateTableSchema;

if (require.main === module) {
	await dumpSchema();
	const schemaPath = path.join(process.cwd(), "prisma", "schema.json");
	const enumSchemaPath = path.join(process.cwd(), "prisma", "schema.enum.json");
	const recreate = process.argv.includes("--force-reset");
	generateTableSchema(schemaPath, enumSchemaPath, recreate);
}
