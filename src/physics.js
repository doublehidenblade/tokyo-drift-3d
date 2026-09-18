// Rapier physics for Milestone 6: the player car is HEADING-DRIVEN in
// world space. arcade.x/z is the source of truth and arcade.heading is an
// absolute world yaw. Steering changes the heading; with zero steering
// input the heading is untouched and the car drives straight along its own
// heading — road curvature has zero influence (the M5 track-space model
// re-snapped the car to the spline every step, which is why it "followed
// the road" hands-off; that model is gone).
//
// arcade.s/lat are per-step DERIVED estimates (nearest track point) used
// only by traffic AI, nitro bottles, lap counting, the HUD/camera, and the
// autopilot — never to move the car.
//
// Guard rails: the world agent builds rail GEOMETRY + Rapier colliders via
// the exported addStaticBox(..., 'rail') at the CFG.railLat spec (see
// railSpec() below). The car ALSO bounces off the logical rail plane
// (|lat| = CFG.maxLat) in arcade code every step — a continuous plane
// check, so tunneling through at 216 km/h is impossible by construction.
// Rapier CCD is enabled on the player body as a backstop for thin
// world-agent colliders, and 'rail' contact events apply a mild grind
// scrub (deduped against the arcade bounce).
//
// Containment failsafe: NaN state, leaving CFG.worldBounds, or dropping
// below CFG.voidY respawns the car on the track centerline (see
// src/respawn.js), aligned to the tangent, at moderate speed, with a 1 s
// ghost window. Drivetrain stays arcade (no tire sim, no raycast vehicle).
import { CFG } from './config.js';
import { nearestTrackPoint, containmentBreach, respawnPlayer } from './respawn.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

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

  // One static body hosts every static collider. Tags are generic so the
  // world agent can add rail colliders (or anything else) via the exported
  // addStaticBox and have them routed in the contact dispatch below.
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const tagHandles = new Map(); // tag -> Set<handle>
  function tagOf(handle) {
    for (const [t, set] of tagHandles) if (set.has(handle)) return t;
    return null;
  }

  function yawQuat(yaw) {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  }

  // Exported for the world agent (rail geometry + colliders, etc.).
  function addStaticBox(hx, hy, hz, x, y, z, yaw, tag) {
    const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(x, y, z).setFriction(0.9);
    if (yaw) d.setRotation(yawQuat(yaw));
    const h = world.createCollider(d, staticBody).handle;
    if (tag) {
      if (!tagHandles.has(tag)) tagHandles.set(tag, new Set());
      tagHandles.get(tag).add(h);
    }
    return h;
  }

  // ---- Player: dynamic cuboid, teleported from arcade state every step
  // (kinematic-by-teleport, as in M3-M5). CCD is a backstop so the Rapier
  // integration itself can't tunnel through thin world-agent colliders at
  // speed; the arcade rail-plane check is the primary anti-tunnel system.
  const ch = CFG.chassisHalf;
  const chassisDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(0, 0.4, 0)
    .setLinearDamping(0.0)
    .setAngularDamping(4.0)
    .lockRotations();
  if (chassisDesc.setCcdEnabled) chassisDesc.setCcdEnabled(true);
  const chassis = world.createRigidBody(chassisDesc);
  const chassisColDesc = RAPIER.ColliderDesc.cuboid(ch.x, 0.75, ch.z)
    .setTranslation(0, 0.35, 0) // spans road+0 .. road+1.5: covers the cabin
    .setDensity((CFG.carMassKg) / (8 * ch.x * ch.y * ch.z))
    .setFriction(0.4)
    .setRestitution(0.1)
    .setCollisionGroups(ALL);
  chassisColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const chassisCol = world.createCollider(chassisColDesc, chassis);

  // M6 arcade state. x/z/heading/speed are the simulation; s/lat are
  // derived estimates refreshed by estimateTrack() every step.
  const arcade = {
    x: 0, z: 0,
    s: CFG.spawnS, lat: CFG.spawnLat,
    speed: 0, heading: 0, // heading = absolute world yaw (rad)
    steerVis: 0, nitro: 1, nitroBurning: false,
    ghostT: 0, respawns: 0, lastGoodS: CFG.spawnS, dbgY: undefined,
    lap: 1, raceT: 0, lapStartT: 0, lastLapT: null, bestLapT: null,
    raceDone: false, pickups: 0,
  };
  const facade = { arcade, track }; // for respawnPlayer

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

  // Map a track-space (s, lat) onto a world body (teleportS only).
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

  // Mirror the arcade state onto the Rapier body (called every step and
  // after respawns). Velocity follows the heading so contacts resolve.
  function placeBody() {
    track.frameAt(arcade.s, _f);
    chassis.setTranslation({ x: arcade.x, y: _f.pos.y + ch.y, z: arcade.z }, true);
    chassis.setRotation(yawQuat(arcade.heading), true);
    chassis.setLinvel({
      x: Math.sin(arcade.heading) * arcade.speed,
      y: 0,
      z: Math.cos(arcade.heading) * arcade.speed,
    }, true);
  }

  // Refresh the derived track-space estimate from the world position.
  const _est = {};
  function estimateTrack() {
    nearestTrackPoint(track, arcade.x, arcade.z, _est);
    arcade.s = _est.s;
    arcade.lat = _est.lat;
    if (isFinite(_est.s) && Math.abs(_est.lat) <= CFG.maxLat) arcade.lastGoodS = _est.s;
    return _est;
  }

  // Guard-rail plane: continuous check, so no tunneling at any speed.
  // The clamp cancels the outward displacement every step (that IS the
  // lateral reflection — the car can never cross the plane). The heading
  // is NEVER touched here: a rail hit must not spin or yank the car
  // (M6). Fresh hits scrub speed x0.82 and spark; sustained grinding
  // costs speed continuously instead of compounding the hit scrub.
  let stepCount = 0, lastDt = CFG.fixedDt;
  let lastBounceStep = -1e9, lastRailSparkStep = -1, railBounceStep = -1;
  function railPlaneCheck(est) {
    const over = Math.abs(arcade.lat) - CFG.maxLat;
    if (!(over > 0)) return; // also false when lat is NaN
    const side = Math.sign(arcade.lat) || 1;
    const rel = wrapAngle(arcade.heading - est.yaw);
    const outward = Math.sin(rel) * side; // > 0: still driving into the rail
    track.frameAt(arcade.s, _f);
    arcade.lat = side * CFG.maxLat;
    arcade.x = _f.pos.x + _f.lat.x * arcade.lat;
    arcade.z = _f.pos.z + _f.lat.z * arcade.lat;
    if (outward > 0) {
      if (stepCount - lastBounceStep > 30) {
        arcade.speed *= 0.82; // fresh hit
        lastBounceStep = stepCount;
        railBounceStep = stepCount; // logical plane handled it; skip the collider double-scrub
      } else {
        arcade.speed *= Math.max(0, 1 - 0.8 * lastDt); // grinding
      }
    }
    if (lastRailSparkStep !== stepCount) {
      lastRailSparkStep = stepCount;
      emit('curb', arcade.x, est.roadY + 0.6, arcade.z);
    }
  }

  // Order matters: the hard failsafe (NaN / bounds / void) runs BEFORE the
  // rail clamp, so a flung car respawns instead of being yanked to the rail.
  function containAndClamp() {
    const est = estimateTrack();
    let y = est.roadY;
    if (typeof arcade.dbgY === 'number') { y = arcade.dbgY; arcade.dbgY = undefined; }
    const breach = containmentBreach(arcade.x, y, arcade.z);
    if (breach) {
      respawnPlayer(facade, breach);
      placeBody();
      return;
    }
    railPlaneCheck(est);
  }

  // Spark/contact callbacks registered by main.js: cb(kind, x, y, z).
  // NOTE: kind 'rail' is folded into 'curb' for emission — main.js only
  // handles curb/building/rival/traffic/pickup, and rail hits should look
  // like curb strikes without a main.js change.
  const listeners = [];
  function onContact(cb) { listeners.push(cb); }
  let rawEventCount = 0;

  function emit(kind, x, y, z) {
    for (const cb of listeners) cb(kind, x, y, z);
  }

  // M6: car-car bump-apart in world space. The contact normal n (world XZ,
  // player center -> other center) shoves the player AWAY along n,
  // proportional to the closing speed along n, hard-clamped. Purely
  // positional — the heading is never touched, so a hit can not spin the
  // car. A follow-up rail-plane check keeps the shove inside the corridor.
  const BUMP_K = 0.08;       // meters of shove per (m/s) of closing speed
  const BUMP_MAX = 2.2;      // hard clamp on bump magnitude (m)
  const BUMP_MIN_SEP = 0.35; // separation nudge when merely overlapping

  function carBump(other, kind) {
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
    const a = arcade;
    track.frameAt(a.s, _f);
    const ot = oBody.translation();
    let nx = ot.x - a.x, nz = ot.z - a.z;
    let nrm = Math.hypot(nx, nz);
    if (nrm < 1e-4) { // dead-center overlap: separate laterally by lane
      const car = isTraffic ? trafficByHandle.get(other) : null;
      const oLane = car ? car.lane : rivalSt.lane;
      const sgn = oLane >= a.lat ? 1 : -1;
      nx = _f.lat.x * sgn; nz = _f.lat.z * sgn; nrm = 1;
    }
    nx /= nrm; nz /= nrm;
    const pvx = Math.sin(a.heading) * a.speed, pvz = Math.cos(a.heading) * a.speed;
    const ovx = _f.tan.x * oTanVel, ovz = _f.tan.z * oTanVel;
    const closing = (pvx - ovx) * nx + (pvz - ovz) * nz;
    const J = closing > 0 ? Math.min(closing * BUMP_K, BUMP_MAX) : BUMP_MIN_SEP;

    a.x -= nx * J;
    a.z -= nz * J;
    // Head-on component scrubs speed (nT = normal's tangent part).
    const nT = nx * _f.tan.x + nz * _f.tan.z;
    const nL = nx * _f.lat.x + nz * _f.lat.z;
    const cap = a.nitroBurning ? CFG.nitroMaxSpeed : CFG.maxSpeed;
    a.speed = Math.max(0, Math.min(cap, a.speed - nT * J * 0.5));

    // Other car: shoved away along the normal (track space), then slowed.
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
    stepCount++;
    lastDt = dt;
    attachDebugSurface();
    const a = arcade;

    // --- Nitro: one tap burns the WHOLE meter; no regen over time ---
    if (input.nitroPulse) {
      input.nitroPulse = false;
      if (a.nitro > 0.05 && !a.nitroBurning) a.nitroBurning = true;
    }
    if (a.nitroBurning) {
      a.nitro = Math.max(0, a.nitro - CFG.nitroBurnRate * dt);
      if (a.nitro <= 0) a.nitroBurning = false;
    }
    const cap = a.nitroBurning ? CFG.nitroMaxSpeed : CFG.maxSpeed;
    const accel = a.nitroBurning ? CFG.nitroAccel : CFG.arcadeAccel;
    if (racing && !a.raceDone) {
      if (a.speed < cap) a.speed = Math.min(cap, a.speed + accel * dt);
      else a.speed = Math.max(cap, a.speed - 6 * dt);
    }

    // --- M6 steering: absolute world heading ---
    // steerIn is screen-relative: +1 = toward screen-LEFT. Screen-left as
    // a world direction is (input.latDirSign * track-lat), with latDirSign
    // derived every frame from the live camera projection by main.js (the
    // M4 proof — no hardcoded lat/screen convention). turnSign rotates the
    // heading toward that world direction: with the chase camera behind
    // the car this is a left turn; with the front-facing attract camera it
    // is still screen-left. Zero input: the heading below is untouched, so
    // the car drives straight along its own heading — road curvature has
    // no influence whatsoever.
    const steerIn = ((input.left ? 1 : 0) - (input.right ? 1 : 0));
    if (a.speed > 0.5 && steerIn !== 0) {
      track.frameAt(a.s, _f);
      let lx = _f.lat.x, lz = _f.lat.z;
      const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
      const sgn = input.latDirSign || 1;
      const sx = lx * sgn, sz = lz * sgn; // screen-left world direction
      const fx = Math.sin(a.heading), fz = Math.cos(a.heading);
      const turnSign = (fz * sx - fx * sz) >= 0 ? 1 : -1;
      const t = Math.min(a.speed / CFG.maxSpeed, 1);
      const yawRate = CFG.steerYawLow + (CFG.steerYawHigh - CFG.steerYawLow) * t;
      a.heading += steerIn * turnSign * yawRate * dt;
    }
    // Attract-mode assist (one-shot flag set by autopilot.js each update):
    // gently bias the heading toward the track tangent so the menu demo /
    // ?autopilot=1 explicitly follows the racing line. Player driving never
    // sets input.autopilot — the heading there is purely input-driven.
    if (input.autopilot) {
      input.autopilot = false;
      track.frameAt(a.s, _f);
      a.heading += wrapAngle(_f.yaw - a.heading) * Math.min(1, 2.5 * dt);
    }
    a.steerVis += ((steerIn * CFG.maxSteer) - a.steerVis) * Math.min(1, 12 * dt);

    // --- Integrate along the car's own heading (never re-snapped) ---
    const prevS = a.s;
    a.x += Math.sin(a.heading) * a.speed * dt;
    a.z += Math.cos(a.heading) * a.speed * dt;

    containAndClamp();

    // Lap counting at the start/finish line (forward crossings only).
    if (racing && !a.raceDone && a.speed > 1 && prevS > L - 300 && a.s < 300) {
      const lapT = a.raceT - a.lapStartT;
      a.lastLapT = lapT;
      if (!a.bestLapT || lapT < a.bestLapT) a.bestLapT = lapT;
      a.lap++;
      a.lapStartT = a.raceT;
      if (a.lap > CFG.laps) {
        a.raceDone = true;
      }
    }
    if (racing) a.raceT += dt;
    if (a.ghostT > 0) a.ghostT = Math.max(0, a.ghostT - dt);

    placeBody();

    // --- Nitro bottle pickups (track-space, via the s/lat estimate) ---
    for (const b of bottles) {
      if (!b.active) {
        b.rearm -= dt;
        if (b.rearm <= 0) b.active = true;
        continue;
      }
      if (Math.abs(track.distAhead(a.s, b.s)) < 6 && Math.abs(b.lat - a.lat) < 3.2) {
        b.active = false;
        b.rearm = 25;
        a.nitro = Math.min(1, a.nitro + CFG.nitroPickupFill);
        a.pickups++;
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
      let effSpeed = car.speed;
      if (car.slowT > 0) { car.slowT -= dt; effSpeed = car.speed * 0.45; }
      else if (car.kind === 'same') {
        const ahead = track.distAhead(car.s, a.s);
        if (ahead > 0 && ahead < 35 && Math.abs(car.lane - a.lat) < 3.2) {
          effSpeed = Math.min(car.speed, Math.max(a.speed * 0.85, 8));
        }
      }
      car.s = (car.s + dirS * effSpeed * dt) % L;
      if (car.s < 0) car.s += L;
      if (track.distAhead(a.s, car.s) < -250) respawnTraffic(car, a.s);
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

    // --- Collision events: sparks + arcade response ---
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
      if (trafficByHandle.has(other)) kind = 'traffic';
      else if (other === rivalCol.handle || other === chassisCol.handle) kind = 'rival';
      else kind = tagOf(other); // 'curb' | 'building' | 'rail' | null
      if (!kind) return;
      const src = playerHit ? chassis.translation() : rival.translation();
      // Ghost window: contacts are visual-only (sparks), never gameplay.
      if (playerHit && a.ghostT <= 0) {
        if (kind === 'traffic' || kind === 'rival') {
          carBump(other, kind);
          a.speed *= kind === 'traffic' ? 0.75 : 0.8;
        } else if (kind === 'rail') {
          // World-agent rail collider contact. The arcade rail-plane check
          // already handled the bounce this step in the aligned case (deduped
          // via railBounceStep); this path only bites when a collider sits
          // inside the logical plane — mild grind scrub, no positional yank,
          // and never a heading change (M6).
          if (railBounceStep !== stepCount) a.speed *= (1 - 0.3 * lastDt);
        }
        else if (kind === 'curb') a.speed *= 0.86;
        else if (kind === 'building') a.speed *= 0.55;
      }
      if (kind === 'rail') {
        if (lastRailSparkStep !== stepCount) {
          lastRailSparkStep = stepCount;
          emit('curb', src.x, 0.6, src.z);
        }
      } else {
        emit(kind, src.x, 0.4, src.z);
      }
    });

    // Bump shoves moved the car in world space: re-clamp + re-mirror.
    containAndClamp();
    placeBody();
  }

  function reset() {
    teleportS(CFG.spawnS, CFG.spawnLat, false);
    arcade.nitro = 1; // full meter on (re)spawn; teleportS preserves it
    arcade.lap = 1;
    arcade.raceT = 0;
    arcade.lapStartT = 0;
    arcade.lastLapT = null;
    arcade.bestLapT = null;
    arcade.raceDone = false;
    arcade.pickups = 0;
    arcade.respawns = 0;
    for (const b of bottles) { b.active = true; b.rearm = 0; }
  }

  // Harness + menu: place the car in track space, aligned to the tangent.
  function teleportS(s, lat, keepTraffic) {
    s = ((s % L) + L) % L;
    track.frameAt(s, _f);
    arcade.x = _f.pos.x + _f.lat.x * lat;
    arcade.z = _f.pos.z + _f.lat.z * lat;
    arcade.s = s;
    arcade.lat = lat;
    arcade.heading = _f.yaw;
    arcade.speed = 0;
    arcade.steerVis = 0;
    // NOTE: teleport preserves the nitro meter (M4 contract) — only
    // reset() refills it. The burn is cancelled by the reposition.
    arcade.nitroBurning = false;
    arcade.ghostT = 0;
    arcade.dbgY = undefined;
    arcade.lastGoodS = s;
    placeBody();
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rivalSt.s = (s + 40) % L;
    if (keepTraffic) return;
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const lanes = car.kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
      car.lane = lanes[i % lanes.length];
      const n = car.kind === 'same' ? CFG.trafficCount : CFG.oncomingCount;
      car.s = (s + 120 + (i % n) * (L / n / 2)) % L;
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
  }

  // Harness-only: run N physics steps without rendering (fast-forward).
  function stepN(n, input, racing) {
    for (let i = 0; i < n; i++) step(CFG.fixedDt, input, racing);
  }

  // ---- Harness-only debug surface (M6) ----
  // Lets the gate fling the car out of bounds / into NaN / below the void
  // to prove the containment failsafe. Attached lazily because window.__td3
  // is constructed in main.js after createPhysics returns.
  function debugSetWorldPos(x, z, yOvr) {
    arcade.x = x;
    arcade.z = z;
    if (yOvr !== undefined) arcade.dbgY = yOvr;
  }
  let debugAttached = false;
  function attachDebugSurface() {
    if (debugAttached) return;
    debugAttached = true;
    if (typeof window !== 'undefined' && window.__td3) {
      window.__td3.debugSetWorldPos = debugSetWorldPos;
      window.__td3.nearestTrackPoint = (x, z) => nearestTrackPoint(track, x, z, {});
    }
  }

  reset();

  return {
    RAPIER, world, chassis, chassisCol, rival, rivalCol, traffic, rivalSt,
    arcade, bottles, track, addStaticBox, onContact, step, stepN, reset, teleportS,
    playerSpeed: () => arcade.speed,
    rawEvents: () => rawEventCount,
    // World-agent contract for rail colliders: build one static cuboid per
    // side per segment with center = track.toWorld(s + seg/2, ±railLat,
    // railHeight/2), half-extents = (railThick, railHeight/2, seg/2 + 0.4),
    // yaw = frame yaw, via physics.addStaticBox(..., 'rail'). The car also
    // bounces off the logical plane at |lat| = maxLat every step, so small
    // geometry/collider mismatches can not cause tunneling.
    railSpec: () => ({
      railLat: CFG.railLat, railThick: CFG.railThick,
      railHeight: CFG.railHeight, segLen: CFG.railSegLen, maxLat: CFG.maxLat,
    }),
    // M6 B4: gate traffic colliders on visual fade-in (city.trafficFade()).
    // A traffic car whose visual hasn't finished fading in (< 1) cannot
    // collide — no ghost-car hits. Called from the render loop in main.js
    // (headless step-only scenarios never call it, so harness contacts
    // keep working as before).
    setTrafficFade: (fades) => {
      for (let i = 0; i < traffic.length; i++) {
        const car = traffic[i];
        const ready = !fades || fades[i] === undefined || fades[i] >= 1;
        const groups = ready ? TRAFFIC_HITS : 0;
        if (car._fg !== groups) { car.col.setCollisionGroups(groups); car._fg = groups; }
      }
    },
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
