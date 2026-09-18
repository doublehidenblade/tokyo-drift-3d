// Shared tuning constants for Milestone 2.
export const CFG = {
  fixedDt: 1 / 60,
  trackLength: 3200,      // city extent along +Z (m)
  roadHalf: 13,           // drivable half-width (m)
  curbX: 13.75,           // curb centerline |x| (m)
  curbTopY: 0.30,         // curb top surface height (m)

  // Player car (dynamic body, arcade velocity control — see physics.js note)
  carMassKg: 900,
  chassisHalf: { x: 0.95, y: 0.35, z: 2.2 },
  wheelRadius: 0.35,
  arcadeAccel: 22,        // m/s^2 auto-acceleration toward cap
  nitroAccel: 38,         // m/s^2 while nitro is burning
  steerLatAccel: 16,      // lateral accel for yaw rate (m/s^2)
  maxSpeed: 60,           // m/s (~216 km/h)
  nitroMaxSpeed: 75,      // m/s (~270 km/h)
  nitroDrain: 0.38,       // meter fraction per second while boosting
  nitroRecharge: 0.14,    // meter fraction per second while not boosting
  maxSteer: 0.55,         // visual front-wheel steer (rad)

  // Spawn
  spawnX: 6.5,
  spawnZ: -20,

  // Rival (simple AI)
  rivalSpeed: 30,         // m/s
  rivalLaneX: 8.5,

  // Same-direction traffic
  trafficLanes: [3.0, 6.5, 10.0],
  trafficCount: 6,
  trafficSpeedMin: 19,
  trafficSpeedMax: 30,

  // Oncoming traffic (other side of the median)
  oncomingLanes: [-3.0, -6.5, -10.0],
  oncomingCount: 6,
  oncomingSpeedMin: 21,
  oncomingSpeedMax: 30,

  // Tunnel (road passes through a lit tube here)
  tunnelStart: 620,
  tunnelEnd: 920,
  tunnelHalfW: 14.5,      // inner wall |x|
  tunnelH: 7.2,           // ceiling underside height
};
