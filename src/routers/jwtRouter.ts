import { initTRPC } from '@trpc/server';
import { authController, signupSchema, loginSchema } from '../controllers/authController.js';
import { z } from 'zod';
// import { protectedProcedure } from '../middleware/auth.js';
// import { prisma } from '../utils/prisma.js';

const t = initTRPC.create();

const updateFcmTokenSchema = z.object({
  sessionId: z.string(),
  token: z.string(),
  osName: z.enum(['android', 'ios']).optional()
});

export const jwtRouter = t.router({
  signup: t.procedure
    .input(signupSchema)
    .mutation(async ({ input }) => {
      return authController.signup(input);
    }),

  login: t.procedure
    .input(loginSchema)
    .mutation(async ({ input }) => {
      return authController.login(input);
    }),

  logout: t.procedure
    .mutation(async () => {
      return authController.logout();
    }),

  // updateFcmToken: protectedProcedure
  //   .input(updateFcmTokenSchema)
  //   .mutation(async ({ input }) => {
  //     const { sessionId, token, osName } = input;
  //     return prisma.userSession.update({
  //       where: { id: sessionId },
  //       data: {
  //         fcmToken: token,
  //         osName: (osName || 'android'),
  //       },
  //     });
  //   }),
});
