import sqlite3 from "sqlite3";
import { Database as SQLiteDatabase, open } from "sqlite";
import type { BaseORM, WhereClause, CreateData, Include, QueryOptions } from "./orm_base";
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

  function buildWhereClause(where: Record<string, unknown>): string {
    return where && Object.keys(where).length > 0
      ? `WHERE ${Object.keys(where).map(key => `${key} = ?`).join(" AND ")}`
      : "";
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
    where: Record<string, unknown>,
    options?: QueryOptions<T>
  ): Promise<T | null> {
    if (!connected) {
      await connect();
    }
    const whereClause = buildWhereClause(where);
    const values = Object.values(where);
    const result = await sqliteDb.get(`SELECT * FROM ${tableName} ${whereClause}`, values);
    
    if (result && options?.include) {
      await fetchRelatedData(result, options.include, tableName);
    }
    
    return result as T | null;
  }

  async function findMany<T>(
    tableName: string,
    where?: Record<string, unknown>,
    options?: QueryOptions<T>
  ): Promise<T[]> {
    if (!connected) {
      await connect();
    }
    const whereClause = buildWhereClause(where || {});
    const values = where ? Object.values(where) : [];
    console.log('sqliteDb', sqliteDb);
    const results = await sqliteDb.all(`SELECT * FROM ${tableName} ${whereClause}`, values);

    if (options?.include) {
      for (const result of results) {
        await fetchRelatedData(result, options.include, tableName);
      }
    }

    return results as T[];
  }

  async function create<T>(
    tableName: string,
    data: Record<string, unknown>,
    options?: { include?: Include<T> }
  ): Promise<T> {
    if (!connected) {
      await connect();
    }
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

  async function update(
    tableName: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>
  ): Promise<{ affected: number }> {
    if (!connected) {
      await connect();
    }
    const setClause = Object.keys(data).map((key) => `${key} = ?`).join(", ");
    const whereClause = buildWhereClause(where);
    const values = [...Object.values(data), ...Object.values(where)];

    const query = `UPDATE ${tableName} SET ${setClause} ${whereClause}`;
    const result = await sqliteDb.run(query, values);

    return { affected: result.changes || 0 };
  }

  async function delete_(
    tableName: string,
    where: Record<string, unknown>
  ): Promise<{ affected: number }> {
    if (!connected) {
      await connect();
    }
    const whereClause = buildWhereClause(where);
    const values = Object.values(where);

    const query = `DELETE FROM ${tableName} ${whereClause}`;
    const result = await sqliteDb.run(query, values);

    return { affected: result.changes || 0 };
  }

  function createModelProxy<T extends Record<string, any>>(modelName: string) {
    return {
      findFirst: (where: WhereClause<T>, options?: QueryOptions<T>) => 
        findFirst<T>(modelName, where as Record<string, unknown>, options),
      findMany: (where?: WhereClause<T>, options?: QueryOptions<T>) => 
        findMany<T>(modelName, where as Record<string, unknown>, options),
      create: (data: CreateData<T>, options?: { include?: Include<T> }) => 
        create<T>(modelName, data as Record<string, unknown>, options),
      update: (where: { id: number }, data: Partial<T>) => 
        update(modelName, where, data as Record<string, unknown>),
      delete: (where: { id: number }) => 
        delete_(modelName, where)
    };
  }

  function $extends(extension: Record<string, (...args: unknown[]) => unknown>): BaseORM {
    extensions = { ...extensions, ...extension };
    return orm;
  }

  const orm: BaseORM = {
    db: sqliteDb,
    extensions,
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