# Node.js tRPC Server with JWT Authentication

This project is a Node.js server using tRPC with JWT authentication for protected routes.

## Sample Client Usage

Here's an example of how to use the tRPC client with this server, including JWT authentication:

```typescript
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from './server'; // Adjust the import path as needed

// Function to get the JWT token (implement this based on your auth flow)
const getAuthToken = () => {
  // Return the JWT token from your storage (e.g., localStorage, cookie, etc.)
  return localStorage.getItem('authToken');
};

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:3000/trpc',
      headers: () => {
        const token = getAuthToken();
        return {
          Authorization: token ? `Bearer ${token}` : undefined,
        };
      },
    }),
  ],
});

// Example usage:

// Login (unprotected route)
const login = async () => {
  try {
    const result = await client.jwt.login.mutate({
      email: 'user@example.com',
      password: 'password123',
    });
    console.log('Login successful:', result);
    // Store the token
    localStorage.setItem('authToken', result.token);
  } catch (error) {
    console.error('Login failed:', error);
  }
};

// Create a post (protected route)
const createPost = async () => {
  try {
    const newPost = await client.post.createPost.mutate({
      title: 'My New Post',
      content: 'This is the content of my new post.',
    });
    console.log('Post created:', newPost);
  } catch (error) {
    console.error('Failed to create post:', error);
  }
};

// Update a post (protected route)
const updatePost = async (postId: number) => {
  try {
    const updatedPost = await client.post.updatePost.mutate({
      id: postId,
      title: 'Updated Post Title',
      content: 'This is the updated content of my post.',
    });
    console.log('Post updated:', updatedPost);
  } catch (error) {
    console.error('Failed to update post:', error);
  }
};

// Delete a post (protected route)
const deletePost = async (postId: number) => {
  try {
    const result = await client.post.deletePost.mutate({ id: postId });
    console.log('Post deleted:', result);
  } catch (error) {
    console.error('Failed to delete post:', error);
  }
};

// Get posts (unprotected route)
const getPosts = async () => {
  try {
    const posts = await client.post.getPosts.query({});
    console.log('Posts:', posts);
  } catch (error) {
    console.error('Failed to get posts:', error);
  }
};

// Usage
login().then(() => {
  createPost();
  getPosts();
  // Make sure to use actual post IDs for update and delete operations
  updatePost(1);
  deletePost(2);
});
```

This example demonstrates how to:

1. Set up the tRPC client with JWT authentication.
2. Perform login and store the JWT token.
3. Use protected routes (createPost, updatePost, deletePost) that require authentication.
4. Use an unprotected route (getPosts) that doesn't require authentication.

Remember to replace `'http://localhost:3000/trpc'` with your actual server URL if it's different.

## Running the Server

To run the server:

1. Install dependencies: `npm install`
2. Start the server: `npm run dev`

## Seeding the Database

To seed the database with initial data:

```
npm run seed
```

This will run the seed script located at `src/db/seed.ts`.