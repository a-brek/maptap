# MapTap — CLAUDE.md

## Project Overview

**MapTap** is a daily geography guessing game built on a 3D globe. Players identify locations across Earth and other worlds. Three modes: Daily Puzzle (ranked), Practice (unranked), and Map Battle (real-time multiplayer via Socket.io).

**Stack:** Node.js + Express (server) · Vanilla JS (client, no build step) · Neon PostgreSQL · Passport.js auth · Socket.io for real-time battles · globe.gl via CDN

---

## Dev Commands

```bash
# Start server (nodemon, auto-reload)
npm run dev        # or: node server/index.js

# Type-check (fastest validation — use this instead of a full build)
npx tsc --noEmit 2>&1 | head -40

# Check server is running
curl http://localhost:3001/api/puzzle/today
```

Server runs on **port 3001**. Client is served as static files from `client/` — no build step needed; edit HTML/JS/CSS and refresh.

---

## Architecture

### Server (`server/`)

| File | Purpose |
|------|---------|
| `index.js` | Entry point — Express setup, Passport, sessions, Socket.io, static serving |
| `db.js` | Neon PostgreSQL pool (`pg`); export: `{ query, pool }` |
| `competition.js` | Socket.io Map Battle logic — rooms, rounds, scoring, reconnection |
| `routes/puzzle.js` | `GET /api/puzzle/today` — seeded daily locations + scoring math |
| `routes/auth.js` | Register, login, logout, Google OAuth, set-username |
| `routes/user.js` | `POST /api/user/score`, `GET /api/user/history` |
| `routes/leaderboard.js` | Daily, all-time, and battle leaderboards |
| `routes/analytics.js` | Per-location difficulty stats |
| `data/locations.json` | All location data (lat/lng, world, tier, name, country) |

### Client (`client/`)

| File | Purpose |
|------|---------|
| `index.html` | Daily puzzle SPA shell — HUD, globe container, all modals |
| `main.js` | Core game loop — globe.gl setup, round flow, score handling |
| `auth.js` | `window.Auth` IIFE — auth UI, session state, score posting |
| `practice.html` / `practice.js` | Practice mode (same mechanics, no DB write) |
| `competition.html` / `competition.js` | Map Battle UI — Socket.io client, room management |
| `style.css` | Dark tactical theme — Bebas Neue + Share Tech Mono + IBM Plex |

---

## Database Schema

```sql
-- Neon PostgreSQL (project: soft-mode-90087067, pooled connection via DATABASE_URL)

users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE,         -- null until set (Google OAuth new users)
  password_hash TEXT,           -- null for Google-only accounts
  google_id TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

daily_scores (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  date DATE NOT NULL,
  total_score INT,
  round_scores JSONB,           -- [{score, distanceKm, emoji, locationName, country}, ...]
  game_data JSONB,              -- full game replay data
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date)         -- one score per user per day
)

battle_scores (
  id SERIAL PRIMARY KEY,
  played_at TIMESTAMPTZ DEFAULT NOW(),
  room_code VARCHAR(6),
  user_id INT REFERENCES users(id),
  display_name TEXT NOT NULL,
  total_score INT NOT NULL,
  rank INT NOT NULL,
  player_count INT NOT NULL,
  round_scores JSONB
)

session (managed by connect-pg-simple)
```

---

## Key Patterns & Invariants

### Scoring
- `calcScore(distKm, maxDist)` — exponential decay, half-life at 80% of `maxDist`
- Each world has its own radius + maxDist in `WORLD_PARAMS` (puzzle.js:8)
- Tier multipliers: Tier 1–2 = 1×, Tier 3 = 2×, Tier 4–5 = 3× → max 1000 pts/game
- Score formula and tier multipliers must stay in sync between `puzzle.js` (server) and `competition.js` (server uses the same exports)

### Daily Puzzle Seeding
- Locations are seeded by date using a linear-congruential RNG → same date always produces the same puzzle for all players
- `getLocationsForDate(dateStr)` exported from `puzzle.js` and reused in `competition.js`

### Auth Flow
1. `Auth.init()` runs in parallel with `fetchPuzzle()` in `main.js`
2. After loading screen hides → `Auth.onGameReady(user)` shows auth modal if not signed in
3. Game over → `Auth.saveScore(date, totalScore, roundScores)` posts to `POST /api/user/score`
4. Google OAuth: `GET /api/auth/google` → callback → if no username yet, redirect `/?setup=1`

### Map Battle (Socket.io)
- Rooms are ephemeral (`Map` in memory, 10-min TTL)
- Round duration: 10 s · Reveal pause: 5 s · Reconnect grace: 90 s
- Room codes: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no O/0/I/1 ambiguity)
- Locations use a random date offset (not today) so battles don't leak daily answers

### DB Access
Always use `db.query(sql, [params])` — returns full `pg.QueryResult`. Never interpolate user input into SQL strings.

---

## Environment Variables

```bash
DATABASE_URL=          # Neon pooled connection string (required)
SESSION_SECRET=        # Express session secret (required in prod)
GOOGLE_CLIENT_ID=      # Optional — enables Google OAuth
GOOGLE_CLIENT_SECRET=  # Optional
GOOGLE_CALLBACK_URL=   # Optional (defaults to http://localhost:3001/api/auth/google/callback)
PORT=3001              # Optional
NODE_ENV=production    # Enables secure cookies
```

Copy `.env.example` to `.env` to get started.

---

## Token Optimization Rules

> These rules apply in addition to the global RTK rules in `~/.claude/CLAUDE.md`.

- **Never run `npm run build`** — there is no build step. Changes to `client/` are live immediately.
- **Validation:** Use `npx tsc --noEmit 2>&1 | head -40` — not a full server restart.
- **DB queries:** Use `rtk` + the Neon MCP tools or `db.query()` directly. Don't dump full `locations.json` unless editing location data.
- **Log reading:** `rtk log` or `| head -50` — the request logger fires on every HTTP call.
- **Git:** Read-only only (`rtk git diff`, `rtk git status`). User commits manually.

---

## What NOT to Do

- Don't add a frontend build pipeline — the entire point is zero-build simplicity.
- Don't mock DB in tests — use the real Neon connection (or a branch).
- Don't add score routes to `routes/score.js` — it's a stub; real scoring lives in `routes/user.js`.
- Don't add `console.log` debug statements — the request logger already traces all HTTP traffic.
- Don't interpolate user input into SQL — always use parameterized queries.
