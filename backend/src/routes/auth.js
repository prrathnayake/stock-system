import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { User } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { normalizeEmail } from '../utils/normalizeEmail.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../services/tokenService.js';

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
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const access = signAccessToken(user);
  const refresh = signRefreshToken(user.id);
  res.json({ access, refresh, user: { id: user.id, name: user.full_name, role: user.role, email: user.email } });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refresh } = req.body || {};
  if (!refresh) {
    throw new HttpError(400, 'Missing refresh token');
  }
  try {
    const payload = verifyRefreshToken(refresh);
    const user = await User.findByPk(payload.id);
    if (!user) {
      throw new HttpError(401, 'Invalid refresh token');
    }
    const access = signAccessToken(user);
    res.json({ access });
  } catch (e) {
    throw new HttpError(401, 'Invalid refresh token');
  }
}));

export default router;
