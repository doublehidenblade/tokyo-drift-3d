# Tokyo Drift 3D — Architecture (Milestone 4)

M4 changes: screen-space steering (runtime camera-projection derivation),
heading self-centering + clamp, enlarged car colliders, gantry posts moved
beyond car reach, tunnel lighting boost, and the M4 self-iteration harness
(autopilot + CDP scenario runner) as the ship gate.

Full-3D rebuild of Tokyo Drift (pivot from the pseudo-3D track, 2026-09-17).
Static site, no build step, no CDN — all dependencies are vendored locally.

M3 (2026-09-17/18) rebuilt the game around a **closed 5,227 m circuit**
per Craig's phone QA of M2: real grades (23 m elevation range), banked
sweepers, a blue-lit suspension bridge centerpiece (Rainbow Bridge
direction), a lit tunnel leg audited at 4 points, 3-lap races, no median
(shared roadway), traffic around the entire lap, and redesigned nitro
(one-tap full burn, bottle refills, no regen).

## Layout

```
tokyo-drift-3d/
├── index.html            # page shell, HUD (incl. LAP + race time), touch controls, title/finish overlays
├── vendor/
│   ├── three.module.js   # three.js r185 (local)
│   ├── three.core.js     # three.module.js companion import
│   └── rapier.es.js      # @dimforge/rapier3d-compat 0.20.0 (self-contained)
├── src/
│   ├── main.js           # boot, game loop, camera, sparks wiring, __td3 harness API
│   ├── track.js          # centripetal Catmull–Rom closed loop: frames, bank, elevation
│   ├── config.js         # all tunables in one place (CFG.laps = 3, track-space speeds)
│   ├── physics.js        # Rapier world + track-space arcade driver + contact events
│   ├── city.js           # spline-following road, tunnel tube, suspension bridge, city
│   ├── textures.js       # procedural canvas textures (road, windows, signs, gantry)
│   ├── car.js            # low-poly player/rival/traffic car meshes (procedural, not designer art)
│   ├── sparks.js         # spark particle pool
│   ├── input.js          # keyboard + touch input state, one-shot nitro pulse
│   └── hud.js            # speed / lap / time / nitro / pickups HUD
├── harness/
│   ├── shoot3.mjs        # CDP verification suite for M3
│   └── shots-m3/         # evidence screenshots
├── ARCHITECTURE.md
└── CHANGELOG.md
```

## Track (new in M3)

`src/track.js` builds a centripetal Catmull–Rom loop from 17 control
points (~5,227 m lap). For each of 1024 samples it precomputes a banked
frame:

- `pos` (smoothed XZ, smoothed elevation; tunnel dip −3.3 m, bridge apex
  +20.1 m; max grade ~1.83°), `tan` (pitch + yaw), `lat` (driver's LEFT —
  M3's comment wrongly claimed right, and that wrong convention inverted
  the steering; M4 derives the screen mapping at runtime instead),
  `up` (banked via Rodrigues rotation of the horizontal frame around
  `tan` — max bank 8° at the Karussell).
- `frameAt(s)`, `toWorld(s, lat, h)` (track-space → world),
  `distAhead(sA, sB)` (wrap-aware signed distance), `inTunnel(s)`,
  `inBridge(s, margin)`.
- Legs: `tunnel = {s0: 3533, s1: 4328}` (the only tunnel, bores through a
  hill ridge), `bridge = {s0: 1502, s1: 2296}` (suspension bridge over
  water, top of water at y = −5), plus `water = {cx, cz, w, d, y, yaw}`.

## Physics model (M6 — heading-based arcade)

Rapier owns collision; a **heading-based arcade driver** owns motion (M6
replaced the M3–M5 track-space driver, which re-snapped the car to the
spline every step and therefore auto-followed curves hands-off — Craig's
#1 complaint):

- The player is a dynamic Rapier cuboid (2.8 × 1.5 × 5.6, collider center
  +0.35 m) with CCD enabled. Each fixed step the driver integrates the
  car's world position along its absolute world yaw
  (`arcade.heading`): steering changes the heading, zero input leaves it
  untouched — the car drives straight along its own heading and road
  curvature has no influence. `arcade.s/lat` are per-step DERIVED
  estimates (nearest track point, `src/respawn.js`) for traffic AI,
  bottles, laps, HUD/camera — never for motion.
- **Steering (M6 screen-relative):** `steerIn = left − right`
  (screen-left positive); the turn direction comes from
  `input.latDirSign × track-lat` projected against the car's forward
  vector — LEFT always yaws toward screen-left BY CONSTRUCTION, with the
  chase camera and the front-facing attract camera. Yaw rate
  `steerYawLow → steerYawHigh` (1.4 → 0.42 rad/s) falls with speed. No
  heading clamp, no self-centering. Contacts never touch the heading.
- **Guard rails:** the world agent builds rail geometry + colliders at the
  `CFG.railLat` spec (`physics.railSpec()` documents exact offsets);
  physics ALSO bounces the car off the logical rail plane (|lat| = 11.1 m)
  every step — a continuous plane check, so tunneling at 216 km/h is
  impossible by construction. Bounce = reflect lateral velocity
  (restitution 0.4), speed ×0.82, spark.
- **Containment:** NaN state, leaving `CFG.worldBounds` (±1700 m), or
  dropping below `CFG.voidY` (−30 m) → `respawnPlayer()` puts the car on
  the track centerline at the nearest s, tangent-aligned, 20 m/s, 1 s
  ghost (contacts visual-only).
- Speed: auto-accel 22 m/s² toward 60 m/s (216 km/h); nitro 40 m/s²
  toward 75 m/s (270 km/h). **Nitro: one pulse burns the whole meter**
  (~2 s full burn), no passive regen; 14 bottles at fixed (s, lat),
  +0.25 each, 25 s respawn. FOV kicks 62 → 74 while burning.
- Laps: `lap` increments crossing s=0 forward (prevS > L−300 && s < 300);
  race ends at CFG.laps = 3 → state `done`, finish banner with total time.
- Traffic: 10 same-dir + 10 oncoming dynamic bodies in track space
  (never destroyed — wrapped/respawned relative to the player's s).
  Same-dir cars brake when the player is immediately ahead in-lane; on
  traffic contact the player is shoved in world space along the contact
  normal (positional only — never spins the car) + slowed.
- `world.step()` on a fixed 60 Hz accumulator; contact events via
  `ActiveEvents.COLLISION_EVENTS`. curb → ×0.86, building → ×0.55,
  rival → ×0.8, traffic → ×0.75 + positional shove, rail → mild grind
  scrub; all fire sparks. Ghost window: sparks only.
- Autopilot (menu attract / ?autopilot=1): explicitly track-following —
  pure-pursuit of the racing line + a one-shot `input.autopilot` tangent
  bias per step. Never the player heading model.

## M4 self-iteration harness (ship gate)

- `src/autopilot.js` — in-engine driver (dynamic-imported ONLY under
  `?autopilot=1`; zero cost for players). Pure-pursuit of the road 110 m
  ahead in track space, emergency lane-change around traffic, nitro burn
  on full meter when clear. Drives ONLY via `input.left/right/nitroPulse`
  — the same flags the touch halves set — so it exercises the real
  screen-space steering path.
- `harness/autopilot/cdp.mjs` — shared headless-Chrome CDP helper, plus
  `pressStart`/`pressEnd`: synthesized pointer presses via CDP
  `Input.dispatchMouseEvent`, which the browser delivers as real
  PointerEvents through the production touch path (same handler, same
  screen-half hit-testing — honestly described as synthesized presses,
  never as TouchEvents).
- `harness/autopilot/run.mjs` — 8 scenarios, nonzero exit on any failure:
  steer-screen (synthesized pointer presses on left/right halves through
  the production PointerEvent path — NOT setInput(), NOT TouchEvents;
  chase camera FROZEN at a snapped pose; 2 game-seconds of fixed-step
  physics per press; the car's NDC.x displacement must match the screen
  direction of +lat projected through the same frozen camera — asserted
  ABSOLUTELY at s=200/900/2500/3900 including curves, against a
  projection reference independent of input.latDirSign; actually
  negative-controlled 2026-09-18: inverting the steering sign fails all 8
  direction assertions with exit 2),
  race (3 laps in-page headless, telemetry CSV, 3 lap times, live drive
  frame sequence → m4-drive.webm),
  luma-sweep (every 50 m, 105 samples, saved as CSV), tunnel, bridge,
  gauntlet (contacts+sparks+scrub, |heading| ≤ clamp, re-centers;
  real-time spark-catch screenshot), nitro (bottle +0.25, one-tap burn,
  no regen; mid-burn screenshot),
  collider (screen-projected cuboid-vs-mesh).
- `window.__td3` harness API: reset/start/teleportS (snaps camera),
  state/debug/luma/bottles/checks, setInput/pulseNitro/stepPhysics (fixed
  60 Hz stepping without rendering), placeTraffic, colliderInfo,
  carNDC/latDirSign/fps, projectionCheck, showColliderDebug,
  cameraInfo/buildingsNear, freezeCamera/steerGatePrep/steerGateHold (the
  deterministic steering gate: frozen camera, atomic in-page setup,
  fixed-step hold measurement).

## Controls (M4)

Unchanged scheme: auto-accelerate always; hold **left/right half of the
screen** (`#touchzone`) to steer — the press's screen half is hit-tested
from the PointerEvent (`e.clientX < innerWidth/2`), and the steering
direction is derived per-frame from the live camera projection
(`input.latDirSign`), so left input steers toward screen-left BY
CONSTRUCTION (the M3 reversal came from a hardcoded lat convention that
contradicted the track math). The harness proves it with synthesized
pointer presses through that exact production path, asserting absolute
screen direction at s=200/900/2500/3900 with the camera frozen —
negative-controlled (inverting the sign fails the gate).
One circular **NITRO** button bottom-right (one-shot pulse: input.js
`nitroPulse` edge-detects). Keyboard: arrows/A D steer, Space/Shift
nitro. Tap-to-start; finish banner shows total race time with RESTART.

## Rendering (M3)

- three.js r185, WebGL, night scene with fog. All art procedural (canvas
  textures, low-poly meshes) — **not designer-drawn**.
- Road: spline-following ribbon with the M3 lane layout (no median — one
  wide shared roadway, edge lines + dashed lane lines), wet-streak
  overlay, banked/graded to the frames.
- Tunnel (s 3533–4328): concrete tube following the spline, emissive
  ceiling strips, wall sconces, 4 real point lights, glowing entrance/
  exit portal frames, tunnel-only ambient boost — never pitch black;
  harness samples luma at 4 points across the full range (all > 0.05).
- Suspension bridge (s 1502–2296): blue-lit portal towers (Y-up, deck
  level), catenary main cables (tube geometry) with lights, 80
  suspenders, deck edge light strips, blue-lit approach piers; water
  plane below with **fake** additive neon streak reflections (blue under
  the bridge, orange under the landmark — no planar reflection, mobile
  perf). Skyline beyond: 52 lit towers + an orange Tokyo-Tower-like
  landmark spire. (Procedural homage to Rainbow Bridge per Craig's
  reference photo — direction only, no photo pixels.)
- City: 478 buildings (6 variants incl. reflective glass), 200 neon
  signs **physically mounted on facades** (standing art rule), 240 street
  lamps with glow sprites, 230 trees, power poles with sagging wires,
  6 directional gantries + start/finish gantry with checkered banner,
  pedestrian overpass with walkers + 82 sidewalk peds (never on the
  road), hill mounds + mountain silhouettes (terrain variety).
- Traffic: 20 instanced cars (2.8 m wide to match player scale) with
  headlight cones + taillight/headlight strips — real dynamic Rapier
  bodies that collide with the player.
- Player car: red reflective `MeshPhysicalMaterial` (metalness 1,
  clearcoat), additive headlight cones, one real spotlight.
- Cheap additive glow points/sprites, light fog; no postprocessing bloom.
- Sparks: pooled point sprites emitted at the contact point from Rapier.

## Running it

- Static hosting (any static server): just serve the directory.
- `file://`: ES modules are blocked by CORS in **stock** Chrome. Either
  launch Chrome with `--allow-file-access-from-files`, or serve the folder
  (`python3 -m http.server`). There is no build step.
- Deployable files: `index.html`, `src/` (10 files incl. new
  `src/track.js`), `vendor/`, `CHANGELOG.md`, `ARCHITECTURE.md` — 16
  files. Sibling repo `doublehidenblade/tokyo-drift` is untouched; the
  live M2 site is untouched until M3 is published.

## Verification

`node harness/shoot3.mjs` drives the game headless (CDP) and asserts the
M3 acceptance bar, writing evidence screenshots to `harness/shots-m3/`:

- boot + title screen
- car/lane ratio ≈ 0.70, laps = 3, trackLen ≈ 5227
- steering: left input decreases lat (screen-left), right increases
- auto-accel to ≥ 55 m/s (cap 60)
- nitro bottle pickup: exactly +0.25
- one-tap burn: nitroOn true, drains to 0, no regen over time
- full lap from L−400: lap increments, lastLapT positive
- tunnel audit: luma at 4 points across the full tunnel range, all > 0.05
- traffic head-on: contact events + sparks + speed scrub
- evidence screenshots: a-title, b-start, c-curve, d-tunnel, e-bridge,
  f-nitro
- zero console/page errors

`node harness/shoot2.mjs` (M2) and earlier harnesses are superseded.

## Caveats

- All art is procedural — not designer-drawn. The bridge is a procedural
  homage to Rainbow Bridge; Craig's reference photo was direction only.
- Water reflections are fake additive streaks, not planar reflections.
- Arcade track-space driving on a dynamic Rapier cuboid with real
  collision events — not a tire/suspension sim.
- Headless SwiftShader renders ~10–30× slower than wall clock; the
  harness waits on game-time — says nothing about on-device frame rate.
  No FPS floor is asserted anywhere in the gate (an earlier draft had
  one; headless numbers don't represent devices). Craig's phone verdict
  is the only valid perf/mobile verdict.
