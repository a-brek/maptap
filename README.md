# TapMap

A daily geography guessing game. Each day, 5 locations tied to historical events are
revealed one at a time. Click the 3D globe where you think each event happened — scored
by great-circle distance from your guess to the actual site.

## Setup

```bash
npm install
npm start
```

Open → http://localhost:3001

### Development (auto-reload)

```bash
npm run dev
```

## Game Rules

- **5 locations** per day, each tied to a "this day in history" event
- Click the globe to place a guess marker, then hit **Confirm**
- Scoring: `1000 × max(0, 1 − distance_km / 2000)` — max 1000 pts per round
- Same puzzle for **everyone on the same calendar day** (seeded by date)
- Share your results as a Wordle-style emoji grid

## Scoring Tiers

| Distance | Points | Grade |
|---|---|---|
| < 200 km | 900–1000 | Pinpoint |
| 200–600 km | 700–900 | Close |
| 600–1200 km | 400–700 | Nearby |
| 1200–2000 km | 0–400 | Far |
| > 2000 km | 0 | Miss |

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/puzzle/today` | Today's puzzle — coords withheld |
| GET | `/api/puzzle/:date` | Puzzle for YYYY-MM-DD — coords withheld |
| POST | `/api/puzzle/:date/reveal/:round` | Submit guess `{lat, lng}`, receive actual coords + score |
| POST | `/api/score` | **501 — planned** |
| GET | `/api/leaderboard` | **501 — planned** |

## Project Structure

```
maptap/
  client/
    index.html      ← Game UI
    main.js         ← Globe setup, game loop, API calls
    style.css       ← Dark tactical theme
  server/
    index.js        ← Express app entry
    routes/
      puzzle.js     ← Puzzle API + haversine scoring
      score.js      ← Stubbed (501) for future DB integration
    data/
      puzzles.json  ← 20 daily puzzle sets (flat JSON, no DB)
  package.json
  README.md
```

## Adding Puzzles

Edit `server/data/puzzles.json`. Each entry:

```json
{
  "date": "YYYY-MM-DD",
  "title": "Optional title",
  "locations": [
    {
      "name": "Display name",
      "lat": 00.0000,
      "lng": 00.0000,
      "story": "The historical event description shown after the guess.",
      "hint": "A subtle geographic clue shown on demand."
    }
  ]
}
```

Puzzles without an exact date match are selected deterministically by hashing today's
date string, so every day always has a puzzle even without an exact entry.
