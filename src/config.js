// Shared tuning constants for Milestone 1.
export const CFG = {
  fixedDt: 1 / 60,
  trackLength: 1600,      // city extent along +Z (m)
  roadHalf: 13,           // drivable half-width (m)
  curbX: 13.75,           // curb centerline |x| (m)
  curbTopY: 0.30,         // curb top surface height (m)

  // Player car (dynamic body, arcade velocity control — see physics.js note)
  carMassKg: 900,
  chassisHalf: { x: 0.95, y: 0.35, z: 2.2 },
  wheelRadius: 0.35,
  arcadeAccel: 16,        // m/s^2 at full gas
  arcadeBrake: 34,        // m/s^2 braking
  steerLatAccel: 14,      // lateral accel for yaw rate (m/s^2)
  maxSpeed: 38,           // m/s (~137 km/h)
  maxSteer: 0.55,         // visual front-wheel steer (rad)

  // Rival (simple AI)
  rivalSpeed: 24,         // m/s — slower than player top speed so the player catches up
  rivalLaneX: 4.0,
};
