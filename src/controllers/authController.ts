import { orm } from '../db/orm.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { hash, compare } from 'bun';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

export const authController = {
  signup: async (input: z.infer<typeof signupSchema>) => {
    const existingUser = await orm.User.findFirst({ email: input.email });
    if (existingUser) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'User already exists',
      });
    }

    const hashedPassword = await hash(input.password, 10);
    const user = await orm.User.create({
      name: input.name,
      email: input.email,
      password: hashedPassword,
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  },

  login: async (input: z.infer<typeof loginSchema>) => {
    const user = await orm.User.findFirst({ email: input.email });
    if (!user) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    const isPasswordValid = await compare(input.password, user.password);
    if (!isPasswordValid) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Invalid password',
      });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    return { token, user: { id: user.id, name: user.name, email: user.email } };
  },

  logout: async () => {
    // In a stateless JWT authentication system, logout is typically handled client-side
    // by removing the token from storage. Here we'll just return a success message.
    return { message: 'Logged out successfully' };
  },
};

export const signupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});