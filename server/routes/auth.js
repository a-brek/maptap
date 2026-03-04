'use strict';

const express  = require('express');
const passport = require('passport');
const bcrypt   = require('bcryptjs');
const db       = require('../db');

const router = express.Router();

// ── GET /api/auth/config ──────────────────────────────────
router.get('/config', (_req, res) => {
  res.json({
    googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

// ── GET /api/auth/me ──────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.isAuthenticated()) return res.json({ user: null });
  const { id, username, email, avatar_url } = req.user;
  res.json({
    user: { id, username, email, avatarUrl: avatar_url, needsUsername: !username },
  });
});

// ── POST /api/auth/register ───────────────────────────────
router.post('/register', async (req, res) => {
  const { password, username } = req.body ?? {};

  if (!password || !username)
    return res.status(400).json({ error: 'Username and password are required' });

  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20)
    return res.status(400).json({ error: 'Username must be 3–20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed))
    return res.status(400).json({ error: 'Username: letters, numbers, and underscores only' });

  try {
    const hash   = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
      [trimmed, hash]
    );
    const user = result.rows[0];

    req.logIn(user, err => {
      if (err) return res.status(500).json({ error: 'Session error' });
      res.json({ user: { id: user.id, username: user.username } });
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err)   return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    req.logIn(user, err2 => {
      if (err2) return next(err2);
      res.json({ user: { id: user.id, username: user.username } });
    });
  })(req, res, next);
});

// ── POST /api/auth/logout ─────────────────────────────────
router.post('/logout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ ok: true });
  });
});

// ── PUT /api/auth/username ────────────────────────────────
router.put('/username', async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });

  const { username } = req.body ?? {};
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const trimmed = username.trim();
  if (trimmed.length < 3 || trimmed.length > 20)
    return res.status(400).json({ error: 'Username must be 3–20 characters' });
  if (!/^[a-zA-Z0-9_]+$/.test(trimmed))
    return res.status(400).json({ error: 'Username: letters, numbers, and underscores only' });

  try {
    await db.query('UPDATE users SET username = $1 WHERE id = $2', [trimmed, req.user.id]);
    req.user.username = trimmed;
    res.json({ ok: true, username: trimmed });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    res.status(500).json({ error: 'Failed to set username' });
  }
});

// ── Google OAuth ──────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['email', 'profile'] }));

router.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: '/?auth=error' }),
  (req, res) => {
    if (!req.user.username) return res.redirect('/?setup=1');
    res.redirect('/');
  }
);

module.exports = router;
