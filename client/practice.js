'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  puzzle:       null,
  date:         null,
  round:        0,
  totalScore:   0,
  roundScores:  [],
  pendingGuess: null,
  markers:      [],
  arcs:         [],
  labels:       [],
  rings:        [],
  gameOver:     false,
  hintVisible:  false,
};

let globe = null;
let _nextRoundTimer = null;
const AUTO_ADVANCE_MS = 5000;

function qs(sel) { return document.querySelector(sel); }

// ── Score helpers ───────────────────────────────────────────
function scoreEmoji(score) {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  if (score >= 40) return '🟠';
  if (score >   0) return '🔴';
  return '⚫';
}
function scoreQuality(score) {
  if (score >= 90) return ['Pinpoint', 'q-pinpoint'];
  if (score >= 70) return ['Close',    'q-close'];
  if (score >= 40) return ['Nearby',   'q-nearby'];
  if (score >   0) return ['Far',      'q-far'];
  return ['Miss', 'q-miss'];
}
function scoreGrade(total) {
  if (total >= 450) return 'Navigator';
  if (total >= 350) return 'Cartographer';
  if (total >= 250) return 'Traveler';
  if (total >= 150) return 'Explorer';
  return 'Landlubber';
}
function animateCounter(el, from, to, duration = 700) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Random practice date ────────────────────────────────────
// Pick a random UTC date from 2024-06-01 to yesterday
function randomPracticeDate() {
  const start = Date.UTC(2024, 5, 1); // 2024-06-01
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const end = yesterday.getTime();
  const range = end - start;
  if (range <= 0) return '2024-06-01';
  const t = start + Math.floor(Math.random() * range);
  return new Date(t).toISOString().slice(0, 10);
}

// ── World Config ────────────────────────────────────────────
const _TX  = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/';
const _SSC = 'https://www.solarsystemscope.com/textures/download/';

const WORLD_CONFIG = {
  earth:    { label: '🌍 Earth',    globeImage: 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg', bumpImage: 'https://unpkg.com/three-globe/example/img/earth-topology.png', atmosphere: true,  atmosphereColor: 'rgba(100, 160, 255, 0.3)', atmosphereAlt: 0.16, showOceans: true  },
  moon:     { label: '🌕 Moon',     globeImage: `${_TX}moonmap1k.jpg`,          bumpImage: `${_TX}moonbump1k.jpg`,     atmosphere: false, atmosphereColor: 'rgba(0,0,0,0)',              atmosphereAlt: 0.01, showOceans: false },
  mars:     { label: '🔴 Mars',     globeImage: `${_TX}marsmap1k.jpg`,          bumpImage: `${_TX}marsbump1k.jpg`,     atmosphere: true,  atmosphereColor: 'rgba(200, 120, 80, 0.25)',   atmosphereAlt: 0.08, showOceans: false },
  mercury:  { label: '🪨 Mercury',  globeImage: `${_TX}mercurymap1k.jpg`,       bumpImage: `${_TX}mercurybump1k.jpg`,  atmosphere: false, atmosphereColor: 'rgba(0,0,0,0)',              atmosphereAlt: 0.01, showOceans: false },
  venus:    { label: '🌫️ Venus',   globeImage: `${_TX}venusmap1k.jpg`,          bumpImage: null,                       atmosphere: true,  atmosphereColor: 'rgba(255, 200, 80, 0.35)',   atmosphereAlt: 0.22, showOceans: false },
  io:       { label: '🟡 Io',       globeImage: `${_SSC}2k_io.jpg`,             bumpImage: null,                       atmosphere: false, atmosphereColor: 'rgba(255, 210, 60, 0.1)',    atmosphereAlt: 0.02, showOceans: false },
  europa:   { label: '🧊 Europa',   globeImage: `${_SSC}2k_europa.jpg`,         bumpImage: null,                       atmosphere: false, atmosphereColor: 'rgba(180, 220, 255, 0.08)',  atmosphereAlt: 0.02, showOceans: false },
  ganymede: { label: '🌑 Ganymede', globeImage: `${_SSC}2k_ganymede.jpg`,       bumpImage: null,                       atmosphere: false, atmosphereColor: 'rgba(0,0,0,0)',              atmosphereAlt: 0.01, showOceans: false },
  callisto: { label: '🌑 Callisto', globeImage: `${_SSC}2k_callisto.jpg`,       bumpImage: null,                       atmosphere: false, atmosphereColor: 'rgba(0,0,0,0)',              atmosphereAlt: 0.01, showOceans: false },
  titan:    { label: '🟠 Titan',    globeImage: `${_SSC}2k_titan.jpg`,          bumpImage: null,                       atmosphere: true,  atmosphereColor: 'rgba(210, 140, 60, 0.4)',    atmosphereAlt: 0.18, showOceans: false },
  pluto:    { label: '🌐 Pluto',    globeImage: `${_SSC}2k_eris_fictional.jpg`, bumpImage: null,                       atmosphere: false, atmosphereColor: 'rgba(0,0,0,0)',              atmosphereAlt: 0.01, showOceans: false },
};

let _currentWorld = 'earth';

const OCEAN_LABELS = [
  { ocean: true, lat:  5,  lng: -30,  text: 'ATLANTIC OCEAN',  color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat: -5,  lng: -145, text: 'PACIFIC OCEAN',   color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat: -20, lng:  75,  text: 'INDIAN OCEAN',    color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat: -60, lng:   0,  text: 'SOUTHERN OCEAN',  color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat:  80, lng:   0,  text: 'ARCTIC OCEAN',    color: 'rgba(100,180,255,0.28)' },
];

// ── Country highlight ───────────────────────────────────────
const COUNTRY_ALIASES = {
  'england': 'united kingdom', 'scotland': 'united kingdom', 'wales': 'united kingdom',
  'northern ireland': 'united kingdom', 'united states': 'united states of america',
  'usa': 'united states of america', 'north korea': "democratic people's republic of korea",
  'south korea': 'republic of korea', 'czech republic': 'czechia',
  'ivory coast': "côte d'ivoire", 'burma': 'myanmar', 'tibet': 'china',
};
let _worldGeoCache = null;
async function loadWorldGeo() {
  if (_worldGeoCache) return _worldGeoCache;
  const res = await fetch('https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson');
  _worldGeoCache = await res.json();
  return _worldGeoCache;
}
function findCountry(geo, rawName) {
  const key = (COUNTRY_ALIASES[rawName.toLowerCase()] ?? rawName).toLowerCase();
  return geo.features.find(f => {
    const n = (f.properties.name ?? '').toLowerCase();
    return n === key || n.includes(key) || key.includes(n);
  }) ?? null;
}
async function showCountryHighlight(countryName) {
  try {
    const geo = await loadWorldGeo();
    const feature = findCountry(geo, countryName);
    if (feature) globe.polygonsData([feature]);
  } catch (_) {}
}
function clearCountryHighlight() { globe.polygonsData([]); }

// ── Globe ───────────────────────────────────────────────────
function randomGlobeView() {
  const altitude = 1.6 + Math.random() * 0.8;
  return { lat: Math.random() * 130 - 50, lng: Math.random() * 360 - 180, altitude };
}

function initGlobe() {
  const container = qs('#globe-container');
  globe = Globe({ animateIn: false })(container)
    .width(container.clientWidth)
    .height(container.clientHeight)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .backgroundImageUrl('https://unpkg.com/three-globe/example/img/night-sky.png')
    .atmosphereColor('rgba(100, 160, 255, 0.3)')
    .atmosphereAltitude(0.16)
    .pointsData([]).pointLat('lat').pointLng('lng').pointColor('color').pointRadius('size').pointAltitude('altitude')
    .ringsData([]).ringLat('lat').ringLng('lng').ringColor(() => t => `rgba(0, 201, 167, ${(1 - t) * 0.8})`).ringMaxRadius(4).ringPropagationSpeed(1.4).ringRepeatPeriod(2000)
    .arcsData([]).arcStartLat('startLat').arcStartLng('startLng').arcEndLat('endLat').arcEndLng('endLng').arcColor('color').arcDashLength(0.45).arcDashGap(0.12).arcDashAnimateTime(2400).arcStroke(0.45)
    .labelsData([...OCEAN_LABELS]).labelLat('lat').labelLng('lng').labelText('text').labelSize(d => d.ocean ? 0.55 : 0.75).labelColor('color').labelDotRadius(d => d.ocean ? 0 : 0.32).labelIncludeDot(d => !d.ocean).labelAltitude(0.025).labelResolution(3)
    .htmlElementsData([]).htmlLat('lat').htmlLng('lng').htmlAltitude('alt').htmlElement('el')
    .polygonsData([]).polygonCapColor(() => 'rgba(0, 201, 167, 0.10)').polygonSideColor(() => 'rgba(0, 201, 167, 0.06)').polygonStrokeColor(() => 'rgba(0, 201, 167, 0.75)').polygonAltitude(0.007)
    .onGlobeClick(({ lat, lng }) => handleGlobeClick(lat, lng));

  globe.pointOfView(randomGlobeView());
  window.addEventListener('resize', () => {
    globe.width(container.clientWidth).height(container.clientHeight);
  });
}

function setGlobeWorld(world) {
  if (world === _currentWorld) return;
  _currentWorld = world;
  const cfg = WORLD_CONFIG[world] || WORLD_CONFIG.earth;
  globe
    .globeImageUrl(cfg.globeImage)
    .bumpImageUrl(cfg.bumpImage || '')
    .showAtmosphere(cfg.atmosphere)
    .atmosphereColor(cfg.atmosphereColor)
    .atmosphereAltitude(cfg.atmosphereAlt);
  globe.labelsData(cfg.showOceans ? [...OCEAN_LABELS, ...state.labels] : [...state.labels]);
}

// ── API ─────────────────────────────────────────────────────
async function fetchPuzzle(date) {
  const res = await fetch(`/api/puzzle/${date}`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

async function revealLocation(date, roundIndex, lat, lng) {
  const res = await fetch(`/api/puzzle/${date}/reveal/${roundIndex}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng }),
  });
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  return res.json();
}

// ── Globe click & confirm ───────────────────────────────────
function handleGlobeClick(lat, lng) {
  if (state.gameOver || !state.puzzle) return;
  state.markers = state.markers.filter(m => m.id !== 'pending');
  state.pendingGuess = { lat, lng };
  state.markers.push({ id: 'pending', lat, lng, color: '#e89620', size: 0.25, altitude: 0.12 });
  globe.pointsData([...state.markers]);
  qs('#confirm-btn').removeAttribute('hidden');
  qs('#guess-prompt').textContent = 'Adjust or confirm your guess';
}

async function confirmGuess() {
  if (!state.pendingGuess) return;
  const btn = qs('#confirm-btn');
  btn.setAttribute('disabled', '');
  btn.textContent = 'Submitting…';

  const { lat, lng } = state.pendingGuess;
  try {
    const { actual, distanceKm, score } = await revealLocation(state.date, state.round, lat, lng);

    const emoji   = scoreEmoji(score);
    const country = actual.name.includes(',') ? actual.name.split(',').pop().trim() : actual.name;
    state.roundScores.push({ score, distanceKm, emoji, locationName: actual.name, country });

    state.markers = state.markers.map(m =>
      m.id === 'pending' ? { ...m, id: `guess-${state.round}`, size: 0.2, altitude: 0.07 } : m
    );
    globe.pointOfView({ lat: actual.lat, lng: actual.lng, altitude: 1.8 }, 1200);

    state.markers.push({ id: `actual-${state.round}`, lat: actual.lat, lng: actual.lng, color: '#00c9a7', size: 0.28, altitude: 0.06 });
    state.rings.push({ lat: actual.lat, lng: actual.lng });
    state.arcs.push({ startLat: lat, startLng: lng, endLat: actual.lat, endLng: actual.lng, color: ['#e89620', '#00c9a7'] });
    state.labels.push({ lat: actual.lat, lng: actual.lng, text: actual.name, color: '#00c9a7' });

    const world = state.puzzle.locations[state.round]?.world || 'earth';
    globe.pointsData([...state.markers]);
    globe.ringsData([...state.rings]);
    globe.arcsData([...state.arcs]);
    globe.labelsData([...(WORLD_CONFIG[world]?.showOceans ? OCEAN_LABELS : []), ...state.labels]);
    if (world === 'earth') showCountryHighlight(country);

    const prevTotal = state.totalScore;
    state.totalScore += score;
    const scoreEl = qs('#score-display');
    scoreEl.classList.add('score-flash');
    setTimeout(() => scoreEl.classList.remove('score-flash'), 420);
    animateCounter(scoreEl, prevTotal, state.totalScore);

    updatePips(state.round, 'done');

    setTimeout(() => {
      hideCluePanel();
      showScorePopup(score, distanceKm, actual);
    }, 1500);

  } catch (err) {
    console.error('Guess failed:', err);
    btn.removeAttribute('disabled');
    btn.textContent = 'Confirm Guess';
  }
}

// ── Clue panel ──────────────────────────────────────────────
function showCluePanel() {
  const loc   = state.puzzle.locations[state.round];
  const world = loc.world || 'earth';
  const wcfg  = WORLD_CONFIG[world] || WORLD_CONFIG.earth;

  qs('#round-number').textContent  = String(state.round + 1).padStart(2, '0');
  qs('#round-label').textContent   = `Round ${state.round + 1} of 5`;
  qs('#location-clue').textContent = loc.name;
  qs('#location-sub').textContent  = wcfg.label;
  qs('#hint-toggle').setAttribute('hidden', '');
  qs('#hint-text').classList.remove('visible');
  qs('#hint-text').setAttribute('aria-hidden', 'true');
  qs('#guess-prompt').textContent  = window.matchMedia('(hover: none)').matches
    ? `Tap the ${wcfg.label} to place your guess`
    : `Click the ${wcfg.label} to place your guess`;
  qs('#confirm-btn').setAttribute('hidden', '');
  qs('#confirm-btn').removeAttribute('disabled');
  qs('#confirm-btn').textContent   = 'Confirm Guess';

  state.hintVisible  = false;
  state.pendingGuess = null;

  setGlobeWorld(world);
  clearCountryHighlight();
  updateRoundDisplay();
  updatePips(state.round, 'active');

  qs('#clue-panel').classList.add('visible');
}
function hideCluePanel() { qs('#clue-panel').classList.remove('visible'); }

// ── Score popup ─────────────────────────────────────────────
function showScorePopup(score, distanceKm, actual) {
  const [label, cls] = scoreQuality(score);
  qs('#popup-score').textContent    = `+${score}`;
  qs('#popup-distance').textContent = distanceKm < 2 ? 'Basically spot on!' : `${distanceKm.toLocaleString()} km away`;
  qs('#popup-location').textContent = actual.name;

  const qEl = qs('#popup-quality');
  qEl.textContent = label;
  qEl.className   = `quality ${cls}`;

  qs('#next-btn').textContent = state.round >= 4 ? 'View Results →' : 'Next Location →';

  const bar = qs('#popup-timer-bar');
  bar.style.animation = 'none';
  bar.offsetHeight;
  bar.style.animation = `timerDrain ${AUTO_ADVANCE_MS}ms linear forwards`;

  clearTimeout(_nextRoundTimer);
  _nextRoundTimer = setTimeout(nextRound, AUTO_ADVANCE_MS);

  qs('#score-popup').classList.add('visible');
}
function hideScorePopup() {
  clearTimeout(_nextRoundTimer);
  _nextRoundTimer = null;
  qs('#score-popup').classList.remove('visible');
}

// ── HUD ─────────────────────────────────────────────────────
function updateRoundDisplay() { qs('#round-display').textContent = `${state.round + 1} / 5`; }
function updatePips(activeIndex, activeState) {
  qs('#round-pips').querySelectorAll('.pip').forEach((pip, i) => {
    if (i < activeIndex)        pip.className = 'pip done';
    else if (i === activeIndex) pip.className = `pip ${activeState}`;
    else                        pip.className = 'pip';
  });
}

// ── Hint toggle ─────────────────────────────────────────────
function toggleHint() {
  state.hintVisible = !state.hintVisible;
  const hintEl   = qs('#hint-text');
  const toggleEl = qs('#hint-toggle');
  hintEl.classList.toggle('visible', state.hintVisible);
  hintEl.setAttribute('aria-hidden', String(!state.hintVisible));
  toggleEl.textContent = state.hintVisible ? 'Hide Hint' : 'Show Hint';
  toggleEl.setAttribute('aria-expanded', String(state.hintVisible));
}

// ── Next round ──────────────────────────────────────────────
function nextRound() {
  hideScorePopup();
  state.round += 1;
  setTimeout(() => {
    if (state.round >= 5) showGameOver();
    else showCluePanel();
  }, 320);
}

// ── Game over ───────────────────────────────────────────────
function showGameOver() {
  state.gameOver = true;
  qs('#final-score').textContent = state.totalScore.toLocaleString();
  qs('#score-grade').textContent = scoreGrade(state.totalScore);

  const breakdown = qs('#score-breakdown');
  breakdown.innerHTML = state.roundScores.map((r, i) => {
    const km = r.distanceKm < 1 ? '<1' : Math.round(r.distanceKm).toLocaleString();
    const label = r.locationName || `Location ${i + 1}`;
    return `
    <div class="breakdown-row">
      <span class="breakdown-emoji">${r.emoji}</span>
      <span class="breakdown-label">${label}</span>
      <span class="breakdown-dist">${km} km off</span>
      <span class="breakdown-score">+${r.score}</span>
    </div>`;
  }).join('');

  const overlay = qs('#game-over');
  overlay.removeAttribute('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('visible')));
}

// ── Reset & play again ──────────────────────────────────────
function resetGame() {
  // Reset state
  Object.assign(state, {
    puzzle: null, date: null, round: 0, totalScore: 0, roundScores: [],
    pendingGuess: null, markers: [], arcs: [], labels: [], rings: [],
    gameOver: false, hintVisible: false,
  });
  _currentWorld = 'earth';

  // Reset globe layers
  globe.pointsData([]).ringsData([]).arcsData([]).labelsData([...OCEAN_LABELS]).polygonsData([]);

  // Reset HUD
  qs('#score-display').textContent = '0';
  updateRoundDisplay();
  updatePips(0, 'active');

  // Reset globe world texture back to earth
  const cfg = WORLD_CONFIG.earth;
  globe
    .globeImageUrl(cfg.globeImage)
    .bumpImageUrl(cfg.bumpImage)
    .showAtmosphere(cfg.atmosphere)
    .atmosphereColor(cfg.atmosphereColor)
    .atmosphereAltitude(cfg.atmosphereAlt);

  // Hide game-over
  const overlay = qs('#game-over');
  overlay.classList.remove('visible');
  overlay.setAttribute('hidden', '');

  // Show loading
  const loading = qs('#loading');
  qs('#loading-text').textContent = 'Loading practice puzzle…';
  loading.classList.remove('fade-out');
  loading.removeAttribute('hidden');

  loadPuzzle();
}

// ── Load puzzle ─────────────────────────────────────────────
async function loadPuzzle() {
  const date = randomPracticeDate();
  try {
    const puzzle = await fetchPuzzle(date);
    state.puzzle = puzzle;
    state.date   = puzzle.date;

    const loading = qs('#loading');
    loading.classList.add('fade-out');
    loading.addEventListener('transitionend', () => {
      loading.setAttribute('hidden', '');
    }, { once: true });

    setTimeout(() => showCluePanel(), 650);
  } catch (err) {
    console.error('Failed to load puzzle:', err);
    qs('#loading-text').textContent = 'Failed to load puzzle — please try again.';
  }
}

// ── Init ────────────────────────────────────────────────────
async function init() {
  initGlobe();

  qs('#confirm-btn').addEventListener('click', confirmGuess);
  qs('#next-btn').addEventListener('click', nextRound);
  qs('#hint-toggle').addEventListener('click', toggleHint);
  qs('#play-again-btn').addEventListener('click', resetGame);
  qs('#view-map-btn').addEventListener('click', () => {
    qs('#game-over').setAttribute('hidden', '');
    qs('#results-fab').removeAttribute('hidden');
  });
  qs('#results-fab').addEventListener('click', () => {
    qs('#results-fab').setAttribute('hidden', '');
    qs('#game-over').removeAttribute('hidden');
  });

  await loadPuzzle();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
