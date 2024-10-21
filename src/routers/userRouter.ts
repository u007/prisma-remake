import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { orm } from '../db/orm.js';

const t = initTRPC.create();

export const userRouter = t.router({
  getUser: t.procedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const user = await orm.User.findFirst({ id: input.id });
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }
      return user;
    }),

  updateProfile: t.procedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(2).optional(),
      bio: z.string().max(500).optional(),
      avatar: z.string().url().optional(),
      birthDate: z.string().datetime().optional(),
      phoneNumber: z.string().regex(/^\+?[1-9]\d{1,14}$/).optional(),
      website: z.string().url().optional(),
      location: z.string().max(100).optional(),
      socialLinks: z.object({
        twitter: z.string().url().optional(),
        facebook: z.string().url().optional(),
        linkedin: z.string().url().optional(),
        instagram: z.string().url().optional(),
      }).optional(),
      preferences: z.object({
        newsletter: z.boolean().optional(),
        notifications: z.boolean().optional(),
        language: z.string().min(2).max(5).optional(),
        theme: z.enum(['light', 'dark']).optional(),
      }).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;
      
      // Check if the user exists
      const existingUser = await orm.User.findFirst({ id });
      if (!existingUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Update the user profile
      const updatedUser = await orm.User.update({ id }, updateData);

      if (updatedUser.affected === 0) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update user profile',
        });
      }

      // Fetch and return the updated user data
      const user = await orm.User.findFirst({ id });
      return user;
    }),
});