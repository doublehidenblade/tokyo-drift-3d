/**
 * pocket-racer CarTuning — faithful JS port of the engine-agnostic feel values.
 *
 * Vendored from: https://github.com/inabako06/pocket-racer
 * File: src/CarTuning.ts (MIT License, Copyright (c) 2026 inabako06)
 * Full license: ./LICENSE
 *
 * This is a REFERENCE copy documenting the lineage of the drift model used
 * by ./drift-model.js. The live tune for Tokyo Drift 3D lives in
 * ../../config.js (CFG.drift) and is passed into the model as a parameter —
 * values there were re-based to our speed scale (60 m/s vs their 46 m/s)
 * and our auto-accelerate input scheme (no throttle button).
 *
 * Units: speeds m/s, angles rad unless a key says "Deg", rates per second.
 */
export const PocketRacerTuning = {
  // ── Sustained drift (Ridge-Racer style) ──────────────────────────
  DriftSpeedThreshold: 20,   // m/s — drift needs speed
  DriftSteerThreshold: 0.08, // rad of steer angle (scaled by car steerMul)
  DriftEngageTimeSlow: 0.2,  // s of held steer at low speed before breakaway
  DriftEngageTimeFast: 0.015,// s of held steer at high speed
  DriftHoldSpeed: 5,         // m/s — drop out of drift below this
  DriftTurnRate: 5.0,        // rad/s travel-direction rotation at full depth
  DriftAngleMax: 58,         // deg — deepest sustained slip angle
  DriftBuildRate: 45,        // deg/s — angle deepens this fast when steering in
  DriftReleaseRate: 100,     // deg/s — counter-steer recovery
  GripRecoverRate: 45,       // deg/s — off-throttle straighten-up
  DriftExitAngle: 5,         // deg — below this the drift releases
  DriftDrag: 0.2,            // 1/s speed decay while drifting
  DriftBrakeDrag: 1.6,       // 1/s extra decay when braking mid-drift

  // ── Grip / stability (non-drift) ─────────────────────────────────
  SideFriction: 1.2,         // lateral-velocity scrub rate (their scale)
  SpinGripAccel: 17,         // m/s^2 lateral-grip budget -> yaw-rate cap
  SpinYawMargin: 0.6,        // rad/s floor on the yaw cap (low-speed agility)
  AssistMinSpeed: 2.5,       // m/s — stability assists engage above this
};
