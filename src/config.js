// Shared tuning constants for Milestone 3 (closed lap circuit).
export const CFG = {
  fixedDt: 1 / 60,
  roadHalf: 12,           // drivable half-width (m); no median — one wide roadway
  laneW: 4,               // lane width; the car is 70% of a lane wide
  curbLat: 12.75,         // curb centerline lateral offset (m)
  curbTopY: 0.30,         // curb top surface height (m)

  // Player car (dynamic body, arcade track-space control — see physics.js)
  carMassKg: 900,
  chassisHalf: { x: 1.4, y: 0.4, z: 2.8 }, // 2.8 m wide = 70% of 4 m lane
  wheelRadius: 0.42,
  arcadeAccel: 22,        // m/s^2 auto-acceleration toward cap
  nitroAccel: 40,         // m/s^2 while nitro is burning
  steerLatAccel: 16,      // lateral accel for heading rate (m/s^2)
  maxHeading: 0.6,        // clamp on heading offset from tangent (rad)
  maxSpeed: 60,           // m/s (~216 km/h)
  nitroMaxSpeed: 75,      // m/s (~270 km/h)
  nitroBurnRate: 0.5,     // meter fraction per second while burning (full burn ~2 s)
  nitroPickupFill: 0.25,  // meter fill per nitro bottle pickup
  maxSteer: 0.55,         // visual front-wheel steer (rad)

  laps: 3,                // race length

  // Spawn (track space)
  spawnS: 0,
  spawnLat: 5,

  // Rival (follows the spline)
  rivalSpeed: 30,         // m/s
  rivalLat: 5,

  // Same-direction traffic (right side laterals)
  trafficLanes: [3, 7, 11],
  trafficCount: 10,
  trafficSpeedMin: 19,
  trafficSpeedMax: 30,

  // Oncoming traffic (left side laterals, s decreasing)
  oncomingLanes: [-3, -7, -11],
  oncomingCount: 10,
  oncomingSpeedMin: 21,
  oncomingSpeedMax: 30,

  // Tunnel tube
  tunnelHalfW: 13.5,      // inner wall lateral offset
  tunnelH: 7.2,           // ceiling underside height
};
