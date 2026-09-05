import type { AuthContext } from '../middlewares/auth.middleware.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
