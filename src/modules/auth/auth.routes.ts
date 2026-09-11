import { Router } from 'express';
import { asyncHandler } from '../../middlewares/asyncHandler.js';
import { login, logout, refresh, register } from './auth.controller.js';

export const authRouter = Router();

authRouter.post('/register', asyncHandler(register));
authRouter.post('/login', asyncHandler(login));
authRouter.post('/refresh', asyncHandler(refresh));
authRouter.post('/logout', asyncHandler(logout));
