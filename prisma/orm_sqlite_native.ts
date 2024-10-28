import sqlite3 from "sqlite3";
import { Database as SQLiteDatabase, open } from "sqlite";
import type { BaseORM, WhereClause, CreateData, Include, QueryOptions, ModelType, DataQueryOptions } from "./orm_base";
import { connected } from "process";

export type SQLiteORM = BaseORM & {
}

export function createSQLiteORM(): SQLiteORM {
  let sqliteDb: SQLiteDatabase;
  let extensions: Record<string, (...args: unknown[]) => unknown> = {};
  let connected = false;

  async function connect(): Promise<void> {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not defined in the environment.");
    }

    const dbUrl = new URL(process.env.DATABASE_URL);
    if (dbUrl.protocol !== 'sqlite:') {
      throw new Error("Invalid protocol for SQLite. Use sqlite:");
    }

    sqliteDb = await open({
      filename: dbUrl.pathname,
      driver: sqlite3.Database
    });
    connected = true;
  }

  async function disconnect(): Promise<void> {
    if (sqliteDb) {
      await sqliteDb.close();
    }
  }

  function buildWhereClause(options?: QueryOptions<unknown>): { clause: string; values: unknown[] } {
    if (!options?.where) return { clause: "", values: [] };
    
    const conditions: string[] = [];
    const values: unknown[] = [];

    // Handle basic where conditions
    for (const [key, value] of Object.entries(options.where)) {
      if (key !== 'AND' && key !== 'OR' && key !== 'NOT') {
        conditions.push(`${key} = ?`);
        values.push(value);
      }
    }

    // Handle AND conditions
    if (options.where.AND) {
      for (const condition of options.where.AND) {
        for (const [key, value] of Object.entries(condition)) {
          conditions.push(`${key} = ?`);
          values.push(value);
        }
      }
    }

    // Handle OR conditions
    if (options.where.OR) {
      const orConditions = options.where.OR.map(condition => {
        const entries = Object.entries(condition);
        for (const [, value] of entries) {
          values.push(value);
        }
        return entries.map(([key]) => `${key} = ?`).join(" OR ");
      });
      if (orConditions.length) {
        conditions.push(`(${orConditions.join(") OR (")})`);
      }
    }

    // Handle NOT conditions
    if (options.where.NOT) {
      for (const [key, value] of Object.entries(options.where.NOT)) {
        conditions.push(`NOT ${key} = ?`);
        values.push(value);
      }
    }

    return {
      clause: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
      values
    };
  }
  async function fetchRelatedData<T>(
    data: Record<string, unknown>,
    include: Include<T>,
    tableName: string
  ): Promise<void> {
    if (!connected) {
      await connect();
    }
    for (const [key, value] of Object.entries(include)) {
      if (value) {
        const relatedData = await sqliteDb.get(
          `SELECT * FROM ${key} WHERE ${tableName}_id = ?`,
          data.id
        );
        data[key] = relatedData;
      }
    }
  }

  async function findFirst<T>(
    tableName: string,
    options?: QueryOptions<T>
  ): Promise<T | null> {
    if (!connected) {
      await connect();
    }
    const { clause, values } = buildWhereClause(options);
    const result = await sqliteDb.get(`SELECT * FROM ${tableName} ${clause}`, values);
    
    if (result && options?.include) {
      await fetchRelatedData(result, options.include, tableName);
    }
    
    return result as T | null;
  }

  async function findMany<T>(
    tableName: string,
    options?: QueryOptions<T>
  ): Promise<T[]> {
    if (!connected) {
      await connect();
    }
    const { clause, values } = buildWhereClause(options);
    const results = await sqliteDb.all(`SELECT * FROM ${tableName} ${clause}`, values);

    if (options?.include) {
      for (const result of results) {
        await fetchRelatedData(result, options.include, tableName);
      }
    }

    return results as T[];
  }

  async function create<T>(
    tableName: string,
    options?: DataQueryOptions<T>
  ): Promise<T> {
    if (!connected) {
      await connect();
    }
    if (!options?.data) {
      throw new Error("Create data must be provided in the where clause");
    }
    
    const data = options.data;
    const columns = Object.keys(data).join(", ");
    const placeholders = Object.keys(data).map(() => "?").join(", ");
    const values = Object.values(data);

    const query = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders}) RETURNING *`;
    const result = await sqliteDb.run(query, values);
    const created = await sqliteDb.get(`SELECT * FROM ${tableName} WHERE id = ?`, result.lastID);

    if (options?.include && created) {
      await fetchRelatedData(created as Record<string, unknown>, options.include, tableName);
    }

    return (created || { id: result.lastID }) as T;
  }

  async function update<T>(
    tableName: string,
    options: DataQueryOptions<T>
  ): Promise<T> {
    if (!connected) {
      await connect();
    }
    if (!options?.where) {
      throw new Error("Where clause is required for update");
    }

    if (!options?.data) {
      throw new Error("Update data must be provided in the where clause");
    }

    const { clause: whereClause, values: whereValues } = buildWhereClause(options);
    const setClause = Object.keys(options.where).map((key) => `${key} = ?`).join(", ");
    const values = [...Object.values(options.where), ...whereValues];

    const query = `UPDATE ${tableName} SET ${setClause} ${whereClause} RETURNING *`;
    const result = await sqliteDb.get(query, values);

    return result as T;
  }

  async function delete_<T>(
    tableName: string,
    options: QueryOptions<T>
  ): Promise<T> {
    if (!connected) {
      await connect();
    }
    if (!options?.where) {
      throw new Error("Where clause is required for delete");
    }

    const { clause, values } = buildWhereClause(options);
    const query = `DELETE FROM ${tableName} ${clause} RETURNING *`;
    const result = await sqliteDb.get(query, values);

    return result as T;
  }

  function createModelProxy<T extends ModelType>(modelName: string) {
    return {
      findFirst: (options: QueryOptions<T>) => findFirst<T>(modelName, options),
      findMany: (options?: QueryOptions<T>) => findMany<T>(modelName, options),
      create: (options?: QueryOptions<T>) => create<T>(modelName, options),
      update: (options: QueryOptions<T>) => update<T>(modelName, options),
      delete: (options: QueryOptions<T>) => delete_<T>(modelName, options)
    };
  }

  function $extends(extension: Record<string, (...args: unknown[]) => unknown>): BaseORM {
    extensions = { ...extensions, ...extension };
    return orm;
  }

  const orm: BaseORM = {
    db: sqliteDb,
    extensions,
    connected,
    $connected: () => connected,
    $connect: connect,
    $disconnect: disconnect,
    findFirst,
    findMany,
    create,
    update,
    delete: delete_,
    createModelProxy,
    $extends
  };

  return orm;
}