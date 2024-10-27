export type WhereClause<T> = Partial<T>;
export type CreateData<T> = Omit<T, 'id'>;

export type Include<T> = Record<keyof T, boolean>;
export type DataQueryOptions<T> = QueryOptions<T> & {
  data?: CreateData<T>;
};
export type QueryOptions<T> = {
  include?: Include<T>;
  orderBy?: Partial<Record<keyof T, 'asc' | 'desc'>>;
  take?: number;
  skip?: number;
  where?: {
    AND?: WhereClause<T>[];
    OR?: WhereClause<T>[];
    NOT?: WhereClause<T>;
  } & WhereClause<T>;
};
export type ModelName = string;
export type ModelType = Record<string, unknown>;
export type BaseORM = {
  db: unknown;
  extensions: Record<string, (...args: unknown[]) => unknown>;
  connected: boolean;

  createModelProxy<T extends ModelType>(modelName: ModelName): {
    findFirst: (options: QueryOptions<T>) => Promise<T | null>;
    findMany: (options?: QueryOptions<T>) => Promise<T[]>;
    create: (options?: DataQueryOptions<T>) => Promise<T>;
    update: (options: DataQueryOptions<T>) => Promise<T>;
    delete: (options: QueryOptions<T>) => Promise<T>;
  };

  $connected(): boolean;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;

  findFirst<T>(
    tableName: string,
    options?: Omit<QueryOptions<T>, 'where'>,
  ): Promise<T | null>;

  findMany<T>(
    tableName: string,
    options?: Omit<QueryOptions<T>, 'where'>,
  ): Promise<T[]>;

  create<T>(
    tableName: string,
    options?: DataQueryOptions<T>,
  ): Promise<T>;

  update<T>(
    tableName: string,
    options?: DataQueryOptions<T>,
  ): Promise<T>;

  delete<T>(
    tableName: string,
    options?: QueryOptions<T>,
  ): Promise<T>;
  $extends(extension: Record<string, (...args: unknown[]) => unknown>): BaseORM;
};