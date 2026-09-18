# Tokyo Drift 3D — Vision (read this first)

Craig's game: a full-3D night-time arcade drift racer through a neon Tokyo,
playable in a phone browser at https://doublehidenblade.github.io/tokyo-drift-3d/.
**Stack: Three.js + Rapier (web).** The Godot prototype is paused on the shelf;
Godot reference images in `art-reference/` are a *fidelity bar only*, not the stack.

## The fantasy

Rain-slick neon streets, a suspension bridge over a bay, a lit tunnel through
a ridge, dense downtown towers with Japanese signage, an elevated expressway
and an air-train crossing overhead — and a 5,227 m closed circuit running
through all of it. 3 laps, nitro bottles, traffic both directions, 5 hearts.

## Where things live in this repo

- `CITY_PLAN.md` — the city-first plan: districts, bay, bridge, tunnel,
  highways + air-train, then the track routed through it. The source of truth
  for world layout (Milestone 6+).
- `ARCHITECTURE.md` — how the code works (track math, physics, harness).
- `CHANGELOG.md` — what shipped in each release.
- `art-reference/` — Craig's inspiration images and his phone-QA screenshots.
  Never let the current build state limit what the vision could be; when in
  doubt, re-read these folders.
  - `retro-tokyo-80s/` — 5 refs: 80s anime Tokyo street, synthwave car,
    city-pop car, rainy rooftop, Tokyo Tower at dusk.
  - `tokyo-night-real/` — 8 refs: real night Tokyo (Shibuya, Rainbow Bridge,
    waterfront skyline, tunnel run, city-pop poster).
  - `craig-phone-qa-2026-09-18/` — his on-device QA screenshots (the bugs he
    found) + the Godot race-car-controller and Leartes cyberpunk-city refs
    that set the model-fidelity bar.
- `harness/shots-m4/` — M4+M5 release evidence (screenshots + drive video).

## How Craig works (standing rules)

- He QA's on his Samsung — his phone is the only valid mobile verdict. A
  passing harness is necessary, never sufficient.
- Every ask, bug, and idea goes in the master TODO and is re-checked before
  any completion claim.
- All art is procedural (canvas textures, low-poly meshes). Never present it
  as designer-drawn or hand-painted.
- Signs must be physically mounted on buildings/supports. No floating signs.
- Keep 5 hearts. No autonomous brainstorming — only Craig-originated work.
- Every release message includes the playable link.
