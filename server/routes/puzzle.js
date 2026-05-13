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
// Harder rounds are worth more — matches maptap.gg difficulty weighting.
// Tier 1+2 = 1×, Tier 3 = 2×, Tier 4+5 = 3× → max 1000 total per game.
const TIER_MULTIPLIERS = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 3 };

function calcScore(distKm, maxDist = 2000) {
  // Exponential decay — halflife at 80% of maxDist for gentler mid-range dropoff
  return Math.round(100 * Math.exp(-distKm * Math.LN2 / (maxDist * 0.8)));
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
// Puzzle version — bump to let clients replay even if they already finished
// ---------------------------------------------------------------------------
const PUZZLE_VERSIONS = {
  '2026-03-04': 2,
};

// ---------------------------------------------------------------------------
// Manual overrides — hardcoded puzzles for specific dates
// ---------------------------------------------------------------------------
const DATE_OVERRIDES = {
  '2026-03-04': [
    { name: 'Sydney, Australia',               lat: -33.8688, lng: 151.2093,  tier: 1 },
    { name: 'Cairo, Egypt',                    lat: 30.0444,  lng: 31.2357,   tier: 2 },
    { name: 'Nairobi, Kenya',                  lat: -1.2921,  lng: 36.8219,   tier: 3 },
    { name: 'Almaty, Kazakhstan',              lat: 43.2220,  lng: 76.8512,   tier: 4 },
    { name: 'Ulaanbaatar, Mongolia',           lat: 47.8864,  lng: 106.9057,  tier: 5 },
  ],
};

// ---------------------------------------------------------------------------
// Pick 5 random locations for a given date string (deterministic)
// ---------------------------------------------------------------------------
// Pick one location per tier (1–5) so rounds go easy → hard.
// Each tier pool is shuffled once with a fixed seed, then indexed by
// days-since-epoch mod pool-size — guaranteeing no repeats within a full cycle.
const EPOCH = new Date('2025-01-01').getTime();
const MS_PER_DAY = 86400000;

// Island locations in Tier 5 — used to interleave island/non-island in the cycle
// so the final round doesn't land on an island the majority of days.
const TIER5_ISLAND_NAMES = new Set([
  'Victoria, Seychelles', 'Moroni, Comoros', 'Male, Maldives',
  'Bandar Seri Begawan, Brunei', 'Dili, East Timor',
  'Port Vila, Vanuatu', 'Honiara, Solomon Islands', "Nuku'alofa, Tonga",
  'Apia, Samoa', 'Funafuti, Tuvalu', 'Tarawa, Kiribati',
  'Majuro, Marshall Islands', 'Palikir, Micronesia',
  'Bridgetown, Barbados', 'Roseau, Dominica', 'Castries, Saint Lucia',
  'Kingstown, Saint Vincent and the Grenadines', "St. George's, Grenada",
  'Basseterre, Saint Kitts and Nevis', "St. John's, Antigua and Barbuda",
  'São Tomé, São Tomé and Príncipe', 'Ngerulmud, Palau', 'Yaren, Nauru',
  'Avarua, Cook Islands', 'Hanga Roa, Easter Island',
]);

// Pre-shuffle each tier once with a fixed seed so the cycle order is stable
const TIER_CYCLES = (() => {
  const tiers = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  for (const loc of locations) tiers[loc.tier].push(loc);
  const rand = seededRng(0xdeadbeef);
  const cycles = {};
  for (let t = 1; t <= 5; t++) {
    const shuffled = [...tiers[t]];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    if (t === 5) {
      // Interleave non-island and island so the final round alternates.
      // Pattern: non-island, island, non-island, island… then remaining islands.
      const nonIsland = shuffled.filter(l => !TIER5_ISLAND_NAMES.has(l.name));
      const island    = shuffled.filter(l =>  TIER5_ISLAND_NAMES.has(l.name));
      const interleaved = [];
      const len = Math.max(nonIsland.length, island.length);
      for (let i = 0; i < len; i++) {
        if (i < nonIsland.length) interleaved.push(nonIsland[i]);
        if (i < island.length)    interleaved.push(island[i]);
      }
      cycles[t] = interleaved;
    } else {
      cycles[t] = shuffled;
    }
  }
  return cycles;
})();

function getLocationsForDate(dateStr) {
  if (DATE_OVERRIDES[dateStr]) return DATE_OVERRIDES[dateStr];

  const dayIndex = Math.floor((new Date(dateStr + 'T12:00:00Z').getTime() - EPOCH) / MS_PER_DAY);

  const result = [];
  for (let t = 1; t <= 5; t++) {
    const pool = TIER_CYCLES[t];
    result.push(pool[((dayIndex % pool.length) + pool.length) % pool.length]);
  }
  return result;
}

const VALID_CONTINENTS = new Set(['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania']);

// Pick 5 random locations (one per tier) filtered to a continent.
// Falls back to the full pool for any tier with fewer than 1 matching location.
function getLocationsForContinent(continent, seed) {
  const rand = seededRng(seed);
  const result = [];
  for (let t = 1; t <= 5; t++) {
    const pool = TIER_CYCLES[t].filter(l => l.continent === continent);
    const fallback = TIER_CYCLES[t];
    const src = pool.length > 0 ? pool : fallback;
    result.push(src[Math.floor(rand() * src.length)]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// GET /api/puzzle/today
// ---------------------------------------------------------------------------
router.get('/today', (req, res) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const locs  = getLocationsForDate(today);
  res.json({
    date:      today,
    version:   PUZZLE_VERSIONS[today] || 1,
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
    version:   PUZZLE_VERSIONS[date] || 1,
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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Invalid date format — use YYYY-MM-DD' });
  }

  const locs     = getLocationsForDate(date);
  const location = locs[roundIndex];
  if (!location) {
    return res.status(404).json({ error: 'Round not found' });
  }

  const world      = location.world || 'earth';
  const params     = WORLD_PARAMS[world] || WORLD_PARAMS.earth;
  const distanceKm = haversine(lat, lng, location.lat, location.lng, params.R);
  const multiplier = TIER_MULTIPLIERS[location.tier] || 1;
  const score      = Math.round(calcScore(distanceKm, params.maxDist) * multiplier);
  const maxScore   = 100 * multiplier;

  res.json({
    actual: { lat: location.lat, lng: location.lng, name: location.name, world },
    distanceKm: Math.round(distanceKm),
    score,
    maxScore,
  });
});

module.exports = router;
module.exports.getLocationsForDate      = getLocationsForDate;
module.exports.getLocationsForContinent = getLocationsForContinent;
module.exports.VALID_CONTINENTS         = VALID_CONTINENTS;
module.exports.haversine                = haversine;
module.exports.calcScore                = calcScore;
module.exports.WORLD_PARAMS             = WORLD_PARAMS;
