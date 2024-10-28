// import { drizzle } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import Database from 'better-sqlite3';

import type { BaseORM, WhereClause, CreateData, Include, QueryOptions, ModelType, DataQueryOptions } from "./orm_base";
import { eq, and, or, not, sql } from 'drizzle-orm';

export type DrizzleORM = BaseORM & {
  db: ReturnType<typeof drizzle>;
}

export function createORM(): DrizzleORM {
  let drizzleDb: ReturnType<typeof drizzle>;
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

    const sqlite = new Database(dbUrl.pathname);
    drizzleDb = drizzle({ client: sqlite });
    connected = true;
  }

  async function disconnect(): Promise<void> {
    if (drizzleDb) {
      await drizzleDb.execute(sql`PRAGMA optimize`);
    }
  }

  function buildWhereClause(tableName: string, options?: QueryOptions<unknown>) {
    if (!options?.where) return {};
    
    const conditions = [];
    
    for (const [key, value] of Object.entries(options.where)) {
      if (key === 'AND' && Array.isArray(value)) {
        conditions.push(and(...value.map(cond => eq(tableName[Object.keys(cond)[0]], Object.values(cond)[0]))));
      } else if (key === 'OR' && Array.isArray(value)) {
        conditions.push(or(...value.map(cond => eq(tableName[Object.keys(cond)[0]], Object.values(cond)[0]))));
      } else if (key === 'NOT') {
        conditions.push(not(eq(tableName[Object.keys(value)[0]], Object.values(value)[0])));
      } else {
        conditions.push(eq(tableName[key], value));
      }
    }
    
    return conditions.length === 1 ? conditions[0] : and(...conditions);
  }

  async function findFirst<T>(
    tableName: string,
    options?: QueryOptions<T>
  ): Promise<T | null> {
    if (!connected) await connect();
    
    const where = buildWhereClause(tableName, options);
    const result = await drizzleDb
      .select()
      .from(tableName)
      .where(where)
      .limit(1)
      .execute();

    return result[0] as T || null;
  }

  async function findMany<T>(
    tableName: string,
    options?: QueryOptions<T>
  ): Promise<T[]> {
    if (!connected) await connect();

    const where = buildWhereClause(tableName, options);
    const results = await drizzleDb
      .select()
      .from(tableName)
      .where(where)
      .execute();

    return results as T[];
  }

  async function create<T>(
    tableName: string,
    options?: DataQueryOptions<T>
  ): Promise<T> {
    if (!connected) await connect();
    if (!options?.data) {
      throw new Error("Create data must be provided");
    }

    const result = await drizzleDb
      .insert(tableName)
      .values(options.data)
      .returning()
      .execute();

    return result[0] as T;
  }

  async function update<T>(
    tableName: string,
    options: DataQueryOptions<T>
  ): Promise<T> {
    if (!connected) await connect();
    if (!options?.where || !options?.data) {
      throw new Error("Where clause and data are required for update");
    }

    const where = buildWhereClause(tableName, options);
    const result = await drizzleDb
      .update(tableName)
      .set(options.data)
      .where(where)
      .returning()
      .execute();

    return result[0] as T;
  }

  async function delete_<T>(
    tableName: string,
    options: QueryOptions<T>
  ): Promise<T> {
    if (!connected) await connect();
    if (!options?.where) {
      throw new Error("Where clause is required for delete");
    }

    const where = buildWhereClause(tableName, options);
    const result = await drizzleDb
      .delete(tableName)
      .where(where)
      .returning()
      .execute();

    return result[0] as T;
  }

  const orm: DrizzleORM = {
    db: drizzleDb,
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
    createModelProxy: (modelName: string) => ({
      findFirst: (options) => findFirst(modelName, options),
      findMany: (options) => findMany(modelName, options),
      create: (options) => create(modelName, options),
      update: (options) => update(modelName, options),
      delete: (options) => delete_(modelName, options)
    }),
    $extends: (extension) => {
      extensions = { ...extensions, ...extension };
      return orm;
    }
  };

  return orm;
}
