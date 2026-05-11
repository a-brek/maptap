'use strict';

// ── Helpers ────────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }

function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch (_) {}
  }
}

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

// ── Player identity (survives reload / disconnect) ─────────
function getOrCreatePlayerId() {
  try {
    let id = localStorage.getItem('maptap_player_id');
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('maptap_player_id', id);
    }
    return id;
  } catch (_) {
    return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
}

// ── State ──────────────────────────────────────────────────
const state = {
  socket:           null,
  roomCode:         null,
  playerId:         getOrCreatePlayerId(),
  isHost:           false,
  mySocketId:       null,
  displayName:      null,
  avatar:           AVATARS[0],
  round:            -1,
  totalScore:       0,
  roundActive:      false,
  guessSubmitted:   false,
  pendingGuess:     null,
  roundEndAt:       null,
  timerInterval:    null,
  nextRoundAt:      null,
  nextRoundInterval:null,
  markers:          [],
  arcs:             [],
  rings:            [],
  labels:           [],
  currentWorld:     'earth',
  roundDurationSecs: 10,
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
  state._lastBuzzedSec = null;
  state.timerInterval = setInterval(() => {
    if (!state.roundEndAt) return;
    const secsLeft = Math.max(0, Math.ceil((state.roundEndAt - Date.now()) / 1000));
    const el = qs('#timer-display');
    if (el) {
      el.textContent = secsLeft;
      el.classList.toggle('urgent', secsLeft <= 3);
    }
    // Buzz once per second on the last 3 seconds (skip if already guessed)
    if (!state.guessSubmitted && secsLeft <= 3 && secsLeft > 0 && secsLeft !== state._lastBuzzedSec) {
      state._lastBuzzedSec = secsLeft;
      vibrate(secsLeft === 1 ? [80, 40, 80] : 60);
    }
  }, 100);
}

function stopCountdown() {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
}

function startNextRoundCountdown(ms) {
  clearInterval(state.nextRoundInterval);
  state.nextRoundAt = Date.now() + ms;
  const label = qs('#results-next-label');
  const tick = () => {
    const secs = Math.max(0, Math.ceil((state.nextRoundAt - Date.now()) / 1000));
    if (label) label.textContent = `Next round in ${secs}s…`;
    if (secs <= 0) {
      clearInterval(state.nextRoundInterval);
      state.nextRoundInterval = null;
    }
  };
  tick();
  state.nextRoundInterval = setInterval(tick, 250);
}

function stopNextRoundCountdown() {
  clearInterval(state.nextRoundInterval);
  state.nextRoundInterval = null;
}

// ── Lobby UI ────────────────────────────────────────────────
function renderPlayerList(players) {
  const ul = qs('#player-list');
  ul.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    li.classList.toggle('is-host', p.isHost);
    li.classList.toggle('is-you', p.socketId === state.mySocketId);
    li.classList.toggle('is-disconnected', !!p.disconnected);
    const avatarImg = p.avatar ? `<img class="player-avatar" src="${avatarUrl(p.avatar)}" alt="" />` : '';
    let html = avatarImg + escapeHtml(p.displayName);
    if (p.isHost) html += ' <span class="player-host-badge">Host</span>';
    if (p.socketId === state.mySocketId) html += ' <span style="font-size:9px;color:var(--teal)">(you)</span>';
    if (p.disconnected) {
      html += ' <span class="player-ready-pill notready">Offline</span>';
    } else if (p.ready) {
      html += ' <span class="player-ready-pill ready">Ready</span>';
    } else {
      html += ' <span class="player-ready-pill notready">Not ready</span>';
    }
    li.innerHTML = html;
    ul.appendChild(li);
  }

  const active = players.filter(p => !p.disconnected);
  const readyCount = active.filter(p => p.ready).length;
  const allReady = active.length > 0 && readyCount === active.length;

  qs('#waiting-status').textContent =
    `${readyCount}/${active.length} ready · ${players.length} in lobby`;

  // Reflect my own ready state on the toggle
  const me = players.find(p => p.socketId === state.mySocketId);
  state.iAmReady = !!(me && me.ready);
  const readyBtn = qs('#ready-btn');
  if (readyBtn) {
    readyBtn.textContent = state.iAmReady ? 'Cancel Ready' : "I'm Ready";
    readyBtn.classList.toggle('primary', !state.iAmReady);
  }

  // Host can only start when everyone (active) is ready
  const startBtn = qs('#start-btn');
  if (startBtn && state.isHost) {
    if (allReady) startBtn.removeAttribute('disabled');
    else          startBtn.setAttribute('disabled', '');
    startBtn.textContent = allReady ? 'Start Game' : `Waiting (${readyCount}/${active.length})`;
  }
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
  const durationField = qs('#duration-field');
  if (isHost) {
    startBtn.removeAttribute('hidden');
    durationField.removeAttribute('hidden');
  } else {
    startBtn.setAttribute('hidden', '');
    durationField.setAttribute('hidden', '');
  }
  if (navigator.share) qs('#share-link-btn').removeAttribute('hidden');
}

function inviteUrl() {
  return `${window.location.origin}/compete?code=${state.roomCode}`;
}

async function copyInviteLink() {
  const url = inviteUrl();
  try {
    await navigator.clipboard.writeText(url);
  } catch (_) {
    // Fallback for older browsers / insecure contexts
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }
  const btn = qs('#copy-link-btn');
  const orig = btn.textContent;
  btn.textContent = 'Link copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('copied');
  }, 1800);
}

async function shareInviteLink() {
  if (!navigator.share) return copyInviteLink();
  try {
    await navigator.share({
      title: 'Tap Map Live',
      text:  `Join my Tap Map room — code ${state.roomCode}`,
      url:   inviteUrl(),
    });
  } catch (_) { /* user cancelled */ }
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
  const cluePanel = qs('#clue-panel');
  cluePanel.removeAttribute('hidden');
  cluePanel.classList.add('visible');
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
  qs('#results-location-name').textContent = data.actual.name.replace(/, USA$/, '');
  qs('#clue-panel').classList.remove('visible');
  qs('#clue-panel').setAttribute('hidden', '');
  qs('#round-results').removeAttribute('hidden');
}

function buildBreakdownTable(scores) {
  if (!scores || scores.length === 0) return '<div style="color:var(--text-dim);font-size:10px;padding:4px 0;">No round data</div>';
  let rows = '';
  scores.forEach((rs, idx) => {
    if (rs.noGuess) {
      rows += `<tr>
        <td>${idx + 1}</td>
        <td class="bd-no-guess" colspan="4">No guess</td>
      </tr>`;
    } else {
      const dist = rs.distanceKm != null ? `${rs.distanceKm.toLocaleString()} km` : '—';
      rows += `<tr>
        <td>${idx + 1}</td>
        <td>${rs.accuracyScore}</td>
        <td>+${rs.speedBonus}</td>
        <td class="bd-total">${rs.total}</td>
        <td style="color:var(--text-dim)">${dist}</td>
      </tr>`;
    }
  });
  return `<table class="breakdown-table">
    <thead><tr><th>Rd</th><th>Accuracy</th><th>Speed</th><th>Round</th><th>Distance</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function showFinalStandings(data) {
  qs('#round-results').setAttribute('hidden', '');
  qs('#hud').setAttribute('hidden', '');
  qs('#clue-panel').classList.remove('visible');
  qs('#clue-panel').setAttribute('hidden', '');

  const { finalStandings, roomName } = data;
  state.finalStandings = finalStandings;
  state.roomName       = roomName || null;

  const podium = qs('#podium-row');
  podium.innerHTML = '';

  const medals = ['🥇', '🥈', '🥉'];

  finalStandings.forEach((p, i) => {
    const entry = document.createElement('div');
    entry.classList.add('podium-entry');
    if (i === 0) entry.classList.add('rank-1');
    else if (i === 1) entry.classList.add('rank-2');
    else if (i === 2) entry.classList.add('rank-3');
    if (p.socketId === state.mySocketId) entry.classList.add('is-me');

    const av = p.avatar ? `<img class="podium-avatar" src="${avatarUrl(p.avatar)}" alt="" />` : '';
    const isMe = p.socketId === state.mySocketId;

    const mainRow = document.createElement('div');
    mainRow.className = 'podium-main-row';
    mainRow.innerHTML = `
      <div class="podium-rank">${medals[i] || i + 1}</div>
      ${av}
      <div class="podium-name">${escapeHtml(p.displayName)}${isMe ? ' <span style="font-size:9px;color:var(--teal)">(you)</span>' : ''}</div>
      <div class="podium-score">${p.totalScore}</div>
      <div class="podium-chevron">▾</div>
    `;

    const breakdown = document.createElement('div');
    breakdown.className = 'podium-breakdown';
    breakdown.hidden = true;
    breakdown.innerHTML = buildBreakdownTable(p.scores);

    mainRow.addEventListener('click', () => {
      breakdown.hidden = !breakdown.hidden;
      entry.classList.toggle('expanded', !breakdown.hidden);
    });

    entry.appendChild(mainRow);
    entry.appendChild(breakdown);
    podium.appendChild(entry);
  });

  // Wire up share button
  const shareBtn = qs('#comp-share-btn');
  shareBtn.onclick = () => shareResults(finalStandings, roomName);

  // Wire up leaderboard toggle
  const lbToggle = qs('#comp-lb-toggle');
  const lbDiv    = qs('#comp-leaderboard');
  let lbLoaded = false;
  lbToggle.onclick = async () => {
    const isOpen = !lbDiv.hidden;
    lbDiv.hidden = isOpen;
    lbToggle.textContent = isOpen ? 'All-Time Leaderboard ▾' : 'All-Time Leaderboard ▴';
    if (!isOpen && !lbLoaded) {
      lbLoaded = true;
      lbDiv.innerHTML = '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);padding:8px 0;">Loading…</div>';
      try {
        const res = await fetch('/api/leaderboard/battle');
        const json = await res.json();
        lbDiv.innerHTML = renderBattleLeaderboard(json);
      } catch (_) {
        lbDiv.innerHTML = '<div style="color:#ff6b6b;font-family:var(--font-mono);font-size:10px;">Failed to load</div>';
      }
    }
  };

  qs('#comp-game-over').removeAttribute('hidden');
}

function generateShareText(finalStandings, roomName) {
  const medals = ['🥇', '🥈', '🥉'];
  const lines = ['🗺️ Map Battle'];
  if (roomName) lines.push(roomName);
  lines.push('─────────────');
  finalStandings.forEach((p, i) => {
    const isMe = p.socketId === state.mySocketId;
    lines.push(`${medals[i] || (i + 1) + '.'} ${p.displayName}${isMe ? ' ← me' : ''} — ${p.totalScore}`);
  });
  lines.push('─────────────');
  lines.push(window.location.origin + '/compete');
  return lines.join('\n');
}

async function shareResults(finalStandings, roomName) {
  const text = generateShareText(finalStandings, roomName);
  const btn = qs('#comp-share-btn');

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Map Battle Results', text });
      return;
    } catch (_) { /* user cancelled */ }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }
  const orig = btn.textContent;
  btn.textContent = 'Copied!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('copied');
  }, 1800);
}

function renderBattleLeaderboard(data) {
  const { entries, viewerRank } = data;
  if (!entries || entries.length === 0) {
    return '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);padding:8px 0;">No battle scores yet. Be the first!</div>';
  }
  let rows = '';
  entries.forEach(e => {
    const isMe = viewerRank != null && e.rank === viewerRank;
    const wins = e.wins > 0 ? ` <span style="color:var(--amber);font-size:9px">${e.wins}W</span>` : '';
    rows += `<tr class="${isMe ? 'lb-me' : ''}">
      <td class="lb-rank">${e.rank}</td>
      <td>${escapeHtml(e.displayName)}${wins}</td>
      <td class="lb-score">${e.totalScore}</td>
      <td style="color:var(--text-dim);font-size:9px">${e.playerCount}P</td>
    </tr>`;
  });
  const footer = viewerRank ? `<div style="font-family:var(--font-mono);font-size:9px;color:var(--teal);padding:6px 0 0">Your best rank: #${viewerRank}</div>` : '';
  return `<table class="battle-lb-table">
    <thead><tr><th>#</th><th>Player</th><th>Best Score</th><th>Size</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>${footer}`;
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
  vibrate(40);
  const iv = setInterval(() => {
    s--;
    if (s <= 0) {
      clearInterval(iv);
      overlay.setAttribute('hidden', '');
      vibrate([60, 40, 120]);
    } else {
      cd.textContent = s;
      vibrate(40);
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

      // Silent reconnect attempt: if we already had a player slot in this
      // room (phone went to sleep, network blipped, etc.) the server will
      // recognise our playerId and reattach us to the existing game.
      const lastName = (() => {
        try { return localStorage.getItem('maptap_display_name') || ''; } catch (_) { return ''; }
      })();
      if (state.playerId && lastName) {
        state._silentReconnectUntil = Date.now() + 2000;
        state.socket.emit('room:join', {
          code:        preCode.toUpperCase(),
          displayName: lastName,
          avatar:      state.avatar,
          playerId:    state.playerId,
        });
      }
    }
  });

  socket.on('connect_error', () => {
    qs('#loading').removeAttribute('hidden');
  });

  socket.on('room:created', ({ code, playerId, players, isHost, roomName }) => {
    if (playerId) state.playerId = playerId;
    showLobbyWaiting(code, players, isHost, roomName);
    history.replaceState(null, '', `/compete?code=${code}`);
  });

  socket.on('room:joined', ({ code, playerId, players, isHost, roomName, gameState }) => {
    if (playerId) state.playerId = playerId;
    state.mySocketId = socket.id;
    state.roomCode   = code;
    state.isHost     = isHost;
    history.replaceState(null, '', `/compete?code=${code}`);

    if (gameState && gameState.phase === 'round') {
      // Reconnecting into an in-progress round
      showGameUI();
      qs('#starting-overlay').setAttribute('hidden', '');
      state.totalScore = gameState.totalScore || 0;
      qs('#score-display').textContent = state.totalScore;
      startRoundUI({
        round:    gameState.round,
        total:    gameState.total,
        cityName: gameState.cityName,
        world:    gameState.world,
        tier:     gameState.tier,
        duration: gameState.timeLeftMs,
      });
      if (gameState.alreadyGuessed) {
        state.guessSubmitted = true;
        const btn = qs('#confirm-btn');
        btn.textContent = 'Guess submitted!';
        btn.setAttribute('disabled', '');
        btn.style.opacity = '0.6';
        btn.removeAttribute('hidden');
      }
    } else if (gameState && gameState.phase === 'finished') {
      showLobbyWaiting(code, players, isHost, roomName);
    } else {
      showLobbyWaiting(code, players, isHost, roomName);
    }
  });

  socket.on('room:error', ({ message }) => {
    if (state._silentReconnectUntil && Date.now() < state._silentReconnectUntil) {
      // Speculative reconnect failed (room was reaped or game already over).
      // Drop the stale ?code= from the URL and reset to create-mode so the
      // user isn't stuck trying to rejoin a dead room.
      state._silentReconnectUntil = null;
      history.replaceState(null, '', '/compete');
      switchToCreateMode();
      qs('#code-input').value = '';
      return;
    }
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
    stopNextRoundCountdown();
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
    startNextRoundCountdown(data.nextInMs ?? 5000);
  });

  socket.on('game:finished', (data) => {
    stopNextRoundCountdown();
    showFinalStandings(data);
  });
}

// ── Lobby button wiring ─────────────────────────────────────
let _joinMode = false;

function switchToJoinMode() {
  _joinMode = true;
  qs('#code-field').style.display = '';
  qs('#room-name-field').style.display = 'none';
  qs('#create-btn').textContent = '← Back';
  qs('#create-btn').classList.remove('primary');
  qs('#join-toggle-btn').textContent = 'Join';
  qs('#join-toggle-btn').classList.add('primary');
}

function switchToCreateMode() {
  _joinMode = false;
  qs('#code-field').style.display = 'none';
  qs('#room-name-field').style.display = '';
  qs('#create-btn').textContent = 'Create Room';
  qs('#create-btn').classList.add('primary');
  qs('#join-toggle-btn').textContent = 'Join Room';
  qs('#join-toggle-btn').classList.remove('primary');
}

function handleCreateOrJoin(isJoin) {
  const name = qs('#name-input').value.trim();
  if (!name) { setLobbyError('Enter a display name'); return; }
  if (name.length > 20) { setLobbyError('Name too long (max 20 chars)'); return; }
  setLobbyError('');

  try { localStorage.setItem('maptap_display_name', name); } catch (_) {}

  if (isJoin) {
    const code = qs('#code-input').value.trim().toUpperCase();
    if (code.length !== 6) { setLobbyError('Enter a 6-character room code'); return; }
    state.displayName = name;
    state.socket.emit('room:join', { code, displayName: name, avatar: state.avatar, playerId: state.playerId });
  } else {
    const roomName = qs('#room-name-input').value.trim();
    state.displayName = name;
    state.socket.emit('room:create', { displayName: name, roomName: roomName || null, avatar: state.avatar, playerId: state.playerId });
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
    if (_joinMode) {
      switchToCreateMode();
      qs('#code-input').value = '';
      setLobbyError('');
      return;
    }
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
    state.socket.emit('host:start', { roundDurationSecs: state.roundDurationSecs });
  });

  document.querySelectorAll('.duration-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.duration-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.roundDurationSecs = parseInt(btn.dataset.secs, 10);
    });
  });

  qs('#ready-btn').addEventListener('click', () => {
    state.iAmReady = !state.iAmReady;
    state.socket.emit('player:ready', { ready: state.iAmReady });
    vibrate(20);
  });

  qs('#confirm-btn').addEventListener('click', confirmGuess);

  qs('#copy-link-btn').addEventListener('click', copyInviteLink);
  qs('#share-link-btn').addEventListener('click', shareInviteLink);

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
