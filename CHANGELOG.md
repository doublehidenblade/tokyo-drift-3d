# Tokyo Drift 3D — Changelog

## Milestone 3 (2026-09-17/18)

Craig phone-QA'd M2 and asked for a real circuit, not an endless straight
road. The whole game was rebuilt around a closed lap:

1. **Closed-loop lap (5,227 m)** — centripetal Catmull–Rom circuit with
   real grades, not bumps: 23 m of elevation (−3.3 m tunnel dip to +20.1 m
   bridge apex, max grade ~1.83° ≈ 3.2%), banked sweepers (up to 8°,
   Karussell-style), a climbing bridge approach, and a descent into the
   tunnel. 3 laps to finish; HUD shows LAP 1/2/3 and race time; lap
   counted on crossing the start/finish line; finish banner on race end.
2. **Rainbow Bridge centerpiece** (per Craig's reference photo — direction
   only, no photo pixels, all procedural): blue-lit suspension bridge with
   2 portal towers, catenary main cables (tube geometry) with lights,
   80 suspender cables, deck edge light strips, blue waterline glows;
   lit skyline beyond + orange Tokyo-Tower-like landmark on the far shore;
   fake neon streak reflections on the water (additive quads, no planar
   reflection — mobile-conscious).
3. **No median** — one wide shared roadway (lane markings only); the
   player can cross into oncoming lanes to dodge 10 oncoming + 10
   same-direction traffic cars. Car width 2.8 m = exactly 70% of the
   4 m lane width (verified ratio 0.7000 in the harness).
4. **Traffic everywhere on the lap** — the M2 despawn bug is fixed by
   design: M2 spawned traffic in a z-window ahead of the car and left
   gaps after the tunnel; M3 traffic lives in track space permanently
   (never destroyed — wrapped/respawned relative to the player's lap
   position), so density is even around the entire circuit.
5. **Nitro redesign** — one tap burns the entire available meter (full
   burn ≈ 2 s); no passive regeneration; 14 glowing nitro bottles on the
   road, each +25%, respawn 30 s after pickup.
6. **Lit tunnel, audited everywhere** — the one tunnel leg (s≈3533–4328)
   keeps the M2 lit-tunnel treatment (ceiling strips, sconces, 4 real
   lights, portal frames, tunnel-only ambient boost); the harness samples
   luma at 4 points across the FULL tunnel range, all > 0.05 (0.055–0.138)
   — zero pitch-black sections anywhere on the lap. The tunnel visibly
   bores through a hill ridge.
7. **Player car**: reflective MeshPhysicalMaterial paint (metalness 1,
   clearcoat), additive headlight cones, one real spotlight; traffic cars
   all get headlight cones + taillight strips.
8. **Terrain variety**: rolling hill mounds flanking the road, distant
   mountain silhouettes, hill ridge over the tunnel — no flat ground
   everywhere.
9. **Density**: 478 buildings, 200 facade-mounted neon signs (physically
   attached — standing art rule), 240 street lamps, 230 trees, power
   poles with sagging wires, 6 directional gantries + start/finish gantry,
   pedestrian overpass with walkers, 82 sidewalk peds (never on the road).
10. **Track-space arcade driving** — steering now moves the car laterally
    in track space (left → −lat = screen-left, verified empirically);
    yaw/banking follow the spline frames. Rapier dynamic cuboid still
    owns collision (curbs, buildings, rival, traffic → sparks + scrub);
    gravity/ramps from the dynamic body.

Verification (headless, `harness/shoot3.mjs`, shots in `harness/shots-m3/`):
PASS, exit 0, zero console/page errors:
- Boot + title screen: OK
- Car/lane ratio 0.7000, laps = 3, trackLen = 5227.0: OK
- Steering: left → lat 5.00 → −12.60; right → +6.64: OK
- Auto-accel to 60.0 m/s (216 km/h): OK
- Nitro bottle: exactly +0.25 (0.0000 → 0.2500): OK
- One-tap burn: nitroOn true at 0.5 s, 0.0000 at 5.5 s, still 0 at
  10.5 s (no regen): OK
- Full lap from L−400: lap 1 → 2, lastLapT = 8.23 s positive: OK
- Tunnel luma at s = 3600/3800/4000/4200: 0.138/0.055/0.063/0.064, all
  > 0.05: OK
- Head-on with oncoming car: contact events 17 → 18, sparks 22 → 23,
  speed scrubbed 60 → 52.7: OK
- Screenshots: a-title, b-start, c-curve (dense district), d-tunnel
  (visually lit), e-bridge (suspension bridge), f-nitro (mid-burn): OK

Caveats:
- All art is procedural (canvas textures, low-poly meshes) — not
  designer-drawn. The bridge is a procedural homage to Rainbow Bridge;
  the reference photo is direction only — no photo pixels anywhere.
- Water reflections are fake additive glow streaks, not planar
  reflections (mobile perf).
- Arcade track-space driving on a dynamic Rapier cuboid with real
  collision events — not a tire/suspension sim.
- Mobile correctness unverified — Craig's phone test is the only valid
  verdict.

## Milestone 2 (2026-09-17)

Craig phone-tested M1 and filed five issues; all fixed here:

1. **Tunnel was pitch black** — the road now passes through a real tube
   (z 620–920) with concrete walls/ceiling, emissive ceiling light strips,
   wall sconces, 4 interior point lights, glowing cyan entrance / orange
   exit portal frames, and a tunnel-following ambient boost. Verified with
   an in-tunnel screenshot + a luminance probe (mean 0.235 vs ~0.00 black).
2. **Car too slow** — speed cap 38 → 60 m/s (216 km/h), stronger
   acceleration (22 m/s²), plus NITRO: 75 m/s (270 km/h) with a
   rechargeable meter, HUD meter bar, and FOV kick (62 → 74).
3. **Steering reversed on touch** — root cause: the chase camera looks +Z,
   so screen-right is world −X; the old `left → yaw−` mapping drove the car
   toward screen-right. Fixed to `left → yaw+` and verified empirically in
   the harness (left-half input moves the car toward screen-left).
4. **Ghost-town scene** — dramatically denser: 6 building variants
   (taller towers, reflective glass facades with a procedural night env
   map), ~140 facade-mounted neon signs (vertical + horizontal boards, all
   physically attached), street lamps with additive glow sprites, power
   poles with sagging catenary wires, procedural trees, 5 directional
   overhead gantries with emissive panels, a median barrier dividing
   two-way traffic (6 same-direction cars with red taillights + 6 oncoming
   cars with white headlights, all real Rapier bodies that collide),
   pedestrian overpass with walking peds + sidewalk peds (never on the
   roadway), wet reflective asphalt with emissive lane markers, reflective
   guardrails, light fog + additive glow points (no postprocessing bloom).
5. **Controls redesigned** — removed all GAS/BRAKE/steer buttons. New
   scheme: auto-accelerate toward the cap; hold left/right half of the
   screen to steer; one NITRO button (bottom-right). Keyboard:
   arrows/A D steer, Space/Shift nitro. Tap-to-start kept.

Kept from M1: arcade speed/yaw on a dynamic Rapier cuboid (the full
raycast-vehicle sim was tried and dropped in M1 — flips at speed — and is
NOT reintroduced); real Rapier contacts for road/curbs/median/buildings/
rival/traffic with sparks + speed scrub; fixed-step accumulator; vendored
Three.js + Rapier, no build step, same file layout for simple publishing.

Verification (headless, `harness/shoot2.mjs`, shots in `harness/shots-m2/`):
- Auto-accel to 56.8 m/s (205 km/h): OK
- Steering left → x 6.5 → 10.82 (screen-left); right → 6.5 → 2.50
  (screen-right): OK, direction confirmed empirically
- Touch-zone wiring (left/right halves + nitro button via synthetic
  pointer events): OK
- Nitro to 66.7 m/s (240 km/h), meter drains, nitroOn true: OK
- Tunnel interior luma 0.235 (pitch black ≈ 0.00): OK
- 12 traffic cars (6 same + 6 oncoming); rear-end → sparks + scrub: OK
- Zero console/page errors: OK

Caveats:
- All art is procedural (canvas textures, low-poly meshes) — not
  designer-drawn.
- Arcade drivetrain (not a tire/suspension sim); Rapier resolves contacts.
- Bug found during M2 verification and fixed: buildings near the tunnel
  could extend into the tube (their centers were clear but half-widths
  weren't), showing facades inside the tunnel and intruding colliders
  into the drivable lane. Buildings are now placed fully clear of the
  tunnel's outer wall.
- Headless SwiftShader renders ~10–30× slower than wall clock, so the
  harness waits on game-time; this says nothing about on-device frame
  rate — Craig's phone verdict is the only valid perf/mobile verdict.
- `file://` in stock Chrome blocks ES-module imports (CORS); use
  `--allow-file-access-from-files` or any static server.

## Milestone 1 (2026-09-17)

Full-3D pivot: new `tokyo-drift-3d/` project (three.js + Rapier, vendored
locally, no CDN, no build step). Pseudo-3D work stashed untouched; live v86
site untouched. Not published (no authorization).

Delivered:
- Night neon highway: multi-lane straight, curbs, edge light strips.
- Procedural neon city: instanced buildings, canvas window textures, neon
  signs mounted on building facades, streetlights, start gantry.
- Player car (orange) + rival AI car (teal, lane-keeping, 24 m/s cruise).
- Chase camera, touch LEFT/RIGHT/GAS/BRAKE + keyboard (arrows/WASD).
- HUD: speed, distance, time. Spark particles on impacts.
- Fixed 120 Hz physics accumulator; headless-Chrome CDP harness.

Physics disclosure (fallback, per brief allowance): the player is a
**dynamic Rapier cuboid driven by an arcade speed/yaw model**, not a
raycast-vehicle simulation. Rapier still resolves all real contacts
(road/curbs/rival/buildings); contact events trigger sparks and speed
scrub. The raycast vehicle was tried and dropped (weak acceleration,
pitch instability/flips under stronger tuning).

Verification (headless, `harness/diag.mjs`):
- Acceleration 0 → 38 m/s (137 km/h) in ~2.4 s game time: OK
- Steering left/right both respond: OK
- Curb contact: HIT OK — sparks fired, speed scrubbed on contact
- Rival rear-end: HIT OK — contact event fired
- Zero console/page errors: OK

Bug notes:
- Rapier 0.20.0 renamed `ActiveEvents.CONTACT_EVENTS` to
  `COLLISION_EVENTS`; the old name is `undefined` and silently disables
  collision events (caused missing sparks until fixed).
- Steering law changed from flat yaw-rate to kinematic-bicycle
  (`yawRate = steerLatAccel / max(speed, 5)`) — holding steer at speed no
  longer spins the car in donuts.
- START button now resets car/rival to the start line (previously the
  rival could drift during menu idle).

Caveats:
- All art is procedural (canvas textures, low-poly meshes) — not
  designer-drawn.
- `file://` in stock Chrome blocks ES-module imports (CORS); use
  `--allow-file-access-from-files` or any static server.
- Mobile correctness unverified — Craig's on-device test is the only
  valid verdict.
