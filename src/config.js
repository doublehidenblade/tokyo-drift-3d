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
  // M6 heading-based steering: absolute world-yaw rate, falls with speed
  // (no high-speed donuts, generous low-speed authority for hairpins).
  steerYawLow: 1.4,       // yaw rate (rad/s) near standstill
  steerYawHigh: 0.42,     // yaw rate (rad/s) at maxSpeed
  maxSpeed: 60,           // m/s (~216 km/h)
  nitroMaxSpeed: 75,      // m/s (~270 km/h)
  nitroBurnRate: 0.5,     // meter fraction per second while burning (full burn ~2 s)
  nitroPickupFill: 0.25,  // meter fill per nitro bottle pickup
  maxSteer: 0.55,         // visual front-wheel steer (rad)

  // Guard-rail spec (M6): the world agent builds rail GEOMETRY + Rapier
  // colliders along the track at these exact offsets; physics.js bounces
  // the car off the logical rail plane (|lat| = maxLat) every step, so the
  // car can never tunnel through no matter the speed.
  railLat: 12.75,         // rail centerline lateral offset (m)
  railThick: 0.25,        // rail collider half-thickness (m)
  railHeight: 1.1,        // rail collider height above the road (m)
  railSegLen: 12,         // collider segment length along s (m)
  maxLat: 11.1,           // car-center lateral clamp = railLat - railThick - chassisHalf.x

  // M6 free-driving containment failsafe (car-side): leave the rectangle
  // or drop below voidY and the car respawns on the track.
  worldBounds: { x: 1700, z: 1700 }, // half-extents (m); track spans ~[-350, 1450]
  voidY: -30,             // road height below this = void -> respawn
  respawnSpeed: 20,       // m/s after a respawn (moderate)
  ghostTime: 1.0,         // s of post-respawn invulnerability (no bump/scrub)

  hearts: 5,              // lives/HP concept (preserved; not consumed by any system yet)

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
