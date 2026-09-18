// Tokyo Drift 3D — Milestone 2 boot + game loop.
// Render / physics / input live in their own modules; this file wires them.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { CFG } from './config.js';
import { createPhysics } from './physics.js';
import { buildCity } from './city.js';
import { buildCarMesh } from './car.js';
import { Sparks } from './sparks.js';
import { input, bindInput, setInput } from './input.js';
import { bindHud, updateHud } from './hud.js';

const errors = [];
function reportError(msg) {
  errors.push(String(msg).slice(0, 300));
  const el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = errors.slice(-3).join('\n'); }
}
window.addEventListener('error', (e) => reportError('error: ' + (e.message || e.type)));
window.addEventListener('unhandledrejection', (e) => reportError('reject: ' + (e.reason && e.reason.message || e.reason)));

let physics, renderer, scene, camera, playerMesh, rivalMesh, sparks, city;
let state = 'menu';       // menu | playing
let elapsed = 0;
let sparkCount = 0;
const startZ = CFG.spawnZ;

// Smooth tunnel factor: 1 deep inside, ramping at the portals.
function tunnelFactor(z) {
  const m = 60; // ramp margin
  if (z < CFG.tunnelStart - m || z > CFG.tunnelEnd + m) return 0;
  if (z > CFG.tunnelStart && z < CFG.tunnelEnd) return 1;
  if (z <= CFG.tunnelStart) return (z - (CFG.tunnelStart - m)) / m;
  return ((CFG.tunnelEnd + m) - z) / m;
}

async function boot() {
  await RAPIER.init();
  physics = await createPhysics(RAPIER);

  renderer = new THREE.WebGLRenderer({
    antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);

  city = buildCity(scene, physics);
  sparks = new Sparks(scene);
  physics.onContact((kind, x, y, z) => {
    sparkCount++;
    if (kind === 'curb' || kind === 'barrier') sparks.burst(x, y, z, 26, 3.0);
    else if (kind === 'building') sparks.burst(x, y, z, 60, 5.0);
    else if (kind === 'rival' || kind === 'traffic') sparks.burst(x, y + 0.4, z, 40, 4.0);
  });

  playerMesh = buildCarMesh(0xff6a1a); // Pocket-reference orange
  rivalMesh = buildCarMesh(0x1ad1c0);  // teal rival
  scene.add(playerMesh, rivalMesh);

  bindInput();
  bindHud();
  window.addEventListener('resize', onResize);
  document.getElementById('btn-start').addEventListener('click', resetGame);

  syncMeshes();
  city.syncTraffic(physics.traffic);
  updateCamera(1);
  updateHud(0, 0, 0, 1, false);
  renderer.render(scene, camera);

  window.__td3 = {
    ready: true,
    start: resetGame,
    reset: resetGame,
    teleport: (x, z, yaw, keepTraffic) => {
      physics.teleport(x, z, yaw || 0, keepTraffic);
      for (const k of ['left', 'right', 'nitro']) input[k] = false;
      elapsed = 0;
      state = 'playing';
      document.getElementById('overlay').style.display = 'none';
    },
    setInput,
    input: () => ({ left: !!input.left, right: !!input.right, nitro: !!input.nitro }),
    state: () => {
      const p = physics.chassis.translation();
      return {
        state, errors: errors.slice(),
        speed: physics.playerSpeed(),
        nitro: physics.arcade.nitro,
        nitroOn: physics.arcade.nitroOn,
        dist: Math.max(0, p.z - startZ),
        time: elapsed, x: p.x, y: p.y, z: p.z,
        yaw: physics.arcade.yaw,
        rivalZ: physics.rival.translation().z,
        rivalX: physics.rival.translation().x,
        traffic: physics.traffic.map((c) => {
          const t = c.body.translation();
          return { kind: c.kind, x: +t.x.toFixed(1), z: +t.z.toFixed(1) };
        }),
        sparks: sparkCount,
        rawEvents: physics.rawEvents(),
        tunnel: tunnelFactor(p.z),
      };
    },
    // Mean luminance (0..1) of the central screen region — used by the
    // harness to prove the tunnel is never pitch black.
    luma: (frac) => {
      frac = frac || 0.4;
      const c = renderer.domElement;
      const t = document.createElement('canvas');
      t.width = 64; t.height = 64;
      const g = t.getContext('2d');
      g.drawImage(c,
        c.width * (0.5 - frac / 2), c.height * (0.5 - frac / 2), c.width * frac, c.height * frac,
        0, 0, 64, 64);
      const d = g.getImageData(0, 0, 64, 64).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return s / (d.length / 4) / 255;
    },
    debug: () => ({
      yawDeg: physics.arcade.yaw * 180 / Math.PI,
      speed: physics.arcade.speed,
      steerVis: physics.arcade.steerVis,
      nitro: physics.arcade.nitro,
    }),
  };

  requestAnimationFrame(loop);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function resetGame() {
  physics.reset();
  for (const k of ['left', 'right', 'nitro']) input[k] = false;
  elapsed = 0;
  state = 'playing';
  document.getElementById('overlay').style.display = 'none';
}

// The physics body origin sits at y=0.35 (collider center); the visual
// mesh is authored with its origin at ground level, so the mesh is
// placed at (x, 0, z) with the arcade yaw.
function syncBodyMesh(mesh, body, isPlayer) {
  const t = body.translation();
  mesh.position.set(t.x, 0, t.z);
  if (isPlayer) {
    const yaw = physics.arcade.yaw;
    mesh.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    const ws = mesh.userData.wheels;
    const spots = [[0.85, 1.45], [-0.85, 1.45], [0.85, -1.45], [-0.85, -1.45]];
    ws.forEach((w, i) => {
      w.position.set(spots[i][0], CFG.wheelRadius, spots[i][1]);
      w.rotation.y = i < 2 ? physics.arcade.steerVis : 0; // front wheels steer visually
    });
  } else {
    const r = body.rotation();
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const ws = mesh.userData.wheels;
    const spots = [[0.85, 1.45], [-0.85, 1.45], [0.85, -1.45], [-0.85, -1.45]];
    ws.forEach((w, i) => w.position.set(spots[i][0], CFG.wheelRadius, spots[i][1]));
  }
}

function syncMeshes() {
  syncBodyMesh(playerMesh, physics.chassis, true);
  syncBodyMesh(rivalMesh, physics.rival, false);
  city.syncTraffic(physics.traffic);
}

const _camTarget = new THREE.Vector3();

function updateCamera(dt) {
  const t = physics.chassis.translation();
  const yaw = physics.arcade.yaw; // yaw-only follow, never rolls with the body
  const off = new THREE.Vector3(
    Math.sin(yaw) * -10.5, 4.6, Math.cos(yaw) * -10.5
  );
  _camTarget.set(t.x + off.x, 0.35 + off.y, t.z + off.z);
  const k = dt >= 1 ? 1 : 1 - Math.exp(-6 * dt);
  camera.position.lerp(_camTarget, k);
  camera.lookAt(t.x, 1.9, t.z + 7);
  // Nitro FOV kick.
  const targetFov = physics.arcade.nitroOn ? 74 : 62;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 5 * dt);
    camera.updateProjectionMatrix();
  }
}

const clock = new THREE.Clock();
let acc = 0;
const NEUTRAL_INPUT = { left: false, right: false, nitro: false };

function loop() {
  requestAnimationFrame(loop);
  try {
    const dt = Math.min(clock.getDelta(), 0.1);
    // Physics always steps; race time only accrues while playing.
    acc += dt;
    let n = 0;
    while (acc >= CFG.fixedDt && n < 5) {
      physics.step(CFG.fixedDt, state === 'playing' ? input : NEUTRAL_INPUT);
      acc -= CFG.fixedDt;
      n++;
      if (state === 'playing') elapsed += CFG.fixedDt;
    }
    if (n === 5) acc = 0; // drop backlog rather than spiral
    syncMeshes();
    city.update(dt, elapsed);
    sparks.update(dt);
    const p = physics.chassis.translation();
    city.setTunnelGlow(tunnelFactor(p.z));
    updateHud(physics.playerSpeed(), Math.max(0, p.z - startZ), elapsed,
      physics.arcade.nitro, physics.arcade.nitroOn);
    updateCamera(dt);
    renderer.render(scene, camera);
  } catch (err) {
    reportError('loop: ' + (err && err.message || err));
  }
}

boot().catch((e) => reportError('boot: ' + (e && e.message || e)));
