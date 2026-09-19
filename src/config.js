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
  // 2026-09-19 physics-fix: the car now carries a velocity VECTOR (see
  // physics.js); steering yaws the body, lateral grip bleeds off the slip
  // angle, and the vendored pocket-racer drift model
  // (src/vendor/pocket-racer/) takes over on sustained steer at speed.
  // spinYawCap (below, in drift) clamps this rate at speed so a full-lock
  // yank can't spin the car — forgiving for keyboard input.
  steerYawLow: 1.5,       // yaw rate (rad/s) near standstill
  steerYawHigh: 0.6,      // yaw rate (rad/s) at maxSpeed (0.42 was too weak to hold fast corners)
  maxSpeed: 60,           // m/s (~216 km/h)
  nitroMaxSpeed: 75,      // m/s (~270 km/h)
  nitroBurnRate: 0.5,     // meter fraction per second while burning (full burn ~2 s)
  nitroPickupFill: 0.25,  // meter fill per nitro bottle pickup
  maxSteer: 0.55,         // visual front-wheel steer (rad)
  // Sustained-drift tune, adapted from pocket-racer CarTuning.ts
  // (src/vendor/pocket-racer/CarTuning.js documents the source values).
  // Re-based to our speed scale (60 vs 46 m/s) and auto-accel scheme
  // (throttle = auto-accelerate; no throttle button, so off-throttle
  // recovery maps to easing off the steering).
  drift: {
    refMaxSpeed: 60,       // engage-time lerp reference (= maxSpeed)
    speedThreshold: 20,    // m/s: no drift below this — normal driving stays planted
    steerThreshold: 0.70,  // |steerNorm| (0..1 effort) held to start a drift —
                              // deep deliberate steer only; taps/corrections never break away
    engageSlow: 0.25,      // s of held steer at low speed before breakaway
    engageFast: 0.30,      // s of held steer at high speed — deliberate, keyboard-friendly
                              // (pocket-racer's 0.015 s is for analog drift-primary play; here a
                              // 50 ms flick at 60 m/s used to trigger 63%-of-lap drifting and
                              // speed collapse, 2026-09-19)
    holdSpeed: 5,          // m/s: drift drops out below this
    turnRate: 4.0,         // rad/s travel-direction rotation at full depth
    angleMaxDeg: 50,       // deepest sustained slip angle
    buildRateDeg: 40,      // angle deepens this fast steering into the drift
    releaseRateDeg: 120,   // counter-steer recovery (snappy, predictable)
    recoverRateDeg: 50,    // easing off mid-drift straightens this fast
    exitAngleDeg: 5,       // below this the drift releases back to grip
    drag: 0.15,            // 1/s speed decay while drifting (roughly holds speed)
    brakeDrag: 1.6,        // unused: no brake input in this game
    sideFriction: 4.0,     // 1/s lateral-velocity scrub: forgiving planted grip
    spinGripAccel: 17,     // m/s^2 lateral-grip budget -> yaw-rate cap
    spinYawMargin: 0.6,    // rad/s floor on the yaw cap (low-speed agility)
    assistMinSpeed: 2.5,   // m/s: grip/stability assists engage above this
  },

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
