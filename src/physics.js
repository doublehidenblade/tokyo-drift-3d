// Rapier physics for Milestone 3: the car lives in TRACK SPACE
// (s = meters along the closed lap, lat = lateral offset) and is mapped
// onto the world spline every step. The chassis is still a dynamic
// Rapier cuboid, so curb / building / traffic / rival contacts are real
// and drive sparks + speed scrub. Drivetrain remains arcade (the
// DynamicRayCastVehicleController was tried in M1 and flipped at speed —
// do NOT reintroduce it).
import { CFG } from './config.js';

// Tiny deterministic PRNG for traffic respawns.
function lcg(seed) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

// Collision groups: bits = (membership << 16) | filter.
const G_STATIC = 0x0001, G_PLAYER = 0x0002, G_TRAFFIC = 0x0004, G_RIVAL = 0x0008;
const ALL = 0x0002ffff;                       // player: hits everything
const TRAFFIC_HITS = (G_TRAFFIC << 16) | (G_STATIC | G_PLAYER); // not each other, not rival
const RIVAL_HITS = (G_RIVAL << 16) | (G_STATIC | G_PLAYER);     // not traffic

const BOTTLE_COUNT = 14;

export async function createPhysics(RAPIER, track) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = CFG.fixedDt;
  const eventQueue = new RAPIER.EventQueue(true);
  const rnd = lcg(20260917);
  const L = track.length;

  // One static body hosts every static collider.
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const curbHandles = new Set();
  const buildingHandles = new Set();

  function yawQuat(yaw) {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  }

  function addStaticBox(hx, hy, hz, x, y, z, yaw, tag) {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z).setFriction(0.9);
    if (yaw) d.setRotation(yawQuat(yaw));
    const h = world.createCollider(d, staticBody).handle;
    if (tag === 'curb') curbHandles.add(h);
    if (tag === 'building') buildingHandles.add(h);
    return h;
  }

  // Curbs follow the spline: solid walls along both road edges so the car
  // can never leave the track. Segment length 12 m with slight overlap.
  {
    const seg = 12;
    const f = {};
    for (let s = 0; s < L; s += seg) {
      track.frameAt(s + seg / 2, f);
      for (const side of [-1, 1]) {
        const px = f.pos.x + f.lat.x * side * CFG.curbLat;
        const py = f.pos.y + f.lat.y * side * CFG.curbLat + CFG.curbTopY / 2;
        const pz = f.pos.z + f.lat.z * side * CFG.curbLat;
        addStaticBox(0.75, CFG.curbTopY / 2, seg / 2 + 0.4, px, py, pz, f.yaw, 'curb');
      }
    }
  }

  // ---- Player: dynamic cuboid, arcade track-space control ----
  const ch = CFG.chassisHalf;
  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.4, 0)
      .setLinearDamping(0.0)
      .setAngularDamping(4.0)
      .lockRotations()
  );
  const chassisColDesc = RAPIER.ColliderDesc.cuboid(ch.x, 0.75, ch.z)
    .setTranslation(0, 0.35, 0) // spans road+0 .. road+1.5: covers the cabin
    .setDensity((CFG.carMassKg) / (8 * ch.x * ch.y * ch.z))
    .setFriction(0.4)
    .setRestitution(0.1)
    .setCollisionGroups(ALL);
  chassisColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const chassisCol = world.createCollider(chassisColDesc, chassis);

  // arcade: s/lat/heading live in track space; the rest mirrors M2.
  const arcade = {
    s: CFG.spawnS, lat: CFG.spawnLat, speed: 0, heading: 0,
    steerVis: 0, nitro: 1, nitroBurning: false,
    lap: 1, raceT: 0, lapStartT: 0, lastLapT: null, bestLapT: null,
    raceDone: false, pickups: 0,
  };

  // ---- Nitro bottles: fixed track-space spots, re-arm after 25 s ----
  const bottles = [];
  for (let i = 0; i < BOTTLE_COUNT; i++) {
    bottles.push({
      s: ((i + 0.5) / BOTTLE_COUNT) * L,
      lat: (i % 2 === 0 ? 1 : -1) * (2 + (i * 37 % 5)),
      active: true,
      rearm: 0,
    });
  }

  // ---- Rival: follows the spline in its lane ----
  const rival = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 0.7, 0)
      .lockRotations()
  );
  const rivalColDesc = RAPIER.ColliderDesc.cuboid(ch.x, 0.75, ch.z)
    .setTranslation(0, 0.35, 0) // match the player: full visual height
    .setDensity(150).setFriction(0.4).setCollisionGroups(RIVAL_HITS);
  rivalColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const rivalCol = world.createCollider(rivalColDesc, rival);
  const rivalSt = { s: 40, lane: CFG.rivalLat };

  // ---- Traffic: track-space cars, real player contacts ----
  const traffic = []; // {body, col, kind, lane, speed, s, slowT}
  const trafficByHandle = new Map();
  function spawnTrafficCar(kind, i) {
    const lanes = kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
    const lane = lanes[(rnd() * lanes.length) | 0];
    const speed = kind === 'same'
      ? CFG.trafficSpeedMin + rnd() * (CFG.trafficSpeedMax - CFG.trafficSpeedMin)
      : CFG.oncomingSpeedMin + rnd() * (CFG.oncomingSpeedMax - CFG.oncomingSpeedMin);
    const s = (kind === 'same' ? 120 + i * (L / CFG.trafficCount) : 300 + i * (L / CFG.oncomingCount)) % L;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 0.35, 0)
        .setLinearDamping(0.0)
        .lockRotations()
    );
    const cd = RAPIER.ColliderDesc.cuboid(ch.x, 0.7, ch.z)
      .setTranslation(0, 0.35, 0) // body at road+0.35 -> spans 0..1.4: cabin included
      .setDensity(120).setFriction(0.4).setRestitution(0.1)
      .setCollisionGroups(TRAFFIC_HITS);
    cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = world.createCollider(cd, body);
    const car = { body, col, kind, lane, speed, s, slowT: 0 };
    trafficByHandle.set(col.handle, car);
    traffic.push(car);
    return car;
  }
  for (let i = 0; i < CFG.trafficCount; i++) spawnTrafficCar('same', i);
  for (let i = 0; i < CFG.oncomingCount; i++) spawnTrafficCar('oncoming', i);

  function respawnTraffic(car, playerS) {
    const lanes = car.kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
    car.lane = lanes[(rnd() * lanes.length) | 0];
    car.speed = car.kind === 'same'
      ? CFG.trafficSpeedMin + rnd() * (CFG.trafficSpeedMax - CFG.trafficSpeedMin)
      : CFG.oncomingSpeedMin + rnd() * (CFG.oncomingSpeedMax - CFG.oncomingSpeedMin);
    car.s = (playerS + 400 + rnd() * 300) % L;
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  // Map a track-space car onto its world body.
  const _f = {};
  function placeOnTrack(body, s, lat, h, yawExtra) {
    track.frameAt(s, _f);
    body.setTranslation({
      x: _f.pos.x + _f.lat.x * lat + _f.up.x * h,
      y: _f.pos.y + _f.lat.y * lat + _f.up.y * h,
      z: _f.pos.z + _f.lat.z * lat + _f.up.z * h,
    }, true);
    body.setRotation(yawQuat(_f.yaw + (yawExtra || 0)), true);
  }

  // Spark/contact callbacks registered by main.js: cb(kind, x, y, z)
  const listeners = [];
  function onContact(cb) { listeners.push(cb); }
  let rawEventCount = 0;

  function emit(kind, x, y, z) {
    for (const cb of listeners) cb(kind, x, y, z);
  }

  // M5: car-car bump-apart. On contact, the contact normal n (world XZ,
  // from the player's center to the other car's center) is decomposed
  // onto the track frame into lateral and longitudinal components. Each
  // car is pushed AWAY from the other along n, scaled by the closing
  // speed along n (faster hit = bigger shove), hard-clamped for arcade
  // stability. Purely positional in track space — heading is untouched,
  // so the car can never spin or leave the road.
  const BUMP_K = 0.08;       // meters of shove per (m/s) of closing speed
  const BUMP_MAX = 2.2;      // hard clamp on bump magnitude (m)
  const BUMP_MIN_SEP = 0.35; // separation nudge when merely overlapping

  function carBump(other, kind) {
    // Resolve the other car's logical track-space state + body.
    let oBody, oTanVel;
    const isTraffic = kind === 'traffic';
    if (isTraffic) {
      const car = trafficByHandle.get(other);
      if (!car) return;
      oBody = car.body;
      oTanVel = car.kind === 'same' ? car.speed : -car.speed;
    } else if (kind === 'rival') {
      oBody = rival;
      oTanVel = CFG.rivalSpeed;
    } else {
      return;
    }
    track.frameAt(arcade.s, _f);
    const pt = chassis.translation();
    const ot = oBody.translation();
    // Contact normal n: world-XZ direction from player center to other
    // center, decomposed onto the track frame.
    let nT = (ot.x - pt.x) * _f.tan.x + (ot.z - pt.z) * _f.tan.z;
    let nL = (ot.x - pt.x) * _f.lat.x + (ot.z - pt.z) * _f.lat.z;
    let nrm = Math.hypot(nT, nL);
    if (nrm < 1e-4) { // dead-center overlap: fall back to lateral separation
      const car = isTraffic ? trafficByHandle.get(other) : null;
      const oLane = car ? car.lane : rivalSt.lane;
      nT = 0; nL = oLane >= arcade.lat ? 1 : -1; nrm = 1;
    }
    nT /= nrm; nL /= nrm;
    // Closing speed along the normal (player minus other, track space).
    const pTan = arcade.speed * Math.cos(arcade.heading);
    const pLat = arcade.speed * Math.sin(arcade.heading);
    const closing = (pTan - oTanVel) * nT + pLat * nL;
    const J = closing > 0 ? Math.min(closing * BUMP_K, BUMP_MAX) : BUMP_MIN_SEP;

    // Player: pushed away from the other car (opposite the normal),
    // clamped to the spline corridor so it can't leave the road.
    const latMax = CFG.roadHalf + 0.6;
    arcade.lat = Math.max(-latMax, Math.min(latMax, arcade.lat - nL * J));
    // Longitudinal split: a head-on shove scrubs speed, a rear-end shove
    // carries the player forward slightly. Never exceeds the speed cap.
    const cap = arcade.nitroBurning ? CFG.nitroMaxSpeed : CFG.maxSpeed;
    arcade.speed = Math.max(0, Math.min(cap, arcade.speed - nT * J * 0.5));

    // Other car: pushed away along the normal, then slowed so it can't
    // ghost through the player on the following steps.
    if (isTraffic) {
      const car = trafficByHandle.get(other);
      car.lane = Math.max(-11.5, Math.min(11.5, car.lane + nL * J));
      car.s = (((car.s + nT * J) % L) + L) % L;
      car.slowT = 1.2;
    } else {
      rivalSt.lane = Math.max(-CFG.roadHalf, Math.min(CFG.roadHalf, rivalSt.lane + nL * J));
      rivalSt.s = (((rivalSt.s + nT * J) % L) + L) % L;
    }
  }

  function step(dt, input, racing) {
    // --- Nitro: one tap burns the WHOLE meter; no regen over time ---
    if (input.nitroPulse) {
      input.nitroPulse = false;
      if (arcade.nitro > 0.05 && !arcade.nitroBurning) arcade.nitroBurning = true;
    }
    if (arcade.nitroBurning) {
      arcade.nitro = Math.max(0, arcade.nitro - CFG.nitroBurnRate * dt);
      if (arcade.nitro <= 0) arcade.nitroBurning = false;
    }
    const cap = arcade.nitroBurning ? CFG.nitroMaxSpeed : CFG.maxSpeed;
    const accel = arcade.nitroBurning ? CFG.nitroAccel : CFG.arcadeAccel;
    if (racing && !arcade.raceDone) {
      if (arcade.speed < cap) arcade.speed = Math.min(cap, arcade.speed + accel * dt);
      else arcade.speed = Math.max(cap, arcade.speed - 6 * dt);
    }

    // Steering: heading offset from the spline tangent (kinematic bicycle
    // in track space — yaw rate falls with speed, no high-speed donuts).
    // M4: the lat<->screen mapping is derived at runtime (input.latDirSign
    // is set every rendered frame by main.js from the camera projection:
    // +1 when +lat appears screen-left). left input therefore always steers
    // toward screen-left BY CONSTRUCTION — no hardcoded convention that a
    // curve or a wrong comment can invert (that was the M3 reversal bug).
    // heading > 0 moves the car toward +lat (see the lat update below).
    const steerIn = ((input.left ? 1 : 0) - (input.right ? 1 : 0)) * (input.latDirSign || 1);
    if (arcade.speed > 0.5 && steerIn !== 0) {
      arcade.heading += steerIn * CFG.steerLatAccel / Math.max(arcade.speed, 5) * dt;
      arcade.heading = Math.max(-CFG.maxHeading, Math.min(CFG.maxHeading, arcade.heading));
    } else if (steerIn === 0) {
      // The wheel self-centers: with no input the car straightens onto the
      // tangent. (M3 never decayed heading, so after any steering the car
      // ground along the curb diagonally forever — the "sideways car".)
      arcade.heading *= Math.exp(-5 * dt);
      if (Math.abs(arcade.heading) < 0.002) arcade.heading = 0;
    }
    arcade.steerVis += ((steerIn * CFG.maxSteer) - arcade.steerVis) * Math.min(1, 12 * dt);

    const prevS = arcade.s;
    arcade.s = (arcade.s + arcade.speed * Math.cos(arcade.heading) * dt) % L;
    if (arcade.s < 0) arcade.s += L;
    arcade.lat += arcade.speed * Math.sin(arcade.heading) * dt;
    // Hard guard: the car can never leave the spline corridor.
    const latMax = CFG.roadHalf + 0.6;
    if (Math.abs(arcade.lat) > latMax) {
      arcade.lat = Math.sign(arcade.lat) * latMax;
      arcade.speed *= (1 - 1.2 * dt);
    }

    // Lap counting at the start/finish line (forward crossings only).
    if (racing && !arcade.raceDone && arcade.speed > 1 && prevS > L - 300 && arcade.s < 300) {
      const lapT = arcade.raceT - arcade.lapStartT;
      arcade.lastLapT = lapT;
      if (!arcade.bestLapT || lapT < arcade.bestLapT) arcade.bestLapT = lapT;
      arcade.lap++;
      arcade.lapStartT = arcade.raceT;
      if (arcade.lap > CFG.laps) {
        arcade.raceDone = true;
      }
    }
    if (racing) arcade.raceT += dt;

    // --- Map the player body onto the spline ---
    track.frameAt(arcade.s, _f);
    const chh = ch.y;
    chassis.setTranslation({
      x: _f.pos.x + _f.lat.x * arcade.lat + _f.up.x * chh,
      y: _f.pos.y + _f.lat.y * arcade.lat + _f.up.y * chh,
      z: _f.pos.z + _f.lat.z * arcade.lat + _f.up.z * chh,
    }, true);
    const yaw = _f.yaw + arcade.heading;
    chassis.setRotation(yawQuat(yaw), true);
    // Velocity follows the banked frame so slopes are climbed naturally.
    const chh2 = Math.cos(arcade.heading), shh = Math.sin(arcade.heading);
    chassis.setLinvel({
      x: (_f.tan.x * chh2 + _f.lat.x * shh) * arcade.speed,
      y: (_f.tan.y * chh2 + _f.lat.y * shh) * arcade.speed,
      z: (_f.tan.z * chh2 + _f.lat.z * shh) * arcade.speed,
    }, true);

    // --- Nitro bottle pickups ---
    for (const b of bottles) {
      if (!b.active) {
        b.rearm -= dt;
        if (b.rearm <= 0) b.active = true;
        continue;
      }
      if (Math.abs(track.distAhead(arcade.s, b.s)) < 6 && Math.abs(b.lat - arcade.lat) < 3.2) {
        b.active = false;
        b.rearm = 25;
        arcade.nitro = Math.min(1, arcade.nitro + CFG.nitroPickupFill);
        arcade.pickups++;
        const bp = track.toWorld(b.s, b.lat, 0.6, {});
        emit('pickup', bp.x, bp.y, bp.z);
      }
    }

    world.step(eventQueue);

    // --- Rival AI: follow the spline in its lane ---
    rivalSt.s = (rivalSt.s + CFG.rivalSpeed * dt) % L;
    {
      track.frameAt(rivalSt.s, _f);
      rival.setTranslation({
        x: _f.pos.x + _f.lat.x * rivalSt.lane,
        y: _f.pos.y + _f.lat.y * rivalSt.lane + ch.y,
        z: _f.pos.z + _f.lat.z * rivalSt.lane,
      }, true);
      rival.setRotation(yawQuat(_f.yaw), true);
      rival.setLinvel({
        x: _f.tan.x * CFG.rivalSpeed, y: _f.tan.y * CFG.rivalSpeed, z: _f.tan.z * CFG.rivalSpeed,
      }, true);
    }

    // --- Traffic AI: spline followers; respawn ahead when left behind ---
    // M4: traffic no longer ghosts through the player — it brakes when the
    // player is directly ahead in its lane, and gets shoved aside + slowed
    // when contact actually happens (see the collision handler below).
    for (const car of traffic) {
      const dirS = car.kind === 'same' ? 1 : -1;
      let effSpeed = car.speed;
      if (car.slowT > 0) { car.slowT -= dt; effSpeed = car.speed * 0.45; }
      else if (car.kind === 'same') {
        const ahead = track.distAhead(car.s, arcade.s);
        if (ahead > 0 && ahead < 35 && Math.abs(car.lane - arcade.lat) < 3.2) {
          effSpeed = Math.min(car.speed, Math.max(arcade.speed * 0.85, 8));
        }
      }
      car.s = (car.s + dirS * effSpeed * dt) % L;
      if (car.s < 0) car.s += L;
      if (track.distAhead(arcade.s, car.s) < -250) respawnTraffic(car, arcade.s);
      track.frameAt(car.s, _f);
      car.body.setTranslation({
        x: _f.pos.x + _f.lat.x * car.lane,
        y: _f.pos.y + _f.lat.y * car.lane + 0.35,
        z: _f.pos.z + _f.lat.z * car.lane,
      }, true);
      car.body.setRotation(yawQuat(_f.yaw + (car.kind === 'same' ? 0 : Math.PI)), true);
      car.body.setLinvel({
        x: dirS * _f.tan.x * effSpeed,
        y: dirS * _f.tan.y * effSpeed,
        z: dirS * _f.tan.z * effSpeed,
      }, true);
    }

    // --- Collision events: sparks + arcade speed scrub ---
    eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const playerHit = h1 === chassisCol.handle || h2 === chassisCol.handle;
      const rivalHit = h1 === rivalCol.handle || h2 === rivalCol.handle;
      if (!playerHit && !rivalHit) return;
      rawEventCount++;
      const other = playerHit
        ? (h1 === chassisCol.handle ? h2 : h1)
        : (h1 === rivalCol.handle ? h2 : h1);
      let kind = null;
      if (curbHandles.has(other)) kind = 'curb';
      else if (buildingHandles.has(other)) kind = 'building';
      else if (trafficByHandle.has(other)) kind = 'traffic';
      else if (other === rivalCol.handle || other === chassisCol.handle) kind = 'rival';
      if (!kind) return;
      const src = playerHit ? chassis.translation() : rival.translation();
      if (playerHit) {
        carBump(other, kind);
        if (kind === 'curb') arcade.speed *= 0.86;
        else if (kind === 'traffic') arcade.speed *= 0.75;
        else if (kind === 'building') arcade.speed *= 0.55;
        else if (kind === 'rival') arcade.speed *= 0.8;
        // M4: a hit never spins the car — snap the heading back toward the
        // track tangent and let the speed scrub + sparks sell the impact.
        arcade.heading *= 0.25;
      }
      emit(kind, src.x, 0.4, src.z);
    });
  }

  function reset() {
    teleportS(CFG.spawnS, CFG.spawnLat, false);
    arcade.lap = 1;
    arcade.raceT = 0;
    arcade.lapStartT = 0;
    arcade.lastLapT = null;
    arcade.bestLapT = null;
    arcade.raceDone = false;
    arcade.pickups = 0;
    for (const b of bottles) { b.active = true; b.rearm = 0; }
  }

  // Harness-only: place the car deterministically in track space.
  function teleportS(s, lat, keepTraffic) {
    arcade.s = ((s % L) + L) % L;
    arcade.lat = lat;
    arcade.speed = 0;
    arcade.heading = 0;
    arcade.steerVis = 0;
    arcade.nitro = 1;
    arcade.nitroBurning = false;
    placeOnTrack(chassis, arcade.s, arcade.lat, ch.y, 0);
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rivalSt.s = (arcade.s + 40) % L;
    if (keepTraffic) return;
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const lanes = car.kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
      car.lane = lanes[i % lanes.length];
      const n = car.kind === 'same' ? CFG.trafficCount : CFG.oncomingCount;
      car.s = (arcade.s + 120 + (i % n) * (L / n / 2)) % L;
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // Harness-only: run N physics steps without rendering (fast-forward).
  function stepN(n, input, racing) {
    for (let i = 0; i < n; i++) step(CFG.fixedDt, input, racing);
  }

  reset();

  return {
    RAPIER, world, chassis, chassisCol, rival, rivalCol, traffic, rivalSt,
    arcade, bottles, track, addStaticBox, onContact, step, stepN, reset, teleportS,
    playerSpeed: () => arcade.speed,
    rawEvents: () => rawEventCount,
    // Harness: collider half-extents + vertical offsets (body origin heights)
    // so the projection check can compare Rapier cuboids vs rendered meshes.
    colliderInfo: () => ({
      player: { half: [ch.x, 0.75, ch.z], colOff: 0.35, bodyH: ch.y },
      traffic: { half: [ch.x, 0.7, ch.z], colOff: 0.35, bodyH: 0.35 },
    }),
    // Harness: place traffic car i relative to the player (gauntlet scenario).
    placeTraffic: (i, sDelta, lane) => {
      const car = traffic[i % traffic.length];
      car.s = (((arcade.s + sDelta) % L) + L) % L;
      car.lane = lane;
      car.slowT = 0;
    },
  };
}
