import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { orm } from '../db/orm';
import { protectedProcedure } from '../server';

const t = initTRPC.context<{ userId?: number }>().create();

export const postRouter = t.router({
  createPost: protectedProcedure
    .input(z.object({
      title: z.string(),
      content: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return orm.Post.create({
        ...input,
        authorId: ctx.userId,
      });
    }),

  getPosts: t.procedure
    .input(z.object({
      authorId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      return orm.Post.findMany(input);
    }),

  updatePost: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      content: z.string().optional(),
      published: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const post = await orm.Post.findFirst({ id: input.id });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }
      if (post.authorId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to update this post',
        });
      }
      const { id, ...updateData } = input;
      return orm.Post.update({ id }, updateData);
    }),

  deletePost: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const post = await orm.Post.findFirst({ id: input.id });
      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Post not found',
        });
      }
      if (post.authorId !== ctx.userId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You are not authorized to delete this post',
        });
      }
      return orm.Post.delete({ id: input.id });
    }),
});