import { test, expect, it, jest } from 'bun:test';
import { setupDatabase, generateDesiredSchema, parseSchema, getExistingSchema, createOrUpdateTable } from './setup';
import { DatabaseDriver } from './drivers/index';
import fs from 'fs';
import path from 'path';
import { orm } from '../src/db/orm';

jest.mock('../src/db/orm', () => ({
  orm: {
    connect: jest.fn(),
    db: {}
  }
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn()
}));

jest.mock('./drivers/index', () => ({
  getDriver: jest.fn()
}));

const mockDriver: DatabaseDriver = {
  getExistingSchema: jest.fn(),
  mapDataType: jest.fn(),
  createOrUpdateTable: jest.fn()
};

test('setupDatabase', async () => {
  const mockExistingSchema = {};
  const mockDesiredSchema = {
    User: {
      columns: [
        { name: 'id', type: 'INTEGER', notnull: true, pk: true, dflt_value: null },
        { name: 'name', type: 'TEXT', notnull: true, pk: false, dflt_value: null }
      ],
      indexes: []
    }
  };

  (getDriver as jest.Mock).mockReturnValue(mockDriver);
  (mockDriver.getExistingSchema as jest.Mock).mockResolvedValue(mockExistingSchema);
  (fs.readFileSync as jest.Mock).mockReturnValue('model User {\n  id Int @id\n  name String\n}');

  await setupDatabase();

  expect(orm.connect).toHaveBeenCalled();
  expect(mockDriver.getExistingSchema).toHaveBeenCalled();
  expect(mockDriver.createOrUpdateTable).toHaveBeenCalledWith('User', mockDesiredSchema.User);
});

test('generateDesiredSchema', () => {
  (fs.readFileSync as jest.Mock).mockReturnValue('model User {\n  id Int @id\n  name String\n}');

  const result = generateDesiredSchema(mockDriver);

  expect(result).toHaveProperty('User');
  expect(result.User).toHaveProperty('columns');
  expect(result.User).toHaveProperty('indexes');
  expect(result.User.driver).toBe(mockDriver);
});

test('parseSchema', () => {
  const schemaContent = `
    model User {
      id Int @id
      name String
      email String @unique
      posts Post[]
      createdAt DateTime @default(now())
    }

    model Post {
      id Int @id
      title String
      content String?
      author User @relation(fields: [authorId], references: [id])
      authorId Int
      @@index([authorId])
    }
  `;

  const result = parseSchema(schemaContent);

  expect(result).toHaveProperty('User');
  expect(result).toHaveProperty('Post');
  expect(result.User.columns).toHaveLength(5);
  expect(result.Post.columns).toHaveLength(4);
  expect(result.User.indexes).toHaveLength(1);
  expect(result.Post.indexes).toHaveLength(1);
});

test('getExistingSchema', async () => {
  const mockSchema = { existingTable: {} };
  (mockDriver.getExistingSchema as jest.Mock).mockResolvedValue(mockSchema);

  const result = await getExistingSchema(mockDriver);

  expect(result).toEqual(mockSchema);
  expect(mockDriver.getExistingSchema).toHaveBeenCalled();
});

test('createOrUpdateTable', async () => {
  const tableName = 'TestTable';
  const tableSchema = {
    columns: [
      { name: 'id', type: 'INTEGER', notnull: true, pk: true, dflt_value: null },
      { name: 'name', type: 'TEXT', notnull: true, pk: false, dflt_value: null }
    ],
    indexes: []
  };

  await createOrUpdateTable(mockDriver, tableName, tableSchema);

  expect(mockDriver.createOrUpdateTable).toHaveBeenCalledWith(tableName, tableSchema);
});
