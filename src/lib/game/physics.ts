import { PLAYER_RADIUS, PLAYER_SPEED, BULLET_SPEED } from './constants';
import { isWall } from './map';
import type { Bullet } from './types';

// Move player with wall collision
export function movePlayer(
  x: number, y: number,
  dx: number, dy: number,
  dt: number,
  grid: boolean[][]
): { x: number; y: number } {
  const speed = PLAYER_SPEED * dt;
  let nx = x + dx * speed;
  let ny = y + dy * speed;

  const r = PLAYER_RADIUS;

  // Check X movement
  if (dx !== 0) {
    const testX = nx;
    const blocked =
      isWall(grid, testX - r, y - r) ||
      isWall(grid, testX + r, y - r) ||
      isWall(grid, testX - r, y + r) ||
      isWall(grid, testX + r, y + r) ||
      isWall(grid, testX - r, y) ||
      isWall(grid, testX + r, y) ||
      isWall(grid, testX, y - r) ||
      isWall(grid, testX, y + r);
    if (blocked) nx = x;
  }

  // Check Y movement
  if (dy !== 0) {
    const testY = ny;
    const blocked =
      isWall(grid, nx - r, testY - r) ||
      isWall(grid, nx + r, testY - r) ||
      isWall(grid, nx - r, testY + r) ||
      isWall(grid, nx + r, testY + r) ||
      isWall(grid, nx - r, testY) ||
      isWall(grid, nx + r, testY) ||
      isWall(grid, nx, testY - r) ||
      isWall(grid, nx, testY + r);
    if (blocked) ny = y;
  }

  return { x: nx, y: ny };
}

// Step bullet forward, return true if it should be destroyed (hit wall)
export function stepBullet(bullet: Bullet, dt: number, grid: boolean[][]): boolean {
  bullet.x += bullet.dx * BULLET_SPEED * dt;
  bullet.y += bullet.dy * BULLET_SPEED * dt;
  bullet.age++;
  return isWall(grid, bullet.x, bullet.y);
}
