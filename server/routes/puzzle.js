const express  = require('express');
const router   = express.Router();
const locations = require('../data/locations.json');

// ---------------------------------------------------------------------------
// Per-world constants (radius in km, max scoring distance in km)
// ---------------------------------------------------------------------------
const WORLD_PARAMS = {
  earth:    { R: 6371,  maxDist: 2000 },
  moon:     { R: 1737,  maxDist:  545 },
  mars:     { R: 3390,  maxDist: 1065 },
  mercury:  { R: 2439,  maxDist:  766 },
  venus:    { R: 6051,  maxDist: 1900 },
  io:       { R: 1821,  maxDist:  572 },
  europa:   { R: 1560,  maxDist:  490 },
  ganymede: { R: 2634,  maxDist:  827 },
  callisto: { R: 2410,  maxDist:  757 },
  titan:    { R: 2575,  maxDist:  809 },
  pluto:    { R: 1188,  maxDist:  373 },
};

// ---------------------------------------------------------------------------
// Haversine great-circle distance (km) — radius varies by world
// ---------------------------------------------------------------------------
function haversine(lat1, lng1, lat2, lng2, R = 6371) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
function calcScore(distKm, maxDist = 2000) {
  return Math.round(1000 * Math.max(0, 1 - distKm / maxDist));
}

// ---------------------------------------------------------------------------
// Seeded linear-congruential RNG — same date → same shuffle every time
// ---------------------------------------------------------------------------
function seededRng(seed) {
  let s = (Math.abs(seed) >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ---------------------------------------------------------------------------
// Manual overrides — hardcoded puzzles for specific dates
// ---------------------------------------------------------------------------
const DATE_OVERRIDES = {
  '2026-03-04': [
    { name: 'Istanbul, Turkey',         lat: 41.0082,  lng: 28.9784,   tier: 1 },
    { name: 'Havana, Cuba',             lat: 23.1136,  lng: -82.3666,  tier: 2 },
    { name: 'Ulaanbaatar, Mongolia',    lat: 47.8864,  lng: 106.9057,  tier: 3 },
    { name: 'Suva, Fiji',              lat: -18.1248, lng: 178.4501,  tier: 4 },
    { name: 'Ashgabat, Turkmenistan',  lat: 37.9601,  lng: 58.3261,   tier: 5 },
  ],
};

// ---------------------------------------------------------------------------
// Pick 5 random locations for a given date string (deterministic)
// ---------------------------------------------------------------------------
// Pick one location per tier (1–5) so rounds go easy → hard.
// Each tier pool is shuffled with the same date seed, giving daily variety.
function getLocationsForDate(dateStr) {
  if (DATE_OVERRIDES[dateStr]) return DATE_OVERRIDES[dateStr];

  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = Math.imul(31, hash) + dateStr.charCodeAt(i) | 0;
  }

  // Group locations by tier
  const tiers = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const loc of locations) {
    tiers[loc.tier].push(loc);
  }

  // Pick one from each tier using the date seed
  const rand = seededRng(hash);
  const result = [];
  for (let t = 1; t <= 5; t++) {
    const pool = tiers[t];
    // Shuffle pool with seeded rng
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    result.push(shuffled[0]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// GET /api/puzzle/today
// ---------------------------------------------------------------------------
router.get('/today', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const locs  = getLocationsForDate(today);
  res.json({
    date:      today,
    locations: locs.map(({ name, world }) => ({ name, world: world || 'earth' })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/puzzle/:date
// ---------------------------------------------------------------------------
router.get('/:date', (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format — use YYYY-MM-DD' });
  }
  const locs = getLocationsForDate(date);
  res.json({
    date,
    locations: locs.map(({ name, world }) => ({ name, world: world || 'earth' })),
  });
});

// ---------------------------------------------------------------------------
// POST /api/puzzle/:date/reveal/:round
// Body: { lat: number, lng: number }
// Returns: { actual: {lat, lng, name}, distanceKm, score }
// ---------------------------------------------------------------------------
router.post('/:date/reveal/:round', (req, res) => {
  const { date, round } = req.params;
  const { lat, lng }    = req.body;

  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ error: 'Body must contain lat and lng' });
  }

  const roundIndex = parseInt(round, 10);
  if (isNaN(roundIndex) || roundIndex < 0 || roundIndex > 4) {
    return res.status(400).json({ error: 'round must be 0–4' });
  }

  const locs     = getLocationsForDate(date);
  const location = locs[roundIndex];
  if (!location) {
    return res.status(404).json({ error: 'Round not found' });
  }

  const world  = location.world || 'earth';
  const params = WORLD_PARAMS[world] || WORLD_PARAMS.earth;
  const distanceKm = haversine(lat, lng, location.lat, location.lng, params.R);
  const score      = calcScore(distanceKm, params.maxDist);

  res.json({
    actual: { lat: location.lat, lng: location.lng, name: location.name, world },
    distanceKm: Math.round(distanceKm),
    score,
  });
});

module.exports = router;
