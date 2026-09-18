# M4 self-iteration harness

Scripted playtests that drive the real game in headless Chrome via CDP.
This is the ship gate — no milestone ships unless green.

## Run

```bash
cd ~/workspace/tokyo-drift-3d
node harness/autopilot/run.mjs [--only=a,b] [--shots=dir]
```

- `--only`: comma-separated subset of scenarios
  (`steer-screen,race,luma-sweep,tunnel,bridge,gauntlet,nitro,collider`).
- `--shots`: screenshot/webm output dir (default `harness/shots-m4/`).
- Exit code 2 on any scenario failure, 1 on harness crash, 0 when green.

## Scenarios

(Execution order: steer-screen, luma-sweep, tunnel, bridge, gauntlet,
nitro, collider, race. Race runs last because it uses its own page with
`?autopilot=1`.)

1. **steer-screen** — The definitive steering proof. Synthesized pointer
   presses (CDP `Input.dispatchMouseEvent` → real PointerEvents → the
   production screen-half hit test in `input.js`) hold each screen half
   for 2 game-seconds of fixed-step physics with the chase camera FROZEN
   at a snapped pose. Asserts ABSOLUTELY, at s=200/900/2500/3900
   (including curves, curvature logged from track yaw): LEFT must
   displace the car's NDC.x the same screen way +lat points, RIGHT the
   opposite way — compared against an independent projection reference
   (raw +lat projection through the same frozen camera, not
   `input.latDirSign`). Actually negative-controlled 2026-09-18:
   inverting the steering sign in `src/physics.js` fails all 8 direction
   assertions with exit 2 (LEFT slides the car screen-right — Craig's
   exact symptom); restoring the sign returns it to green.
2. **luma-sweep** — Batched in-page full-lap sweep every 50 m (camera snaps
   in `teleportS`, so each sample sees the settled view). Asserts no
   sample reads near-black (< 0.035). Full sweep saved as
   `m4-luma-sweep.csv`.
3. **tunnel** — Discovers the tunnel interior via `state().tunnel` and
   asserts every sampled section reads luma > 0.05 (+ evidence
   screenshot).
4. **bridge** — Samples the Rainbow Bridge approach, deck, and exit;
   asserts the deck is lit (luma > 0.05) and saves an evidence screenshot.
5. **gauntlet** — Parks 5 same-direction cars in the player's lane and
   drives 12 game-seconds through them via `stepPhysics`. Asserts contacts
   registered, sparks emitted, speed scrubbed, `|heading|` never exceeds
   the ±0.6 clamp, heading re-centers with no input, and heading
   self-centers after a curb grind. Real-time spark-catch evidence
   screenshot.
6. **nitro** — Bottle pickup gives +0.25, one tap starts the burn and
   empties the meter, meter never regenerates (+ mid-burn screenshot).
7. **collider** — Lines all 20 traffic cars up ahead, projects every
   car's Rapier cuboid and visual mesh to NDC, asserts the mesh is
   contained in its collider (green=collider / orange=mesh overlay
   screenshot saved).
8. **race** — `?autopilot=1`: the in-engine autopilot drives a full 3-lap
   race in-page (headless). Asserts `raceDone`, 3 sane lap times,
   telemetry captured, zero page errors. Writes telemetry CSV, start /
   finish screenshots, and a live drive frame sequence encoded to
   `m4-drive.webm`. (No FPS floor: headless SwiftShader frame rates say
   nothing about devices.)

## What "synthesized pointer presses" means

The game listens for PointerEvents and never checks `pointerType`, so
CDP `Input.dispatchMouseEvent` (mousePressed/mouseReleased at screen
coordinates) exercises the exact production touch path: the same
`pointerdown` handler, the same screen-half hit-testing
(`e.clientX < innerWidth/2`). We describe these honestly as synthesized
pointer presses — `Input.dispatchTouchEvent` is never used and we never
claim these are TouchEvents.

## Autopilot (`src/autopilot.js`)

Dynamic-imported ONLY when `?autopilot=1` is present — normal players
never download or parse it. Pure-pursuit of the road 110 m ahead (track
space, no yaw-sign conventions), emergency lane-change around traffic,
nitro burn on a full meter when clear. It drives EXACTLY like a human:
only `input.left / input.right / input.nitroPulse`.

## Requirements

- Headless Chrome at `/opt/meta-chromium/chrome`
- `ffmpeg` for the race webm
- The game must be syntax-clean (`node --check` all of `src/`)
