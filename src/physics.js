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
  const chassisColDesc = RAPIER.ColliderDesc.cuboid(ch.x, ch.y, ch.z)
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
  const rivalColDesc = RAPIER.ColliderDesc.cuboid(ch.x, ch.y, ch.z)
    .setDensity(150).setFriction(0.4).setCollisionGroups(RIVAL_HITS);
  rivalColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const rivalCol = world.createCollider(rivalColDesc, rival);
  const rivalSt = { s: 40, lane: CFG.rivalLat };

  // ---- Traffic: track-space cars, real player contacts ----
  const traffic = []; // {body, col, kind, lane, speed, s}
  const trafficHandles = new Set();
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
    const cd = RAPIER.ColliderDesc.cuboid(ch.x, 0.35, ch.z)
      .setDensity(120).setFriction(0.4).setRestitution(0.1)
      .setCollisionGroups(TRAFFIC_HITS);
    cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = world.createCollider(cd, body);
    trafficHandles.add(col.handle);
    const car = { body, col, kind, lane, speed, s };
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
    // Screen-left = steer toward -lat (lat points to the driver's right).
    const steerIn = (input.left ? 1 : 0) + (input.right ? -1 : 0);
    if (arcade.speed > 0.5) {
      arcade.heading += -steerIn * CFG.steerLatAccel / Math.max(arcade.speed, 5) * dt;
      arcade.heading = Math.max(-CFG.maxHeading, Math.min(CFG.maxHeading, arcade.heading));
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
    for (const car of traffic) {
      const dirS = car.kind === 'same' ? 1 : -1;
      car.s = (car.s + dirS * car.speed * dt) % L;
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
        x: dirS * _f.tan.x * car.speed,
        y: dirS * _f.tan.y * car.speed,
        z: dirS * _f.tan.z * car.speed,
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
      else if (trafficHandles.has(other)) kind = 'traffic';
      else if (other === rivalCol.handle || other === chassisCol.handle) kind = 'rival';
      if (!kind) return;
      const src = playerHit ? chassis.translation() : rival.translation();
      if (playerHit) {
        if (kind === 'curb') arcade.speed *= 0.86;
        else if (kind === 'traffic') arcade.speed *= 0.75;
        else if (kind === 'building') arcade.speed *= 0.55;
        else if (kind === 'rival') arcade.speed *= 0.8;
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
  };
}
