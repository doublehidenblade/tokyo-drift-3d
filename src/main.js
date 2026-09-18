// Tokyo Drift 3D — Milestone 3 boot + game loop (closed lap circuit).
// Render / physics / input live in their own modules; this file wires them.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { CFG } from './config.js';
import { Track } from './track.js';
import { createPhysics } from './physics.js';
import { buildCity } from './city.js';
import { buildCarMesh, WHEEL_SPOTS } from './car.js';
import { Sparks } from './sparks.js';
import { input, bindInput, setInput, pulseNitro } from './input.js';
import { bindHud, updateHud } from './hud.js';

const errors = [];
function reportError(msg) {
  errors.push(String(msg).slice(0, 300));
  const el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = errors.slice(-3).join('\n'); }
}
window.addEventListener('error', (e) => reportError('error: ' + (e.message || e.type)));
window.addEventListener('unhandledrejection', (e) => reportError('reject: ' + (e.reason && e.reason.message || e.reason)));

let track, physics, renderer, scene, camera, playerMesh, rivalMesh, sparks, city;
let state = 'menu';       // menu | playing
let elapsed = 0;
let sparkCount = 0;

// Smooth tunnel factor from track-space s: 1 deep inside, ramping at portals.
function tunnelFactor(s) {
  const m = 60; // ramp margin (m)
  const { s0, s1 } = track.tunnel;
  if (s < s0 - m || s > s1 + m) return 0;
  if (s > s0 && s < s1) return 1;
  if (s <= s0) return (s - (s0 - m)) / m;
  return ((s1 + m) - s) / m;
}

async function boot() {
  await RAPIER.init();
  track = new Track();
  physics = await createPhysics(RAPIER, track);

  renderer = new THREE.WebGLRenderer({
    antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('game').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);

  city = buildCity(scene, physics, track);
  sparks = new Sparks(scene);
  physics.onContact((kind, x, y, z) => {
    sparkCount++;
    if (kind === 'curb') sparks.burst(x, y, z, 26, 3.0);
    else if (kind === 'building') sparks.burst(x, y, z, 60, 5.0);
    else if (kind === 'rival' || kind === 'traffic') sparks.burst(x, y + 0.4, z, 40, 4.0);
    else if (kind === 'pickup') sparks.burst(x, y, z, 30, 3.5, 0x35f2ff);
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
  updateHud({
    speed: 0, dist: 0, time: 0, nitro: 1, nitroOn: false,
    lap: 1, laps: CFG.laps, lapStartT: 0, lastLapT: null, raceDone: false,
  });
  renderer.render(scene, camera);

  window.__td3 = {
    ready: true,
    start: resetGame,
    reset: resetGame,
    // Harness: place the car in track space.
    teleportS: (s, lat, keepTraffic) => {
      physics.teleportS(s, lat, keepTraffic);
      input.left = input.right = false;
      input.nitroPulse = false;
      elapsed = 0;
      state = 'playing';
      document.getElementById('overlay').style.display = 'none';
    },
    // Harness: run N physics steps without rendering (fast-forward).
    stepPhysics: (n) => physics.stepN(n, input, state === 'playing'),
    setInput,
    pulseNitro,
    input: () => ({ left: !!input.left, right: !!input.right, nitroPulse: !!input.nitroPulse }),
    bottles: () => physics.bottles.map((b) => ({
      s: +b.s.toFixed(1), lat: +b.lat.toFixed(1), active: b.active,
    })),
    // Harness: verify car width = 70% of lane width.
    checks: () => {
      const carW = CFG.chassisHalf.x * 2;
      return { carW, laneW: CFG.laneW, ratio: carW / CFG.laneW, laps: CFG.laps, trackLen: track.length };
    },
    state: () => {
      const a = physics.arcade;
      const t = physics.chassis.translation();
      return {
        state, errors: errors.slice(),
        speed: physics.playerSpeed(),
        nitro: a.nitro, nitroOn: a.nitroBurning,
        pickups: a.pickups,
        s: +a.s.toFixed(1), lat: +a.lat.toFixed(2),
        dist: (a.lap - 1) * track.length + a.s,
        time: elapsed, lap: a.lap, laps: CFG.laps,
        lapStartT: +a.lapStartT.toFixed(2), lastLapT: a.lastLapT,
        raceDone: a.raceDone,
        x: +t.x.toFixed(1), y: +t.y.toFixed(1), z: +t.z.toFixed(1),
        yaw: +(track.frameAt(a.s).yaw + a.heading).toFixed(3),
        heading: +a.heading.toFixed(3),
        rivalS: +physics.rivalSt.s.toFixed(1),
        traffic: physics.traffic.map((c) => ({ kind: c.kind, s: +c.s.toFixed(0), lane: c.lane })),
        sparks: sparkCount,
        rawEvents: physics.rawEvents(),
        tunnel: tunnelFactor(a.s),
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
      s: physics.arcade.s, lat: physics.arcade.lat,
      speed: physics.arcade.speed, nitro: physics.arcade.nitro,
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
  input.left = input.right = false;
  input.nitroPulse = false;
  elapsed = 0;
  state = 'playing';
  document.getElementById('overlay').style.display = 'none';
}

// The physics body origin sits at chassisHalf.y above the road (track
// frame); the visual mesh is authored with its origin at ground level.
const _f = {};
function syncBodyMesh(mesh, body, isPlayer) {
  const t = body.translation();
  mesh.position.set(t.x, t.y - CFG.chassisHalf.y, t.z);
  if (isPlayer) {
    track.frameAt(physics.arcade.s, _f);
    const yaw = _f.yaw + physics.arcade.heading;
    mesh.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    // Roll the car with the banking for a planted look.
    const rollQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), _f.bank);
    mesh.quaternion.premultiply(rollQ);
    const ws = mesh.userData.wheels;
    ws.forEach((w, i) => {
      w.position.set(WHEEL_SPOTS[i][0], CFG.wheelRadius, WHEEL_SPOTS[i][1]);
      w.rotation.y = i < 2 ? physics.arcade.steerVis : 0; // front wheels steer visually
    });
  } else {
    const r = body.rotation();
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const ws = mesh.userData.wheels;
    ws.forEach((w, i) => w.position.set(WHEEL_SPOTS[i][0], CFG.wheelRadius, WHEEL_SPOTS[i][1]));
  }
}

function syncMeshes() {
  syncBodyMesh(playerMesh, physics.chassis, true);
  syncBodyMesh(rivalMesh, physics.rival, false);
  city.syncTraffic(physics.traffic);
}

const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();

function updateCamera(dt) {
  const t = physics.chassis.translation();
  track.frameAt(physics.arcade.s, _f);
  _camPos.set(
    t.x - _f.tan.x * 10.5 + _f.up.x * 4.6,
    t.y - _f.tan.y * 10.5 + _f.up.y * 4.6,
    t.z - _f.tan.z * 10.5 + _f.up.z * 4.6
  );
  const k = dt >= 1 ? 1 : 1 - Math.exp(-6 * dt);
  camera.position.lerp(_camPos, k);
  _camLook.set(t.x + _f.tan.x * 8, t.y + 1.9, t.z + _f.tan.z * 8);
  camera.lookAt(_camLook);
  // Nitro FOV kick.
  const targetFov = physics.arcade.nitroBurning ? 74 : 62;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 5 * dt);
    camera.updateProjectionMatrix();
  }
}

const clock = new THREE.Clock();
let acc = 0;
const NEUTRAL_INPUT = { left: false, right: false, nitroPulse: false };

function loop() {
  requestAnimationFrame(loop);
  try {
    const dt = Math.min(clock.getDelta(), 0.1);
    // Physics always steps; race time only accrues while playing.
    acc += dt;
    let n = 0;
    while (acc >= CFG.fixedDt && n < 5) {
      physics.step(CFG.fixedDt, state === 'playing' ? input : NEUTRAL_INPUT, state === 'playing');
      acc -= CFG.fixedDt;
      n++;
      if (state === 'playing') elapsed += CFG.fixedDt;
    }
    if (n === 5) acc = 0; // drop backlog rather than spiral
    syncMeshes();
    city.update(dt, elapsed, physics.bottles);
    sparks.update(dt);
    const a = physics.arcade;
    city.setTunnelGlow(tunnelFactor(a.s));
    updateHud({
      speed: physics.playerSpeed(),
      dist: (a.lap - 1) * track.length + a.s,
      time: elapsed, nitro: a.nitro, nitroOn: a.nitroBurning,
      lap: a.lap, laps: CFG.laps, lapStartT: a.lapStartT,
      lastLapT: a.lastLapT, raceDone: a.raceDone,
    });
    updateCamera(dt);
    renderer.render(scene, camera);
  } catch (err) {
    reportError('loop: ' + (err && err.message || err));
  }
}

boot().catch((e) => reportError('boot: ' + (e && e.message || e)));
