'use strict';

const express = require('express');
const db      = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Authentication required' });
  next();
}

// ── POST /api/user/score ──────────────────────────────────
router.get('/today/:date', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT total_score, round_scores, game_data FROM daily_scores
       WHERE user_id = $1 AND date = $2`,
      [req.user.id, req.params.date]
    );
    if (!rows[0]) return res.json({ played: false });
    const row = rows[0];
    res.json({
      played:      true,
      totalScore:  row.total_score,
      roundScores: typeof row.round_scores === 'string' ? JSON.parse(row.round_scores) : row.round_scores,
      gameData:    typeof row.game_data    === 'string' ? JSON.parse(row.game_data)    : (row.game_data ?? {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch today result' });
  }
});

router.post('/score', requireAuth, async (req, res) => {
  const { date, totalScore, roundScores, actuals, guesses } = req.body ?? {};

  if (!date || totalScore === undefined || !Array.isArray(roundScores))
    return res.status(400).json({ error: 'Missing required fields' });

  const gameData = { actuals: actuals ?? [], guesses: guesses ?? [] };

  try {
    await db.query(
      `INSERT INTO daily_scores (user_id, date, total_score, round_scores, game_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date) DO UPDATE SET
         total_score  = EXCLUDED.total_score,
         round_scores = EXCLUDED.round_scores,
         game_data    = EXCLUDED.game_data,
         completed_at = NOW()`,
      [req.user.id, date, totalScore, JSON.stringify(roundScores), JSON.stringify(gameData)]
    );

    // Return the user's rank for today after saving
    const rankResult = await db.query(
      `SELECT rank FROM (
         SELECT user_id, RANK() OVER (ORDER BY total_score DESC)::int AS rank
         FROM daily_scores WHERE date = $1
       ) ranked WHERE user_id = $2`,
      [date, req.user.id]
    );

    res.json({ ok: true, rank: rankResult.rows[0]?.rank ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

// ── GET /api/user/history ─────────────────────────────────
// Returns scores with a 7-day rolling average for trend display
router.get('/history', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         date,
         total_score,
         round_scores,
         ROUND(AVG(total_score) OVER (
           ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
         ))::int AS rolling_avg,
         COUNT(*) OVER ()::int AS total_games
       FROM daily_scores
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 90`,
      [req.user.id]
    );

    res.json(rows.map(r => ({
      date:        r.date,
      total_score: r.total_score,
      round_scores: typeof r.round_scores === 'string'
        ? JSON.parse(r.round_scores)
        : r.round_scores,
      rolling_avg: r.rolling_avg,
      total_games: r.total_games,
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ── GET /api/user/stats ───────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*)::int                  AS games_played,
         ROUND(AVG(total_score))::int   AS avg_score,
         MAX(total_score)::int          AS best_score,
         SUM(total_score)::int          AS total_score
       FROM daily_scores
       WHERE user_id = $1`,
      [req.user.id]
    );
    res.json(rows[0] ?? {});
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
