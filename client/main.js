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

function scoreEmoji(score) {
  if (score >= 900) return '🟢';
  if (score >= 700) return '🟡';
  if (score >= 400) return '🟠';
  if (score >   0) return '🔴';
  return '⚫';
}

function scoreQuality(score) {
  if (score >= 900) return ['Pinpoint', 'q-pinpoint'];
  if (score >= 700) return ['Close',    'q-close'];
  if (score >= 400) return ['Nearby',   'q-nearby'];
  if (score >   0) return ['Far',      'q-far'];
  return ['Miss', 'q-miss'];
}

function scoreGrade(total) {
  if (total >= 4500) return 'Navigator';
  if (total >= 3500) return 'Cartographer';
  if (total >= 2500) return 'Traveler';
  if (total >= 1500) return 'Explorer';
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
  const INCLINATION = 12; // gentle drift, not a dramatic sine wave
  const SPEED = 0.06;     // slow cruise

  const el = document.createElement('div');
  el.style.cssText = 'pointer-events:none;transform:translate(-50%,-50%);';
  el.innerHTML = UFO_SVG;

  const shadowEl = document.createElement('div');
  shadowEl.style.cssText = 'pointer-events:none;transform:translate(-50%,-50%);width:14px;height:5px;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,0.82) 0%,transparent 70%);';

  // Two entries: shadow on surface, UFO above
  const ufoData = [
    { lat: 0, lng: 0, el: shadowEl, alt: 0.001 },
    { lat: 0, lng: 0, el,           alt: 0.08  },
  ];
  let angle = 0;

  function tick() {
    angle += SPEED; // unbounded — no modulo so no antimeridian jump
    const lat = INCLINATION * Math.sin(angle * Math.PI / 180 * 0.6);
    const lng = angle % 360 - 180;
    ufoData[0].lat = ufoData[1].lat = lat;
    ufoData[0].lng = ufoData[1].lng = lng;
    globe.htmlElementsData([...ufoData]);
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
    .onGlobeClick(({ lat, lng }) => handleGlobeClick(lat, lng));

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

// ── Globe Click ────────────────────────────────────────────
function handleGlobeClick(lat, lng) {
  if (state.gameOver || !state.puzzle) return;

  // Replace any pending marker
  state.markers = state.markers.filter(m => m.id !== 'pending');
  state.pendingGuess = { lat, lng };
  state.markers.push({ id: 'pending', lat, lng, color: '#e89620', size: 0.25, altitude: 0.12 });
  globe.pointsData([...state.markers]);

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

  const { lat, lng } = state.pendingGuess;

  try {
    const { actual, distanceKm, score } = await revealLocation(state.date, state.round, lat, lng);

    // Record round result — include location metadata for analytics
    const emoji   = scoreEmoji(score);
    const country = actual.name.includes(',')
      ? actual.name.split(',').pop().trim()
      : actual.name;
    state.roundScores.push({ score, distanceKm, emoji, locationName: actual.name, country });

    // Upgrade pending → confirmed guess marker (drop altitude slightly)
    state.markers = state.markers.map(m =>
      m.id === 'pending' ? { ...m, id: `guess-${state.round}`, size: 0.2, altitude: 0.07 } : m
    );

    // Add actual-location marker
    state.markers.push({
      id: `actual-${state.round}`,
      lat: actual.lat, lng: actual.lng,
      color: '#00c9a7', size: 0.28, altitude: 0.06,
    });

    // Pulse ring at actual location
    state.rings.push({ lat: actual.lat, lng: actual.lng });
    globe.ringsData([...state.rings]);

    // Add arc
    state.arcs.push({
      startLat: lat, startLng: lng,
      endLat: actual.lat, endLng: actual.lng,
      color: d => d === state.arcs[state.arcs.length - 1]
        ? ['#e89620', '#00c9a7']
        : ['#e89620', '#00c9a7'],
    });
    // Simpler: store colors directly
    state.arcs[state.arcs.length - 1].color = ['#e89620', '#00c9a7'];

    // Add label
    state.labels.push({
      lat: actual.lat, lng: actual.lng,
      text: actual.name,
      color: '#00c9a7',
    });

    globe.pointsData([...state.markers]);
    globe.arcsData([...state.arcs]);
    globe.labelsData([...OCEAN_LABELS, ...state.labels]);

    // Fly to actual location and highlight its country
    globe.pointOfView({ lat: actual.lat, lng: actual.lng, altitude: 1.8 }, 1400);
    showCountryHighlight(country);

    // Update score
    const prevTotal = state.totalScore;
    state.totalScore += score;
    const scoreEl = qs('#score-display');
    scoreEl.classList.add('score-flash');
    setTimeout(() => scoreEl.classList.remove('score-flash'), 420);
    animateCounter(scoreEl, prevTotal, state.totalScore);

    updatePips(state.round, 'done');

    // Slide in score popup after fly-in
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
  const loc = state.puzzle.locations[state.round];

  qs('#round-number').textContent  = String(state.round + 1).padStart(2, '0');
  qs('#round-label').textContent   = `Round ${state.round + 1} of 5`;
  qs('#location-clue').textContent = loc.name;
  qs('#hint-toggle').setAttribute('hidden', '');
  qs('#hint-text').classList.remove('visible');
  qs('#hint-text').setAttribute('aria-hidden', 'true');
  qs('#guess-prompt').textContent  = window.matchMedia('(hover: none)').matches
    ? 'Tap the globe to place your guess'
    : 'Click the globe to place your guess';
  qs('#confirm-btn').setAttribute('hidden', '');
  qs('#confirm-btn').removeAttribute('disabled');
  qs('#confirm-btn').textContent   = 'Confirm Guess';

  state.hintVisible   = false;
  state.pendingGuess  = null;

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

// ── Game Over ──────────────────────────────────────────────
function showGameOver() {
  state.gameOver = true;

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
    `Score: ${state.totalScore}/5000`,
    `tapmap.gg`,
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
  Auth.saveScore(state.date, state.totalScore, state.roundScores).then(rank => {
    if (rank !== null) showRank(rank);
  });
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

    // Dismiss loading screen, then show auth modal if needed
    const loading = qs('#loading');
    loading.classList.add('fade-out');
    loading.addEventListener('transitionend', () => {
      loading.setAttribute('hidden', '');
      Auth.onGameReady(authUser);
    }, { once: true });

    // Show first clue after short delay (globe is animating in)
    setTimeout(() => showCluePanel(), 650);

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
