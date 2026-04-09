import {
  COLOR_P1, COLOR_P2,
  PLAYER_RADIUS, RAY_MAX, EDGE_SOFT_RATIO, FOV,
  BULLET_TRAIL_FRAMES, POWERUP_RADIUS, POWERUP_LIGHT_RADIUS,
  TILE,
} from './constants';
import { getCellSize } from './map';
import { buildVisionPolygon, isPointVisible } from './raycast';
import type { Point, Segment, Player, Bullet, Powerup } from './types';

interface RenderState {
  me: Player;
  opponent: Player | null;
  myRole: number;
  bullets: Bullet[];
  grid: boolean[][];
  walls: Segment[];
  muzzleFlash: number;
  hitFlash: number;
  killText: { text: string; alpha: number } | null;
  scores: [number, number];
  winner: number | null;
  powerups: Powerup[];
  lightReveal: { x: number; y: number; radius: number; alpha: number } | null;
}

export function render(ctx: CanvasRenderingContext2D, state: RenderState) {
  const { width, height } = ctx.canvas;
  const cellSize = getCellSize();
  const gw = state.grid[0].length;
  const gh = state.grid.length;
  const mapW = gw * cellSize;
  const mapH = gh * cellSize;

  // Center map if it's smaller than viewport, otherwise scroll with player
  let camX: number, camY: number;
  if (mapW <= width) {
    camX = -(width - mapW) / 2; // negative offset to center
  } else {
    camX = Math.max(0, Math.min(state.me.x - width / 2, mapW - width));
  }
  if (mapH <= height) {
    camY = -(height - mapH) / 2;
  } else {
    camY = Math.max(0, Math.min(state.me.y - height / 2, mapH - height));
  }

  ctx.save();

  // 1. Fill black
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  // Build vision polygon
  const visionPoly = buildVisionPolygon(state.me.x, state.me.y, state.me.angle, state.walls);

  // 2. Clip to vision polygon
  ctx.save();
  ctx.translate(-camX, -camY);

  // Build clip path: vision cone + any active light reveal circles
  ctx.beginPath();
  ctx.moveTo(state.me.x, state.me.y);
  for (const p of visionPoly) {
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  // Add powerup light reveal as additional visible area (follows player)
  if (state.lightReveal && state.lightReveal.alpha > 0) {
    const lr = state.lightReveal;
    ctx.moveTo(state.me.x + lr.radius, state.me.y);
    ctx.arc(state.me.x, state.me.y, lr.radius, 0, Math.PI * 2);
  }

  ctx.clip();

  // 3. Draw floor — subtle grid pattern for navigation
  ctx.fillStyle = '#111118';
  ctx.fillRect(0, 0, mapW, mapH);

  // Floor grid lines
  ctx.strokeStyle = '#1a1a22';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= gw; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellSize, 0);
    ctx.lineTo(x * cellSize, mapH);
    ctx.stroke();
  }
  for (let y = 0; y <= gh; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellSize);
    ctx.lineTo(mapW, y * cellSize);
    ctx.stroke();
  }

  // Draw walls — clearly visible with color and 3D-ish effect
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (state.grid[y][x]) {
        const wx = x * cellSize;
        const wy = y * cellSize;
        // Wall fill
        ctx.fillStyle = '#4a3828';
        ctx.fillRect(wx, wy, cellSize, cellSize);
        // Top/left highlight
        ctx.strokeStyle = '#6b5540';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wx, wy + cellSize);
        ctx.lineTo(wx, wy);
        ctx.lineTo(wx + cellSize, wy);
        ctx.stroke();
        // Bottom/right shadow
        ctx.strokeStyle = '#2e2018';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wx + cellSize, wy);
        ctx.lineTo(wx + cellSize, wy + cellSize);
        ctx.lineTo(wx, wy + cellSize);
        ctx.stroke();
      }
    }
  }

  // Draw powerups (glowing orbs)
  for (const pu of state.powerups) {
    if (!pu.active) continue;
    // Outer glow
    const glowGrad = ctx.createRadialGradient(pu.x, pu.y, 0, pu.x, pu.y, POWERUP_RADIUS * 2.5);
    glowGrad.addColorStop(0, 'rgba(255, 220, 50, 0.4)');
    glowGrad.addColorStop(1, 'rgba(255, 220, 50, 0)');
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, POWERUP_RADIUS * 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Core
    ctx.fillStyle = '#ffdd44';
    ctx.beginPath();
    ctx.arc(pu.x, pu.y, POWERUP_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    // Inner highlight
    ctx.fillStyle = '#ffffaa';
    ctx.beginPath();
    ctx.arc(pu.x - 3, pu.y - 3, POWERUP_RADIUS * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw bullets
  for (const b of state.bullets) {
    const alpha = Math.max(0.2, 1 - b.age / (BULLET_TRAIL_FRAMES + 3));
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();

    if (b.age < BULLET_TRAIL_FRAMES) {
      const trailLen = 12;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.4 * (1 - b.age / BULLET_TRAIL_FRAMES)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.dx * trailLen, b.y - b.dy * trailLen);
      ctx.stroke();
    }
  }

  // Draw opponent if visible
  if (state.opponent) {
    const opp = state.opponent;
    const visible = isPointVisible(
      state.me.x, state.me.y, state.me.angle,
      opp.x, opp.y, state.walls
    );
    // Also visible if inside light reveal radius
    let inLightReveal = false;
    if (state.lightReveal && state.lightReveal.alpha > 0) {
      const ldx = opp.x - state.me.x;
      const ldy = opp.y - state.me.y;
      inLightReveal = Math.sqrt(ldx * ldx + ldy * ldy) < state.lightReveal.radius;
    }
    if (visible || inLightReveal) {
      const oppColor = state.myRole === 0 ? COLOR_P2 : COLOR_P1;
      ctx.fillStyle = oppColor;
      ctx.beginPath();
      ctx.arc(opp.x, opp.y, PLAYER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = oppColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(opp.x, opp.y);
      ctx.lineTo(opp.x + Math.cos(opp.angle) * 16, opp.y + Math.sin(opp.angle) * 16);
      ctx.stroke();
    }
  }

  // Muzzle flash
  if (state.muzzleFlash > 0) {
    const flashAlpha = state.muzzleFlash / 2;
    ctx.fillStyle = `rgba(255, 255, 200, ${flashAlpha * 0.6})`;
    ctx.beginPath();
    ctx.arc(state.me.x, state.me.y, 20, 0, Math.PI * 2);
    ctx.fill();
  }

  const hasReveal = state.lightReveal && state.lightReveal.alpha > 0;

  if (hasReveal) {
    // During reveal: only apply a gentle radial fade at the reveal radius edge
    const lr = state.lightReveal!;
    ctx.globalCompositeOperation = 'source-atop';
    const lrGrad = ctx.createRadialGradient(state.me.x, state.me.y, 0, state.me.x, state.me.y, lr.radius);
    lrGrad.addColorStop(0, 'rgba(0,0,0,0)');
    lrGrad.addColorStop(0.85, 'rgba(0,0,0,0)');
    lrGrad.addColorStop(1, `rgba(0,0,0,${0.5 * lr.alpha})`);
    ctx.fillStyle = lrGrad;
    ctx.beginPath();
    ctx.arc(state.me.x, state.me.y, lr.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    // Normal flashlight: distance falloff + edge softness
    const gradient = ctx.createRadialGradient(
      state.me.x, state.me.y, 0,
      state.me.x, state.me.y, RAY_MAX
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.75, 'rgba(0,0,0,0.25)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.7)');

    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = gradient;
    const gradSize = RAY_MAX * 1.5;
    ctx.fillRect(state.me.x - gradSize, state.me.y - gradSize, gradSize * 2, gradSize * 2);

    // Edge softness
    ctx.globalCompositeOperation = 'destination-out';
    const halfFov = FOV / 2;
    const edgeAngle = halfFov * EDGE_SOFT_RATIO;
    drawEdgeFade(ctx, state.me.x, state.me.y, state.me.angle - halfFov, edgeAngle, RAY_MAX, true);
    drawEdgeFade(ctx, state.me.x, state.me.y, state.me.angle + halfFov - edgeAngle, edgeAngle, RAY_MAX, false);

    ctx.globalCompositeOperation = 'source-over';
  }

  // 5. Restore clip
  ctx.restore();

  // Draw player (always visible, outside clip)
  ctx.translate(-camX, -camY);
  const myColor = state.myRole === 0 ? COLOR_P1 : COLOR_P2;
  ctx.fillStyle = myColor;
  ctx.beginPath();
  ctx.arc(state.me.x, state.me.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = myColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(state.me.x, state.me.y);
  ctx.lineTo(state.me.x + Math.cos(state.me.angle) * 18, state.me.y + Math.sin(state.me.angle) * 18);
  ctx.stroke();

  ctx.restore();

  // 6. HUD
  drawHUD(ctx, state);

  // Hit flash overlay
  if (state.hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 0, 0, ${state.hitFlash * 0.15})`;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawEdgeFade(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  startAngle: number, span: number, radius: number,
  fadeIn: boolean
) {
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const alpha = fadeIn ? (1 - t) * 0.3 : t * 0.3;
    const a1 = startAngle + (span / steps) * i;
    const a2 = startAngle + (span / steps) * (i + 1);
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, a1, a2);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHUD(ctx: CanvasRenderingContext2D, state: RenderState) {
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.font = '16px "Geist Mono", monospace';
  ctx.textBaseline = 'top';

  // Score display with player colors
  const s1 = state.scores[0];
  const s2 = state.scores[1];

  const dotSize = 10;
  const dotGap = 6;
  const dashWidth = 20;
  const totalWidth = 2 * (30 + 3 * (dotSize + dotGap)) + dashWidth;
  const startX = (width - totalWidth) / 2;
  let cx = startX;

  // P1 label
  ctx.fillStyle = COLOR_P1;
  ctx.textAlign = 'left';
  ctx.fillText('P1', cx, 14);
  cx += 30;

  // P1 dots
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx + dotSize / 2, 22, dotSize / 2, 0, Math.PI * 2);
    if (i < s1) {
      ctx.fillStyle = COLOR_P1;
      ctx.fill();
    } else {
      ctx.strokeStyle = COLOR_P1;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    cx += dotSize + dotGap;
  }

  // Dash
  cx += 8;
  ctx.fillStyle = '#555';
  ctx.fillRect(cx, 19, dashWidth, 3);
  cx += dashWidth + 8;

  // P2 dots
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx + dotSize / 2, 22, dotSize / 2, 0, Math.PI * 2);
    if (i < s2) {
      ctx.fillStyle = COLOR_P2;
      ctx.fill();
    } else {
      ctx.strokeStyle = COLOR_P2;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    cx += dotSize + dotGap;
  }

  // P2 label
  ctx.fillStyle = COLOR_P2;
  ctx.fillText('P2', cx + 4, 14);

  // HP indicator
  const hp = state.me.hp;
  ctx.textAlign = 'left';
  ctx.font = '14px "Geist Mono", monospace';
  ctx.fillStyle = hp > 1 ? '#ffffff' : '#ff4444';
  let hpText = 'HP ';
  for (let i = 0; i < 2; i++) hpText += i < hp ? '\u25A0 ' : '\u25A1 ';
  ctx.fillText(hpText, 16, height - 30);

  // Kill text
  if (state.killText && state.killText.alpha > 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = state.killText.alpha;
    ctx.font = '28px "Geist Mono", monospace';
    ctx.fillStyle = state.killText.text === 'DIED' ? '#ff5566' : '#00ffaa';
    ctx.fillText(state.killText.text, width / 2, height / 2 - 40);
    ctx.globalAlpha = 1;
  }

  // Win screen is handled by HTML overlay

  ctx.restore();
}
