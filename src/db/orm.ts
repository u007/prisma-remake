import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { ORM as GeneratedORM, Include, OrderBy, QueryOptions } from './generatedTypes';

class ORM implements GeneratedORM {
  private db: any;
  private extensions: Record<string, Function> = {};

  constructor() {
    return new Proxy(this, {
      get: (target, prop) => {
        if (typeof prop === 'string' && prop in target.extensions) {
          return target.extensions[prop].bind(target);
        }
        if (typeof prop === 'string' && !(prop in target)) {
          return target.createModelProxy(prop);
        }
        return (target as any)[prop];
      }
    });
  }

  private createModelProxy(modelName: string) {
    return {
      findFirst: (where: any, options?: QueryOptions<any>) => this.findFirst(modelName, where, options),
      findMany: (where?: any, options?: QueryOptions<any>) => this.findMany(modelName, where, options),
      create: (data: any, options?: { include?: Include<any> }) => this.create(modelName, data, options),
      update: (where: { id: number }, data: any) => this.update(modelName, where, data),
      delete: (where: { id: number }) => this.delete(modelName, where),
    };
  }

  async connect() {
    this.db = await open({
      filename: './database.sqlite',
      driver: sqlite3.Database
    });
    await this.db.exec('PRAGMA foreign_keys = ON');
  }

  async createTable(tableName: string, fields: Record<string, string>) {
    const fieldDefinitions = Object.entries(fields)
      .map(([name, type]) => `${name} ${type}`)
      .join(', ');
    await this.db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${fieldDefinitions})`);
  }

  private buildWhereClause(where: Record<string, any>) {
    const conditions = Object.keys(where).map(key => `${key} = ?`);
    return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  }

  private buildOrderByClause(orderBy?: OrderBy<any>) {
    if (!orderBy) return '';
    const orderClauses = Array.isArray(orderBy)
      ? orderBy.map(clause => Object.entries(clause).map(([key, order]) => `${key} ${order}`).join(', '))
      : Object.entries(orderBy).map(([key, order]) => `${key} ${order}`);
    return orderClauses.length ? `ORDER BY ${orderClauses.join(', ')}` : '';
  }

  private async executeQuery(query: string, params: any[]) {
    return await this.db.all(query, params);
  }

  private async fetchRelatedData(result: any, include: Include<any>, modelName: string) {
    for (const [key, value] of Object.entries(include)) {
      if (value === true) {
        const relatedModelName = key.charAt(0).toUpperCase() + key.slice(1);
        const foreignKey = `${modelName.toLowerCase()}Id`;
        const relatedData = await this.findMany(relatedModelName, { [foreignKey]: result.id });
        result[key] = relatedData;
      } else if (typeof value === 'object') {
        const relatedModelName = key.charAt(0).toUpperCase() + key.slice(1);
        const foreignKey = `${modelName.toLowerCase()}Id`;
        const relatedData = await this.findMany(relatedModelName, { [foreignKey]: result.id }, { include: value });
        result[key] = relatedData;
      }
    }
  }

  async findFirst(tableName: string, where: Record<string, any>, options?: QueryOptions<any>) {
    const whereClause = this.buildWhereClause(where);
    const orderByClause = this.buildOrderByClause(options?.orderBy);
    const limitClause = options?.take ? 'LIMIT ?' : '';
    const offsetClause = options?.skip ? 'OFFSET ?' : '';

    const query = `SELECT * FROM ${tableName} ${whereClause} ${orderByClause} ${limitClause} ${offsetClause} LIMIT 1`;
    const params = [...Object.values(where)];
    
    if (options?.take) params.push(options.take);
    if (options?.skip) params.push(options.skip);

    const result = await this.db.get(query, params);

    if (result && options?.include) {
      await this.fetchRelatedData(result, options.include, tableName);
    }

    return result;
  }

  async findMany(tableName: string, where: Record<string, any> = {}, options?: QueryOptions<any>) {
    const whereClause = this.buildWhereClause(where);
    const orderByClause = this.buildOrderByClause(options?.orderBy);
    const limitClause = options?.take ? 'LIMIT ?' : '';
    const offsetClause = options?.skip ? 'OFFSET ?' : '';

    const query = `SELECT * FROM ${tableName} ${whereClause} ${orderByClause} ${limitClause} ${offsetClause}`;
    const params = [...Object.values(where)];
    
    if (options?.take) params.push(options.take);
    if (options?.skip) params.push(options.skip);

    const results = await this.executeQuery(query, params);

    if (options?.include) {
      for (const result of results) {
        await this.fetchRelatedData(result, options.include, tableName);
      }
    }

    return results;
  }

  async create(tableName: string, data: Record<string, any>, options?: { include?: Include<any> }) {
    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const values = Object.values(data);

    const query = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
    const result = await this.db.run(query, values);

    if (options?.include) {
      const createdRecord = await this.findFirst(tableName, { id: result.lastID }, { include: options.include });
      return createdRecord;
    }

    return { id: result.lastID };
  }

  async update(tableName: string, where: Record<string, any>, data: Record<string, any>) {
    const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
    const whereClause = this.buildWhereClause(where);
    const values = [...Object.values(data), ...Object.values(where)];

    const query = `UPDATE ${tableName} SET ${setClause} ${whereClause}`;
    const result = await this.db.run(query, values);

    return { affected: result.changes };
  }

  async delete(tableName: string, where: Record<string, any>) {
    const whereClause = this.buildWhereClause(where);
    const values = Object.values(where);

    const query = `DELETE FROM ${tableName} ${whereClause}`;
    const result = await this.db.run(query, values);

    return { affected: result.changes };
  }

  $extends(extension: Record<string, Function>) {
    this.extensions = { ...this.extensions, ...extension };
    return this;
  }
}

export const orm = new ORM();