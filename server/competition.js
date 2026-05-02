'use strict';

const { getLocationsForDate, haversine, calcScore, WORLD_PARAMS } = require('./routes/puzzle');

const rooms       = new Map(); // code → Room
const socketToRoom = new Map(); // socketId → code

const ROUND_DURATION_MS    = 10_000;
const REVEAL_PAUSE_MS      = 5_000;
const ROOM_TTL_MS          = 10 * 60 * 1000;
const RECONNECT_GRACE_MS   = 90_000;
const CODE_CHARS           = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function randomSeed() {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newPlayerId() {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

class Room {
  constructor(code, hostSocketId, roomName) {
    this.code         = code;
    this.roomName     = roomName || null;
    this.hostId       = hostSocketId;
    this.state        = 'waiting';
    this.players      = new Map();
    this.round        = -1;
    this.locations    = null;
    this.date         = null;
    this.roundTimer   = null;
    this.roundStart   = null;
    this.roundGuesses = new Map();
  }

  playerList() {
    return [...this.players.values()].map(p => ({
      socketId:    p.socketId,
      displayName: p.displayName,
      avatar:      p.avatar,
      totalScore:  p.totalScore,
      isHost:      p.socketId === this.hostId,
      disconnected: !!p.disconnected,
      ready:       !!p.ready,
    }));
  }
}

const VALID_SEEDS = new Set([
  'felix','aneka','oliver','orion','luna','nova','atlas','echo',
  'rio','max','sage','rebel','ace','flash','neo','storm',
  'raven','blaze','zen','kit','wolf','fox','crow','jay',
]);
const VALID_STYLES = new Set(['pixel-art','bottts','adventurer','big-ears']);

function sanitizeName(name) {
  if (typeof name !== 'string') return null;
  const s = name.replace(/[<>&"']/g, '').trim();
  if (s.length < 1 || s.length > 20) return null;
  return s;
}

function sanitizeAvatar(avatar) {
  // Accept {style, seed} object or legacy string seed
  if (avatar && typeof avatar === 'object') {
    const style = VALID_STYLES.has(avatar.style) ? avatar.style : 'pixel-art';
    const seed  = VALID_SEEDS.has(avatar.seed)   ? avatar.seed  : 'felix';
    return { style, seed };
  }
  if (typeof avatar === 'string' && VALID_SEEDS.has(avatar)) {
    return { style: 'pixel-art', seed: avatar };
  }
  return { style: 'pixel-art', seed: 'felix' };
}

function checkAllGuessed(io, room) {
  const active = [...room.players.values()].filter(p => !p.disconnected);
  if (active.length === 0) return;
  const allGuessed = active.every(p => room.roundGuesses.has(p.socketId));
  if (allGuessed) endRound(io, room);
}

function startRound(io, room, roundIndex) {
  room.round        = roundIndex;
  room.roundGuesses = new Map();
  room.roundStart   = Date.now();

  const loc = room.locations[roundIndex];
  io.to(room.code).emit('game:round-start', {
    round:    roundIndex,
    total:    room.locations.length,
    cityName: loc.name,
    world:    loc.world || 'earth',
    tier:     loc.tier,
    duration: ROUND_DURATION_MS,
  });

  room.roundTimer = setTimeout(() => endRound(io, room), ROUND_DURATION_MS);
}

function endRound(io, room) {
  clearTimeout(room.roundTimer);
  room.roundTimer = null;

  const loc    = room.locations[room.round];
  const world  = loc.world || 'earth';
  const params = WORLD_PARAMS[world] || WORLD_PARAMS.earth;

  const results = [];
  for (const [, player] of room.players) {
    const guess = room.roundGuesses.get(player.socketId);
    let roundScore = { accuracyScore: 0, speedBonus: 0, total: 0, noGuess: true };

    if (guess) {
      const timeRemaining  = Math.max(0, ROUND_DURATION_MS - (guess.submittedAt - room.roundStart)) / 1000;
      const distKm         = haversine(guess.lat, guess.lng, loc.lat, loc.lng, params.R);
      const accuracyScore  = calcScore(distKm, params.maxDist);
      const speedBonus     = Math.round((timeRemaining / 10) * loc.tier * 5);
      const total          = accuracyScore + speedBonus;

      roundScore = {
        accuracyScore,
        speedBonus,
        total,
        distanceKm: Math.round(distKm),
        timeRemaining: Math.round(timeRemaining * 10) / 10,
        guess: { lat: guess.lat, lng: guess.lng },
        noGuess: false,
      };
      player.totalScore += total;
    }

    player.scores.push(roundScore);

    results.push({
      socketId:    player.socketId,
      displayName: player.displayName,
      avatar:      player.avatar,
      roundScore,
      totalScore:  player.totalScore,
    });
  }

  results.sort((a, b) => b.totalScore - a.totalScore);

  io.to(room.code).emit('game:round-end', {
    round:    room.round,
    actual:   { lat: loc.lat, lng: loc.lng, name: loc.name, world },
    results,
    nextInMs: REVEAL_PAUSE_MS,
  });

  if (room.round >= room.locations.length - 1) {
    room.state = 'finished';
    setTimeout(() => {
      io.to(room.code).emit('game:finished', { finalStandings: results });
      setTimeout(() => rooms.delete(room.code), ROOM_TTL_MS);
    }, REVEAL_PAUSE_MS);
  } else {
    setTimeout(() => startRound(io, room, room.round + 1), REVEAL_PAUSE_MS);
  }
}

function findPlayerByPlayerId(room, playerId) {
  if (!playerId) return null;
  for (const p of room.players.values()) {
    if (p.playerId === playerId) return p;
  }
  return null;
}

function attachCompetition(io, sessionMiddleware) {
  const passport = require('passport');

  io.use((socket, next) => sessionMiddleware(socket.request, socket.request.res || {}, next));
  io.use((socket, next) => passport.initialize()(socket.request, socket.request.res || {}, next));
  io.use((socket, next) => passport.session()(socket.request, socket.request.res || {}, next));

  io.on('connection', (socket) => {
    const user = socket.request.user ?? null;

    function resolveDisplayName(payload) {
      if (user?.username) return user.username;
      return sanitizeName(payload?.displayName);
    }

    socket.on('room:create', (payload) => {
      const displayName = resolveDisplayName(payload);
      if (!displayName) return socket.emit('room:error', { message: 'Invalid display name (1–20 chars)' });

      const rawRoomName = payload?.roomName;
      const roomName = rawRoomName ? String(rawRoomName).replace(/[<>&"']/g, '').trim().slice(0, 30) || null : null;

      const code = generateCode();
      const room = new Room(code, socket.id, roomName);
      rooms.set(code, room);
      socketToRoom.set(socket.id, code);

      const avatar = sanitizeAvatar(payload?.avatar);
      const playerId = (typeof payload?.playerId === 'string' && payload.playerId.length <= 64)
        ? payload.playerId
        : newPlayerId();
      room.players.set(socket.id, {
        socketId:    socket.id,
        playerId,
        displayName,
        avatar,
        userId:      user?.id ?? null,
        scores:      [],
        totalScore:  0,
        disconnected: false,
        ready:       false,
      });

      socket.join(code);
      socket.emit('room:created', { code, playerId, players: room.playerList(), isHost: true, roomName: room.roomName });
    });

    socket.on('room:join', (payload) => {
      const { code } = payload || {};
      const displayName = resolveDisplayName(payload);
      if (!displayName) return socket.emit('room:error', { message: 'Invalid display name (1–20 chars)' });

      const room = rooms.get(String(code).toUpperCase());
      if (!room) return socket.emit('room:error', { message: 'Room not found' });

      // Reconnect path: existing player slot found via playerId
      const existing = findPlayerByPlayerId(room, payload?.playerId);
      if (existing) {
        if (existing.disconnected && existing.reconnectTimer) {
          clearTimeout(existing.reconnectTimer);
          existing.reconnectTimer = null;
        }
        // Move slot to new socket id
        room.players.delete(existing.socketId);
        if (room.hostId === existing.socketId) room.hostId = socket.id;
        existing.socketId    = socket.id;
        existing.disconnected = false;
        room.players.set(socket.id, existing);
        socketToRoom.set(socket.id, room.code);
        socket.join(room.code);

        const payloadOut = {
          code:        room.code,
          playerId:    existing.playerId,
          players:     room.playerList(),
          isHost:      room.hostId === socket.id,
          roomName:    room.roomName,
          reconnected: true,
        };

        if (room.state === 'in-progress' && room.locations) {
          const loc = room.locations[room.round];
          payloadOut.gameState = {
            phase:        'round',
            round:        room.round,
            total:        room.locations.length,
            cityName:     loc.name,
            world:        loc.world || 'earth',
            tier:         loc.tier,
            timeLeftMs:   Math.max(0, ROUND_DURATION_MS - (Date.now() - room.roundStart)),
            alreadyGuessed: room.roundGuesses.has(socket.id),
            totalScore:   existing.totalScore,
          };
        } else if (room.state === 'finished') {
          payloadOut.gameState = { phase: 'finished' };
        }

        socket.emit('room:joined', payloadOut);
        socket.to(room.code).emit('room:players-updated', { players: room.playerList() });
        // If they were the missing guess, round may now be ready to end
        if (room.state === 'in-progress') checkAllGuessed(io, room);
        return;
      }

      if (room.state !== 'waiting') return socket.emit('room:error', { message: 'Game already in progress' });

      const avatar = sanitizeAvatar(payload?.avatar);
      const playerId = (typeof payload?.playerId === 'string' && payload.playerId.length <= 64)
        ? payload.playerId
        : newPlayerId();
      socketToRoom.set(socket.id, room.code);
      room.players.set(socket.id, {
        socketId:    socket.id,
        playerId,
        displayName,
        avatar,
        userId:      user?.id ?? null,
        scores:      [],
        totalScore:  0,
        disconnected: false,
        ready:       false,
      });

      socket.join(room.code);
      socket.emit('room:joined', { code: room.code, playerId, players: room.playerList(), isHost: false, roomName: room.roomName });
      socket.to(room.code).emit('room:players-updated', { players: room.playerList() });
    });

    socket.on('player:ready', (payload) => {
      const code = socketToRoom.get(socket.id);
      const room = code && rooms.get(code);
      if (!room || room.state !== 'waiting') return;
      const player = room.players.get(socket.id);
      if (!player) return;
      player.ready = !!(payload && payload.ready);
      io.to(room.code).emit('room:players-updated', { players: room.playerList() });
    });

    socket.on('host:start', () => {
      const code = socketToRoom.get(socket.id);
      const room = code && rooms.get(code);
      if (!room)                        return;
      if (room.hostId !== socket.id)    return;
      if (room.state !== 'waiting')     return;
      if (room.players.size < 1)        return;

      // Require every active player (host included) to be ready
      const active = [...room.players.values()].filter(p => !p.disconnected);
      if (!active.every(p => p.ready)) {
        return socket.emit('room:error', { message: 'Waiting for all players to ready up' });
      }

      room.state     = 'in-progress';
      room.date      = todayStr();
      // Random per-room seed so competition locations differ from the daily puzzle
      room.locations = getLocationsForDate(randomSeed());

      io.to(room.code).emit('game:starting', { rounds: room.locations.length });
      setTimeout(() => startRound(io, room, 0), 3000);
    });

    socket.on('game:guess', (payload) => {
      const code = socketToRoom.get(socket.id);
      const room = code && rooms.get(code);
      if (!room || room.state !== 'in-progress') return;
      if (room.roundGuesses.has(socket.id))      return;

      const lat = parseFloat(payload?.lat);
      const lng = parseFloat(payload?.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      room.roundGuesses.set(socket.id, { lat, lng, submittedAt: Date.now() });
      socket.emit('game:guess-ack', { received: true });

      const player = room.players.get(socket.id);
      socket.to(room.code).emit('game:player-guessed', { displayName: player?.displayName });

      checkAllGuessed(io, room);
    });

    socket.on('disconnect', () => {
      const code = socketToRoom.get(socket.id);
      if (!code) return;
      socketToRoom.delete(socket.id);

      const room = rooms.get(code);
      if (!room) return;

      const player = room.players.get(socket.id);
      if (!player) return;

      // Keep slot for a grace window so reloads / mobile backgrounding /
      // network blips don't nuke the room. Reconnect via playerId restores
      // the player into the same slot.
      player.disconnected = true;

      if (room.state === 'waiting') {
        io.to(code).emit('room:players-updated', { players: room.playerList() });
      } else {
        io.to(code).emit('room:player-left', { displayName: player.displayName });
        if (room.state === 'in-progress') checkAllGuessed(io, room);
      }

      player.reconnectTimer = setTimeout(() => {
        const stillThere = room.players.get(player.socketId);
        if (!stillThere || !stillThere.disconnected) return;
        room.players.delete(player.socketId);

        if (room.players.size === 0) {
          clearTimeout(room.roundTimer);
          rooms.delete(code);
          return;
        }
        if (room.hostId === player.socketId) {
          // Pick any non-disconnected player, or fall back to first
          const next = [...room.players.values()].find(p => !p.disconnected) || room.players.values().next().value;
          room.hostId = next.socketId;
          io.to(code).emit('room:host-changed', { newHostId: room.hostId });
        }
        io.to(code).emit('room:players-updated', { players: room.playerList() });
      }, RECONNECT_GRACE_MS);
    });
  });
}

module.exports = { attachCompetition };
