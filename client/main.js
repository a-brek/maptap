/* ============================================================
   Tap Map — Game Logic
   Globe: globe.gl (window.Globe via CDN)
   API:   /api/puzzle/*
   ============================================================ */

'use strict';

// ── State ──────────────────────────────────────────────────
const state = {
  puzzle:       null,   // { date, title, locations: [{name,story,hint}] }
  date:         null,   // "YYYY-MM-DD"
  round:        0,      // 0–4
  totalScore:   0,
  roundScores:  [],     // [{score, distanceKm, emoji}]
  pendingGuess: null,   // {lat, lng} — pending marker, not yet confirmed
  markers:      [],     // globe point data
  arcs:         [],     // globe arc data
  labels:       [],     // globe label data
  rings:        [],     // globe ring data
  gameOver:     false,
  hintVisible:  false,
};

let globe = null;
let _nextRoundTimer = null;
const AUTO_ADVANCE_MS = 5000; // ms before auto-advancing to next round

// ── Helpers ────────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }

// ── Sound Effects ──────────────────────────────────────────
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playTone(freq, type, gainVal, duration, delay = 0) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
    gain.gain.setValueAtTime(gainVal, ctx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
    osc.start(ctx.currentTime + delay);
    osc.stop(ctx.currentTime + delay + duration);
  } catch (_) {}
}

function soundConfirm() {
  playTone(440, 'sine', 0.15, 0.12);
}

function soundReveal(score) {
  if (score >= 90) {
    // Pinpoint — ascending triumphant chime
    playTone(523, 'sine', 0.18, 0.18, 0.00);
    playTone(659, 'sine', 0.18, 0.18, 0.12);
    playTone(784, 'sine', 0.22, 0.35, 0.24);
  } else if (score >= 70) {
    // Close — bright double tone
    playTone(523, 'sine', 0.18, 0.18, 0.00);
    playTone(659, 'sine', 0.18, 0.28, 0.14);
  } else if (score >= 40) {
    // Nearby — single mid tone
    playTone(440, 'sine', 0.16, 0.25, 0.00);
  } else if (score > 0) {
    // Far — descending tone
    playTone(330, 'sine', 0.14, 0.20, 0.00);
    playTone(262, 'sine', 0.12, 0.25, 0.15);
  } else {
    // Miss — low thud
    playTone(180, 'triangle', 0.18, 0.30, 0.00);
  }
}

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

// Smooth number counter animation
function animateCounter(el, from, to, duration = 700) {
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Ocean Labels (trash talk) ───────────────────────────────
const OCEAN_LABELS = [
  { ocean: true, lat:  5,  lng: -30,  text: 'ATLANTIC OCEAN\nskill issue tbh',        color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat: -5,  lng: -145, text: 'PACIFIC OCEAN\nyou would drown here',    color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat: -20, lng:  75,  text: 'INDIAN OCEAN\nnot even on the map lol',  color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat: -60, lng:   0,  text: 'SOUTHERN OCEAN\nyour score lives here',  color: 'rgba(100,180,255,0.28)' },
  { ocean: true, lat:  80, lng:   0,  text: 'ARCTIC OCEAN\ncold like ur geography',   color: 'rgba(100,180,255,0.28)' },
];

// ── UFO ────────────────────────────────────────────────────
const UFO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="13" viewBox="0 0 52 36" style="filter:drop-shadow(0 0 4px #7df)">
  <defs>
    <radialGradient id="domeGrad" cx="40%" cy="30%">
      <stop offset="0%" stop-color="#e0f8ff"/>
      <stop offset="100%" stop-color="#4ad" stop-opacity="0.7"/>
    </radialGradient>
    <radialGradient id="bodyGrad" cx="50%" cy="35%">
      <stop offset="0%" stop-color="#c8d8e8"/>
      <stop offset="100%" stop-color="#6688aa"/>
    </radialGradient>
  </defs>
  <!-- saucer body -->
  <ellipse cx="26" cy="22" rx="22" ry="8" fill="url(#bodyGrad)" stroke="#aac" stroke-width="0.8"/>
  <!-- rim glow -->
  <ellipse cx="26" cy="22" rx="22" ry="8" fill="none" stroke="rgba(130,220,255,0.5)" stroke-width="2"/>
  <!-- dome -->
  <ellipse cx="26" cy="17" rx="10" ry="9" fill="url(#domeGrad)" stroke="#9de" stroke-width="0.8"/>
  <!-- lights -->
  <circle class="ufo-l1" cx="10" cy="24" r="2.5" fill="#ff0" opacity="0.9"/>
  <circle class="ufo-l2" cx="19" cy="28" r="2.5" fill="#0ff" opacity="0.9"/>
  <circle class="ufo-l3" cx="26" cy="29" r="2.5" fill="#ff0" opacity="0.9"/>
  <circle class="ufo-l4" cx="33" cy="28" r="2.5" fill="#0ff" opacity="0.9"/>
  <circle class="ufo-l5" cx="42" cy="24" r="2.5" fill="#ff0" opacity="0.9"/>
</svg>`;

// ── Nuclear Mushroom Cloud (Iran) ──────────────────────────
const nukeEl = document.createElement('div');
nukeEl.style.cssText = 'pointer-events:none;transform:translate(-50%,-80%);';
nukeEl.innerHTML = `<img src="https://media.giphy.com/media/eCT0Q6KVM1772xHAE3/giphy.gif" width="30" height="30" style="display:block;" alt="">`;

const nukeData = [{ lat: 32.4, lng: 53.7, el: nukeEl, alt: 0.06 }];

// Blink the UFO lights via CSS in the main document
(function injectUfoStyle() {
  const s = document.createElement('style');
  s.textContent = `
    @keyframes ufo-blink-a { 0%,49%{opacity:0.9} 50%,100%{opacity:0.15} }
    @keyframes ufo-blink-b { 0%,49%{opacity:0.15} 50%,100%{opacity:0.9} }
    .ufo-l1,.ufo-l3,.ufo-l5 { animation: ufo-blink-a 0.8s infinite; }
    .ufo-l2,.ufo-l4          { animation: ufo-blink-b 0.8s infinite; }
  `;
  document.head.appendChild(s);
})();

function startUfoOrbit() {
  const INCLINATION = 12;
  const SPEED = 0.06;

  const el = document.createElement('div');
  el.style.cssText = 'pointer-events:none;transform:translate(-50%,-50%);';
  el.innerHTML = UFO_SVG;

  const shadowEl = document.createElement('div');
  shadowEl.style.cssText = 'pointer-events:none;transform:translate(-50%,-50%);width:14px;height:5px;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,0.82) 0%,transparent 70%);';

  let angle = 190; // starts over Western Europe

  function tick() {
    angle += SPEED;
    const lat = INCLINATION * Math.sin(angle * Math.PI / 180 * 0.6);
    const lng = angle % 360 - 180;
    globe.htmlElementsData([
      ...nukeData,
      { lat, lng, el: shadowEl, alt: 0.001 },
      { lat, lng, el,           alt: 0.08  },
    ]);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Globe Setup ────────────────────────────────────────────
function randomGlobeView(altitude = 2.2) {
  return {
    lat: Math.random() * 130 - 50,   // roughly -50 to +80 (avoids poles)
    lng: Math.random() * 360 - 180,
    altitude,
  };
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
    // Markers
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointRadius('size')
    .pointAltitude('altitude')
    // Rings
    .ringsData([])
    .ringLat('lat')
    .ringLng('lng')
    .ringColor(() => t => `rgba(0, 201, 167, ${(1 - t) * 0.8})`)
    .ringMaxRadius(4)
    .ringPropagationSpeed(1.4)
    .ringRepeatPeriod(2000)
    // Arcs
    .arcsData([])
    .arcStartLat('startLat')
    .arcStartLng('startLng')
    .arcEndLat('endLat')
    .arcEndLng('endLng')
    .arcColor('color')
    .arcDashLength(0.45)
    .arcDashGap(0.12)
    .arcDashAnimateTime(2400)
    .arcStroke(0.45)
    // Labels (ocean labels + game labels merged; ocean labels have no dot)
    .labelsData([...OCEAN_LABELS])
    .labelLat('lat')
    .labelLng('lng')
    .labelText('text')
    .labelSize(d => d.ocean ? 0.55 : 0.75)
    .labelColor('color')
    .labelDotRadius(d => d.ocean ? 0 : 0.32)
    .labelIncludeDot(d => !d.ocean)
    .labelAltitude(0.025)
    .labelResolution(3)
    // HTML elements (UFO)
    .htmlElementsData([])
    .htmlLat('lat')
    .htmlLng('lng')
    .htmlAltitude('alt')
    .htmlElement('el')
    // Country polygons (for post-reveal highlight)
    .polygonsData([])
    .polygonCapColor(() => 'rgba(0, 201, 167, 0.10)')
    .polygonSideColor(() => 'rgba(0, 201, 167, 0.06)')
    .polygonStrokeColor(() => 'rgba(0, 201, 167, 0.75)')
    .polygonAltitude(0.007)
    // Interaction
    .onGlobeClick(({ lat, lng }) => handleGlobeClick(lat, lng))
    .onZoom(({ altitude }) => {
      const img = nukeEl.querySelector('img');
      if (img) {
        const size = Math.round(Math.max(8, Math.min(90, 30 * 2.2 / altitude)));
        img.width = size;
        img.height = size;
      }
    });

  globe.pointOfView(randomGlobeView());

  window.addEventListener('resize', () => {
    globe.width(container.clientWidth).height(container.clientHeight);
  });
}

// ── Country Highlight ──────────────────────────────────────

// Some location name suffixes don't map 1:1 to GeoJSON country names
const COUNTRY_ALIASES = {
  'england':          'united kingdom',
  'scotland':         'united kingdom',
  'wales':            'united kingdom',
  'northern ireland': 'united kingdom',
  'united states':    'united states of america',
  'usa':              'united states of america',
  'north korea':      "democratic people's republic of korea",
  'south korea':      'republic of korea',
  'czech republic':   'czechia',
  'ivory coast':      "côte d'ivoire",
  'burma':            'myanmar',
  'tibet':            'china',
};

let _worldGeoCache = null;

async function loadWorldGeo() {
  if (_worldGeoCache) return _worldGeoCache;
  const res = await fetch(
    'https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson'
  );
  _worldGeoCache = await res.json();
  return _worldGeoCache;
}

function findCountry(geo, rawName) {
  const key  = (COUNTRY_ALIASES[rawName.toLowerCase()] ?? rawName).toLowerCase();
  return geo.features.find(f => {
    const n = (f.properties.name ?? '').toLowerCase();
    return n === key || n.includes(key) || key.includes(n);
  }) ?? null;
}

async function showCountryHighlight(countryName) {
  try {
    const geo     = await loadWorldGeo();
    const feature = findCountry(geo, countryName);
    if (feature) globe.polygonsData([feature]);
  } catch (err) {
    console.warn('Country highlight failed:', err);
  }
}

function clearCountryHighlight() {
  globe.polygonsData([]);
}

// ── API ────────────────────────────────────────────────────
async function fetchPuzzle() {
  const res = await fetch('/api/puzzle/today');
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
  return res.json(); // { actual: {lat,lng,name}, distanceKm, score }
}

// ── Marker Drop Animation ──────────────────────────────────
function dropMarker(markerId, targetAlt, onLand) {
  const START_ALT = 1.6;
  const DURATION  = 520;
  const start     = performance.now();

  function tick(now) {
    const t     = Math.min((now - start) / DURATION, 1);
    const eased = t * t * t; // ease-in cubic — gravity feel
    const alt   = START_ALT + (targetAlt - START_ALT) * eased;

    state.markers = state.markers.map(m =>
      m.id === markerId ? { ...m, altitude: alt } : m
    );
    globe.pointsData([...state.markers]);

    if (t < 1) {
      requestAnimationFrame(tick);
    } else if (onLand) {
      onLand();
    }
  }
  requestAnimationFrame(tick);
}

// ── Globe Click ────────────────────────────────────────────
function handleGlobeClick(lat, lng) {
  if (state.gameOver || !state.puzzle) return;

  // Replace any pending marker
  state.markers = state.markers.filter(m => m.id !== 'pending');
  state.pendingGuess = { lat, lng };
  // Start high — dropMarker will animate it down
  state.markers.push({ id: 'pending', lat, lng, color: '#e89620', size: 0.25, altitude: 1.6 });
  globe.pointsData([...state.markers]);
  dropMarker('pending', 0.12);

  // Reveal confirm button
  const btn = qs('#confirm-btn');
  btn.removeAttribute('hidden');
  qs('#guess-prompt').textContent = 'Adjust or confirm your guess';
}

// ── Confirm Guess ──────────────────────────────────────────
async function confirmGuess() {
  if (!state.pendingGuess) return;

  const btn = qs('#confirm-btn');
  btn.setAttribute('disabled', '');
  btn.textContent = 'Submitting…';
  soundConfirm();

  const { lat, lng } = state.pendingGuess;

  try {
    const { actual, distanceKm, score } = await revealLocation(state.date, state.round, lat, lng);
    soundReveal(score);

    // Record round result — include location metadata for analytics
    const emoji   = scoreEmoji(score);
    const country = actual.name.includes(',')
      ? actual.name.split(',').pop().trim()
      : actual.name;
    state.roundScores.push({ score, distanceKm, emoji, locationName: actual.name, country });

    // Upgrade pending → confirmed guess marker
    state.markers = state.markers.map(m =>
      m.id === 'pending' ? { ...m, id: `guess-${state.round}`, size: 0.2, altitude: 0.07 } : m
    );
    globe.pointsData([...state.markers]);

    // Fly globe toward actual location while UFO is en route
    globe.pointOfView({ lat: actual.lat, lng: actual.lng, altitude: 1.8 }, 1200);

    // Drop the actual-location pin from space, then trigger ring on land
    const actualId = `actual-${state.round}`;
    state.markers.push({
      id: actualId,
      lat: actual.lat, lng: actual.lng,
      color: '#00c9a7', size: 0.28, altitude: 1.6,
    });
    dropMarker(actualId, 0.06, () => {
      state.rings.push({ lat: actual.lat, lng: actual.lng });
      globe.ringsData([...state.rings]);
    });
    state.arcs.push({
      startLat: lat, startLng: lng,
      endLat: actual.lat, endLng: actual.lng,
      color: ['#e89620', '#00c9a7'],
    });
    state.labels.push({ lat: actual.lat, lng: actual.lng, text: actual.name, color: '#00c9a7' });

    const world = state.puzzle.locations[state.round]?.world || 'earth';
    globe.pointsData([...state.markers]);
    globe.arcsData([...state.arcs]);
    globe.labelsData([
      ...(WORLD_CONFIG[world]?.showOceans ? OCEAN_LABELS : []),
      ...state.labels,
    ]);
    if (world === 'earth') showCountryHighlight(country);

    // Update score display immediately
    const prevTotal = state.totalScore;
    state.totalScore += score;
    const scoreEl = qs('#score-display');
    scoreEl.classList.add('score-flash');
    setTimeout(() => scoreEl.classList.remove('score-flash'), 420);
    animateCounter(scoreEl, prevTotal, state.totalScore);

    updatePips(state.round, 'done');

    // Score popup after fly-in
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

// ── Clue Panel ─────────────────────────────────────────────
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

  state.hintVisible   = false;
  state.pendingGuess  = null;

  setGlobeWorld(world);
  clearCountryHighlight();

  updateRoundDisplay();
  updatePips(state.round, 'active');

  const panel = qs('#clue-panel');
  panel.classList.add('visible');
}

function hideCluePanel() {
  qs('#clue-panel').classList.remove('visible');
}

// ── Score Popup ────────────────────────────────────────────
function showScorePopup(score, distanceKm, actual) {
  const [label, cls] = scoreQuality(score);

  qs('#popup-score').textContent    = `+${score}`;
  qs('#popup-distance').textContent = distanceKm < 2
    ? 'Basically spot on!'
    : `${distanceKm.toLocaleString()} km away`;
  qs('#popup-location').textContent = actual.name;

  const qEl = qs('#popup-quality');
  qEl.textContent  = label;
  qEl.className    = `quality ${cls}`;

  const isLast = state.round >= 4;
  qs('#next-btn').textContent = isLast ? 'View Results →' : 'Next Location →';

  // Restart the countdown bar animation
  const bar = qs('#popup-timer-bar');
  bar.style.animation = 'none';
  bar.offsetHeight; // force reflow so animation restarts cleanly
  bar.style.animation = `timerDrain ${AUTO_ADVANCE_MS}ms linear forwards`;

  // Auto-advance after delay; button click also works as an early skip
  clearTimeout(_nextRoundTimer);
  _nextRoundTimer = setTimeout(nextRound, AUTO_ADVANCE_MS);

  const popup = qs('#score-popup');
  popup.classList.add('visible');
}

function hideScorePopup() {
  clearTimeout(_nextRoundTimer);
  _nextRoundTimer = null;
  qs('#score-popup').classList.remove('visible');
}

// ── HUD Updates ────────────────────────────────────────────
function updateRoundDisplay() {
  qs('#round-display').textContent = `${state.round + 1} / 5`;
}

function updatePips(activeIndex, activeState) {
  qs('#round-pips').querySelectorAll('.pip').forEach((pip, i) => {
    if (i < activeIndex)       pip.className = 'pip done';
    else if (i === activeIndex) pip.className = `pip ${activeState}`;
    else                        pip.className = 'pip';
  });
}

// ── Hint Toggle ────────────────────────────────────────────
function toggleHint() {
  state.hintVisible = !state.hintVisible;
  const hintEl   = qs('#hint-text');
  const toggleEl = qs('#hint-toggle');

  hintEl.classList.toggle('visible', state.hintVisible);
  hintEl.setAttribute('aria-hidden', String(!state.hintVisible));
  toggleEl.textContent = state.hintVisible ? 'Hide Hint' : 'Show Hint';
  toggleEl.setAttribute('aria-expanded', String(state.hintVisible));
}

// ── Next Round ─────────────────────────────────────────────
function nextRound() {
  hideScorePopup();
  state.round += 1;

  setTimeout(() => {
    if (state.round >= 5) {
      showGameOver();
    } else {
      showCluePanel();
    }
  }, 320);
}

// ── localStorage persistence ───────────────────────────────
function saveResultLocally() {
  try {
    localStorage.setItem(`tapmap-result-${state.date}`, JSON.stringify({
      totalScore:  state.totalScore,
      roundScores: state.roundScores,
    }));
  } catch (_) {}
}

function loadResultLocally(date) {
  try {
    const raw = localStorage.getItem(`tapmap-result-${date}`);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

// ── Game Over ──────────────────────────────────────────────
function showGameOver(skipSave = false) {
  state.gameOver = true;

  if (!skipSave) saveResultLocally();

  qs('#final-score').textContent = state.totalScore.toLocaleString();
  qs('#score-grade').textContent = scoreGrade(state.totalScore);

  // Breakdown rows
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

  // Share text (Wordle-style)
  const grid = state.roundScores.map(r => r.emoji).join('');
  const shareText = [
    `Tap Map ${state.date}`,
    grid,
    `tapmap.onrender.com`,
    `Total Score: ${state.totalScore}/500`,
  ].join('\n');
  qs('#share-text').textContent = shareText;

  // Show overlay
  const overlay = qs('#game-over');
  overlay.removeAttribute('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => overlay.classList.add('visible'));
  });

  startCountdown();

  // Save score + show rank (async — updates UI when server responds)
  if (!skipSave) {
    Auth.saveScore(state.date, state.totalScore, state.roundScores).then(rank => {
      if (rank !== null) showRank(rank);
    });
  }
}

function showRank(rank) {
  const el = qs('#player-rank');
  if (!el) return;
  const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
  el.textContent = `#${rank}${suffix} today`;
  el.removeAttribute('hidden');
}

// ── Countdown to Next Puzzle ───────────────────────────────
function startCountdown() {
  function update() {
    const now      = Date.now();
    const midnight = new Date();
    midnight.setUTCHours(24, 0, 0, 0);
    const diff = midnight.getTime() - now;

    const h = String(Math.floor(diff / 3_600_000)).padStart(2, '0');
    const m = String(Math.floor((diff % 3_600_000) / 60_000)).padStart(2, '0');
    const s = String(Math.floor((diff % 60_000) / 1_000)).padStart(2, '0');

    qs('#next-puzzle-countdown').textContent = `${h}:${m}:${s}`;
  }
  update();
  setInterval(update, 1000);
}

// ── Copy Share Text ────────────────────────────────────────
async function copyShareText() {
  const text = qs('#share-text').textContent;
  const btn  = qs('#copy-btn');

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for browsers without clipboard API
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy Results'; }, 2000);
}

// ── World Switching ────────────────────────────────────────
// Texture base URLs
const _TX  = 'https://cdn.jsdelivr.net/gh/jeromeetienne/threex.planets@master/images/';
const _SSC = 'https://www.solarsystemscope.com/textures/download/';

const WORLD_CONFIG = {
  // ── Inner Solar System ──────────────────────────────────
  earth: {
    label:          '🌍 Earth',
    globeImage:     'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
    bumpImage:      'https://unpkg.com/three-globe/example/img/earth-topology.png',
    atmosphere:     true,
    atmosphereColor:'rgba(100, 160, 255, 0.3)',
    atmosphereAlt:  0.16,
    showOceans:     true,
  },
  moon: {
    label:          '🌕 Moon',
    globeImage:     `${_TX}moonmap1k.jpg`,
    bumpImage:      `${_TX}moonbump1k.jpg`,
    atmosphere:     false,
    atmosphereColor:'rgba(0,0,0,0)',
    atmosphereAlt:  0.01,
    showOceans:     false,
  },
  mars: {
    label:          '🔴 Mars',
    globeImage:     `${_TX}marsmap1k.jpg`,
    bumpImage:      `${_TX}marsbump1k.jpg`,
    atmosphere:     true,
    atmosphereColor:'rgba(200, 120, 80, 0.25)',
    atmosphereAlt:  0.08,
    showOceans:     false,
  },
  mercury: {
    label:          '🪨 Mercury',
    globeImage:     `${_TX}mercurymap1k.jpg`,
    bumpImage:      `${_TX}mercurybump1k.jpg`,
    atmosphere:     false,
    atmosphereColor:'rgba(0,0,0,0)',
    atmosphereAlt:  0.01,
    showOceans:     false,
  },
  venus: {
    label:          '🌫️ Venus',
    globeImage:     `${_TX}venusmap1k.jpg`,
    bumpImage:      null,
    atmosphere:     true,
    atmosphereColor:'rgba(255, 200, 80, 0.35)',
    atmosphereAlt:  0.22,
    showOceans:     false,
  },
  // ── Jupiter System ──────────────────────────────────────
  io: {
    label:          '🟡 Io',
    globeImage:     `${_SSC}2k_io.jpg`,
    bumpImage:      null,
    atmosphere:     false,
    atmosphereColor:'rgba(255, 210, 60, 0.1)',
    atmosphereAlt:  0.02,
    showOceans:     false,
  },
  europa: {
    label:          '🧊 Europa',
    globeImage:     `${_SSC}2k_europa.jpg`,
    bumpImage:      null,
    atmosphere:     false,
    atmosphereColor:'rgba(180, 220, 255, 0.08)',
    atmosphereAlt:  0.02,
    showOceans:     false,
  },
  ganymede: {
    label:          '🌑 Ganymede',
    globeImage:     `${_SSC}2k_ganymede.jpg`,
    bumpImage:      null,
    atmosphere:     false,
    atmosphereColor:'rgba(0,0,0,0)',
    atmosphereAlt:  0.01,
    showOceans:     false,
  },
  callisto: {
    label:          '🌑 Callisto',
    globeImage:     `${_SSC}2k_callisto.jpg`,
    bumpImage:      null,
    atmosphere:     false,
    atmosphereColor:'rgba(0,0,0,0)',
    atmosphereAlt:  0.01,
    showOceans:     false,
  },
  // ── Saturn System ───────────────────────────────────────
  titan: {
    label:          '🟠 Titan',
    globeImage:     `${_SSC}2k_titan.jpg`,
    bumpImage:      null,
    atmosphere:     true,
    atmosphereColor:'rgba(210, 140, 60, 0.4)',
    atmosphereAlt:  0.18,
    showOceans:     false,
  },
  // ── Other Notable Bodies ────────────────────────────────
  pluto: {
    label:          '🌐 Pluto',
    globeImage:     `${_SSC}2k_eris_fictional.jpg`,
    bumpImage:      null,
    atmosphere:     false,
    atmosphereColor:'rgba(0,0,0,0)',
    atmosphereAlt:  0.01,
    showOceans:     false,
  },
};

let _currentWorld = 'earth';

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

  // Ocean labels only make sense on Earth
  globe.labelsData(cfg.showOceans ? [...OCEAN_LABELS, ...state.labels] : [...state.labels]);
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  initGlobe();
  startUfoOrbit();

  // Wire up events
  qs('#confirm-btn').addEventListener('click', confirmGuess);
  qs('#next-btn').addEventListener('click', nextRound);
  qs('#hint-toggle').addEventListener('click', toggleHint);
  qs('#copy-btn').addEventListener('click', copyShareText);

  // Auth init and puzzle fetch run in parallel
  try {
    const [authUser, puzzle] = await Promise.all([
      Auth.init(),
      fetchPuzzle(),
    ]);

    state.puzzle = puzzle;
    state.date   = puzzle.date;

    // Check if this puzzle was already completed today
    const saved = loadResultLocally(puzzle.date);
    if (saved) {
      state.totalScore  = saved.totalScore;
      state.roundScores = saved.roundScores;
      state.round       = 5;
    }

    // Dismiss loading screen, then show auth modal if needed
    const loading = qs('#loading');
    loading.classList.add('fade-out');
    loading.addEventListener('transitionend', () => {
      loading.setAttribute('hidden', '');
      Auth.onGameReady(authUser);
    }, { once: true });

    if (saved) {
      // Already played — go straight to results
      setTimeout(() => showGameOver(true), 650);
    } else {
      // Show first clue after short delay (globe is animating in)
      setTimeout(() => showCluePanel(), 650);
    }

  } catch (err) {
    console.error('Failed to load puzzle:', err);
    qs('#loading-text').textContent = 'Failed to load puzzle — please refresh.';
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
