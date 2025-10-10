import { Router } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../db.js';
import { config } from '../config.js';

const router = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

router.post('/login', async (req, res) => {
  const parse = LoginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
  const { email, password } = parse.data;
  const user = await User.findOne({ where: { email } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const access = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, config.auth.jwtSecret, { expiresIn: config.auth.jwtExpires });
  const refresh = jwt.sign({ id: user.id }, config.auth.refreshSecret, { expiresIn: config.auth.refreshExpires });
  res.json({ access, refresh, user: { id: user.id, name: user.full_name, role: user.role, email: user.email } });
});

router.post('/refresh', async (req, res) => {
  const { refresh } = req.body || {};
  if (!refresh) return res.status(400).json({ error: 'Missing refresh token' });
  try {
    const payload = jwt.verify(refresh, config.auth.refreshSecret);
    const user = await User.findByPk(payload.id);
    if (!user) return res.status(401).json({ error: 'Invalid refresh token' });
    const access = jwt.sign({ id: user.id, role: user.role, name: user.full_name }, config.auth.jwtSecret, { expiresIn: config.auth.jwtExpires });
    res.json({ access });
  } catch (e) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

export default router;
