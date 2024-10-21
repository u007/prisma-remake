import { orm } from './orm.js';
import bcrypt from 'bcryptjs';

async function seed() {
  await orm.connect();

  console.log('Seeding database...');

  // Create users
  const user1 = await orm.User.create({
    name: 'Alice Johnson',
    email: 'alice@example.com',
    password: await bcrypt.hash('password123', 10),
  });

  const user2 = await orm.User.create({
    name: 'Bob Smith',
    email: 'bob@example.com',
    password: await bcrypt.hash('password456', 10),
  });

  console.log('Users created:', user1, user2);

  // Create addresses for users
  const address1 = await orm.Address.create({
    street: '123 Main St',
    city: 'New York',
    state: 'NY',
    country: 'USA',
    zipCode: '10001',
    userId: user1.id,
  });

  const address2 = await orm.Address.create({
    street: '456 Elm St',
    city: 'Los Angeles',
    state: 'CA',
    country: 'USA',
    zipCode: '90001',
    userId: user2.id,
  });

  console.log('Addresses created:', address1, address2);

  // Create posts for users
  const post1 = await orm.Post.create({
    title: 'My First Post',
    content: 'This is the content of my first post.',
    published: true,
    authorId: user1.id,
  });

  const post2 = await orm.Post.create({
    title: 'Another Post',
    content: 'This is another post by Alice.',
    published: true,
    authorId: user1.id,
  });

  const post3 = await orm.Post.create({
    title: "Bob's Thoughts",
    content: 'Here are some thoughts from Bob.',
    published: true,
    authorId: user2.id,
  });

  console.log('Posts created:', post1, post2, post3);

  console.log('Database seeded successfully!');
}

seed().catch(console.error).finally(() => process.exit(0));