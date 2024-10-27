export type WhereClause<T> = Partial<T>;
export type CreateData<T> = Omit<T, 'id'>;

export type Include<T> = Record<keyof T, boolean>;
export type QueryOptions<T> = {
  include?: Include<T>;
  orderBy?: Partial<Record<keyof T, 'asc' | 'desc'>>;
  take?: number;
  skip?: number;
};
export type ModelName = string;
export type ModelType = Record<string, any>;
export type BaseORM = {
  db: any;
  extensions: Record<string, (...args: unknown[]) => unknown>;
  connected: boolean;

  createModelProxy<T extends ModelType>(modelName: ModelName): {
    findFirst: (where: WhereClause<T>, options?: QueryOptions<T>) => Promise<T | null>;
    findMany: (where?: WhereClause<T>, options?: QueryOptions<T>) => Promise<T[]>;
    create: (data: CreateData<T>, options?: { include?: Include<T> }) => Promise<T>;
    update: (where: { id: number }, data: Partial<T>) => Promise<{ affected: number }>;
    delete: (where: { id: number }) => Promise<{ affected: number }>;
  };

  $connected(): boolean;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;

  findFirst<T>(
    tableName: string,
    where: Record<string, unknown>,
    options?: QueryOptions<T>,
  ): Promise<T | null>;

  findMany<T>(
    tableName: string,
    where?: Record<string, unknown>,
    options?: QueryOptions<T>,
  ): Promise<T[]>;

  create<T>(
    tableName: string,
    data: Record<string, unknown>,
    options?: { include?: Include<T> },
  ): Promise<T>;

  update(
    tableName: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Promise<{ affected: number }>;

  delete(
    tableName: string,
    where: Record<string, unknown>,
  ): Promise<{ affected: number }>;

  $extends(extension: Record<string, (...args: unknown[]) => unknown>): BaseORM;
};