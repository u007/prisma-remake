import { initTRPC } from '@trpc/server';
import { authController, signupSchema, loginSchema } from '../controllers/authController.js';

const t = initTRPC.create();

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
});