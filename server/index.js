'use strict';

require('dotenv').config();

const http        = require('http');
const { Server: SocketIO } = require('socket.io');
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const session     = require('express-session');
const pgSession   = require('connect-pg-simple')(session);
const passport    = require('passport');
const { Strategy: LocalStrategy }  = require('passport-local');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const bcrypt      = require('bcryptjs');
const path        = require('path');
const { attachCompetition } = require('./competition');

const db              = require('./db');
const { pool }        = db;
const puzzleRoutes    = require('./routes/puzzle');
const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/user');
const leaderboardRoutes = require('./routes/leaderboard');
const analyticsRoutes   = require('./routes/analytics');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security & Performance ────────────────────────────────
app.set('trust proxy', 1); // required for secure cookies behind Render/fly/etc
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(compression());
app.use(express.json());

// ── Sessions ──────────────────────────────────────────────
const sessionMiddleware = session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
  }),
  secret:            process.env.SESSION_SECRET || 'tapmap-dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   30 * 24 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);

// ── Passport ──────────────────────────────────────────────
app.use(passport.initialize());
app.use(passport.session());

// Local strategy — email or username + password
passport.use(new LocalStrategy(
  { usernameField: 'identifier' },
  async (identifier, password, done) => {
    try {
      const val = identifier.toLowerCase().trim();
      const { rows } = await db.query(
        'SELECT * FROM users WHERE email = $1 OR lower(username) = $1',
        [val]
      );
      const user = rows[0];
      if (!user)               return done(null, false, { message: 'Invalid email/username or password' });
      if (!user.password_hash) return done(null, false, { message: 'This account uses Google sign-in' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok)                 return done(null, false, { message: 'Invalid email/username or password' });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

// Google OAuth — only registered when credentials are provided
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL
        || `http://localhost:${PORT}/api/auth/google/callback`,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email     = profile.emails?.[0]?.value?.toLowerCase();
        const googleId  = profile.id;
        const avatarUrl = profile.photos?.[0]?.value;

        let user;
        const byGoogle = await db.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
        user = byGoogle.rows[0];

        if (!user && email) {
          const byEmail = await db.query('SELECT * FROM users WHERE email = $1', [email]);
          user = byEmail.rows[0];
        }

        if (user) {
          await db.query(
            'UPDATE users SET google_id = $1, avatar_url = $2 WHERE id = $3',
            [googleId, avatarUrl, user.id]
          );
          return done(null, { ...user, google_id: googleId, avatar_url: avatarUrl });
        }

        // Brand-new Google user — username set later
        const result = await db.query(
          'INSERT INTO users (email, google_id, avatar_url) VALUES ($1, $2, $3) RETURNING *',
          [email, googleId, avatarUrl]
        );
        return done(null, result.rows[0]);
      } catch (err) {
        return done(err);
      }
    }
  ));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, rows[0] ?? null);
  } catch (err) {
    done(err);
  }
});

// ── Request Logger ────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── API Routes ────────────────────────────────────────────
app.use('/api/puzzle',      puzzleRoutes);
app.use('/api/auth',        authRoutes);
app.use('/api/user',        userRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/analytics',   analyticsRoutes);

// ── Serve Client ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client')));
app.get('/practice',  (_req, res) => res.sendFile(path.join(__dirname, '../client/practice.html')));
app.get('/compete',   (_req, res) => res.sendFile(path.join(__dirname, '../client/competition.html')));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));

// ── Global Error Handler ──────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── Socket.io ─────────────────────────────────────────────
const httpServer = http.createServer(app);
const io = new SocketIO(httpServer, { cors: { origin: true, credentials: true } });
attachCompetition(io, sessionMiddleware);

httpServer.listen(PORT, async () => {
  // Add game_data column if not present (safe to re-run)
  try {
    await db.query(`ALTER TABLE daily_scores ADD COLUMN IF NOT EXISTS game_data JSONB`);
  } catch (err) {
    console.warn('Migration warning:', err.message);
  }
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS battle_scores (
        id           SERIAL PRIMARY KEY,
        played_at    TIMESTAMPTZ DEFAULT NOW(),
        room_code    VARCHAR(6),
        user_id      INT REFERENCES users(id),
        display_name TEXT NOT NULL,
        total_score  INT NOT NULL,
        rank         INT NOT NULL,
        player_count INT NOT NULL,
        round_scores JSONB
      )
    `);
  } catch (err) {
    console.warn('Battle scores migration warning:', err.message);
  }
  console.log(`\n  🌍  Tap Map running at http://localhost:${PORT}\n`);
});
