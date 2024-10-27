import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { dumpSchema } from "./dumpSchema";
import { parsePrismaSchemaJsons } from '../prisma/parser';
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

async function syncTableSchema(
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

	let needRereate = false;
	try {
		if (DB_DEBUG)
			console.log(`Reading schema files: ${schemaPath}, ${enumSchemaPath}`);
		const { schemaContent, schemaEnumContent, schemaTypes } = await parsePrismaSchemaJsons(
			schemaPath,
			enumSchemaPath,
			recreate,
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

		console.log("tables", schemaTypes);
		for (const tableSchema of schemaContent) {
			if (DB_DEBUG) console.log(`Processing table: ${tableSchema.name}`);

			// Create table if it doesn't exist
			const isAlter = tables.some((t) => t.name === tableSchema.name);

			if (! isAlter) {
				const createTableFields = tableSchema.fields
					.filter((field) => !field.isRelation)
					.map((field) => {
						const sqliteType = getSQLiteType(
							field.type,
							field.isEnum,
							schemaEnumContent,
						);
						return `"${field.name}" ${sqliteType}`;
					})
					.join(", ");

				const contraints = (() => {
					const constraints = [];
					for (const field of tableSchema.fields) {
						if (field.isRelation && field.relation) {
							console.log("field.relation", field.name, field.relation);
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
				const primaryDDL = tableSchema.idFields?.length > 0 ? `PRIMARY KEY (${tableSchema.idFields.join(", ")})`: '';
				console.log("createTableFields", tableSchema.name, {
					createTableFields,
					contraints,
					primaryDDL,
				});
				await db.exec(
					`CREATE TABLE IF NOT EXISTS "${tableSchema.name}" (${createTableFields} ${primaryDDL ? `, ${primaryDDL}`: ''}${contraints ? `, ${contraints}` : ""})`,
				);

				continue
				// IS CREATE TABLE

			}
			// is ALTER TABLE
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

				const sqliteType = !field.isRelation ? getSQLiteType(
					field.type,
					field.isEnum,
					schemaEnumContent,
				): field.type;

				if (field.isRelation) {
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

					// check if column can be casted
					if (!canConvertType(currentColumn.type, sqliteType)) {
						console.error(
							`Column type change for ${field.name} requires table recreation`,
						);
						needRereate = true;
					} else {
						// Alter column
						await db.exec(
							`ALTER TABLE "${tableSchema.name}" ALTER COLUMN "${field.name}" SET DATA TYPE ${sqliteType}`,
						);
					}
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

			// check if existing id fields are same
			const existingIdFields = currentColumns.filter((col: ColumnInfo) => col.name === 'id');
			const existingIdFieldsNames: string[] = existingIdFields.map((col: ColumnInfo) => col.name);
			// console.log("currentColumns", {existingIdFieldsNames, idFields: tableSchema.idFields});
	
			if (existingIdFieldsNames.length > 0) {
				// If id field exists but doesn't match schema, need recreation
				if (!tableSchema.idFields || tableSchema.idFields.join(',') !== existingIdFieldsNames.join(',')) {
					console.log('needRereate id mismatch', {new: tableSchema.idFields, old: existingIdFieldsNames } );
					await alterTableAddPrimaryKey(
						db,
						tableSchema.name,
						tableSchema.idFields,
					);
				}
			} else if (tableSchema.idFields?.length) {
				await alterTableAddPrimaryKey(
					db,
					tableSchema.name,
					tableSchema.idFields[0].name,
				);
			}
			// Handle foreign keys
			for (const field of tableSchema.fields) {
				// Check if field is a relation field (not array type)
				if (field.isArray) continue;

				if (field.relation) {
					const fkName = `fk_${tableSchema.name}_${field.name}`;
					const referencedTable = field.relation.name.replace("?", "");
					// Check if foreign key exists
					const fkExists = await db.get(
						`SELECT COUNT(*) as count FROM pragma_foreign_key_list(?) 
						WHERE "table" = ? AND "to" IN (${field.relation.references.map(() => '?').join(',')}) AND "from" IN (${field.relation.fields.map(() => '?').join(',')})`,
						[
							tableSchema.name,
							referencedTable,
							...field.relation.references,
							...field.relation.fields,
						],
					);
					// console.log("fkExists", fkExists, field.relation);
					if (!fkExists?.count) {
						// needRereate = true;
						console.warn(
							`Foreign key ${fkName} requires table recreation (${field.relation.fields[0]} -> ${referencedTable}.${field.relation.references[0]})`,
						);
						try {
							// await db.exec(`ALTER TABLE "${tableSchema.name}" ADD ${fkDefinition}`);
							await addForeignKeyConstraint(
								db,
								tableSchema.name,
								field.relation.fields.join(", "),
								referencedTable,
								field.relation.references.join(", "),
							);
							if (DB_DEBUG) console.log(`Added foreign key: ${fkName}`);
						} catch (error) {
							console.error(
								`Failed to add foreign key ${fkName}`,
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

	const countResult = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`);
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
			return '';
		}
	}
	
	// Get existing table schema
	const tableInfo = await db.get(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
		[tableName]
	);
	
	// Create temp table with same schema as original
	const createTempTableSQL = tableInfo.sql.replace(
		new RegExp(`"?${tableName}"?`, 'g'),
		`"${tempTableName}"`
	);
	const createSQL = `${tableInfo.sql.replace(/,?\s+PRIMARY\s+KEY(\s*\([^)]+)?/gi, `, PRIMARY KEY (${columnNames.join(', ')}`)}`	
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

	console.log('changing/adding primary field', tableName, sql);
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
		[tableName]
	);
	
	// Create temp table with same schema as original, including foreign keys
	const createTempTableSQL = tableInfo.sql.replace(
		new RegExp(`"?${tableName}"?`, 'g'),
		`"${tempTableName}"`
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
	const countResult = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`);
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
		console.error('sql failed: ', sql);
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
