# Tokyo Drift — World Assembly Coherence Proof ("scene + city-blueprint = world")

Date: 2026-09-19. Original proof 14:44 UTC; makeover-phase-2 update ~11:00 CDT.
Proof/analysis only — no scenes built, no files edited, nothing published.
Sources: `CITY_PLAN.md` + `ARCHITECTURE.md` (blueprint), `src/track.js` control points
(ground truth for coordinates), read-only inspection of the 7 published `*-scene.html`
dioramas, Craig's 6 tokyo-photo-refs (2026-09-19), his 6 citypop-retro refs
(`references/citypop-retro-20260919/`, 10:39 CDT), his 5 EVA/Akira refs
(`references/eva-akira-20260919/`, 10:56 CDT), and the retro pack research
(`hidden_files/asset-pack-research/retro-packs-20260919.md`).

Companion: `world-map.html` — 2D top-down SVG map with the 7 scene pins + gap markers
+ the makeover phase-2 element layer.

## The one-sentence verdict

**The equation holds thematically but not geometrically.** Every showroom scene matches
its blueprint district's character, and the blueprint's 5,227 m closed race loop connects
all eight districts in order — but the scenes are standalone dioramas in local coordinate
frames with **no shared road geometry between adjacent scenes**. "Scene + blueprint =
world" is true at the planning level; the connective tissue (one continuous road ribbon
running through scene boundaries) does not exist yet. That is the enrichment phase's job.

## Art direction lock — retro/city-pop, EVA/Akira (Craig, 2026-09-19)

- **Retro is stylized realism, not pure photorealism** (Craig's words). Target language:
  deep-blue nights, warm dense windows, neon accents, a large moon, reflective roads,
  layered city depth — the look that got him to fall in love with Tokyo (EVA, Akira,
  80s Japan sci-fi).
- **Pack decisions (final):** Quaternius **Downtown City MegaKit — VETOED** (too Western
  for a Tokyo scene; removed from v3). **Elegant Crow Retro Skyscraper Pack (CC0) —
  APPROVED** for MultiMesh skyline bands with emissive lit-window patterns. **GDQuest
  godot-4-stylized-sky (MIT) — APPROVED** for gradient sky + stars + hero moon, with a
  static/reduced-sampling phone-friendly variant for the Samsung target.
- **v3 material stack (in integration):** ambientCG 2K PBR (asphalt/dirt/grass/concrete/
  gravel), SSR water shader, night sky, Kenney City Kit Roads, Quaternius **Nature**
  MegaKit (vegetation only — the nature kit was never vetoed).
- **Dark-void lesson (Start Plaza, fixed 10:57 CDT):** it was mostly *lighting*, not
  materials — facade textures painted lit windows but the material had no emissive
  component, and ACES tone mapping crushed the blacks. Fix: emissiveMap on facades,
  window density 0.50→0.62, Neutral tone mapping, brighter albedos, stronger moon.
  Rule for the makeover: **no surface renders pure black; lit windows always emit.**

## Makeover Phase 2 — build in parallel with v3 (Craig's instruction, 10:59 CDT)

Craig's orchestration: parallel workers build **new mocks + new scenes + this blueprint
update** while the v3 game is built on the *existing* scenes; a 20-minute cron checks
whether new mocks/scenes/gameplay are ready for his review; everything funnels to the
APK entry (buttons for gameplay and showrooms). Mocks/scenes are mock-review-gated;
only review-passed work lands in v3.

### Makeover element register (MKE-1 … MKE-8)

| ID | Element | Ref | District landing | Notes |
|---|---|---|---|---|
| MKE-1 | Utility poles + catenary wire density, EVA-style (pole-to-pole catenaries, crossarms, insulators) | eva-akira 82/83 (Tokyo-3 overpass; Komatsu street) | Start Plaza, Downtown, Industrial Edge, Harbor West street runs | Mechanical: instanced pole system + wire curves. Wires never free-floating — always pole-to-pole with real attachment points |
| MKE-2 | Pedestrian overpasses with Japanese signage, Tokyo-3 style (green steel truss, 架空線注意 vertical signs, district name boards like 第3新東京市) | eva-akira 82 | Start Plaza (over the start straight), Downtown | All signage = real Japanese text, physically mounted to the structure |
| MKE-3 | Elevated curving rail + lit red/white train, EVA-02 style | eva-akira 84 | Air-train loop over Downtown / Waterfront East (blueprint crosses track at s≈2540/3300) | This is the visual target for the blueprint's air-train — curved elevated guideway, lit train windows, animated run |
| MKE-4 | Tower window-grid density, Akira-style (dense warm window grids; one sodium-orange key tower; searchlight beams) | eva-akira 85/86 | Downtown core, bay north-shore skyline bands | MultiMesh bands + emissive window atlas; deterministic lit/dark ratio |
| MKE-5 | Retro color grading: deep-blue night / sodium orange / teal | eva-akira 85/86, citypop-retro 75–80 | GLOBAL — all night scenes + v3 | Palette lock doc; grading pass, not per-scene improvisation |
| MKE-6 | Traffic variety: civilian cars, lane changes, blinking indicators | game-side | Godot v3+ traffic AI; scene cameo in Downtown/Waterfront East | Needs traffic-AI work; GGBotNet PSX Style Cars (CC0) as background traffic |
| MKE-7 | City verticality: MultiMesh skyline bands, fog/value separation, Elegant Crow towers | retro research | Downtown, bay skyline, v3 world | 2–3 fog-separated depth bands; the density answer to Craig's "background buildings much denser" |
| MKE-8 | Stylized sky: GDQuest gradient + stars + hero moon (phone-safe variant) | retro research | v3 + showroom night skies | Static/reduced-sampling for the Mobile renderer; pale warm oversized moon |

### Per-district delivery state (as of ~11:00 CDT, 2026-09-19)

Status: 🟢 scene live · 🟡 fix in flight · 🔴 no scene yet. Mocks: all queued in the
makeover review wave (20-min cron); Bridge + Downtown are the priority mocks.

| District | Scene | Scene state | Makeover mock | In v3 |
|---|---|---|---|---|
| Start Plaza | 🟢 startplaza | live; arch fixed; dark-void fixed (commit b6768397, live-verified) | queued | integrating |
| Harbor West | 🟡 harborwest | live; water/boats fixes published (2f6c707), live-verify pending | queued | integrating |
| The Climb | 🟡 the-climb | live; grounding fixed; skyline/perspective verify pending | queued | integrating |
| Bay Strait + bridge | 🔴 — | M1 gap | **queued — PRIORITY** (Rainbow Bridge look, ref photo 06) | integrating (procedural) |
| Waterfront East | 🟡 waterfront-east | live; fixes published (2f6c707), live-verify pending | queued | integrating |
| Downtown | 🔴 (FH6 stand-in) | M2 gap; FH6 is a low-rise stand-in for 35–70 m towers | **queued — PRIORITY** (dedicated scene + air-train overhang, MKE-2/3/4/7) | integrating |
| South Ridge | 🟢 south-ridge | live; portal "orange ball" fixed (emissive frame + warm interior pool) | queued | integrating |
| Industrial Edge | 🟢 district2 | live; missing-model 404 fixed (849d437), all 200s | queued | integrating |

### Reference → district landing (new refs, Craig's language)

- eva-akira 82 — Tokyo-3 pedestrian overpass (green truss, 架空線注意 + 第3新東京市 signage,
  dense catenary wires) → MKE-2 overpasses (Start Plaza / Downtown); MKE-1 wire runs everywhere
- eva-akira 83 — Komatsu stationery street miniature → street-level dressing language for
  Start Plaza / Downtown commercial streets (MKE-1)
- eva-akira 84 — EVA-02 red/white train on curved elevated rail → MKE-3 air-train visual target
- eva-akira 85 — Akira Singapore night (teal construction glow, dense lit towers) → MKE-4
  tower density + teal grading (MKE-5)
- eva-akira 86 — Akira orange sodium tower w/ searchlights vs Singapore skyline → MKE-4 hero
  tower treatment; sodium-orange key light (MKE-5)
- citypop-retro 75–80 — deep-blue nights, warm windows, neon, moon, wet roads → MKE-5 palette-lock inputs

## Coordinate ground truth (from src/track.js)

Lap L = 5227 m. Start/finish s=0 at (0,0,0). District s-ranges from CITY_PLAN.md,
anchor coordinates interpolated from the 15 control points (chord-length scaled to L):

| # | Blueprint district | s-range | Anchor (x, z) | Scene |
|---|---|---|---|---|
| 1 | Start Plaza / Mid-rise commercial | 4941→5227→0→470 | (0, 0) start gantry | startplaza ✅ |
| 2 | Harbor West | 470–1235 | (50, 860) mid | harborwest ✅ |
| 3 | The Climb | 1235–1502 | (370, 1270) mid | the-climb ✅ |
| 4 | Bay Strait + suspension bridge | 1502–2285 | (820, 1440) apex | ❌ NO SCENE |
| 5 | Waterfront East | 2285–2573 | (1230, 1230) mid | waterfront-east ✅ |
| 6 | Downtown neon core | 2573–3573 | (1390, 740) cp8 | ⚠️ FH6 (stand-in) |
| 7 | South Ridge + tunnel | 3533–4318 | (1340, 120) tunnel entrance | south-ridge ✅ |
| 8 | Industrial Edge | 4318–4941 | (550, −300) cp13 | district2 ✅ |

Note: Downtown (ends s 3573) overlaps South Ridge (starts s 3533) — tunnel entrance
cp10 at s≈3573 sits exactly at downtown's tail. Air-train loop (x 1120–1520, z 480–1120)
sits over Waterfront East + Downtown and crosses the track at s≈2540 and s≈3300.

## Per-scene placement & consistency

### 1. Start Plaza → district 1, pinned at (0, 0)
- Content: Kabukicho arch (歌舞伎町一番街 — Craig's QA rebuild in progress), checkered
  start line under the arch, neon commercial straight, vending machines, shopfront bays.
- Blueprint: start gantry, 8–20 m commercial blocks, shopfronts, vending machines. ✅
- Road: a straight — matches the start/finish straight (0,−160)→(0,470). ✅
- No bay/water in the scene — correct, the district is ~500 m west of the bay. ✅
- Connects to: Harbor West (track north, +z) and Industrial Edge (track south, −z)
  via the race loop. No shared geometry with either neighbor's scene.

### 2. Harbor West → district 2, pinned at (50, 860)
- Content: night quay, boats, warehouses. Water was a flat black plate (Craig's QA fix
  in progress: reconnect water, add boats).
- Blueprint: low warehouses 6–12 m, container stacks, cargo props along the bay's west shore. ⚠️
- **Mismatch M3 (flavor drift):** blueprint says industrial *cargo* port; the scene is a
  *fishing* port with boats. Boats are fine on a quay, but the district character drifted
  from cargo-industrial toward fishing-village. Enrichment should push it back toward
  containers/cargo (Craig's photo 03 — trucks and a car meet under the elevated highway —
  fits the cargo-industrial flavor far better).
- Bay position check: bay rect x∈[500,1180] — at cp3 (230,1170) the water is ~270 m east
  of the track. A quay with visible water in-scene is a plausible sightline. ✅
- The elevated expressway (z=860, y=15) crosses OVER the track here at s≈868 — the
  scene does not show it. Opportunity (see gap list).

### 3. The Climb → district 3, pinned at (370, 1270)
- Content: hillside touge town, sloped street, tiled roofs, stone walls, lanterns, neon
  city below, one ship in the harbor view.
- Blueprint: mixed mid-rise 10–25 m, hillside feel; track climbs cp3 (y5) → cp4 (y13). ✅
- Harbor view below: bay's west edge is ~270 m east — plausible. ✅
- Connects to: Harbor West (south) and the bridge approach (east). No shared geometry.

### 4. Bay Strait + suspension bridge → district 4, pinned at (820, 1440)
- **Mismatch M1 (the biggest coverage gap): there is no showroom scene for this district.**
  The bridge is the track's centerpiece (Rainbow Bridge homage, blue-lit portal towers,
  apex y=20 over water y=−5) and Craig just sent photo 06 saying "our bridge doesn't
  look like this famous one" — yet the district that should showcase it has no scene.
  It appears only as a horizon element in waterfront-east.
- Blueprint geometry: towers at s 1600–2200, land approaches outside the towers;
  bay x∈[500,1180], z∈[1000,2260]; far north shore z≈2260 with quay + 4 port cranes.
- Enrichment priority #1: a dedicated bridge-district scene.

### 5. Waterfront East → district 5, pinned at (1230, 1230)
- Content: night bayshore expressway — curved elevated deck (R=190, deck y=8, 17 m
  wide), piers, quay, ferris wheel, twin-tower Rainbow Bridge span on the horizon,
  gantries, day/night toggle.
- Blueprint: promenade, low commercial, piers on the bay's east shore; track descends
  cp6 (y16) → cp7 (y6). ✅ Deck y=8 is compatible with the descending track.
- The horizon Rainbow Bridge reads to the *west* — geographically correct: the bridge
  spans (510,1370)→(1130,1370), i.e. west of this district. ✅
- Craig's QA fixes in progress: road↔bridge-deck gap, day/night façade parity, flat
  black water → animated water with reflections.
- Connects to: bridge east landing (west) and Downtown (south). No shared geometry.

### 6. Downtown neon core → district 6, pinned at (1390, 740) — FH6 as stand-in ⚠️
- **Mismatch M2:** Downtown (towers 35–70 m, densest façade signage, air-train loop
  threading between towers) has no dedicated scene. FH6 Night Street is the closest
  thing — dense tate-kanban, RAKU RAKU van, night street — but it is low-rise
  shopfronts (GLB street buildings ~10–12 m fronts), not 35–70 m towers.
- FH6 is officially a "hero district" (dashboard: "Night neon street · hero district"),
  i.e. a representative neon street, not a fixed map location. Pinned to Downtown
  approximately on the map with that caveat.
- **The air-train appears in NO scene** — yet Craig's photo 01 (Yogi Pocha street,
  dense tate-kanban under a green elevated-rail overhang) is exactly the air-train
  overpass look, and the blueprint puts the loop right over this district. Enrichment
  priority #2: downtown scene with the air-train overhang.
- The elevated expressway's east end (x=1100) also terminates near here — unshown.

### 7. South Ridge + tunnel → district 7, pinned at (1340, 120) (tunnel entrance)
- Content: night mountain touge, road bending into a tunnel portal bored through a
  mountain mass, tunnel name plaque on the portal face, pooled amber interior light,
  sedan heading in.
- Blueprint: tunnel entrance cp10 (1340,120) y=−2, mid cp11 (1170,−200), exit cp12
  (860,−330) y=−3; ridge hills flank the tube; concrete headwalls. ✅
- Craig's QA fix in progress: the "giant orange ball" portal glow.
- Connects to: Downtown (north) and Industrial Edge (south). No shared geometry.

### 8. Industrial Edge → district 8, pinned at (550, −300) — district2 ✅
- Content: night industrial dock — gantry cranes (9), container stacks, sodium/amber/
  orange accents, no water.
- Blueprint: warehouses, chimneys w/ beacons, container yards, sodium-orange. ✅
- Naming note: the district is landlocked (z≈−300); "dock" here = loading dock, not
  water — consistent since the scene shows no water. The earlier "District 2" wave
  name is legacy; on the map it is Industrial Edge.
- Connects to: South Ridge tunnel exit (east) and Start Plaza (west). No shared geometry.

## Road network: what connects the scenes

The ONLY connective road network in the blueprint is the race circuit itself — a closed
5,227 m loop (no median, one wide shared roadway, guard rails full lap). There are no
cross streets, no intersections, no alternate routes anywhere in the blueprint.
Scene-to-scene road continuity is therefore purely sequential along the loop:

Start Plaza → Harbor West → The Climb → [bridge] → Waterfront East → Downtown →
South Ridge (tunnel) → Industrial Edge → Start Plaza

**No two adjacent scenes share road geometry** — each diorama's road ends at its own
frame. This is expected for showrooms, but it means "scene+blueprint=world" currently
rests on the blueprint alone. The enrichment phase must decide: keep scenes as
character dioramas, or build them as true map slices on one shared coordinate frame.

## Full mismatch / gap register

| ID | Severity | Finding |
|---|---|---|
| M1 | HIGH | Bay Strait + bridge district (s 1502–2285) has NO showroom scene — the track's centerpiece and the subject of Craig's Rainbow Bridge photo is unrepresented. |
| M2 | HIGH | Downtown neon core (s 2573–3573) has NO dedicated scene; FH6 is a low-rise stand-in for a 35–70 m tower district. |
| M3 | MED | Harbor West flavor drift: blueprint = industrial cargo port; scene = fishing port. Push back toward cargo/containers (matches Craig's photo 03). |
| M4 | MED | No geometric road continuity between any two adjacent scenes (all dioramas are local-frame). Thematic continuity only. |
| M5 | LOW | FH6 is unplaceable as a fixed location ("hero district"); pinned to Downtown approximately. |
| M6 | LOW | Downtown/South Ridge s-ranges overlap (2573–3573 vs 3533–4318) — tunnel entrance sits at downtown's tail; harmless but note for map labeling. |
| M7 | LOW | "District 2" name is legacy; it is Industrial Edge on the map. Rename on the dashboard when convenient. |

(Craig's 8 visual-QA defects are owned by the sibling fix worker — not repeated here.)

## Gap list for the NEXT phase (scene enrichment) — Craig's road-system asks

Legend: 🔵 missing from the **blueprint** (needs planning first) · 🟡 in blueprint but
missing from **scenes** (needs scene work) · 🟢 already covered.

| # | Craig's ask (his words) | Status | What enrichment needs |
|---|---|---|---|
| 1 | Crossroads — player runs a red light, dodges horizontal traffic; off-road warning 3 s + reset | 🔵 | Blueprint has NO crossing roads at all (sealed loop, guard rails). Needs a blueprint decision: where cross streets cross the track, signal logic, the warning/reset mechanic. |
| 2 | Road 4-lane → 2-lane transitions and vice versa | 🔵 | Track ribbon is fixed-width ("one wide shared roadway", no median). Lane-count transitions need blueprint + road-builder support. |
| 3 | Road splits (one branch blocked with 🚧) and merges | 🔵 | No splits/merges in the blueprint. Needs planning: where, which branch is drivable, blocker props. |
| 4 | Civilian cars that switch lanes with a blinking directional/tail light, so the player can anticipate and dodge | 🔵 | Traffic = 20 cars (10 same-dir + 10 oncoming), brake-only AI, no lane changes, no indicators. Needs traffic-AI + signal-light work in the game, then scene representation. |
| 5 | Criss-crossing roads like 立交桥 (interchanges) | 🔵 | Only grade separations in the blueprint: the suspension bridge, the tunnel, one expressway overpass (s≈868). No interchanges planned. |
| 6 | Highway running semi-alongside the player road | 🔵/🟡 | The elevated expressway (z=860, y=15, x −300→1100) CROSSES the track but never runs alongside it. Craig's photo 04 wants semi-alongside. Blueprint extension + scene. |
| 7 | Tokyo Tower landmark ("landmarks that make Tokyo Tokyo") | 🟡 | In the *game* skyline only (ARCHITECTURE: "orange Tokyo-Tower-like landmark spire"). In NO showroom scene. Give it a scene — natural fit: Downtown or the bay skyline. |
| 8 | Rainbow Bridge look ("our bridge doesn't look like this famous one", photo 06) | 🟡 | Game has a procedural homage; waterfront-east shows it on the horizon. No dedicated scene (see M1). Bridge-district scene is the place to nail the look. |
| 9 | Green air-train track overhang (photo 01, Yogi Pocha street) | 🟡 | IN the blueprint (air-train loop over Downtown, crosses track at s≈2540/3300) but visible in NO scene. Downtown scene should show the overhang with dense tate-kanban beneath — exactly Craig's photo. |
| 10 | Car meet under the elevated highway (photo 03, LBWK R34 + Veilside RX-7) | 🟡 | Expressway crossing exists in the blueprint (s≈868, Harbor West) but no scene shows under-highway life. Harbor West enrichment: car-meet pad under the expressway. |
| 11 | Toshiba-building street, vending machines, signage (photo 02) | 🟢 | Covered: startplaza has vending machines + dense signage. Keep as reference for other commercial streets. |
| 12 | Night highway driving POV (photo 04) | 🟡 | Expressway has ~24 animated car-light dots in the blueprint (game), but no scene captures the driving POV. Candidate: Waterfront East enrichment (bayshore expressway). |

### Enrichment-phase needs, distilled

1. **Blueprint decisions first (🔵):** crossroads + red-light mechanic, lane-count
   transitions, splits/merges, interchange locations, alongside-highway routing,
   lane-switching traffic AI with indicators. None of these exist in CITY_PLAN.md —
   the track is currently a sealed loop. Craig's "update the 2D city planning to enable
   these scene variety" is exactly right; planning precedes scenes.
2. **Two missing district scenes (🟡):** the bridge district (M1) and Downtown with
   the air-train overhang (M2) — both are also where the landmark work (Tokyo Tower,
   Rainbow Bridge look) lands.
3. **Scene enrichment on existing districts (🟡):** Harbor West → cargo-industrial +
   under-expressway car meet; Waterfront East → night-highway POV; Start Plaza stays
   as the commercial-street reference.
4. **Continuity question (M4):** decide whether enriched scenes stay dioramas or
   become true map slices on the shared track frame — that determines whether
   "scene+blueprint=world" ever becomes geometric.

## Reference photos → where each one lands (Craig's language)

- 01 Yogi Pocha street + green elevated rail → Downtown air-train overhang scene (M2/#9)
- 02 Toshiba street + vending machines → Start Plaza (covered 🟢)
- 03 car meet under elevated highway → Harbor West under-expressway (M3/#10)
- 04 night highway, expressway semi-alongside → blueprint extension + Waterfront East (#6/#12)
- 05 Tokyo Tower at night → landmark for Downtown/bay skyline scenes (#7)
- 06 Rainbow Bridge at night → the bridge-district scene must match this (M1/#8)
