'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { generateMaze, getMapDimensions } from '@/lib/game/map';
import type { MazeResult } from '@/lib/game/map';
import { movePlayer, stepBullet } from '@/lib/game/physics';
import { render } from '@/lib/game/renderer';
import type { Player, Bullet, Powerup, ServerMsg } from '@/lib/game/types';
import {
  MAX_HP, SHOOT_COOLDOWN, MAX_BULLETS_PER_PLAYER,
  RESPAWN_INVULN_MS, SEND_RATE, POWERUP_PICKUP_DIST,
  POWERUP_LIGHT_RADIUS, POWERUP_DURATION,
} from '@/lib/game/constants';

type Phase = 'menu' | 'waiting' | 'playing' | 'over';

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [phase, setPhase] = useState<Phase>('menu');
  const [roomCode, setRoomCode] = useState('');
  const [displayCode, setDisplayCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [role, setRole] = useState(0);
  const [winner, setWinner] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [connError, setConnError] = useState('');

  const gameRef = useRef<{
    maze: MazeResult | null;
    me: Player;
    opponent: Player;
    bullets: Bullet[];
    keys: Set<string>;
    mouseAngle: number;
    role: number;
    muzzleFlash: number;
    hitFlash: number;
    killText: { text: string; alpha: number } | null;
    scores: [number, number];
    winner: number | null;
    lastSend: number;
    animId: number;
    powerups: Powerup[];
    lightReveal: { x: number; y: number; radius: number; alpha: number; endTime: number } | null;
  }>({
    maze: null,
    me: { x: 0, y: 0, angle: 0, hp: MAX_HP, score: 0, lastShot: 0, invulnUntil: 0 },
    opponent: { x: 0, y: 0, angle: 0, hp: MAX_HP, score: 0, lastShot: 0, invulnUntil: 0 },
    bullets: [],
    keys: new Set(),
    mouseAngle: 0,
    role: 0,
    muzzleFlash: 0,
    hitFlash: 0,
    killText: null,
    scores: [0, 0],
    winner: null,
    lastSend: 0,
    animId: 0,
    powerups: [],
    lightReveal: null,
  });

  const connectWS = useCallback((action: 'create' | 'join', code?: string) => {
    setConnError('');
    setDisplayCode('');
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${protocol}://${window.location.host}`;
    console.log('[WS] Connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected');
      if (action === 'create') {
        ws.send(JSON.stringify({ t: 'create' }));
        setPhase('waiting');
      } else {
        ws.send(JSON.stringify({ t: 'join', code }));
        setPhase('waiting');
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      console.log('[WS] Received:', msg);
      if (msg.t === 'room') {
        setDisplayCode(msg.code);
      }
      handleServerMsg(msg as ServerMsg);
    };

    ws.onerror = (e) => {
      console.error('[WS] Error:', e);
      setConnError('Connection failed. Check console for details.');
    };

    ws.onclose = (e) => {
      console.log('[WS] Closed:', e.code, e.reason);
      if (gameRef.current.winner === null && phase !== 'menu') {
        setPhase('menu');
      }
    };
  }, [phase]);

  const handleServerMsg = useCallback((msg: ServerMsg) => {
    const g = gameRef.current;
    switch (msg.t) {
      case 'room':
        setDisplayCode(msg.code);
        break;
      case 'start': {
        const maze = generateMaze(msg.seed);
        g.maze = maze;
        g.role = msg.role;
        g.scores = [0, 0];
        g.winner = null;
        g.bullets = [];
        g.powerups = [];
        g.lightReveal = null;
        g.me = {
          x: msg.role === 0 ? maze.spawn1.x : maze.spawn2.x,
          y: msg.role === 0 ? maze.spawn1.y : maze.spawn2.y,
          angle: 0, hp: MAX_HP, score: 0, lastShot: 0, invulnUntil: 0,
        };
        g.opponent = {
          x: msg.role === 0 ? maze.spawn2.x : maze.spawn1.x,
          y: msg.role === 0 ? maze.spawn2.y : maze.spawn1.y,
          angle: 0, hp: MAX_HP, score: 0, lastShot: 0, invulnUntil: 0,
        };
        setRole(msg.role);
        setWinner(null);
        setPhase('playing');
        break;
      }
      case 'pos':
        g.opponent.x = msg.x;
        g.opponent.y = msg.y;
        g.opponent.angle = msg.a;
        break;
      case 'shoot':
        g.bullets.push({
          x: msg.x, y: msg.y,
          dx: Math.cos(msg.a), dy: Math.sin(msg.a),
          owner: g.role === 0 ? 1 : 0,
          age: 0,
        });
        break;
      case 'hit':
        if (msg.target === g.role) {
          g.me.hp = msg.hp;
          g.hitFlash = 6;
        } else {
          g.opponent.hp = msg.hp;
        }
        break;
      case 'kill': {
        g.scores = [msg.s1, msg.s2];
        const isVictim = msg.victim === g.role;
        g.killText = { text: isVictim ? 'DIED' : 'KILLED', alpha: 1 };
        if (isVictim) {
          const spawn = g.role === 0 ? g.maze!.spawn1 : g.maze!.spawn2;
          g.me.x = spawn.x;
          g.me.y = spawn.y;
          g.me.hp = MAX_HP;
          g.me.invulnUntil = Date.now() + RESPAWN_INVULN_MS;
        } else {
          g.opponent.hp = MAX_HP;
        }
        g.bullets = [];
        break;
      }
      case 'win':
        g.winner = msg.winner;
        setWinner(msg.winner);
        setPhase('over');
        break;
      case 'opponent_left':
        setPhase('menu');
        break;
      case 'powerups':
        g.powerups = msg.list.map(p => ({ ...p, active: true }));
        break;
      case 'powerup_taken': {
        const pu = g.powerups.find(p => p.id === msg.id);
        if (pu) pu.active = false;
        // Only activate light reveal for the player who grabbed it
        if (pu && msg.by === g.role) {
          g.lightReveal = {
            x: pu.x, y: pu.y,
            radius: POWERUP_LIGHT_RADIUS,
            alpha: 1,
            endTime: Date.now() + POWERUP_DURATION,
          };
        }
        break;
      }
      case 'powerup_gone': {
        // Opponent grabbed a powerup — just hide it, no reveal for us
        const pu2 = g.powerups.find(p => p.id === msg.id);
        if (pu2) pu2.active = false;
        break;
      }
      case 'powerup_spawn': {
        // A powerup respawned
        const existing = g.powerups.find(p => p.id === msg.id);
        if (existing) {
          existing.active = true;
          existing.x = msg.x;
          existing.y = msg.y;
        } else {
          g.powerups.push({ x: msg.x, y: msg.y, id: msg.id, active: true });
        }
        break;
      }
      case 'newmap': {
        // New map after a kill
        const newMaze = generateMaze(msg.seed);
        g.maze = newMaze;
        g.role = msg.role;
        g.bullets = [];
        g.lightReveal = null;
        g.me.x = msg.role === 0 ? newMaze.spawn1.x : newMaze.spawn2.x;
        g.me.y = msg.role === 0 ? newMaze.spawn1.y : newMaze.spawn2.y;
        g.me.hp = MAX_HP;
        g.me.invulnUntil = Date.now() + RESPAWN_INVULN_MS;
        g.opponent.x = msg.role === 0 ? newMaze.spawn2.x : newMaze.spawn1.x;
        g.opponent.y = msg.role === 0 ? newMaze.spawn2.y : newMaze.spawn1.y;
        g.opponent.hp = MAX_HP;
        break;
      }
    }
  }, []);

  // Game loop
  useEffect(() => {
    if (phase !== 'playing') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const g = gameRef.current;
    let lastTime = performance.now();

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        setPaused(prev => !prev);
        return;
      }
      if (e.code === 'KeyT' && e.shiftKey) {
        e.preventDefault();
        return;
      }
      g.keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => g.keys.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { w: mapW, h: mapH } = getMapDimensions();
      let camX: number, camY: number;
      if (mapW <= canvas.width) {
        camX = -(canvas.width - mapW) / 2;
      } else {
        camX = Math.max(0, Math.min(g.me.x - canvas.width / 2, mapW - canvas.width));
      }
      if (mapH <= canvas.height) {
        camY = -(canvas.height - mapH) / 2;
      } else {
        camY = Math.max(0, Math.min(g.me.y - canvas.height / 2, mapH - canvas.height));
      }
      const worldX = mx + camX;
      const worldY = my + camY;
      g.mouseAngle = Math.atan2(worldY - g.me.y, worldX - g.me.x);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      shoot();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);

    function shoot() {
      const now = Date.now();
      if (now - g.me.lastShot < SHOOT_COOLDOWN) return;
      const myBullets = g.bullets.filter(b => b.owner === g.role);
      if (myBullets.length >= MAX_BULLETS_PER_PLAYER) return;

      g.me.lastShot = now;
      const angle = g.me.angle;
      const bullet: Bullet = {
        x: g.me.x, y: g.me.y,
        dx: Math.cos(angle), dy: Math.sin(angle),
        owner: g.role,
        age: 0,
      };
      g.bullets.push(bullet);
      g.muzzleFlash = 2;

      wsRef.current?.send(JSON.stringify({ t: 'shoot', x: g.me.x, y: g.me.y, a: angle }));
    }

    function loop(time: number) {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      if (!g.maze) {
        g.animId = requestAnimationFrame(loop);
        return;
      }

      // Movement
      let dx = 0, dy = 0;
      if (g.keys.has('KeyW')) dy -= 1;
      if (g.keys.has('KeyS')) dy += 1;
      if (g.keys.has('KeyA')) dx -= 1;
      if (g.keys.has('KeyD')) dx += 1;
      if (dx !== 0 && dy !== 0) {
        const len = Math.sqrt(dx * dx + dy * dy);
        dx /= len;
        dy /= len;
      }

      const pos = movePlayer(g.me.x, g.me.y, dx, dy, dt, g.maze.grid);
      g.me.x = pos.x;
      g.me.y = pos.y;
      g.me.angle = g.mouseAngle;

      // Bullets
      g.bullets = g.bullets.filter(b => {
        const hitWall = stepBullet(b, dt, g.maze!.grid);
        return !hitWall;
      });

      // Check powerup pickup
      for (const pu of g.powerups) {
        if (!pu.active) continue;
        const pdx = g.me.x - pu.x;
        const pdy = g.me.y - pu.y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < POWERUP_PICKUP_DIST) {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ t: 'pickup', id: pu.id }));
          } else {
            // Test mode — handle locally
            pu.active = false;
            g.lightReveal = {
              x: pu.x, y: pu.y,
              radius: POWERUP_LIGHT_RADIUS,
              alpha: 1,
              endTime: Date.now() + POWERUP_DURATION,
            };
          }
        }
      }

      // Decay light reveal
      if (g.lightReveal) {
        const remaining = g.lightReveal.endTime - Date.now();
        if (remaining <= 0) {
          g.lightReveal = null;
        } else {
          g.lightReveal.alpha = Math.min(1, remaining / 500); // fade out in last 500ms
        }
      }

      // Decay effects
      if (g.muzzleFlash > 0) g.muzzleFlash--;
      if (g.hitFlash > 0) g.hitFlash--;
      if (g.killText) {
        g.killText.alpha -= dt;
        if (g.killText.alpha <= 0) g.killText = null;
      }

      // Send position (only in multiplayer)
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const now = performance.now();
        if (now - g.lastSend > 1000 / SEND_RATE) {
          g.lastSend = now;
          wsRef.current.send(JSON.stringify({
            t: 'pos', x: Math.round(g.me.x), y: Math.round(g.me.y), a: +g.me.angle.toFixed(3),
          }));
        }
      }

      // Render
      render(ctx!, {
        me: g.me,
        opponent: g.opponent,
        myRole: g.role,
        bullets: g.bullets,
        grid: g.maze.grid,
        walls: g.maze.walls,
        muzzleFlash: g.muzzleFlash,
        hitFlash: g.hitFlash,
        killText: g.killText,
        scores: g.scores,
        winner: g.winner,
        powerups: g.powerups,
        lightReveal: g.lightReveal,
      });

      g.animId = requestAnimationFrame(loop);
    }

    g.animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(g.animId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [phase]);

  const handleTestMap = () => {
    const g = gameRef.current;
    const seed = Math.floor(Math.random() * 2147483647);
    const maze = generateMaze(seed);
    g.maze = maze;
    g.role = 0;
    g.scores = [0, 0];
    g.winner = null;
    g.bullets = [];
    g.lightReveal = null;
    g.me = {
      x: maze.spawn1.x, y: maze.spawn1.y,
      angle: 0, hp: MAX_HP, score: 0, lastShot: 0, invulnUntil: 0,
    };
    g.opponent = {
      x: maze.spawn2.x, y: maze.spawn2.y,
      angle: 0, hp: MAX_HP, score: 0, lastShot: 0, invulnUntil: 0,
    };
    // Generate local powerups
    const openCells: { x: number; y: number }[] = [];
    const TILE = 40, COLS = 32, ROWS = 24;
    for (let y = 3; y < ROWS - 3; y++) {
      for (let x = 3; x < COLS - 3; x++) {
        if (!maze.grid[y][x]) openCells.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
      }
    }
    for (let i = openCells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [openCells[i], openCells[j]] = [openCells[j], openCells[i]];
    }
    g.powerups = [];
    for (let i = 0; i < Math.min(5, openCells.length); i++) {
      g.powerups.push({ x: openCells[i].x, y: openCells[i].y, id: i, active: true });
    }
    setRole(0);
    setWinner(null);
    setPhase('playing');
  };

  // Shift+T to open test map from menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyT' && e.shiftKey && phase === 'menu') {
        handleTestMap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const handleCreate = () => connectWS('create');
  const handleJoin = () => {
    if (roomCode.length !== 4) return;
    connectWS('join', roomCode.toUpperCase());
  };
  const handleCopy = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(displayCode);
    } else {
      const ta = document.createElement('textarea');
      ta.value = displayCode;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const handlePlayAgain = () => {
    wsRef.current?.close();
    gameRef.current.winner = null;
    setWinner(null);
    setPhase('menu');
  };

  return (
    <div className="h-screen w-screen bg-black text-white font-[family-name:var(--font-geist-mono)] overflow-hidden">
      {phase === 'menu' && (
        <div className="flex flex-col items-center justify-center h-full gap-8">
          <h1 className="text-4xl font-bold tracking-widest">BLACKOUT</h1>
          <p className="text-sm text-neutral-500">1v1 Dark Maze Shooter</p>
          {connError && (
            <p className="text-xs text-red-500 max-w-xs text-center">{connError}</p>
          )}
          <div className="flex flex-col gap-4 w-64">
            <button
              onClick={handleCreate}
              className="h-12 border border-neutral-700 hover:border-neutral-400 transition-colors text-sm tracking-wider"
            >
              CREATE GAME
            </button>
            <div className="flex gap-2">
              <input
                type="text"
                maxLength={4}
                placeholder="CODE"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="flex-1 h-12 bg-transparent border border-neutral-700 text-center text-sm tracking-[0.3em] placeholder:text-neutral-600 focus:border-neutral-400 focus:outline-none"
              />
              <button
                onClick={handleJoin}
                className="h-12 px-6 border border-neutral-700 hover:border-neutral-400 transition-colors text-sm tracking-wider"
              >
                JOIN
              </button>
            </div>
          </div>
        </div>
      )}

      {phase === 'waiting' && (
        <div className="flex flex-col items-center justify-center h-full gap-6">
          {displayCode ? (
            <>
              <p className="text-sm text-neutral-500">Share this code with your opponent:</p>
              <div className="flex items-center gap-3">
                <span className="text-4xl tracking-[0.5em] font-bold">{displayCode}</span>
                <button
                  onClick={handleCopy}
                  className="text-xs text-neutral-500 hover:text-white border border-neutral-700 px-3 py-1"
                >
                  {copied ? 'COPIED' : 'COPY'}
                </button>
              </div>
              <p className="text-sm text-neutral-500">Waiting for opponent to join...</p>
            </>
          ) : (
            <p className="text-sm text-neutral-500">Connecting...</p>
          )}
        </div>
      )}

      {(phase === 'playing' || phase === 'over') && (
        <>
          <canvas
            ref={canvasRef}
            className="block w-full h-full cursor-crosshair"
            onClick={phase === 'over' ? handlePlayAgain : undefined}
          />
          {phase === 'over' && winner !== null && (
            <div className="absolute inset-0 bg-black/85 flex items-center justify-center z-10">
              <div className="border-2 p-8 flex flex-col items-center gap-5 w-[400px]"
                style={{ borderColor: winner === 0 ? '#00ffaa' : '#ff5566', background: '#0a0a12' }}>
                <p className="text-sm text-neutral-500 tracking-widest">GAME OVER</p>
                <h2 className="text-3xl font-bold" style={{ color: winner === 0 ? '#00ffaa' : '#ff5566' }}>
                  PLAYER {winner + 1} WINS!
                </h2>
                <p className="text-lg">
                  {winner === role ? 'VICTORY' : 'DEFEAT'}
                </p>
                <p className="text-neutral-400">
                  <span style={{ color: '#00ffaa' }}>{gameRef.current.scores[0]}</span>
                  {' - '}
                  <span style={{ color: '#ff5566' }}>{gameRef.current.scores[1]}</span>
                </p>
                <button
                  onClick={handlePlayAgain}
                  className="mt-2 h-10 w-48 text-sm tracking-wider font-bold text-black"
                  style={{ background: winner === 0 ? '#00ffaa' : '#ff5566' }}
                >
                  BACK TO MENU
                </button>
              </div>
            </div>
          )}
          {paused && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-6 z-10">
              <h2 className="text-2xl font-bold tracking-widest">PAUSED</h2>
              <div className="flex flex-col gap-3 w-48">
                <button
                  onClick={() => setPaused(false)}
                  className="h-10 border border-neutral-700 hover:border-neutral-400 transition-colors text-sm tracking-wider"
                >
                  RESUME
                </button>
                <button
                  onClick={() => {
                    setPaused(false);
                    wsRef.current?.close();
                    wsRef.current = null;
                    gameRef.current.winner = null;
                    setWinner(null);
                    setPhase('menu');
                  }}
                  className="h-10 border border-neutral-700 hover:border-red-500 transition-colors text-sm tracking-wider text-neutral-400 hover:text-red-400"
                >
                  QUIT TO MENU
                </button>
              </div>
              <p className="text-xs text-neutral-600 mt-4">Press ESC to resume</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
