# Tokyo Drift 3D — CITY_PLAN.md (Milestone 6)

City-first rework plan. The race track spline is UNCHANGED (M4/M5 tuning,
autopilot, and harness scenarios all key off its s-coordinates); the city
is planned around the route and exists independently of it.

## Grounded track facts (computed from src/track.js, 2026-09-18)

- Lap length L = 5227 m. Bbox: x ∈ [-27, 1392], z ∈ [-336, 1440], y ∈ [-3.3, 20.1].
- Bridge leg: s 1502–2285 (apex cp5 ≈ s 1899, y = 20, over water).
- Tunnel leg: s 3533–4318 (entrance cp10 ≈ s 3573, mid cp11 ≈ s 3941, exit cp12 ≈ s 4278; tube y ≈ -2..-3).
- Start/finish: s = 0 at (0, 0, 0). 3 laps, nitro bottles, pause, retro menu, 5 hearts — all preserved.

## Districts (by s-range along the existing route)

| s-range | District | Character |
|---|---|---|
| 4941→5227→0→470 | Start Plaza / Mid-rise commercial | Start gantry, 8–20 m commercial blocks, shopfronts, vending machines |
| 470–1235 | Harbor West | Low warehouses 6–12 m, container stacks, cargo props; runs along the bay's west shore |
| 1235–1502 | The Climb | Mixed mid-rise 10–25 m, hillside feel |
| 1502–2285 | Bay Strait + suspension bridge | Bridge over the water; port skyline on the far shore |
| 2285–2573 | Waterfront East | Promenade, low commercial, piers; bay's east shore |
| 2573–3573 | DOWNTOWN neon core | Towers 35–70 m, densest facade signage, air-train loop threads between towers |
| 3533–4318 | South Ridge + tunnel | Hill ridge flanking the tube; concrete portal headwalls |
| 4318–4941 | Industrial Edge | Warehouses, chimneys w/ beacons, container yards, sodium-orange accents |

## Water: the Bay

The old 760×520 channel under the bridge becomes a real bay:
rect x ∈ [540, 1100], z ∈ [1000, 2260], surface y = -5 (same yaw as before).
The bridge (s 1502–2285) spans the bay mouth. Far north shore at z ≈ 2260:
quay wall, 4 procedural port cranes with orange beacons, industrial
silhouette skyline. West shore = Harbor West warehouses; east shore =
Waterfront East promenade. All water reflection streaks are generated
ONLY under registered light sources (B6).

## Bridge (B2 rework)

- Towers: portal frames — 2 columns + 2 crossbeams + X-bracing, blue-lit.
- Main cables run EXACTLY over the column tops (CABLE_LAT = TOWER_LAT = 17 m;
  saddle blocks at the contact). Previously the cable sat 0.5 m inboard of
  the columns, which read as disconnected.
- Warren stiffening truss under both deck edges between the towers +
  suspenders cable→deck; truss, rails, cables, towers read as one structure.
- Deck girder box under the road ribbon (the old road floated).
- Railing posts/rails unified with the guard-rail system (with colliders).

## Tunnel (B5 rework)

- Portals: concrete headwalls (side pylons + top beam, procedural concrete
  texture), a mounted "トンネル TUNNEL" board bolted to the beam, recessed
  emissive edge strips (no floating glow blobs — the old glowBig portal
  flares are deleted).
- Retaining walls 40 m out from each portal; ridge hill masses flank the
  tube at |lat| 30–90 m (never over the tube — M4 removed the over-tube
  spheres because they blocked the chase camera).
- Interior: sealed tube + strips + sconces + 8 point lights + tunnel-only
  ambient (unchanged scheme, kept never-black).

## Verticality

1. **Elevated expressway**: straight deck at z = 860, x ∈ [-300, 1100],
   deck y = 15, pillars every 40 m, edge light strips, ~24 animated
   car-light dots both directions. Crosses OVER the west straight at
   s ≈ 868 (track y ≈ 1 → 14 m clearance).
2. **Air-train**: rounded-rect loop x ∈ [1120, 1520], z ∈ [480, 1120],
   rail y = 13, pylons every 30 m, one 4-car train looping at 22 m/s.
   Crosses OVER the race track twice in downtown (s ≈ 2540 and s ≈ 3300,
   7 m+ clearance). Buildings skip a 14 m corridor around the loop.
3. The bridge itself (deck y 13–20) and the downtown towers.

## Street-level pass (track-oriented)

Both sides, full lap (minus tunnel/bridge spans): sidewalks, lit
shopfronts with striped awnings (facade-mounted), ~320 Japanese neon signs
(facade-mounted ONLY — standing rule; vertical signboards + horizontal
boards, back-box mounting hardware sunk into walls), streetlights every
30 m (teal heads, registered light sources), power poles with sagging
catenary wires, pruned street trees, vending machines, planters/bollards,
parked cars (improved low-poly: windshield, mirrors, grille, lights),
sidewalk pedestrians + overpass walkers, directional gantries, start gantry.
Density/variety targets the Leartes reference (inspiration only — everything
stays procedural/canvas/low-poly; never presented as designer work).

## QA bug fixes (acceptance criteria)

- **B1 black walls**: hills ≥150 m from track (was 60), mountains ≥300 m
  with proper track-distance test + emissive lift so they read as dark-blue
  silhouettes, never pitch black. Ridge hills get the same lift.
- **B2**: as above; the flat blue boxes on the road are the wet-streak
  overlay's oversized random streaks (up to ~20 m wide, alpha 0.5) — the
  whole random-streak system is deleted and replaced by
  source-registered streaks (B6).
- **B3**: buildings keep |latF| ≥ 18 m; a HARD build-time audit projects
  every building footprint corner to track space and THROWS if any corner
  is inside roadHalf + 2.5 m. Harness asserts violations = 0.
- **B4**: traffic visuals fade/scale in over ~0.8 s on spawn/respawn
  (respawn detected by track-space jump); spawn happens 400–700 m ahead so
  cars are fully visible seconds before any possible contact. api exposes
  `trafficFade()` so car-side physics can gate colliders on it.
- **B5**: portal flare blobs deleted; portal headwall + mounted sign +
  recessed strips (see above).
- **B6**: every reflection streak is generated from a registered light
  source (position + color recorded); `window.__cityAudit` carries
  lights[] and streaks[]; the harness asserts each streak is within 15 m
  of its source with a matching color family. Streaks with no source are
  deleted (the old random road/water streaks).
- **B7**: road texture — SOLID center line + 4 lane lines with VARIED dash
  lengths (3/3, 2/4, 4/2, 1.5/4.5 m dash/gap, all on 6 m tiling cycles),
  solid edge lines kept.

## Guard rails (task 5)

Continuous instanced rail (posts + double rail bars) at |lat| = 14.1 m,
full lap, both sides, skipping only the tunnel tube spans (sealed walls
there). Rapier static-box colliders every 6 m tagged 'curb' (same contact
response as curbs: speed scrub + sparks). Bridge railing unified into this
system. Player max reach is 14.0 m — the rail is the last barrier; a
free-driving car cannot leave the world.

## Interface

- `track.nearestTrackPoint(pos) -> { point, tangent, s }` (new, in track.js):
  coarse-to-fine search over the 1024 samples; point = centerline Vector3,
  tangent = unit tangent Vector3, s = meters along lap.
- city.js api keeps: `update`, `syncTraffic`, `setTunnelGlow`,
  `buildingsNear`; adds `trafficFade()`. Publishes `window.__cityAudit`
  for the harness/inspector.
- Every distinct asset type gets `mesh.userData.asset` (player-racecar,
  traffic-sedan/taxi/truck, building-downtown-tower, bridge-tower,
  tunnel-portal-entry/exit, streetlight, air-train, …).

## Performance (Samsung phone browser)

All static geometry instanced (one draw call per part type). Animated
per-frame work: train (4 instances), highway dots (~24), walkers (28),
beacons (color only), bottles (~14), traffic fade (20) — trivial.
No new real lights except the existing tunnel points; glow stays in two
Points systems. No postprocessing.
