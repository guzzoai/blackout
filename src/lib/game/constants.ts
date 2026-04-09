// Map
export const COLS = 32;
export const ROWS = 24;
export const TILE = 40;
export const MAP_W = COLS * TILE;
export const MAP_H = ROWS * TILE;
export const WALL_REMOVE_RATIO = 0.15;

// Player
export const PLAYER_SPEED = 160;
export const PLAYER_RADIUS = 8;
export const MAX_HP = 2;
export const RESPAWN_INVULN_MS = 1500;

// Vision
export const FOV = 0.45 * Math.PI;
export const RAY_COUNT = 80;
export const RAY_MAX = 280;
export const EDGE_SOFT_RATIO = 0.15;

// Shooting
export const BULLET_SPEED = 600;
export const SHOOT_COOLDOWN = 300;
export const MAX_BULLETS_PER_PLAYER = 3;
export const BULLET_HIT_DIST = 13;
export const BULLET_TRAIL_FRAMES = 3;

// Multiplayer
export const TICK_RATE = 30;
export const SEND_RATE = 20;

// Scoring
export const KILLS_TO_WIN = 3;

// Powerups
export const POWERUP_COUNT = 5;
export const POWERUP_RADIUS = 12;
export const POWERUP_LIGHT_RADIUS = 300;
export const POWERUP_DURATION = 3000; // ms
export const POWERUP_PICKUP_DIST = 25;

// Colors
export const COLOR_WALL = '#1a1a1a';
export const COLOR_FLOOR = '#0d0d0d';
export const COLOR_P1 = '#00ffaa';
export const COLOR_P2 = '#ff5566';
export const COLOR_BULLET = '#ffffff';
