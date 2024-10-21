import assert from 'assert';
import { orm } from './orm';
import { User, Post, Address } from './generatedTypes';

async function runTests() {
  console.log('Starting ORM tests...');

  await orm.connect();

  // Test User CRUD operations
  console.log('Testing User CRUD operations...');
  const user: Omit<User, 'id' | 'createdAt'> = {
    name: 'John Doe',
    email: 'john@example.com',
  };

  // Create
  const createdUser = await orm.User.create(user);
  assert(createdUser.id, 'User should have an ID after creation');

  // Read
  const fetchedUser = await orm.User.findFirst({ id: createdUser.id });
  assert.deepStrictEqual(fetchedUser?.name, user.name, 'Fetched user should match created user');
  assert.deepStrictEqual(fetchedUser?.email, user.email, 'Fetched user should match created user');

  // Update
  const updatedName = 'Jane Doe';
  await orm.User.update({ id: createdUser.id }, { name: updatedName });
  const updatedUser = await orm.User.findFirst({ id: createdUser.id });
  assert.strictEqual(updatedUser?.name, updatedName, 'User name should be updated');

  // Delete
  await orm.User.delete({ id: createdUser.id });
  const deletedUser = await orm.User.findFirst({ id: createdUser.id });
  assert.strictEqual(deletedUser, null, 'User should be deleted');

  // Test Address creation with User
  console.log('Testing Address creation with User...');
  const userWithAddress: Omit<User, 'id' | 'createdAt'> & { address: Omit<Address, 'id' | 'userId'> } = {
    name: 'Alice Smith',
    email: 'alice@example.com',
    address: {
      street: '123 Main St',
      city: 'Anytown',
      state: 'CA',
      country: 'USA',
      zipCode: '12345',
    },
  };

  const createdUserWithAddress = await orm.User.create(userWithAddress, { include: { address: true } });
  assert(createdUserWithAddress.id, 'User should have an ID after creation');
  assert(createdUserWithAddress.address?.id, 'Address should have an ID after creation');
  assert.deepStrictEqual(createdUserWithAddress.address?.street, userWithAddress.address.street, 'Address should match created address');

  // Test Post creation and relation
  console.log('Testing Post creation and relation...');
  const post: Omit<Post, 'id'> = {
    title: 'Test Post',
    content: 'This is a test post content',
    published: true,
    authorId: createdUserWithAddress.id,
  };

  const createdPost = await orm.Post.create(post);
  assert(createdPost.id, 'Post should have an ID after creation');

  // Test fetching user with related data
  console.log('Testing fetching user with related data...');
  const userWithRelations = await orm.User.findFirst(
    { id: createdUserWithAddress.id },
    { include: { address: true, posts: true } }
  );

  assert(userWithRelations?.address, 'User should have an associated address');
  assert(userWithRelations?.posts?.length === 1, 'User should have one associated post');
  assert.strictEqual(userWithRelations?.posts?.[0].title, post.title, 'Associated post should match created post');

  // Clean up
  await orm.Post.delete({ id: createdPost.id });
  await orm.User.delete({ id: createdUserWithAddress.id });

  console.log('All tests passed successfully!');
}

runTests().catch(console.error);