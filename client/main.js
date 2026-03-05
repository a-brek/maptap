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
  actuals:      [], // [{lat, lng, name}] — revealed correct locations
  guesses:      [], // [{lat, lng}] — confirmed guesses
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
  const INCLINATION = 8 + Math.random() * 20;      // random tilt 8°–28°
  const SPEED       = 0.04 + Math.random() * 0.05; // random speed each load

  const el = document.createElement('div');
  el.style.cssText = 'pointer-events:none;transform:translate(-50%,-50%);';
  el.innerHTML = UFO_SVG;

  const shadowEl = document.createElement('div');
  shadowEl.style.cssText = 'pointer-events:none;transform:translate(-50%,-50%);width:14px;height:5px;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,0.82) 0%,transparent 70%);';

  let angle = Math.random() * 360; // random starting position each load

  function tick() {
    angle += SPEED;
    const lat = INCLINATION * Math.sin(angle * Math.PI / 180 * 0.6);
    const lng = angle % 360 - 180;
    const htmlItems = [
      { lat, lng, el: shadowEl, alt: 0.001 },
      { lat, lng, el,           alt: 0.08  },
    ];
    globe.htmlElementsData(htmlItems);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}



// ── Iran–Israel Missile Conflict ──────────────────────────
const _IRAN   = { lat: 32.4, lng: 53.7 };
const _ISRAEL = { lat: 31.7, lng: 35.2 };

function _scatter(center, spread) {
  return center + (Math.random() - 0.5) * spread;
}

function spawnExplosion(lat, lng) {
  if (typeof THREE === 'undefined') return;
  const pos = globe.getCoords(lat, lng, 0.03);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xff8800, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 8), mat);
  mesh.position.set(pos.x, pos.y, pos.z);
  globe.scene().add(mesh);

  const t0 = performance.now();
  (function tick(now) {
    const t = Math.min((now - t0) / 500, 1);
    mesh.scale.setScalar(1 + t * 3);
    mat.opacity = 1 - t;
    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      globe.scene().remove(mesh);
      mesh.geometry.dispose();
      mat.dispose();
    }
  })(t0);
}

function spawnMissile(fromLat, fromLng, toLat, toLng, headColor) {
  if (typeof THREE === 'undefined') return;

  // Decode color components for trail vertex colors
  const r = ((headColor >> 16) & 0xff) / 255;
  const g = ((headColor >> 8)  & 0xff) / 255;
  const b = ((headColor)       & 0xff) / 255;

  // Missile head: large dim outer glow + small bright white core
  const outerMat = new THREE.MeshBasicMaterial({
    color: headColor, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const innerMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const outer = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), outerMat);
  const inner = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), innerMat);
  const head  = new THREE.Group();
  head.add(outer);
  head.add(inner);
  globe.scene().add(head);

  // Glowing trail — Line with vertex colors fading to black (= invisible with AdditiveBlending)
  const TRAIL = 28;
  const tPos = new Float32Array(TRAIL * 3);
  const tCol = new Float32Array(TRAIL * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  trailGeo.setAttribute('color',    new THREE.BufferAttribute(tCol, 3));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({
    vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  globe.scene().add(new THREE.Line(trailGeo, trailMat));
  const trailLine = globe.scene().children[globe.scene().children.length - 1];

  const history = [];
  const duration = 2200 + Math.random() * 1200;
  const t0 = performance.now();
  (function tick(now) {
    const t   = Math.min((now - t0) / duration, 1);
    const lat = fromLat + (toLat - fromLat) * t;
    const lng = fromLng + (toLng - fromLng) * t;
    const alt = 0.22 * Math.sin(t * Math.PI);
    const p   = globe.getCoords(lat, lng, alt);

    head.position.set(p.x, p.y, p.z);

    // Pulse the white core slightly
    const pulse = 0.85 + 0.15 * Math.sin(now * 0.03);
    inner.scale.setScalar(pulse);

    // Update trail history
    history.push({ x: p.x, y: p.y, z: p.z });
    if (history.length > TRAIL) history.shift();

    const count = history.length;
    for (let i = 0; i < count; i++) {
      const age = i / (count - 1 || 1); // 0=oldest(tail) → 1=newest(head)
      tPos[i * 3]     = history[i].x;
      tPos[i * 3 + 1] = history[i].y;
      tPos[i * 3 + 2] = history[i].z;
      // age² makes the fade hug tighter to the head
      tCol[i * 3]     = r * age * age;
      tCol[i * 3 + 1] = g * age * age;
      tCol[i * 3 + 2] = b * age * age;
    }
    trailGeo.setDrawRange(0, count);
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate    = true;

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      globe.scene().remove(head);
      globe.scene().remove(trailLine);
      outer.geometry.dispose(); outerMat.dispose();
      inner.geometry.dispose(); innerMat.dispose();
      trailGeo.dispose(); trailMat.dispose();
      spawnExplosion(toLat, toLng);
    }
  })(t0);
}

function startMissileConflict() {
  function iranFires() {
    spawnMissile(
      _scatter(_IRAN.lat,   3),   _scatter(_IRAN.lng,   4),
      _scatter(_ISRAEL.lat, 0.5), _scatter(_ISRAEL.lng, 0.7),
      0xff5500 // orange-red
    );
    setTimeout(iranFires, 700 + Math.random() * 1000);
  }
  function israelFires() {
    spawnMissile(
      _scatter(_ISRAEL.lat, 0.5), _scatter(_ISRAEL.lng, 0.7),
      _scatter(_IRAN.lat,   3),   _scatter(_IRAN.lng,   4),
      0x44ccff // cyan-blue
    );
    setTimeout(israelFires, 800 + Math.random() * 1100);
  }
  iranFires();
  setTimeout(israelFires, 350);
}

// ── Flat Earth Toggle ───────────────────────────────────────────
let _flatEarth  = false;
let _preFlatPov = null;

function toggleFlatEarth() {
  _flatEarth = !_flatEarth;
  const scene   = globe.scene();
  const startY  = scene.scale.y;
  const targetY = _flatEarth ? 0.016 : 1.0;
  const underside = qs('#flat-earth-underside');

  if (_flatEarth) {
    _preFlatPov = globe.pointOfView();
    globe.pointOfView({ lat: 89.9, lng: 0, altitude: 2.4 }, 1500);
    if (underside) underside.removeAttribute('hidden');
  } else {
    if (_preFlatPov) globe.pointOfView(_preFlatPov, 1500);
    if (underside) underside.setAttribute('hidden', '');
  }

  const t0 = performance.now();
  (function tick(now) {
    const t = Math.min((now - t0) / 1500, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    scene.scale.y = startY + (targetY - startY) * e;
    if (t < 1) requestAnimationFrame(tick);
  })(t0);

  const btn = qs('#flat-btn');
  if (btn) btn.title = _flatEarth ? 'Restore Earth' : 'Flat Earth Mode';
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
    .arcAltitude(d => d.altitude ?? 0.12)
    .arcDashLength(d => d.dashLength ?? 0.45)
    .arcDashGap(d => d.dashGap ?? 0.12)
    .arcDashAnimateTime(d => d.dashTime ?? 2400)
    .arcStroke(d => d.stroke ?? 0.4)
    .labelsData([])
    .labelLat('lat')
    .labelLng('lng')
    .labelText('text')
    .labelSize(d => d.isCountryName ? 0.28 : (d.ocean ? 0.55 : 0.75))
    .labelColor('color')
    .labelDotRadius(d => (d.ocean || d.isCountryName) ? 0 : 0.32)
    .labelIncludeDot(d => !d.ocean && !d.isCountryName)
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

function _polyRingCentroid(ring) {
  let x = 0, y = 0;
  for (const [lng, lat] of ring) { x += lng; y += lat; }
  return [x / ring.length, y / ring.length];
}

function _featureCentroid(feature) {
  try {
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      return _polyRingCentroid(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      let best = null, bestLen = 0;
      for (const poly of geom.coordinates) {
        if (poly[0].length > bestLen) { bestLen = poly[0].length; best = poly[0]; }
      }
      return best ? _polyRingCentroid(best) : null;
    }
  } catch (_) {}
  return null;
}

async function showAllCountryBordersAndNames() {
  try {
    const geo = await loadWorldGeo();

    // Build set of highlighted countries from all correct answers
    const highlightSet = new Set();
    state.roundScores.forEach(r => { if (r.country) highlightSet.add(r.country.toLowerCase()); });
    state.actuals.forEach(a => {
      const parts = a.name.split(',');
      const c = (parts.length > 1 ? parts[parts.length - 1].trim() : a.name).toLowerCase();
      highlightSet.add(c);
    });

    function isHighlighted(f) {
      const name = (f.properties.name || '').toLowerCase();
      for (const h of highlightSet) {
        if (name === h || name.includes(h) || h.includes(name)) return true;
      }
      return false;
    }

    // Country name labels from centroids
    const countryLabels = geo.features.map(f => {
      const c = _featureCentroid(f);
      if (!c) return null;
      return { lat: c[1], lng: c[0], text: f.properties.name, color: 'rgba(200,220,255,0.5)', isCountryName: true };
    }).filter(Boolean);

    globe.labelsData([...state.labels, ...countryLabels]);

    globe
      .polygonsData(geo.features)
      .polygonCapColor(f => isHighlighted(f) ? 'rgba(0,201,167,0.15)' : 'rgba(255,255,255,0.02)')
      .polygonSideColor(f => isHighlighted(f) ? 'rgba(0,201,167,0.08)' : 'rgba(255,255,255,0.01)')
      .polygonStrokeColor(f => isHighlighted(f) ? 'rgba(0,201,167,0.9)' : 'rgba(200,220,255,0.3)');

    // Re-apply after polygon update to keep markers/arcs on top
    globe.pointsData([...state.markers]);
    globe.arcsData([...state.arcs]);
    globe.ringsData([...state.rings]);
  } catch (err) {
    console.warn('Failed to show country borders:', err);
  }
}

// ── API ────────────────────────────────────────────────────
function localDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchPuzzle() {
  const res = await fetch(`/api/puzzle/${localDateStr()}`);
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
// ── Globe Click ────────────────────────────────────────────
function handleGlobeClick(lat, lng) {
  if (state.gameOver || !state.puzzle) return;

  // Replace any pending marker
  state.markers = state.markers.filter(m => m.id !== 'pending');
  state.pendingGuess = { lat, lng };
  // Start high — dropMarker will animate it down
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
      color: '#00c9a7', size: 0.28, altitude: 0.06,
    });
    state.guesses.push({ lat, lng });
    state.actuals.push({ lat: actual.lat, lng: actual.lng, name: actual.name });
    state.rings.push({ lat: actual.lat, lng: actual.lng });
    // Outer glow arc (wide, semi-transparent, static)
    state.arcs.push({
      startLat: lat, startLng: lng,
      endLat: actual.lat, endLng: actual.lng,
      color: ['rgba(232,150,32,0.22)', 'rgba(0,201,167,0.22)'],
      stroke: 1.9, altitude: 0.12, dashLength: 1, dashGap: 0, dashTime: 0,
    });
    // Bright animated traveler dot
    state.arcs.push({
      startLat: lat, startLng: lng,
      endLat: actual.lat, endLng: actual.lng,
      color: ['#e89620', '#00c9a7'],
      stroke: 0.38, altitude: 0.12, dashLength: 0.07, dashGap: 0.93, dashTime: 1600,
    });
    state.labels.push({ lat: actual.lat, lng: actual.lng, text: actual.name, color: '#00c9a7' });

    const world = state.puzzle.locations[state.round]?.world || 'earth';
    globe.pointsData([...state.markers]);
    globe.ringsData([...state.rings]);
    globe.arcsData([...state.arcs]);
    globe.labelsData([...state.labels]);
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
const LS_VERSION = '2';
(function clearIfStale() {
  try {
    if (localStorage.getItem('tapmap-version') !== LS_VERSION) {
      const toDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('tapmap-')) toDelete.push(k);
      }
      toDelete.forEach(k => localStorage.removeItem(k));
      localStorage.setItem('tapmap-version', LS_VERSION);
    }
  } catch (_) {}
})();

function pruneOldResults(todayStr) {
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('tapmap-result-') && !key.endsWith(todayStr)) {
        toDelete.push(key);
      }
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

function saveResultLocally() {
  try {
    localStorage.setItem(`tapmap-result-${state.date}`, JSON.stringify({
      version:     state.puzzleVersion,
      totalScore:  state.totalScore,
      roundScores: state.roundScores,
      guesses:     state.guesses,
      actuals:     state.actuals,
    }));
  } catch (_) {}
}

function loadResultLocally(date, version) {
  try {
    const raw = localStorage.getItem(`tapmap-result-${date}`);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== version) {
      localStorage.removeItem(`tapmap-result-${date}`);
      return null;
    }
    return saved;
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

  // Share text
  const scores = state.roundScores.map(r => r.score).join(' · ');
  const shareText = [
    `Tap Map ${state.date}`,
    scores,
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

  showAllCountryBordersAndNames();
  startCountdown();

  // Save score + show rank (async — updates UI when server responds)
  if (!skipSave) {
    Auth.saveScore(state.date, state.totalScore, state.roundScores, state.actuals, state.guesses).then(rank => {
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
    // Build next local midnight
    const midnight = new Date();
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    const diff = Math.max(0, midnight.getTime() - now);

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

  // Use native share sheet on mobile if available
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user dismissed — do nothing
    }
  }

  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Share Results'; }, 2000);
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
  globe.labelsData([...state.labels]);
}

// ── Init ───────────────────────────────────────────────────
async function init() {
  initGlobe();
  startMissileConflict();
  startUfoOrbit();

  // Wire up events
  qs('#confirm-btn').addEventListener('click', confirmGuess);
  qs('#next-btn').addEventListener('click', nextRound);
  qs('#hint-toggle').addEventListener('click', toggleHint);
  qs('#copy-btn').addEventListener('click', copyShareText);
  qs('#view-map-btn').addEventListener('click', () => {
    qs('#game-over').setAttribute('hidden', '');
    qs('#results-fab').removeAttribute('hidden');
  });
  qs('#results-fab').addEventListener('click', () => {
    qs('#results-fab').setAttribute('hidden', '');
    qs('#game-over').removeAttribute('hidden');
  });
  qs('#flat-btn')?.addEventListener('click', toggleFlatEarth);
  qs('#game-title').addEventListener('dblclick', toggleFlatEarth);

  // Auth init and puzzle fetch run in parallel
  try {
    const [authUser, puzzle] = await Promise.all([
      Auth.init(),
      fetchPuzzle(),
    ]);

    state.puzzle        = puzzle;
    state.date          = puzzle.date;
    state.puzzleVersion = puzzle.version || 1;

    pruneOldResults(puzzle.date);

    // Check if this puzzle was already completed today (local first, then server)
    let saved = loadResultLocally(puzzle.date, state.puzzleVersion);
    if (!saved && authUser) {
      const serverResult = await Auth.getTodayResult(puzzle.date);
      if (serverResult) {
        saved = {
          version:     state.puzzleVersion,
          totalScore:  serverResult.totalScore,
          roundScores: serverResult.roundScores,
          guesses:     serverResult.gameData?.guesses  ?? [],
          actuals:     serverResult.gameData?.actuals  ?? [],
        };
        // Persist locally so future loads skip the server round-trip
        try { localStorage.setItem(`tapmap-result-${puzzle.date}`, JSON.stringify(saved)); } catch (_) {}
      }
    }
    if (saved) {
      state.totalScore  = saved.totalScore;
      state.roundScores = saved.roundScores;
      state.guesses     = saved.guesses || [];
      state.actuals     = saved.actuals || [];
      state.round       = 5;

      // Restore markers, arcs, labels, rings on the globe
      saved.guesses?.forEach((g, i) => {
        const a = saved.actuals?.[i];
        state.markers.push({ id: `guess-${i}`,  lat: g.lat, lng: g.lng, color: '#e89620', size: 0.2,  altitude: 0.07 });
        if (a) {
          state.markers.push({ id: `actual-${i}`, lat: a.lat, lng: a.lng, color: '#00c9a7', size: 0.28, altitude: 0.06 });
          state.arcs.push(
            { startLat: g.lat, startLng: g.lng, endLat: a.lat, endLng: a.lng, color: ['rgba(232,150,32,0.22)', 'rgba(0,201,167,0.22)'], stroke: 1.9, altitude: 0.12, dashLength: 1, dashGap: 0, dashTime: 0 },
            { startLat: g.lat, startLng: g.lng, endLat: a.lat, endLng: a.lng, color: ['#e89620', '#00c9a7'], stroke: 0.38, altitude: 0.12, dashLength: 0.07, dashGap: 0.93, dashTime: 1600 },
          );
          state.labels.push({ lat: a.lat, lng: a.lng, text: a.name, color: '#00c9a7' });
          state.rings.push({ lat: a.lat, lng: a.lng });
        }
      });
    }

    // Dismiss loading screen, then show auth modal if needed
    const loading = qs('#loading');
    loading.classList.add('fade-out');
    loading.addEventListener('transitionend', () => {
      loading.setAttribute('hidden', '');
      Auth.onGameReady(authUser);
    }, { once: true });

    if (saved) {
      // Render restored markers
      globe.pointsData([...state.markers]);
      globe.arcsData([...state.arcs]);
      globe.ringsData([...state.rings]);
      globe.labelsData([...state.labels]);
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
