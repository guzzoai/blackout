# Blackout — 1v1 Dark Maze Shooter

A browser-based 1v1 top-down shooter where two players hunt each other in a pitch-black procedurally generated maze, visible only through a flashlight vision cone. First to 3 kills wins.

---

## Tech Stack

- Next.js (App Router)
- Single-page game — no routing needed
- Canvas 2D rendering (no game engine, no Three.js)
- WebSocket server for multiplayer (`ws` package, standalone server on separate port or Next.js custom server)
- No database — all game state lives in memory on the server
- TypeScript throughout

---

## 1. Lobby & Matchmaking

- Player 1 creates a game → gets a 4-character uppercase room code
- Player 2 enters the code to join
- Once both connected via WebSocket, server sends a shared map seed and assigns roles (P1 / P2)
- UI: dark minimal lobby screen with an input field for room code, a "Create Game" button, and a copy-to-clipboard button for sharing

---

## 2. Procedural Map

- Seeded RNG (mulberry32) so both clients generate identical maps from the same seed
- Recursive backtracker maze on a grid of ~32 columns × 24 rows, 40px per tile
- After generation, randomly remove ~15% of internal walls to widen corridors and create varied sightlines
- Extract wall line segments from the grid for use in raycasting (each wall tile face adjacent to an open tile becomes a segment)
- Spawn points: P1 near top-left, P2 near bottom-right (first and last open cells found by scanning the grid)

---

## 3. Rendering (Canvas 2D)

The entire map exists but is invisible. The only light source is the player's flashlight cone.

### Vision cone

- ~80 rays cast across a 0.45π radian (≈81°) field of view, max range 280px
- Each ray uses ray-segment intersection against all wall segments and stops at the first hit. Nothing behind a wall is ever visible — no bleed, no exceptions
- The resulting hit points plus the player origin form a polygon that defines the lit area

### Distance falloff

- The vision cone fades from full brightness at the player to near-black at max distance
- Implement as a radial gradient mask (centered on the player) composited over the lit area using `globalCompositeOperation`
- Should feel like a real flashlight: bright core, soft organic fade, darkness at the fringe. Not a hard cutoff

### Edge softness

- The outer ~15% of the FOV angle dims slightly so the cone edges are not razor sharp
- Can be baked into the gradient or applied as a secondary angular mask

### Draw order

1. Fill entire canvas black
2. Save context, clip to the vision polygon
3. Draw floor tiles, walls, bullets, opponent (if inside the polygon)
4. Overlay radial gradient for distance falloff
5. Restore context (removes clip)
6. Draw HUD on top (never clipped)

### Colors & visuals

- Walls: `#1a1a1a` when lit, invisible when unlit
- Floor: `#0d0d0d`
- Player: small circle (~10px radius) with a short directional line showing aim
- Opponent: same shape, different accent color, only rendered when inside vision polygon and not behind a wall
- Bullets: bright white dot with a short fading trail (2–3 frames of afterglow)
- Muzzle flash: brief bright circle at player position on shoot (1–2 frames)
- Hit feedback: red tinted screen flash overlay when taking damage

---

## 4. Player Movement

- WASD for movement, mouse position determines aim direction
- Speed: 160 px/s
- Collision: treat player as a circle with 8px radius. Check 8 sample points (corners + cardinal edges) against the tile grid. If any sample lands in a wall tile, block movement in that axis
- Use `requestAnimationFrame` with delta-time for a smooth 60fps loop
- Activate Pointer Lock API on canvas click for proper mouse-aim control

---

## 5. Shooting

- Left mouse click to fire
- Bullet spawns at player center, travels at 600 px/s in the current aim direction
- Bullet collides with walls (check tile at bullet position each frame) and is destroyed
- Bullet collides with opponent if distance from bullet center to opponent center < 13px
- 2-hit kill system: each player has 2 HP. On death, respawn at original spawn point after 1.5s invulnerability
- Cooldown: 300ms minimum between shots
- Max 3 active bullets per player at a time

---

## 6. Multiplayer Sync (WebSocket)

The server is the authority on hits, kills, and scoring. Clients are authority on their own position.

### Client → Server

- Position update (throttled to 20–30 Hz): `{ type: "pos", x, y, a }` (a = angle)
- Shoot event: `{ type: "shoot", x, y, a }`

### Server → Client

- Opponent position broadcast (every tick): `{ type: "pos", x, y, a }`
- Hit confirmed: `{ type: "hit", target, hp }`
- Kill confirmed: `{ type: "kill", killer, victim, score1, score2 }`
- Round over: `{ type: "win", winner }`
- Game start: `{ type: "start", seed, role }`

### Server responsibilities

- Maintain per-room state: two player positions, active bullets array, HP, scores
- Run bullet simulation at server tick rate (~30 Hz) for hit detection
- Validate kill conditions and broadcast results
- Clean up rooms on disconnect

### Payload design

- Use short single-character keys to minimize bandwidth
- JSON is fine — no need for binary at this scale

---

## 7. HUD

- Top center: score display — `P1 ● ● ○  —  ○ ● ● P2` (dots for kills, 3 to win)
- Small HP indicator near player (2 small bars or dots)
- Kill event: centered flash text "KILLED" or "DIED" that fades after 1s
- Match win: fullscreen dark overlay with "VICTORY" or "DEFEAT", play-again button

---

## 8. Visual Style

- Pitch black background at all times, no ambient light
- Geist Mono for all HUD and UI text
- White text on black, no decorative UI elements
- No emoji, no gradients on UI chrome, no glow effects on UI (only in-game effects like muzzle flash and bullet trails)
- Flat, dark, utilitarian aesthetic — the flashlight is the only drama

---

## File Structure

```
app/
  page.tsx              — main game component (lobby UI + canvas game)

lib/game/
  constants.ts          — all magic numbers (speed, fov, tile size, etc.)
  map.ts                — seeded RNG, maze generation, wall segment extraction
  raycast.ts            — ray-segment intersection, vision polygon construction
  physics.ts            — movement with collision, bullet step + wall check
  renderer.ts           — all canvas drawing (map, players, bullets, vision, HUD)
  types.ts              — shared type definitions

server/
  ws.ts                 — WebSocket server (room management, state, hit detection, broadcast)
```

---

## Build Order

Implement incrementally in this sequence. Each step should be testable on its own.

1. **Map generation** — generate and render the maze to canvas (fully lit, no vision cone yet). Verify it looks correct
2. **Vision cone** — add raycasting, clipping, and distance falloff. Verify flashlight feel with WASD movement
3. **Shooting** — add bullet spawning, travel, wall collision, and visual trail. Single-player only
4. **WebSocket server** — room creation, join flow, position broadcast. Get two browser tabs syncing position
5. **Multiplayer combat** — server-side bullet simulation, hit detection, kill/respawn/score flow
6. **Polish** — muzzle flash, hit feedback, kill feed, win screen, pointer lock, edge softness on vision

---

## What NOT to Build

- No mobile / touch controls
- No sound or audio
- No persistent storage, accounts, or login
- No AI opponents
- No spectator mode
- No chat
