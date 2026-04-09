import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

console.log(`Starting in ${dev ? 'development' : 'production'} mode on port ${port}`);

const app = next({ dev });
const handle = app.getRequestHandler();

// ── Game constants ──
const TICK_RATE = 30;
const BULLET_SPEED = 600;
const BULLET_HIT_DIST = 13;
const MAX_HP = 2;
const KILLS_TO_WIN = 3;
const RESPAWN_INVULN_MS = 1500;
const MAX_BULLETS_PER_PLAYER = 3;
const POWERUP_COUNT = 5;
const POWERUP_PICKUP_DIST = 25;
const POWERUP_RESPAWN_MS = 10000;

// ── Types ──
interface PlayerState {
  ws: WebSocket;
  x: number; y: number; a: number;
  hp: number; score: number; invulnUntil: number;
}
interface BulletState { x: number; y: number; dx: number; dy: number; owner: number; }
interface PowerupState { x: number; y: number; id: number; active: boolean; respawnAt: number; }
interface Room {
  code: string;
  players: (PlayerState | null)[];
  bullets: BulletState[];
  seed: number;
  grid: boolean[][] | null;
  phase: 'waiting' | 'playing' | 'over';
  tickInterval: ReturnType<typeof setInterval> | null;
  spawnPoints: [{ x: number; y: number }, { x: number; y: number }];
  powerups: PowerupState[];
  nextPowerupId: number;
}

const rooms = new Map<string, Room>();
const playerRooms = new Map<WebSocket, string>();

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (rooms.has(code)) return generateCode();
  return code;
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateMazeGrid(seed: number) {
  const COLS = 32, ROWS = 24, TILE = 40;
  const rng = mulberry32(seed);
  const grid: boolean[][] = [];
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) {
      grid[y][x] = (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1);
    }
  }
  const spawnMargin = 5;
  const blockCount = 25 + Math.floor(rng() * 10);
  for (let i = 0; i < blockCount; i++) {
    const bw = 1 + Math.floor(rng() * 3);
    const bh = 1 + Math.floor(rng() * 3);
    const bx = 1 + Math.floor(rng() * (COLS - 2 - bw));
    const by = 1 + Math.floor(rng() * (ROWS - 2 - bh));
    if ((bx < spawnMargin && by < spawnMargin) || (bx + bw > COLS - spawnMargin && by + bh > ROWS - spawnMargin)) continue;
    for (let dy = 0; dy < bh; dy++)
      for (let dx = 0; dx < bw; dx++)
        grid[by + dy][bx + dx] = true;
  }
  const wallCount = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < wallCount; i++) {
    const horizontal = rng() > 0.5;
    const len = 3 + Math.floor(rng() * 5);
    if (horizontal) {
      const wx = 2 + Math.floor(rng() * (COLS - 4 - len));
      const wy = 2 + Math.floor(rng() * (ROWS - 4));
      if ((wx < spawnMargin && wy < spawnMargin) || (wx + len > COLS - spawnMargin && wy > ROWS - spawnMargin)) continue;
      for (let dx = 0; dx < len; dx++) grid[wy][wx + dx] = true;
    } else {
      const wx = 2 + Math.floor(rng() * (COLS - 4));
      const wy = 2 + Math.floor(rng() * (ROWS - 4 - len));
      if ((wx < spawnMargin && wy < spawnMargin) || (wx > COLS - spawnMargin && wy + len > ROWS - spawnMargin)) continue;
      for (let dy = 0; dy < len; dy++) grid[wy + dy][wx] = true;
    }
  }
  const spawn1 = { x: 2 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 };
  const spawn2 = { x: (COLS - 3) * TILE + TILE / 2, y: (ROWS - 3) * TILE + TILE / 2 };
  return { grid, spawn1, spawn2 };
}

function isWallServer(grid: boolean[][], x: number, y: number): boolean {
  const TILE = 40;
  const gx = Math.floor(x / TILE);
  const gy = Math.floor(y / TILE);
  if (gx < 0 || gx >= grid[0].length || gy < 0 || gy >= grid.length) return true;
  return grid[gy][gx];
}

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function generatePowerups(room: Room, grid: boolean[][]) {
  const TILE = 40, COLS = 32, ROWS = 24;
  const openCells: { x: number; y: number }[] = [];
  for (let y = 3; y < ROWS - 3; y++)
    for (let x = 3; x < COLS - 3; x++)
      if (!grid[y][x]) openCells.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
  for (let i = openCells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [openCells[i], openCells[j]] = [openCells[j], openCells[i]];
  }
  room.powerups = [];
  room.nextPowerupId = 0;
  for (let i = 0; i < Math.min(POWERUP_COUNT, openCells.length); i++)
    room.powerups.push({ x: openCells[i].x, y: openCells[i].y, id: room.nextPowerupId++, active: true, respawnAt: 0 });
}

function regenerateMap(room: Room) {
  const seed = Math.floor(Math.random() * 2147483647);
  room.seed = seed;
  const { grid, spawn1, spawn2 } = generateMazeGrid(seed);
  room.grid = grid;
  room.spawnPoints = [spawn1, spawn2];
  room.bullets = [];
  for (let i = 0; i < 2; i++) {
    const p = room.players[i];
    if (!p) continue;
    const spawn = i === 0 ? spawn1 : spawn2;
    p.x = spawn.x; p.y = spawn.y;
    p.hp = MAX_HP; p.invulnUntil = Date.now() + RESPAWN_INVULN_MS;
  }
  generatePowerups(room, grid);
  for (let i = 0; i < 2; i++) {
    const p = room.players[i];
    if (!p) continue;
    send(p.ws, { t: 'newmap', seed, role: i });
    send(p.ws, { t: 'powerups', list: room.powerups.map(pu => ({ x: pu.x, y: pu.y, id: pu.id })) });
  }
}

function startGame(room: Room) {
  room.phase = 'playing';
  const seed = Math.floor(Math.random() * 2147483647);
  room.seed = seed;
  const { grid, spawn1, spawn2 } = generateMazeGrid(seed);
  room.grid = grid;
  room.spawnPoints = [spawn1, spawn2];
  for (let i = 0; i < 2; i++) {
    const p = room.players[i]!;
    const spawn = i === 0 ? spawn1 : spawn2;
    p.x = spawn.x; p.y = spawn.y; p.a = 0;
    p.hp = MAX_HP; p.score = 0; p.invulnUntil = 0;
  }
  generatePowerups(room, grid);
  for (let i = 0; i < 2; i++) {
    send(room.players[i]!.ws, { t: 'start', seed, role: i });
    send(room.players[i]!.ws, { t: 'powerups', list: room.powerups.map(p => ({ x: p.x, y: p.y, id: p.id })) });
  }
  room.tickInterval = setInterval(() => tickRoom(room), 1000 / TICK_RATE);
}

function tickRoom(room: Room) {
  if (room.phase !== 'playing' || !room.grid) return;
  const dt = 1 / TICK_RATE;

  room.bullets = room.bullets.filter(b => {
    b.x += b.dx * BULLET_SPEED * dt;
    b.y += b.dy * BULLET_SPEED * dt;
    if (isWallServer(room.grid!, b.x, b.y)) return false;
    const targetIdx = b.owner === 0 ? 1 : 0;
    const target = room.players[targetIdx];
    if (!target) return true;
    if (target.invulnUntil > Date.now()) return true;
    const ddx = b.x - target.x;
    const ddy = b.y - target.y;
    if (Math.sqrt(ddx * ddx + ddy * ddy) < BULLET_HIT_DIST) {
      target.hp--;
      if (target.hp <= 0) {
        room.players[b.owner]!.score++;
        const s1 = room.players[0]!.score;
        const s2 = room.players[1]!.score;
        for (const p of room.players) if (p) send(p.ws, { t: 'kill', killer: b.owner, victim: targetIdx, s1, s2 });
        room.bullets = [];
        if (s1 >= KILLS_TO_WIN || s2 >= KILLS_TO_WIN) {
          const winner = s1 >= KILLS_TO_WIN ? 0 : 1;
          for (const p of room.players) if (p) send(p.ws, { t: 'win', winner });
          room.phase = 'over';
          if (room.tickInterval) clearInterval(room.tickInterval);
        } else {
          setTimeout(() => regenerateMap(room), RESPAWN_INVULN_MS);
        }
        return false;
      } else {
        for (const p of room.players) if (p) send(p.ws, { t: 'hit', target: targetIdx, hp: target.hp });
        return false;
      }
    }
    return true;
  });

  // Powerup respawns
  const now2 = Date.now();
  const TILE = 40, COLS = 32, ROWS = 24;
  for (const pu of room.powerups) {
    if (!pu.active && pu.respawnAt > 0 && now2 >= pu.respawnAt) {
      const openCells: { x: number; y: number }[] = [];
      for (let y = 3; y < ROWS - 3; y++)
        for (let x = 3; x < COLS - 3; x++)
          if (!room.grid![y][x]) {
            const cx = x * TILE + TILE / 2, cy = y * TILE + TILE / 2;
            const tooClose = room.powerups.some(o => o.active && Math.abs(o.x - cx) < TILE * 2 && Math.abs(o.y - cy) < TILE * 2);
            if (!tooClose) openCells.push({ x: cx, y: cy });
          }
      if (openCells.length > 0) {
        const cell = openCells[Math.floor(Math.random() * openCells.length)];
        pu.x = cell.x; pu.y = cell.y;
      }
      pu.active = true; pu.respawnAt = 0;
      pu.id = room.nextPowerupId++;
      for (const p of room.players) if (p) send(p.ws, { t: 'powerup_spawn', x: pu.x, y: pu.y, id: pu.id });
    }
  }

  // Broadcast positions
  for (let i = 0; i < 2; i++) {
    const other = 1 - i;
    const p = room.players[other];
    if (p && room.players[i]) send(room.players[i]!.ws, { t: 'pos', x: p.x, y: p.y, a: p.a });
  }
}

function cleanupRoom(code: string) {
  const room = rooms.get(code);
  if (!room) return;
  if (room.tickInterval) clearInterval(room.tickInterval);
  rooms.delete(code);
}

function handleWsMessage(ws: WebSocket, data: Buffer) {
  let msg: { t: string; [key: string]: unknown };
  try { msg = JSON.parse(data.toString()); } catch { return; }

  switch (msg.t) {
    case 'create': {
      const code = generateCode();
      const room: Room = {
        code,
        players: [{ ws, x: 0, y: 0, a: 0, hp: MAX_HP, score: 0, invulnUntil: 0 }, null],
        bullets: [], seed: 0, grid: null, phase: 'waiting',
        tickInterval: null, spawnPoints: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
        powerups: [], nextPowerupId: 0,
      };
      rooms.set(code, room);
      playerRooms.set(ws, code);
      send(ws, { t: 'room', code });
      break;
    }
    case 'join': {
      const code = (msg.code as string).toUpperCase();
      const room = rooms.get(code);
      if (!room || room.phase !== 'waiting' || room.players[1]) {
        send(ws, { t: 'error', msg: 'Room not found or full' });
        return;
      }
      room.players[1] = { ws, x: 0, y: 0, a: 0, hp: MAX_HP, score: 0, invulnUntil: 0 };
      playerRooms.set(ws, code);
      startGame(room);
      break;
    }
    case 'pos': {
      const code = playerRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;
      const idx = room.players.findIndex(p => p?.ws === ws);
      if (idx === -1) return;
      const p = room.players[idx]!;
      p.x = msg.x as number; p.y = msg.y as number; p.a = msg.a as number;
      break;
    }
    case 'shoot': {
      const code = playerRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing') return;
      const idx = room.players.findIndex(p => p?.ws === ws);
      if (idx === -1) return;
      if (room.bullets.filter(b => b.owner === idx).length >= MAX_BULLETS_PER_PLAYER) return;
      const a = msg.a as number;
      room.bullets.push({ x: msg.x as number, y: msg.y as number, dx: Math.cos(a), dy: Math.sin(a), owner: idx });
      const other = 1 - idx;
      if (room.players[other]) send(room.players[other]!.ws, { t: 'shoot', x: msg.x as number, y: msg.y as number, a });
      break;
    }
    case 'pickup': {
      const code = playerRooms.get(ws);
      if (!code) return;
      const room = rooms.get(code);
      if (!room || room.phase !== 'playing') return;
      const idx = room.players.findIndex(p => p?.ws === ws);
      if (idx === -1) return;
      const puId = msg.id as number;
      const pu = room.powerups.find(p => p.id === puId && p.active);
      if (!pu) return;
      const player = room.players[idx]!;
      const pdx = player.x - pu.x, pdy = player.y - pu.y;
      if (Math.sqrt(pdx * pdx + pdy * pdy) > POWERUP_PICKUP_DIST * 2) return;
      pu.active = false;
      pu.respawnAt = Date.now() + POWERUP_RESPAWN_MS;
      send(player.ws, { t: 'powerup_taken', id: puId, by: idx });
      const otherIdx = 1 - idx;
      if (room.players[otherIdx]) send(room.players[otherIdx]!.ws, { t: 'powerup_gone', id: puId });
      break;
    }
  }
}

function handleWsClose(ws: WebSocket) {
  const code = playerRooms.get(ws);
  if (!code) return;
  playerRooms.delete(ws);
  const room = rooms.get(code);
  if (!room) return;
  for (const p of room.players)
    if (p && p.ws !== ws && p.ws.readyState === WebSocket.OPEN)
      send(p.ws, { t: 'opponent_left' });
  cleanupRoom(code);
}

// ── Start server ──
app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  // Use noServer mode so Next.js doesn't swallow the upgrade event
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => handleWsMessage(ws, data as Buffer));
    ws.on('close', () => handleWsClose(ws));
  });

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`> Blackout running on http://0.0.0.0:${port}`);
  });
});
