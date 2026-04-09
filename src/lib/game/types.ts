export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Player {
  x: number;
  y: number;
  angle: number;
  hp: number;
  score: number;
  lastShot: number;
  invulnUntil: number;
}

export interface Bullet {
  x: number;
  y: number;
  dx: number;
  dy: number;
  owner: number; // 0 or 1
  age: number;
}

export interface GameState {
  players: [Player, Player];
  bullets: Bullet[];
  phase: 'lobby' | 'playing' | 'over';
  winner: number | null;
}

export interface Powerup {
  x: number;
  y: number;
  id: number;
  active: boolean;
}

// WebSocket message types
export type ClientMsg =
  | { t: 'pos'; x: number; y: number; a: number }
  | { t: 'shoot'; x: number; y: number; a: number };

export type ServerMsg =
  | { t: 'start'; seed: number; role: number }
  | { t: 'pos'; x: number; y: number; a: number }
  | { t: 'shoot'; x: number; y: number; a: number }
  | { t: 'hit'; target: number; hp: number }
  | { t: 'kill'; killer: number; victim: number; s1: number; s2: number }
  | { t: 'win'; winner: number }
  | { t: 'room'; code: string }
  | { t: 'wait' }
  | { t: 'joined' }
  | { t: 'opponent_left' }
  | { t: 'powerups'; list: { x: number; y: number; id: number }[] }
  | { t: 'powerup_taken'; id: number; by: number }
  | { t: 'powerup_gone'; id: number }
  | { t: 'powerup_spawn'; x: number; y: number; id: number }
  | { t: 'newmap'; seed: number; role: number };
