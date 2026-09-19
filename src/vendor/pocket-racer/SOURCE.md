# Vendored controller: pocket-racer

**Source:** https://github.com/inabako06/pocket-racer
**License:** MIT — Copyright (c) 2026 inabako06 (full text in `./LICENSE`;
the header above is the complete copyright + permission notice, included in
every vendored file per the license terms).
**Live demo:** https://inabako06.github.io/pocket-racer/ (linked from the repo README)

## Why this one

Craig: "STOP hand-building car physics." The candidates evaluated 2026-09-19:

| Candidate | Verdict |
|---|---|
| **pocket-racer** (TS + Three.js + cannon-es, `RaycastVehicle` + arcade layer) | **Chosen.** Mature sustained-drift model (Ridge-Racer style) with all feel values centralized in `CarTuning.ts`: drift threshold / charge time / max angle / build & release rates / recovery / turn rate. Playable demo + gameplay video, actively maintained (2026). MIT. |
| nordschleife-racer (MIT) | Rejected: ~4,900-line monolithic custom physics core, not a separable starter kit. |
| yangki1902/racing-kit-starter-r3f | Rejected: React-Three-Fiber-specific, no documented drift model. |
| Saarg/Arcade_Car_Physics | Rejected: Unity/C# WheelColliders, not portable to a Three.js/Rapier project. |
| lotking_EngineBuilder-AndCarDriftGame | Rejected: custom source-available license (not OSI-approved), old three.js r128. |
| Paid kits (Gumroad/itch, <$50) | No credible reviewed three.js vehicle kit with a playable demo found. Using the MIT open-source pick per the brief. |

## What was taken

1. **`CarTuning.js`** — faithful JS port of the engine-agnostic feel values from
   `src/CarTuning.ts` (drift thresholds, engage times, angle/rate limits, grip
   and spin-safety values). Reference copy: documents provenance.
2. **`drift-model.js`** — the drift state machine and grip/stability math ported
   from `src/Car.ts` (`applyDriftControl`, `applyStability`, drift-entry charge)
   to plain 2D vector math. No cannon-es, no THREE, no DOM.

## How it was adapted (no engine swap)

Tokyo Drift 3D runs a kinematic arcade model on a **Rapier** world (chassis is
rotation-locked and teleported every step; rails, traffic, respawn and lap
logic all assume this). Swapping in cannon-es's `RaycastVehicle` would mean
running two physics worlds and rewriting every world interaction — rejected.
Instead the vendored **arcade layer** (the part that makes it feel like a drift
game) drives the existing kinematic body:

- State is now a velocity vector `{vx, vz}` + body yaw `heading` instead of a
  scalar speed glued to the heading (the old model had zero slip angle, so
  "drift" was physically impossible).
- Throttle = the game's auto-accelerate (always on while racing); there is no
  throttle button, so off-throttle recovery maps to easing off the steering.
- Steering stays the game's yaw-rate model; its normalized effort feeds the
  drift entry/build/release logic.
- The live tune is `CFG.drift` in `src/config.js` (single place to retune);
  values were re-based from pocket-racer's to our speed scale and input scheme.
- Integration: `src/physics.js` (`step()`), retune: `src/config.js`.

Behavioral contract (from the pocket-racer README): hold steer at speed →
short charge → rear breaks loose into a sustained drift; steer deeper to
deepen the angle, counter-steer (or ease off) to recover; camera/body stay
consistent because heading = travel direction + slip angle.
