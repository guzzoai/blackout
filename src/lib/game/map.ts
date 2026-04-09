import { COLS, ROWS, TILE } from './constants';
import type { Segment } from './types';

// Mulberry32 seeded RNG
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MazeResult {
  grid: boolean[][]; // true = wall
  walls: Segment[];
  spawn1: { x: number; y: number };
  spawn2: { x: number; y: number };
}

// Open arena with scattered blocks/walls
export function generateMaze(seed: number): MazeResult {
  const rng = mulberry32(seed);

  // Simple tile grid: each cell = TILE px
  const grid: boolean[][] = [];
  for (let y = 0; y < ROWS; y++) {
    grid[y] = [];
    for (let x = 0; x < COLS; x++) {
      // Border walls
      if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) {
        grid[y][x] = true;
      } else {
        grid[y][x] = false;
      }
    }
  }

  // Place random rectangular blocks (~30 blocks)
  const blockCount = 25 + Math.floor(rng() * 10);
  const spawnMargin = 5; // keep spawn corners clear

  for (let i = 0; i < blockCount; i++) {
    // Random block size: 1-3 tiles wide, 1-3 tiles tall
    const bw = 1 + Math.floor(rng() * 3);
    const bh = 1 + Math.floor(rng() * 3);
    const bx = 1 + Math.floor(rng() * (COLS - 2 - bw));
    const by = 1 + Math.floor(rng() * (ROWS - 2 - bh));

    // Don't place near spawn corners
    const nearSpawn1 = bx < spawnMargin && by < spawnMargin;
    const nearSpawn2 = bx + bw > COLS - spawnMargin && by + bh > ROWS - spawnMargin;
    if (nearSpawn1 || nearSpawn2) continue;

    for (let dy = 0; dy < bh; dy++) {
      for (let dx = 0; dx < bw; dx++) {
        grid[by + dy][bx + dx] = true;
      }
    }
  }

  // Place some thin horizontal and vertical wall segments
  const wallCount = 8 + Math.floor(rng() * 6);
  for (let i = 0; i < wallCount; i++) {
    const horizontal = rng() > 0.5;
    const len = 3 + Math.floor(rng() * 5);

    if (horizontal) {
      const wx = 2 + Math.floor(rng() * (COLS - 4 - len));
      const wy = 2 + Math.floor(rng() * (ROWS - 4));
      const nearSpawn1 = wx < spawnMargin && wy < spawnMargin;
      const nearSpawn2 = wx + len > COLS - spawnMargin && wy > ROWS - spawnMargin;
      if (nearSpawn1 || nearSpawn2) continue;
      for (let dx = 0; dx < len; dx++) {
        grid[wy][wx + dx] = true;
      }
    } else {
      const wx = 2 + Math.floor(rng() * (COLS - 4));
      const wy = 2 + Math.floor(rng() * (ROWS - 4 - len));
      const nearSpawn1 = wx < spawnMargin && wy < spawnMargin;
      const nearSpawn2 = wx > COLS - spawnMargin && wy + len > ROWS - spawnMargin;
      if (nearSpawn1 || nearSpawn2) continue;
      for (let dy = 0; dy < len; dy++) {
        grid[wy + dy][wx] = true;
      }
    }
  }

  // Extract wall segments for raycasting
  const walls: Segment[] = [];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (!grid[y][x]) continue;
      const px = x * TILE;
      const py = y * TILE;
      // Top
      if (y === 0 || !grid[y - 1][x]) {
        walls.push({ x1: px, y1: py, x2: px + TILE, y2: py });
      }
      // Bottom
      if (y === ROWS - 1 || !grid[y + 1][x]) {
        walls.push({ x1: px, y1: py + TILE, x2: px + TILE, y2: py + TILE });
      }
      // Left
      if (x === 0 || !grid[y][x - 1]) {
        walls.push({ x1: px, y1: py, x2: px, y2: py + TILE });
      }
      // Right
      if (x === COLS - 1 || !grid[y][x + 1]) {
        walls.push({ x1: px + TILE, y1: py, x2: px + TILE, y2: py + TILE });
      }
    }
  }

  const mergedWalls = mergeSegments(walls);

  // Spawn points: top-left corner and bottom-right corner
  const spawn1 = { x: 2 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 };
  const spawn2 = { x: (COLS - 3) * TILE + TILE / 2, y: (ROWS - 3) * TILE + TILE / 2 };

  return { grid, walls: mergedWalls, spawn1, spawn2 };
}

function mergeSegments(segments: Segment[]): Segment[] {
  const horizontal: Segment[] = [];
  const vertical: Segment[] = [];

  for (const s of segments) {
    if (s.y1 === s.y2) horizontal.push(s);
    else if (s.x1 === s.x2) vertical.push(s);
  }

  horizontal.sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  vertical.sort((a, b) => a.x1 - b.x1 || a.y1 - b.y1);

  const merged: Segment[] = [];

  for (let i = 0; i < horizontal.length; i++) {
    const cur = { ...horizontal[i] };
    while (i + 1 < horizontal.length && horizontal[i + 1].y1 === cur.y1 && horizontal[i + 1].x1 === cur.x2) {
      cur.x2 = horizontal[i + 1].x2;
      i++;
    }
    merged.push(cur);
  }

  for (let i = 0; i < vertical.length; i++) {
    const cur = { ...vertical[i] };
    while (i + 1 < vertical.length && vertical[i + 1].x1 === cur.x1 && vertical[i + 1].y1 === cur.y2) {
      cur.y2 = vertical[i + 1].y2;
      i++;
    }
    merged.push(cur);
  }

  return merged;
}

// Check if a pixel position is in a wall
export function isWall(grid: boolean[][], x: number, y: number): boolean {
  const gx = Math.floor(x / TILE);
  const gy = Math.floor(y / TILE);
  if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return true;
  return grid[gy][gx];
}

export function getCellSize(): number {
  return TILE;
}

export function getMapDimensions(): { w: number; h: number } {
  return { w: COLS * TILE, h: ROWS * TILE };
}
