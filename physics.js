// Rapier physics: world, arcade-driven player body (dynamic, so curb /
// rival / building / traffic contacts are real), rival AI body, traffic
// AI bodies, static colliders (road, curbs, median, buildings, tunnel),
// collision-event -> spark callbacks.
//
// NOTE: M1 started with DynamicRayCastVehicleController. After four
// harness tuning rounds it drove and steered but suffered a persistent
// pitch oscillation (wheel contact pairs alternating 1100/0011) and weak
// acceleration (~2.7 m/s^2 vs ~17 expected). Per the milestone brief, we
// fell back to arcade velocity control on a dynamic body: the chassis
// still collides for real with everything; only the drivetrain model is
// arcade. M2 keeps this model (auto-accelerate + nitro) — do NOT
// reintroduce the raycast vehicle. See CHANGELOG.md.
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

export async function createPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = CFG.fixedDt;
  const eventQueue = new RAPIER.EventQueue(true);
  const rnd = lcg(20260917);

  // One static body hosts every static collider (road, curbs, median,
  // buildings, tunnel walls, gantry posts).
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const curbHandles = new Set();
  const buildingHandles = new Set();
  const barrierHandles = new Set();

  function addStaticBox(hx, hy, hz, x, y, z, tag) {
    const h = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.9),
      staticBody
    ).handle;
    if (tag === 'curb') curbHandles.add(h);
    if (tag === 'building') buildingHandles.add(h);
    if (tag === 'barrier') barrierHandles.add(h);
    return h;
  }

  // Road slab: top surface at y=0, z from -100 to trackLength+100.
  addStaticBox(40, 0.5, CFG.trackLength / 2 + 100, 0, -0.5, CFG.trackLength / 2);
  // Curbs: solid boxes the car can really hit/ride.
  for (const s of [-1, 1]) {
    addStaticBox(0.75, CFG.curbTopY / 2, CFG.trackLength / 2 + 100,
      s * CFG.curbX, CFG.curbTopY / 2, CFG.trackLength / 2, 'curb');
  }

  // ---- Player: dynamic cuboid, arcade velocity control ----
  // Body origin rests at y=0.35 (collider half-height); the visual mesh
  // is drawn with its origin at ground level (see main.js syncBodyMesh).
  const ch = CFG.chassisHalf;
  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(CFG.spawnX, 0.35, CFG.spawnZ)
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

  const arcade = { speed: 0, yaw: 0, steerVis: 0, nitro: 1, nitroOn: false };

  // ---- Rival: dynamic box, simple lane-keeping AI ----
  const rival = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(CFG.rivalLaneX, 0.7, 30)
      .lockRotations()
  );
  const rivalColDesc = RAPIER.ColliderDesc.cuboid(0.95, 0.7, 2.2)
    .setDensity(150).setFriction(0.4).setCollisionGroups(RIVAL_HITS);
  rivalColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const rivalCol = world.createCollider(rivalColDesc, rival);

  // ---- Traffic: dynamic boxes, lane AI, real player contacts ----
  const traffic = []; // {body, col, kind: 'same'|'oncoming', lane, speed}
  const trafficHandles = new Set();
  function spawnTrafficCar(kind, i) {
    const lanes = kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
    const lane = lanes[(rnd() * lanes.length) | 0];
    const speed = kind === 'same'
      ? CFG.trafficSpeedMin + rnd() * (CFG.trafficSpeedMax - CFG.trafficSpeedMin)
      : CFG.oncomingSpeedMin + rnd() * (CFG.oncomingSpeedMax - CFG.oncomingSpeedMin);
    const z = kind === 'same' ? 60 + i * 62 + rnd() * 30 : 150 + i * 78 + rnd() * 30;
    const yaw = kind === 'same' ? 0 : Math.PI;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(lane, 0.35, z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
        .setLinearDamping(0.0)
        .lockRotations()
    );
    const cd = RAPIER.ColliderDesc.cuboid(0.95, 0.35, 2.2)
      .setDensity(120).setFriction(0.4).setRestitution(0.1)
      .setCollisionGroups(TRAFFIC_HITS);
    cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const col = world.createCollider(cd, body);
    trafficHandles.add(col.handle);
    const car = { body, col, kind, lane, speed };
    traffic.push(car);
    return car;
  }
  for (let i = 0; i < CFG.trafficCount; i++) spawnTrafficCar('same', i);
  for (let i = 0; i < CFG.oncomingCount; i++) spawnTrafficCar('oncoming', i);

  function respawnTraffic(car, playerZ) {
    const lanes = car.kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
    car.lane = lanes[(rnd() * lanes.length) | 0];
    car.speed = car.kind === 'same'
      ? CFG.trafficSpeedMin + rnd() * (CFG.trafficSpeedMax - CFG.trafficSpeedMin)
      : CFG.oncomingSpeedMin + rnd() * (CFG.oncomingSpeedMax - CFG.oncomingSpeedMin);
    const z = playerZ + (car.kind === 'same' ? 250 + rnd() * 150 : 300 + rnd() * 200);
    const yaw = car.kind === 'same' ? 0 : Math.PI;
    car.body.setTranslation({ x: car.lane, y: 0.35, z }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  }

  // Spark/contact callbacks registered by main.js: cb(kind, x, y, z)
  const listeners = [];
  function onContact(cb) { listeners.push(cb); }
  let rawEventCount = 0;

  function emit(kind, x, y, z) {
    for (const cb of listeners) cb(kind, x, y, z);
  }

  function step(dt, input) {
    // --- Arcade drivetrain: auto-accelerate toward the cap; nitro raises it ---
    const wantNitro = !!input.nitro && arcade.nitro > 0.01;
    arcade.nitroOn = wantNitro;
    if (wantNitro) arcade.nitro = Math.max(0, arcade.nitro - CFG.nitroDrain * dt);
    else arcade.nitro = Math.min(1, arcade.nitro + CFG.nitroRecharge * dt);
    const cap = wantNitro ? CFG.nitroMaxSpeed : CFG.maxSpeed;
    const accel = wantNitro ? CFG.nitroAccel : CFG.arcadeAccel;
    if (arcade.speed < cap) arcade.speed = Math.min(cap, arcade.speed + accel * dt);
    else arcade.speed = Math.max(cap, arcade.speed - 6 * dt); // ease down after nitro

    // Steering: screen-left (camera-relative) is +yaw. The chase camera
    // sits behind the car looking +Z, so screen-right is world -X and
    // increasing yaw (toward +X) moves the car toward screen-left.
    const steerIn = (input.left ? 1 : 0) + (input.right ? -1 : 0);
    // Kinematic-bicycle yaw: constant lateral accel => yaw rate falls
    // with speed (no more high-speed donuts when holding steer).
    if (arcade.speed > 0.5) {
      arcade.yaw += steerIn * CFG.steerLatAccel / Math.max(arcade.speed, 5) * dt;
    }
    arcade.steerVis += ((steerIn * CFG.maxSteer) - arcade.steerVis) * Math.min(1, 12 * dt);

    const fx = Math.sin(arcade.yaw), fz = Math.cos(arcade.yaw);
    const lv = chassis.linvel(); // keep gravity-driven y
    chassis.setLinvel({ x: fx * arcade.speed, y: lv.y, z: fz * arcade.speed }, true);
    chassis.setRotation({ x: 0, y: Math.sin(arcade.yaw / 2), z: 0, w: Math.cos(arcade.yaw / 2) }, true);

    world.step(eventQueue);

    // --- Rival AI: hold lane, constant forward speed ---
    const rp = rival.translation();
    const rv = rival.linvel();
    const vx = Math.max(-5, Math.min(5, (CFG.rivalLaneX - rp.x) * 1.2));
    rival.setLinvel({ x: vx, y: rv.y, z: CFG.rivalSpeed }, true);

    // --- Traffic AI: lane-keeping, respawn ahead when left behind ---
    const pz = chassis.translation().z;
    for (const car of traffic) {
      const tp = car.body.translation();
      const tv = car.body.linvel();
      const dirS = car.kind === 'same' ? 1 : -1;
      if (car.kind === 'same' && tp.z < pz - 40) respawnTraffic(car, pz);
      else if (car.kind === 'oncoming' && tp.z < pz - 60) respawnTraffic(car, pz);
      const lxv = Math.max(-4, Math.min(4, (car.lane - tp.x) * 1.4));
      car.body.setLinvel({ x: lxv, y: tv.y, z: dirS * car.speed }, true);
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
      else if (barrierHandles.has(other)) kind = 'barrier';
      else if (buildingHandles.has(other)) kind = 'building';
      else if (trafficHandles.has(other)) kind = 'traffic';
      else if (other === rivalCol.handle || other === chassisCol.handle) kind = 'rival';
      if (!kind) return;
      const src = playerHit ? chassis.translation() : rival.translation();
      if (playerHit) {
        if (kind === 'curb') arcade.speed *= 0.86;
        else if (kind === 'barrier') arcade.speed *= 0.8;
        else if (kind === 'traffic') arcade.speed *= 0.75;
        else if (kind === 'building') arcade.speed *= 0.55;
      }
      emit(kind, src.x, 0.4, src.z);
    });
  }

  function reset() {
    teleport(CFG.spawnX, CFG.spawnZ, 0);
  }

  // Harness-only: place the car deterministically (tests, screenshots).
  // keepTraffic=true skips the traffic re-seed (for follow-up teleports).
  function teleport(x, z, yaw, keepTraffic) {
    arcade.speed = 0; arcade.yaw = yaw; arcade.steerVis = 0;
    arcade.nitro = 1; arcade.nitroOn = false;
    chassis.setTranslation({ x, y: 0.35, z }, true);
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassis.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    rival.setTranslation({ x: CFG.rivalLaneX, y: 0.7, z: 30 }, true);
    rival.setLinvel({ x: 0, y: 0, z: 0 }, true);
    if (keepTraffic) return;
    // Re-seed traffic near the teleport point for deterministic tests.
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      const lanes = car.kind === 'same' ? CFG.trafficLanes : CFG.oncomingLanes;
      car.lane = lanes[i % lanes.length];
      const zoff = car.kind === 'same' ? 60 + (i % CFG.trafficCount) * 62 : 150 + (i % CFG.oncomingCount) * 78;
      const yaw2 = car.kind === 'same' ? 0 : Math.PI;
      car.body.setTranslation({ x: car.lane, y: 0.35, z: z + zoff }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.body.setRotation({ x: 0, y: Math.sin(yaw2 / 2), z: 0, w: Math.cos(yaw2 / 2) }, true);
    }
  }

  return {
    RAPIER, world, chassis, chassisCol, rival, rivalCol, traffic,
    arcade, addStaticBox, onContact, step, reset, teleport,
    playerSpeed: () => arcade.speed,
    rawEvents: () => rawEventCount,
  };
}
