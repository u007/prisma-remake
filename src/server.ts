import express from 'express';
import { initTRPC, TRPCError } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { jwtRouter } from './routers/jwtRouter';
import { postRouter } from './routers/postRouter';
import { userRouter } from './routers/userRouter';
import { setupDatabase } from '../prisma/setup';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const t = initTRPC.context<{ userId?: number }>().create();

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      userId: ctx.userId,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthed);

const appRouter = t.router({
  jwt: jwtRouter,
  post: postRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;

const app = express();

app.use(express.json());

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.split(' ')[1];
        try {
          const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
          return { userId: decoded.userId };
        } catch (error) {
          // Invalid token
        }
      }
      return {};
    },
  })
);

const port = 3000;

async function main() {
  await setupDatabase();

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

main().catch(console.error);