import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../db.js';
import { config } from '../config.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';

const router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

const loginLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) {
    throw new HttpError(400, 'Invalid request payload', parse.error.flatten());
  }
  const { email, password } = parse.data;
  const user = await User.findOne({ where: { email } });
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const access = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, config.auth.jwtSecret, { expiresIn: config.auth.jwtExpires });
  const refresh = jwt.sign({ id: user.id }, config.auth.refreshSecret, { expiresIn: config.auth.refreshExpires });
  res.json({ access, refresh, user: { id: user.id, name: user.full_name, role: user.role, email: user.email } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh } = req.body || {};
  if (!refresh) {
    throw new HttpError(400, 'Missing refresh token');
  }
  try {
    const payload = jwt.verify(refresh, config.auth.refreshSecret);
    const user = await User.findByPk(payload.id);
    if (!user) {
      throw new HttpError(401, 'Invalid refresh token');
    }
    const access = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, config.auth.jwtSecret, { expiresIn: config.auth.jwtExpires });
    res.json({ access });
  } catch (e) {
    throw new HttpError(401, 'Invalid refresh token');
  }
}));

export default router;
