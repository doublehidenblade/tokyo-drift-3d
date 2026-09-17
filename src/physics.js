// Rapier physics: world, arcade-driven player body (dynamic, so curb /
// rival / building contacts are real), rival AI body, static colliders
// (road, curbs, buildings), collision-event -> spark callbacks.
//
// NOTE: M1 started with DynamicRayCastVehicleController. After four
// harness tuning rounds it drove and steered but suffered a persistent
// pitch oscillation (wheel contact pairs alternating 1100/0011) and weak
// acceleration (~2.7 m/s^2 vs ~17 expected). Per the milestone brief, we
// fell back to arcade velocity control on a dynamic body: the chassis
// still collides for real with everything; only the drivetrain model is
// arcade. See CHANGELOG.md.
import { CFG } from './config.js';

export async function createPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = CFG.fixedDt;
  const eventQueue = new RAPIER.EventQueue(true);

  // One static body hosts every static collider (road, curbs, buildings).
  const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const curbHandles = new Set();
  const buildingHandles = new Set();

  function addStaticBox(hx, hy, hz, x, y, z, tag) {
    const h = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setFriction(0.9),
      staticBody
    ).handle;
    if (tag === 'curb') curbHandles.add(h);
    if (tag === 'building') buildingHandles.add(h);
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
      .setTranslation(0, 0.35, -20)
      .setLinearDamping(0.0)
      .setAngularDamping(4.0)
      .lockRotations()
  );
  const chassisColDesc = RAPIER.ColliderDesc.cuboid(ch.x, ch.y, ch.z)
    .setDensity((CFG.carMassKg) / (8 * ch.x * ch.y * ch.z))
    .setFriction(0.4)
    .setRestitution(0.1);
  chassisColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const chassisCol = world.createCollider(chassisColDesc, chassis);

  const arcade = { speed: 0, yaw: 0, steerVis: 0 };

  // ---- Rival: dynamic box, simple lane-keeping AI ----
  const rival = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(CFG.rivalLaneX, 0.7, 30)
      .lockRotations()
  );
  const rivalColDesc = RAPIER.ColliderDesc.cuboid(0.95, 0.7, 2.2).setDensity(150).setFriction(0.4);
  rivalColDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const rivalCol = world.createCollider(rivalColDesc, rival);

  // Spark/contact callbacks registered by main.js: cb(kind, x, y, z)
  const listeners = [];
  function onContact(cb) { listeners.push(cb); }
  let rawEventCount = 0;

  function emit(kind, x, y, z) {
    for (const cb of listeners) cb(kind, x, y, z);
  }

  function step(dt, input) {
    // --- Arcade drivetrain ---
    if (input.gas) arcade.speed = Math.min(arcade.speed + CFG.arcadeAccel * dt, CFG.maxSpeed);
    else if (input.brake) arcade.speed = Math.max(arcade.speed - CFG.arcadeBrake * dt, 0);
    else arcade.speed = Math.max(arcade.speed - (1.0 + arcade.speed * 0.22) * dt, 0);

    const steerIn = (input.left ? -1 : 0) + (input.right ? 1 : 0);
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
      else if (other === rivalCol.handle || other === chassisCol.handle) kind = 'rival';
      if (!kind) return;
      const src = playerHit ? chassis.translation() : rival.translation();
      if (playerHit && (kind === 'curb' || kind === 'building')) {
        arcade.speed *= kind === 'curb' ? 0.86 : 0.55; // kissing the curb scrubs speed
      }
      emit(kind, src.x, 0.4, src.z);
    });
  }

  function reset() {
    teleport(0, -20, 0);
  }

  // Harness-only: place the car deterministically (tests, screenshots).
  function teleport(x, z, yaw) {
    arcade.speed = 0; arcade.yaw = yaw; arcade.steerVis = 0;
    chassis.setTranslation({ x, y: 0.35, z }, true);
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassis.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    rival.setTranslation({ x: CFG.rivalLaneX, y: 0.7, z: 30 }, true);
    rival.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  return {
    RAPIER, world, chassis, chassisCol, rival, rivalCol,
    arcade, addStaticBox, onContact, step, reset, teleport,
    playerSpeed: () => arcade.speed,
    rawEvents: () => rawEventCount,
  };
}
