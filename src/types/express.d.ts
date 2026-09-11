import type { AuthContext, PlatformAuthContext } from '../middlewares/auth.middleware.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      platformAuth?: PlatformAuthContext;
    }
  }
}

export {};
