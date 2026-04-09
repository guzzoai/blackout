import { FOV, RAY_COUNT, RAY_MAX } from './constants';
import type { Point, Segment } from './types';

// Ray-segment intersection — returns distance or null
function raySegmentIntersect(
  ox: number, oy: number, dx: number, dy: number,
  s: Segment
): number | null {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;

  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((s.x1 - ox) * sy - (s.y1 - oy) * sx) / denom;
  const u = ((s.x1 - ox) * dy - (s.y1 - oy) * dx) / denom;

  if (t > 0 && u >= 0 && u <= 1) {
    return t;
  }
  return null;
}

// Cast a single ray and return the hit point
function castRay(
  ox: number, oy: number, angle: number, walls: Segment[]
): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let minDist = RAY_MAX;

  for (const wall of walls) {
    const dist = raySegmentIntersect(ox, oy, dx, dy, wall);
    if (dist !== null && dist < minDist) {
      minDist = dist;
    }
  }

  return {
    x: ox + dx * minDist,
    y: oy + dy * minDist,
  };
}

// Build vision polygon from rays
export function buildVisionPolygon(
  px: number, py: number, angle: number, walls: Segment[]
): Point[] {
  const points: Point[] = [];
  const halfFov = FOV / 2;
  const startAngle = angle - halfFov;
  const step = FOV / (RAY_COUNT - 1);

  for (let i = 0; i < RAY_COUNT; i++) {
    const rayAngle = startAngle + step * i;
    points.push(castRay(px, py, rayAngle, walls));
  }

  return points;
}

// Check if a point is visible (inside vision polygon and not behind walls)
export function isPointVisible(
  px: number, py: number, angle: number,
  tx: number, ty: number, walls: Segment[]
): boolean {
  const dx = tx - px;
  const dy = ty - py;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > RAY_MAX) return false;

  // Check angle
  let targetAngle = Math.atan2(dy, dx);
  let diff = targetAngle - angle;
  // Normalize to [-PI, PI]
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  if (Math.abs(diff) > FOV / 2) return false;

  // Check wall occlusion — cast ray toward target
  const rdx = Math.cos(targetAngle);
  const rdy = Math.sin(targetAngle);
  for (const wall of walls) {
    const d = raySegmentIntersect(px, py, rdx, rdy, wall);
    if (d !== null && d < dist) return false;
  }

  return true;
}
