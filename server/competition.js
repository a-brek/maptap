'use strict';

const { getLocationsForDate, haversine, calcScore, WORLD_PARAMS } = require('./routes/puzzle');

const rooms       = new Map(); // code → Room
const socketToRoom = new Map(); // socketId → code

const ROUND_DURATION_MS = 10_000;
const REVEAL_PAUSE_MS   = 5_000;
const ROOM_TTL_MS       = 10 * 60 * 1000;
const CODE_CHARS        = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
  const allGuessed = [...room.players.keys()].every(id => room.roundGuesses.has(id));
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
    round:   room.round,
    actual:  { lat: loc.lat, lng: loc.lng, name: loc.name, world },
    results,
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
      room.players.set(socket.id, {
        socketId:    socket.id,
        displayName,
        avatar,
        userId:      user?.id ?? null,
        scores:      [],
        totalScore:  0,
      });

      socket.join(code);
      socket.emit('room:created', { code, players: room.playerList(), isHost: true, roomName: room.roomName });
    });

    socket.on('room:join', (payload) => {
      const { code } = payload || {};
      const displayName = resolveDisplayName(payload);
      if (!displayName) return socket.emit('room:error', { message: 'Invalid display name (1–20 chars)' });

      const room = rooms.get(String(code).toUpperCase());
      if (!room)                    return socket.emit('room:error', { message: 'Room not found' });
      if (room.state !== 'waiting') return socket.emit('room:error', { message: 'Game already in progress' });

      const avatar = sanitizeAvatar(payload?.avatar);
      socketToRoom.set(socket.id, room.code);
      room.players.set(socket.id, {
        socketId:    socket.id,
        displayName,
        avatar,
        userId:      user?.id ?? null,
        scores:      [],
        totalScore:  0,
      });

      socket.join(room.code);
      socket.emit('room:joined', { code: room.code, players: room.playerList(), isHost: false, roomName: room.roomName });
      socket.to(room.code).emit('room:players-updated', { players: room.playerList() });
    });

    socket.on('host:start', () => {
      const code = socketToRoom.get(socket.id);
      const room = code && rooms.get(code);
      if (!room)                        return;
      if (room.hostId !== socket.id)    return;
      if (room.state !== 'waiting')     return;
      if (room.players.size < 1)        return;

      room.state     = 'in-progress';
      room.date      = todayStr();
      room.locations = getLocationsForDate(room.date);

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
      room.players.delete(socket.id);

      if (room.players.size === 0) {
        clearTimeout(room.roundTimer);
        rooms.delete(code);
        return;
      }

      if (room.hostId === socket.id) {
        room.hostId = room.players.keys().next().value;
        io.to(code).emit('room:host-changed', { newHostId: room.hostId });
      }

      if (room.state === 'waiting') {
        io.to(code).emit('room:players-updated', { players: room.playerList() });
      } else {
        io.to(code).emit('room:player-left', { displayName: player?.displayName });
        if (room.state === 'in-progress') checkAllGuessed(io, room);
      }
    });
  });
}

module.exports = { attachCompetition };
