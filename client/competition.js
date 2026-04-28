'use strict';

// ── Helpers ────────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }

// ── Avatars ────────────────────────────────────────────────
const AVATAR_SEEDS = [
  'felix','aneka','oliver','orion','luna','nova','atlas','echo',
  'rio','max','sage','rebel','ace','flash','neo','storm',
  'raven','blaze','zen','kit','wolf','fox','crow','jay',
];
const AVATAR_STYLES = ['pixel-art', 'bottts', 'adventurer', 'big-ears'];

// Interleave styles so you see variety immediately
const AVATARS = [];
for (let i = 0; i < AVATAR_SEEDS.length; i++) {
  for (const style of AVATAR_STYLES) {
    AVATARS.push({ style, seed: AVATAR_SEEDS[i] });
  }
}

function avatarUrl(avatar) {
  if (!avatar) return avatarUrl({ style: 'pixel-art', seed: 'felix' });
  const { style, seed } = typeof avatar === 'string'
    ? { style: 'pixel-art', seed: avatar }  // backwards compat
    : avatar;
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&size=64`;
}

// ── State ──────────────────────────────────────────────────
const state = {
  socket:         null,
  roomCode:       null,
  isHost:         false,
  mySocketId:     null,
  displayName:    null,
  avatar:         AVATARS[0],
  round:          -1,
  totalScore:     0,
  roundActive:    false,
  guessSubmitted: false,
  pendingGuess:   null,
  roundEndAt:     null,
  timerInterval:  null,
  markers:        [],
  arcs:           [],
  rings:          [],
  labels:         [],
  currentWorld:   'earth',
};

let globe = null;

// ── Globe Setup ─────────────────────────────────────────────
function randomGlobeView(altitude = 2.2) {
  return {
    lat: Math.random() * 130 - 50,
    lng: Math.random() * 360 - 180,
    altitude,
  };
}

const WORLD_CONFIG = {
  earth:    { texture: '/textures/natural-earth3-8k.jpg', atmosphere: 'rgba(50, 130, 255, 0.95)', atmosphereAlt: 0.32 },
  moon:     { texture: '/textures/moon-8k.jpg',          atmosphere: 'rgba(180,160,120,0.0)',    atmosphereAlt: 0.01 },
  mars:     { texture: '/textures/mars-8k.jpg',          atmosphere: 'rgba(200,100,50,0.45)',    atmosphereAlt: 0.12 },
};

function setGlobeWorld(world) {
  if (!globe) return;
  const cfg = WORLD_CONFIG[world] || WORLD_CONFIG.earth;
  if (state.currentWorld !== world) {
    state.currentWorld = world;
    globe.globeImageUrl(cfg.texture);
    globe.atmosphereColor(cfg.atmosphere);
    globe.atmosphereAltitude(cfg.atmosphereAlt);
  }
}

function initGlobe() {
  const container = qs('#globe-container');

  globe = Globe({ animateIn: false })(container)
    .width(container.clientWidth)
    .height(container.clientHeight)
    .globeImageUrl('/textures/natural-earth3-8k.jpg')
    .backgroundImageUrl('/textures/stars-milkyway-8k.jpg')
    .atmosphereColor('rgba(50, 130, 255, 0.95)')
    .atmosphereAltitude(0.32)
    .pointsData([])
    .pointLat('lat')
    .pointLng('lng')
    .pointColor('color')
    .pointRadius('size')
    .pointAltitude('altitude')
    .ringsData([])
    .ringLat('lat')
    .ringLng('lng')
    .ringColor(() => t => `rgba(0, 201, 167, ${(1 - t) * 0.8})`)
    .ringMaxRadius(4)
    .ringPropagationSpeed(1.4)
    .ringRepeatPeriod(2000)
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
    .labelSize(0.75)
    .labelColor('color')
    .labelDotRadius(0.32)
    .labelIncludeDot(true)
    .labelAltitude(0.025)
    .labelResolution(3)
    .polygonsData([])
    .polygonCapColor(() => 'rgba(0, 201, 167, 0.10)')
    .polygonSideColor(() => 'rgba(0, 201, 167, 0.06)')
    .polygonStrokeColor(() => 'rgba(0, 201, 167, 0.75)')
    .polygonAltitude(0.007)
    .onGlobeClick(({ lat, lng }) => handleGlobeClick(lat, lng));

  globe.pointOfView(randomGlobeView());

  const renderer = globe.renderer();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  globe.width(container.clientWidth).height(container.clientHeight);

  window.addEventListener('resize', () => {
    globe.width(container.clientWidth).height(container.clientHeight);
  });
}

// ── Globe interaction ───────────────────────────────────────
function handleGlobeClick(lat, lng) {
  if (!state.roundActive || state.guessSubmitted) return;
  state.pendingGuess = { lat, lng };

  state.markers = [{
    lat, lng,
    color:    '#00c9a7',
    size:     0.45,
    altitude: 0.02,
  }];
  globe.pointsData(state.markers);

  qs('#confirm-btn').removeAttribute('hidden');
}

function confirmGuess() {
  if (!state.pendingGuess || state.guessSubmitted) return;
  state.guessSubmitted = true;
  state.socket.emit('game:guess', { lat: state.pendingGuess.lat, lng: state.pendingGuess.lng });

  const btn = qs('#confirm-btn');
  btn.textContent = 'Guess submitted!';
  btn.setAttribute('disabled', '');
  btn.style.opacity = '0.6';
}

// ── Timer ──────────────────────────────────────────────────
function startCountdown() {
  clearInterval(state.timerInterval);
  state.timerInterval = setInterval(() => {
    if (!state.roundEndAt) return;
    const secsLeft = Math.max(0, Math.ceil((state.roundEndAt - Date.now()) / 1000));
    const el = qs('#timer-display');
    if (el) {
      el.textContent = secsLeft;
      el.classList.toggle('urgent', secsLeft <= 3);
    }
  }, 100);
}

function stopCountdown() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

// ── Lobby UI ────────────────────────────────────────────────
function renderPlayerList(players) {
  const ul = qs('#player-list');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.classList.toggle('is-host', p.isHost);
    li.classList.toggle('is-you', p.socketId === state.mySocketId);
    const avatarImg = p.avatar ? `<img class="player-avatar" src="${avatarUrl(p.avatar)}" alt="" />` : '';
    let html = avatarImg + escapeHtml(p.displayName);
    if (p.isHost) html += ' <span class="player-host-badge">Host</span>';
    if (p.socketId === state.mySocketId) html += ' <span style="font-size:9px;color:var(--teal)">(you)</span>';
    li.innerHTML = html;
    ul.appendChild(li);
  }
  qs('#waiting-status').textContent = `${players.length} player${players.length !== 1 ? 's' : ''} in lobby`;
}

function showLobbyWaiting(code, players, isHost, roomName) {
  state.roomCode = code;
  state.isHost   = isHost;
  qs('#lobby-join-form').classList.add('hidden-form');
  qs('#lobby-waiting').classList.add('visible');
  qs('#room-code-display').textContent = code;
  qs('#room-name-display').textContent = roomName || '';
  renderPlayerList(players);
  const startBtn = qs('#start-btn');
  if (isHost) {
    startBtn.removeAttribute('hidden');
  } else {
    startBtn.setAttribute('hidden', '');
  }
}

function setLobbyError(msg) {
  qs('#lobby-error').textContent = msg || '';
}

// ── Game UI ─────────────────────────────────────────────────
function showGameUI() {
  qs('#lobby').setAttribute('hidden', '');
  qs('#hud').removeAttribute('hidden');
}

function startRoundUI(data) {
  const { round, total, cityName, world, duration } = data;
  state.round          = round;
  state.roundActive    = true;
  state.guessSubmitted = false;
  state.pendingGuess   = null;
  state.roundEndAt     = Date.now() + duration;

  // Reset globe state
  state.markers = [];
  state.arcs    = [];
  state.rings   = [];
  globe.pointsData([]);
  globe.arcsData([]);
  globe.ringsData([]);

  setGlobeWorld(world);

  // Update clue panel
  qs('#clue-panel').removeAttribute('hidden');
  qs('#round-number').textContent = String(round + 1).padStart(2, '0');
  qs('#round-label').textContent = `Round ${round + 1} of ${total}`;
  qs('#round-display').textContent = `${round + 1} / ${total}`;
  qs('#location-clue').textContent = cityName;
  qs('#location-sub').textContent = world !== 'earth' ? `Somewhere on ${world.charAt(0).toUpperCase() + world.slice(1)}` : 'Where in the world?';
  qs('#guess-prompt').textContent = 'Click the globe to place your guess';

  const btn = qs('#confirm-btn');
  btn.setAttribute('hidden', '');
  btn.removeAttribute('disabled');
  btn.textContent = 'Confirm Guess';
  btn.style.opacity = '';

  qs('#timer-display').textContent = Math.ceil(duration / 1000);
  qs('#timer-display').classList.remove('urgent');

  startCountdown();
}

function showRoundResults(data) {
  state.roundActive = false;
  stopCountdown();

  const { round, actual, results } = data;

  // Pin actual location on globe
  const actualMarker = { lat: actual.lat, lng: actual.lng, color: '#f4b942', size: 0.55, altitude: 0.02 };
  const markers = [actualMarker];

  // Draw arc from my guess to actual
  const myResult = results.find(r => r.socketId === state.mySocketId);
  if (myResult?.roundScore?.guess) {
    const g = myResult.roundScore.guess;
    markers.push({ lat: g.lat, lng: g.lng, color: '#00c9a7', size: 0.4, altitude: 0.02 });
    state.arcs = [{
      startLat: g.lat, startLng: g.lng,
      endLat: actual.lat, endLng: actual.lng,
      color: ['rgba(0,201,167,0.7)', 'rgba(244,185,66,0.7)'],
    }];
    globe.arcsData(state.arcs);
  }

  globe.pointsData(markers);
  globe.ringsData([{ lat: actual.lat, lng: actual.lng }]);

  // Pan globe to actual location
  globe.pointOfView({ lat: actual.lat, lng: actual.lng, altitude: 1.8 }, 800);

  // Update score display
  if (myResult) {
    state.totalScore = myResult.totalScore;
    qs('#score-display').textContent = state.totalScore;
  }

  // Build results table
  const tbody = qs('#results-tbody');
  tbody.innerHTML = '';
  results.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.classList.toggle('is-me', r.socketId === state.mySocketId);
    const rs = r.roundScore;
    const noGuess = rs.noGuess;
    const av = r.avatar ? `<img class="result-avatar" src="${avatarUrl(r.avatar)}" alt="" />` : '';
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${av}${escapeHtml(r.displayName)}</td>
      <td class="${noGuess ? 'no-guess' : ''}">${noGuess ? '—' : rs.accuracyScore}</td>
      <td class="${noGuess ? 'no-guess' : ''}">${noGuess ? '—' : '+' + rs.speedBonus}</td>
      <td class="${noGuess ? 'no-guess' : ''}">${noGuess ? 'No guess' : rs.total}</td>
      <td class="score-total">${r.totalScore}</td>
    `;
    tbody.appendChild(tr);
  });

  qs('#results-round-title').textContent = `Round ${round + 1} Results`;
  qs('#results-location-name').textContent = data.actual.name;
  qs('#clue-panel').setAttribute('hidden', '');
  qs('#round-results').removeAttribute('hidden');
}

function showFinalStandings(data) {
  qs('#round-results').setAttribute('hidden', '');
  qs('#hud').setAttribute('hidden', '');
  qs('#clue-panel').setAttribute('hidden', '');

  const { finalStandings } = data;
  const podium = qs('#podium-row');
  podium.innerHTML = '';

  finalStandings.forEach((p, i) => {
    const div = document.createElement('div');
    div.classList.add('podium-entry');
    if (i === 0) div.classList.add('rank-1');
    else if (i === 1) div.classList.add('rank-2');
    else if (i === 2) div.classList.add('rank-3');
    if (p.socketId === state.mySocketId) div.classList.add('is-me');
    const medals = ['🥇', '🥈', '🥉'];
    const av = p.avatar ? `<img class="podium-avatar" src="${avatarUrl(p.avatar)}" alt="" />` : '';
    div.innerHTML = `
      <div class="podium-rank">${medals[i] || i + 1}</div>
      ${av}
      <div class="podium-name">${escapeHtml(p.displayName)}${p.socketId === state.mySocketId ? ' <span style="font-size:9px;color:var(--teal)">(you)</span>' : ''}</div>
      <div class="podium-score">${p.totalScore}</div>
    `;
    podium.appendChild(div);
  });

  qs('#comp-game-over').removeAttribute('hidden');
}

// ── Guest notification ──────────────────────────────────────
function showGuessNotification(displayName) {
  const ticker = qs('#guess-ticker');
  const el = document.createElement('div');
  el.className = 'guess-notification';
  el.textContent = `${displayName} guessed!`;
  ticker.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── Starting countdown overlay ──────────────────────────────
function showStartingCountdown(totalMs) {
  const overlay = qs('#starting-overlay');
  overlay.removeAttribute('hidden');
  const cd = qs('#starting-countdown');
  const secsTotal = Math.ceil(totalMs / 1000);
  let s = secsTotal;
  cd.textContent = s;
  const iv = setInterval(() => {
    s--;
    if (s <= 0) {
      clearInterval(iv);
      overlay.setAttribute('hidden', '');
    } else {
      cd.textContent = s;
    }
  }, 1000);
}

// ── Utilities ───────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Socket setup ────────────────────────────────────────────
function initSocket() {
  const socket = io();
  state.socket = socket;

  socket.on('connect', () => {
    state.mySocketId = socket.id;
    qs('#loading').setAttribute('hidden', '');

    // Pre-fill code from URL ?code=XXXXXX
    const params = new URLSearchParams(window.location.search);
    const preCode = params.get('code');
    if (preCode) {
      qs('#code-input').value = preCode.toUpperCase();
      switchToJoinMode();
    }
  });

  socket.on('connect_error', () => {
    qs('#loading').removeAttribute('hidden');
  });

  socket.on('room:created', ({ code, players, isHost, roomName }) => {
    showLobbyWaiting(code, players, isHost, roomName);
    history.replaceState(null, '', `/compete?code=${code}`);
  });

  socket.on('room:joined', ({ code, players, isHost, roomName }) => {
    state.mySocketId = socket.id;
    showLobbyWaiting(code, players, isHost, roomName);
    history.replaceState(null, '', `/compete?code=${code}`);
  });

  socket.on('room:error', ({ message }) => {
    setLobbyError(message);
    qs('#lobby-error-waiting').textContent = message || '';
  });

  socket.on('room:players-updated', ({ players }) => {
    renderPlayerList(players);
  });

  socket.on('room:host-changed', ({ newHostId }) => {
    if (newHostId === state.mySocketId) {
      state.isHost = true;
      qs('#start-btn').removeAttribute('hidden');
    }
  });

  socket.on('room:player-left', ({ displayName }) => {
    showGuessNotification(`${displayName} left`);
  });

  socket.on('game:starting', () => {
    showGameUI();
    showStartingCountdown(3000);
  });

  socket.on('game:round-start', (data) => {
    qs('#round-results').setAttribute('hidden', '');
    startRoundUI(data);
  });

  socket.on('game:guess-ack', () => {
    // Already handled in confirmGuess UI
  });

  socket.on('game:player-guessed', ({ displayName }) => {
    showGuessNotification(displayName);
  });

  socket.on('game:round-end', (data) => {
    showRoundResults(data);
  });

  socket.on('game:finished', (data) => {
    showFinalStandings(data);
  });
}

// ── Lobby button wiring ─────────────────────────────────────
let _joinMode = false;

function switchToJoinMode() {
  _joinMode = true;
  qs('#code-field').style.display = '';
  qs('#room-name-field').style.display = 'none';
  qs('#create-btn').style.display = 'none';
  qs('#join-toggle-btn').textContent = 'Join';
  qs('#join-toggle-btn').classList.add('primary');
}

function handleCreateOrJoin(isJoin) {
  const name = qs('#name-input').value.trim();
  if (!name) { setLobbyError('Enter a display name'); return; }
  if (name.length > 20) { setLobbyError('Name too long (max 20 chars)'); return; }
  setLobbyError('');

  if (isJoin) {
    const code = qs('#code-input').value.trim().toUpperCase();
    if (code.length !== 6) { setLobbyError('Enter a 6-character room code'); return; }
    state.displayName = name;
    state.socket.emit('room:join', { code, displayName: name, avatar: state.avatar });
  } else {
    const roomName = qs('#room-name-input').value.trim();
    state.displayName = name;
    state.socket.emit('room:create', { displayName: name, roomName: roomName || null, avatar: state.avatar });
  }
}

// ── Avatar picker ───────────────────────────────────────────
function initAvatarPicker() {
  const picker = qs('#avatar-picker');
  AVATARS.forEach((avatar, i) => {
    const div = document.createElement('div');
    div.className = 'avatar-option' + (i === 0 ? ' selected' : '');
    div.innerHTML = `<img src="${avatarUrl(avatar)}" alt="${avatar.seed}" loading="lazy" />`;
    div.addEventListener('click', () => {
      qs('.avatar-option.selected')?.classList.remove('selected');
      div.classList.add('selected');
      state.avatar = avatar;
    });
    picker.appendChild(div);
  });
}

// Pre-fill name from logged-in session
async function prefillName() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return;
    const user = await res.json();
    if (user?.username) {
      const input = qs('#name-input');
      input.value = user.username;
      input.setAttribute('readonly', '');
      input.style.opacity = '0.6';
    }
  } catch (_) {}
}

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initGlobe();
  initSocket();
  initAvatarPicker();
  prefillName();

  qs('#create-btn').addEventListener('click', () => {
    if (_joinMode) return;
    handleCreateOrJoin(false);
  });

  qs('#join-toggle-btn').addEventListener('click', () => {
    if (!_joinMode) {
      switchToJoinMode();
    } else {
      handleCreateOrJoin(true);
    }
  });

  qs('#start-btn').addEventListener('click', () => {
    state.socket.emit('host:start');
  });

  qs('#confirm-btn').addEventListener('click', confirmGuess);

  // Enter key in name / code inputs
  qs('#name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (_joinMode) handleCreateOrJoin(true);
      else handleCreateOrJoin(false);
    }
  });
  qs('#code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCreateOrJoin(true);
  });
  qs('#code-input').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase();
  });
});
