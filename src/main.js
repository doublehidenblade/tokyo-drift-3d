// Tokyo Drift 3D — Milestone 3 boot + game loop (closed lap circuit).
// Render / physics / input live in their own modules; this file wires them.
import * as THREE from 'three';
import RAPIER from 'rapier';
import { CFG } from './config.js';
import { createPhysics } from './physics.js';
// NOTE: Track / buildCity are loaded dynamically in boot() — ?world=classic
// loads the M6 track/city, anything else (default) loads the v2 plan world.
import { buildCarMesh, WHEEL_SPOTS, WHEEL_RADIUS, preloadCarModels } from './car.js';
import { Sparks } from './sparks.js';
import { input, bindInput, setInput, pulseNitro } from './input.js';
import { bindHud, updateHud, bindPauseButton, setPausedUI, setPauseVisible } from './hud.js';
import { createInspector } from './inspector.js';

const errors = [];
function reportError(msg) {
  errors.push(String(msg).slice(0, 300));
  const el = document.getElementById('err');
  if (el) { el.style.display = 'block'; el.textContent = errors.slice(-3).join('\n'); }
}
window.addEventListener('error', (e) => reportError('error: ' + (e.message || e.type)));
window.addEventListener('unhandledrejection', (e) => reportError('reject: ' + (e.reason && e.reason.message || e.reason)));

let track, physics, renderer, scene, camera, playerMesh, rivalMesh, sparks, city, inspector;
let state = 'menu';       // menu | playing
let elapsed = 0;
let sparkCount = 0;
// M4 steering gate: when frozen, the chase camera holds its pose so camera
// motion can never mask a reversed steering sign during measurement.
let camFrozen = false;

// Pause (Craig's screenshot button): when true, the loop still renders the
// frozen frame but skips autopilot + physics + all scene updates. Programmatic
// starts (resetGame/teleportS/steerGatePrep) always unpause.
let paused = false;
function togglePause(force) {
  paused = force !== undefined ? !!force : !paused;
  setPausedUI(paused);
}

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
  // Real car models (Kenney car-kit GLBs): preload before buildCity, which
  // builds traffic visuals, and before buildCarMesh (player/rival).
  await preloadCarModels();
  // World selection: ?world=classic restores the M6 track/city; the
  // default ('v2') loads the plan-driven v2 world (track_v2/city_v2).
  const WORLD = new URLSearchParams(location.search).get('world') || 'v2';
  let Track, buildCity;
  if (WORLD === 'classic') {
    ({ Track } = await import('./track.js'));
    ({ buildCity } = await import('./city.js'));
  } else {
    ({ TrackV2: Track } = await import('./track_v2.js'));
    ({ buildCityV2: buildCity } = await import('./city_v2.js'));
    // v2 spawn: the plan's start/finish (mid-straight, facing the tangent).
    // physics.reset()/teleportS read CFG.spawnS, so set it before
    // createPhysics runs its initial reset().
    const { PLAN } = await import('./plan_v2.js');
    CFG.spawnS = PLAN.start_finish.s_m;
  }
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

  // M6 world inspector: view-only asset viewer + 2D city plan, from the menu.
  inspector = createInspector({
    scene, track, city, renderer,
    extraAssets: [
      { name: 'player-racecar', object: playerMesh },
      { name: 'rival-racecar', object: rivalMesh },
    ],
  });
  document.getElementById('btn-inspect').addEventListener('click', () => {
    togglePause(true);
    setPauseVisible(false);
    document.getElementById('overlay').style.display = 'none';
    inspector.open('assets');
  });
  inspector.onClose = () => {
    togglePause(false);
    setPauseVisible(false);
    document.getElementById('overlay').style.display = 'flex';
  };

  bindInput();
  bindHud();
  bindPauseButton(() => togglePause());
  window.addEventListener('keydown', (e) => {
    if (inspector && inspector.isOpen() && e.code === 'Escape') { e.preventDefault(); inspector.close(); return; }
    if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); togglePause(); }
  });
  window.addEventListener('resize', onResize);
  document.getElementById('btn-start').addEventListener('click', resetGame);

  syncMeshes();
  city.syncTraffic(physics.traffic);
  updateAttractCamera(1); // boot lands on the menu: start on the attract pose
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
      togglePause(false);
      setPauseVisible(true);
      document.getElementById('overlay').style.display = 'none';
      // Snap the chase camera to the new position so harness screenshots and
      // luma samples see the settled view, not a mid-flight transit.
      const a = physics.arcade;
      track.frameAt(a.s, _f);
      camera.position.copy(_f.pos).addScaledVector(_f.tan, -10.5).addScaledVector(_f.up, 4.6);
      _camLook.copy(_f.pos).addScaledVector(_f.tan, 8);
      camera.lookAt(_camLook);
    },
    // Harness: run N physics steps without rendering (fast-forward).
    stepPhysics: (n) => physics.stepN(n, input, state === 'playing'),
    // M4 harness: step the autopilot + physics N times without rendering.
    // Used for the 3-lap race — SwiftShader is too slow for real-time.
    stepAutopilot: (n) => {
      if (!autopilot) return 'no autopilot';
      for (let i = 0; i < n; i++) {
        autopilot.update(CFG.fixedDt);
        physics.step(CFG.fixedDt, input, true);
      }
      return 'ok';
    },
    // M4 harness: run the full 3-lap race in-page (one CDP round-trip).
    // Returns { laps, raceDone, sparks, telemetry }.
    runRace: () => {
      if (!autopilot) return { error: 'no autopilot' };
      resetGame(); // sets state='playing'
      const tele = [];
      let steps = 0;
      const maxSteps = 60 * 400; // 400 game-seconds max
      while (steps < maxSteps) {
        autopilot.update(CFG.fixedDt);
        physics.step(CFG.fixedDt, input, true);
        steps++;
        if (steps % 60 === 0) {
          const a = physics.arcade;
          tele.push(`${(steps/60).toFixed(0)},${a.raceT.toFixed(1)},${a.lap},${a.s.toFixed(0)},` +
            `${a.speed.toFixed(1)},${a.lat.toFixed(1)},${a.nitro.toFixed(2)},${sparkCount}`);
        }
        const ap = autopilot.status();
        if (ap && ap.done) break;
      }
      // One final update so the autopilot records the last lap time
      // (the loop breaks right after physics sets raceDone, before the
      // autopilot sees the lap=4 transition).
      autopilot.update(CFG.fixedDt);
      const ap = autopilot.status();
      return {
        laps: ap ? ap.laps : [],
        raceDone: physics.arcade.raceDone,
        sparks: sparkCount,
        telemetry: tele,
        steps,
      };
    },
    setInput,
    pulseNitro,
    input: () => ({ left: !!input.left, right: !!input.right, nitroPulse: !!input.nitroPulse }),
    // Pause control for the harness / Craig's screenshot flow.
    pause: (on) => togglePause(on),
    paused: () => paused,
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
        yaw: +a.heading.toFixed(3),
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
    // M4 screen-space steering proof: NDC of the player car center.
    carNDC: () => {
      camera.updateMatrixWorld();
      const t = physics.chassis.translation();
      _ndcA.set(t.x, t.y + 0.8, t.z).project(camera);
      return { x: +_ndcA.x.toFixed(4), y: +_ndcA.y.toFixed(4) };
    },
    // The runtime-derived lat<->screen mapping (+1: +lat is screen-left).
    latDirSign: () => input.latDirSign,
    // ---- M4 deterministic steering gate API ----
    // Freeze the chase camera at its current pose. The steering gate
    // freezes the camera so camera motion can never mask a reversed
    // steering sign during measurement.
    freezeCamera: (on) => { camFrozen = !!on; },
    // Atomic in-page setup for one steering measurement: exact car state,
    // camera snapped + frozen, lat->screen mapping recomputed for that
    // pose. Returns the live sign convention, the baseline NDC.x, and an
    // INDEPENDENT reference (the NDC.x displacement of a point 10 m along
    // +lat projected through the same frozen camera — raw projection math,
    // not input.latDirSign, so a broken sign derivation cannot fool the
    // gate). Also returns the track yaw ±60 m as evidence the position is
    // (or isn't) on a curve.
    steerGatePrep: (sPos) => {
      camFrozen = true;
      physics.reset();
      physics.teleportS(sPos, 0, true);
      input.left = input.right = false;
      input.nitroPulse = false;
      elapsed = 0;
      state = 'playing';
      togglePause(false);
      setPauseVisible(true);
      document.getElementById('overlay').style.display = 'none';
      const a = physics.arcade;
      track.frameAt(a.s, _f);
      camera.position.copy(_f.pos).addScaledVector(_f.tan, -10.5).addScaledVector(_f.up, 4.6);
      _camLook.copy(_f.pos).addScaledVector(_f.tan, 8);
      camera.lookAt(_camLook);
      updateLatDirSign();
      camera.updateMatrixWorld();
      const t = physics.chassis.translation();
      _ndcA.set(t.x, t.y + 0.8, t.z).project(camera);
      _ndcB.set(t.x + _f.lat.x * 10, t.y + _f.lat.y * 10, t.z + _f.lat.z * 10).project(camera);
      const refD = _ndcB.x - _ndcA.x;
      const yawMinus = track.frameAt(sPos - 60).yaw;
      const yawPlus = track.frameAt(sPos + 60).yaw;
      return {
        sign: input.latDirSign, x0: +_ndcA.x.toFixed(4), refD: +refD.toFixed(5),
        yawMinus: +yawMinus.toFixed(3), yawPlus: +yawPlus.toFixed(3),
      };
    },
    // Run n FIXED physics steps with the live input state (set by the real
    // pointer handler when the runner presses via CDP) and report the
    // car's NDC.x before/after through the frozen camera. Deterministic:
    // the only wall-time dependence is the few rAF steps between the CDP
    // press landing and this eval, which cannot flip the displacement sign.
    steerGateHold: (n) => {
      camera.updateMatrixWorld();
      const t0 = physics.chassis.translation();
      _ndcA.set(t0.x, t0.y + 0.8, t0.z).project(camera);
      const x0 = _ndcA.x;
      physics.stepN(n, input, true);
      const t1 = physics.chassis.translation();
      _ndcB.set(t1.x, t1.y + 0.8, t1.z).project(camera);
      const a = physics.arcade;
      return {
        x0: +x0.toFixed(4), x1: +_ndcB.x.toFixed(4), dx: +(_ndcB.x - x0).toFixed(4),
        lat: +a.lat.toFixed(2), s: +a.s.toFixed(1), speed: +a.speed.toFixed(1),
        left: !!input.left, right: !!input.right, sign: input.latDirSign,
      };
    },
    // Rolling FPS over the last 120 rAFs.
    fps: () => {
      const n = frameDts.length;
      if (!n) return { avg: 0, worst: 0, n: 0 };
      const mean = frameDts.reduce((a, b) => a + b, 0) / n;
      return { avg: +(1 / mean).toFixed(1), worst: +(1 / Math.max(...frameDts)).toFixed(1), n };
    },
    // Harness: place traffic car i relative to the player (gauntlet).
    placeTraffic: (i, sDelta, lane) => physics.placeTraffic(i, sDelta, lane),
    // Collider-vs-mesh screen alignment: NDC bboxes of every car's Rapier
    // cuboid and its visual body box. The runner asserts containment.
    projectionCheck: () => carBoxes().map((b) => {
      const cb = ndcBBox(b.col.x, b.col.y, b.col.z, b.col.hx, b.col.hy, b.col.hz, b.col.yaw);
      track.toWorld(b.mesh.s, b.mesh.lat, (b.mesh.y0 + b.mesh.y1) / 2, _mp);
      const mb = ndcBBox(_mp.x, _mp.y, _mp.z,
        b.mesh.hx, (b.mesh.y1 - b.mesh.y0) / 2, b.mesh.hz, b.mesh.yaw);
      return { name: b.name, col: cb, mesh: mb };
    }),
    // Toggle the green=collider / orange=mesh wireframe overlay.
    showColliderDebug: (on) => setColliderDebug(!!on),
    // M4 harness: chase-camera world position (camera-clip diagnosis).
    cameraInfo: () => {
      camera.updateMatrixWorld();
      const r = (v) => +v.toFixed(2);
      return { x: r(camera.position.x), y: r(camera.position.y), z: r(camera.position.z) };
    },
    // M4 harness: building boxes near s (camera-clip diagnosis).
    buildingsNear: (s, range) => city.buildingsNear(s, range),
    // M4 harness: batched full-lap luma sweep INSIDE the page (one CDP
    // round-trip instead of 200+). Teleports every `step` meters, snaps the
    // camera, renders synchronously, and returns [{s, luma}].
    sweepLuma: (step) => {
      step = step || 50;
      const out = [];
      const c = renderer.domElement;
      const t = document.createElement('canvas');
      t.width = 64; t.height = 64;
      const g = t.getContext('2d', { willReadFrequently: true });
      const a = physics.arcade;
      const lapLen = track.length;
      // M4: drop pixel ratio during the sweep — SwiftShader renders are
      // slow; luma doesn't need full res.
      const pr = renderer.getPixelRatio();
      renderer.setPixelRatio(0.5);
      renderer.setSize(window.innerWidth, window.innerHeight);
      for (let s = 0; s < lapLen; s += step) {
        physics.teleportS(s, 0, true);
        track.frameAt(a.s, _f);
        camera.position.copy(_f.pos).addScaledVector(_f.tan, -10.5).addScaledVector(_f.up, 4.6);
        _camLook.copy(_f.pos).addScaledVector(_f.tan, 8);
        camera.lookAt(_camLook);
        scene.updateMatrixWorld();
        renderer.render(scene, camera);
        const frac = 0.4;
        g.drawImage(c,
          c.width * (0.5 - frac / 2), c.height * (0.5 - frac / 2), c.width * frac, c.height * frac,
          0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        out.push({ s, luma: +(sum / (d.length / 4) / 255).toFixed(4) });
      }
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight);
      return out;
    },
  };

  // The autopilot always loads: the menu attract mode needs it to drive the
  // demo behind the title. In gameplay it only takes over when ?autopilot=1
  // (see loop()), so harness scenarios injecting their own input are never
  // disturbed. The import is kicked off once track/physics/__td3 exist
  // (module level is too early — track and physics are still undefined).
  import('./autopilot.js').then((m) => {
    autopilot = m.createAutopilot(track, physics, input);
    window.__td3.autopilotState = () => autopilot ? autopilot.status() : null;
  }).catch((e) => reportError('autopilot: ' + (e && e.message || e)));

  requestAnimationFrame(loop);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (inspector) inspector.onResize();
}

function resetGame() {
  physics.reset();
  input.left = input.right = false;
  input.nitroPulse = false;
  elapsed = 0;
  state = 'playing';
  togglePause(false); // TAP TO START / __td3.start() always resumes + yields attract mode
  setPauseVisible(true);
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
    // M6: heading is absolute world yaw now (physics owns it); the old code
    // added the track tangent yaw on top, double-yawing the rendered car.
    const yaw = physics.arcade.heading;
    mesh.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    // Roll the car with the banking for a planted look.
    const rollQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), _f.bank);
    mesh.quaternion.premultiply(rollQ);
    const ws = mesh.userData.wheels;
    ws.forEach((w, i) => {
      w.position.set(WHEEL_SPOTS[i][0], WHEEL_RADIUS, WHEEL_SPOTS[i][1]);
      w.rotation.y = i < 2 ? physics.arcade.steerVis : 0; // front wheels steer visually
    });
  } else {
    const r = body.rotation();
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const ws = mesh.userData.wheels;
    ws.forEach((w, i) => w.position.set(WHEEL_SPOTS[i][0], WHEEL_RADIUS, WHEEL_SPOTS[i][1]));
  }
}

function syncMeshes() {
  syncBodyMesh(playerMesh, physics.chassis, true);
  syncBodyMesh(rivalMesh, physics.rival, false);
  city.syncTraffic(physics.traffic);
}

const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _ndcA = new THREE.Vector3();
const _ndcB = new THREE.Vector3();

// M4: derive the lat<->screen steering mapping from the LIVE camera
// projection every rendered frame, so the steering sign can never be wrong
// (the M3 reversal came from a hardcoded convention contradicted by the
// actual track-frame math). Project the car and a point 10 m toward +lat:
// if the +lat point lands screen-LEFT of the car, +lat is screen-left and
// left input must increase lat.
function updateLatDirSign() {
  const t = physics.chassis.translation();
  track.frameAt(physics.arcade.s, _f);
  camera.updateMatrixWorld();
  _ndcA.set(t.x, t.y, t.z).project(camera);
  _ndcB.set(t.x + _f.lat.x * 10, t.y + _f.lat.y * 10, t.z + _f.lat.z * 10).project(camera);
  const d = _ndcB.x - _ndcA.x;
  if (Math.abs(d) > 1e-4) input.latDirSign = d < 0 ? 1 : -1;
}

// ---- M4 harness helpers: screen-space checks & collider debug ----
const _boxF = {};
// World-space boxes for every car: the Rapier cuboid (from colliderInfo +
// live body transforms) and the visual body box (from the authored mesh
// dims in car.js / buildTrafficVisuals).
function carBoxes() {
  const info = physics.colliderInfo();
  const a = physics.arcade;
  const list = [];
  track.frameAt(a.s, _boxF);
  const pt = physics.chassis.translation();
  list.push({
    name: 'player',
    col: { x: pt.x, y: pt.y + info.player.colOff, z: pt.z, hx: 1.4, hy: 0.75, hz: 2.8, yaw: a.heading },
    mesh: { s: a.s, lat: a.lat, y0: 0, y1: 1.5, hx: 1.4, hz: 2.8, yaw: a.heading },
  });
  for (let i = 0; i < physics.traffic.length; i++) {
    const c = physics.traffic[i];
    track.frameAt(c.s, _boxF);
    const yaw = _boxF.yaw + (c.kind === 'same' ? 0 : Math.PI);
    // M4: use the LOGICAL track position (c.s, c.lane) for the collider bbox,
    // not the transient physics body position. The body is teleported to the
    // logical position each step, but world.step() can displace it via contacts;
    // the visual is always at the logical position, so the harness must compare
    // like-for-like.
    track.toWorld(c.s, c.lane, 0.7, _mp);
    list.push({
      name: 'traffic' + i,
      col: { x: _mp.x, y: _mp.y, z: _mp.z, hx: 1.4, hy: 0.7, hz: 2.8, yaw },
      mesh: { s: c.s, lat: c.lane, y0: 0.15, y1: 1.3, hx: 1.4, hz: 2.8, yaw },
    });
  }
  return list;
}
function ndcBBox(cx, cy, cz, hx, hy, hz, yaw) {
  camera.updateMatrixWorld();
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let ix = -1; ix <= 1; ix += 2)
    for (let iy = -1; iy <= 1; iy += 2)
      for (let iz = -1; iz <= 1; iz += 2) {
        const lx = hx * ix, ly = hy * iy, lz = hz * iz;
        _ndcA.set(cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c).project(camera);
        if (_ndcA.x < x0) x0 = _ndcA.x;
        if (_ndcA.x > x1) x1 = _ndcA.x;
        if (_ndcA.y < y0) y0 = _ndcA.y;
        if (_ndcA.y > y1) y1 = _ndcA.y;
      }
  const r = (v) => +v.toFixed(4);
  return { x0: r(x0), x1: r(x1), y0: r(y0), y1: r(y1) };
}
function boxEdges(color) {
  const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
    color, depthTest: false, transparent: true, opacity: 0.9,
  }));
  l.renderOrder = 999;
  l.frustumCulled = false;
  return l;
}
let colliderDbg = null;
function setColliderDebug(on) {
  if (on && !colliderDbg) {
    const group = new THREE.Group();
    const items = [];
    for (let i = 0; i < 21; i++) {
      const col = boxEdges(0x39ff6a), mesh = boxEdges(0xffa63d);
      col.visible = mesh.visible = false;
      group.add(col, mesh);
      items.push({ col, mesh });
    }
    scene.add(group);
    colliderDbg = { group, items };
  } else if (!on && colliderDbg) {
    scene.remove(colliderDbg.group);
    colliderDbg = null;
  }
}
function placeDbgBox(line, x, y, z, hx, hy, hz, yaw) {
  line.position.set(x, y, z);
  line.rotation.set(0, yaw, 0);
  line.scale.set(hx * 2, hy * 2, hz * 2);
}
const _mp = new THREE.Vector3();
function updateColliderDebug() {
  const boxes = carBoxes();
  const items = colliderDbg.items;
  for (let i = 0; i < items.length; i++) {
    const b = boxes[i], it = items[i];
    if (!b) { it.col.visible = it.mesh.visible = false; continue; }
    it.col.visible = it.mesh.visible = true;
    placeDbgBox(it.col, b.col.x, b.col.y, b.col.z, b.col.hx, b.col.hy, b.col.hz, b.col.yaw);
    track.toWorld(b.mesh.s, b.mesh.lat, (b.mesh.y0 + b.mesh.y1) / 2, _mp);
    placeDbgBox(it.mesh, _mp.x, _mp.y, _mp.z,
      b.mesh.hx, (b.mesh.y1 - b.mesh.y0) / 2, b.mesh.hz, b.mesh.yaw);
  }
}

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

// Menu attract camera: LOW and IN FRONT of the car, looking back at it —
// the anime "car drifts toward the camera" framing. A slight lateral offset
// keeps the car off-center for a dynamic 3/4-front view. updateLatDirSign()
// derives the steering mapping from this live camera pose every frame, so
// the autopilot steers correctly through the front-facing view too.
function updateAttractCamera(dt) {
  const t = physics.chassis.translation();
  track.frameAt(physics.arcade.s, _f);
  const gy = CFG.chassisHalf.y; // body origin height above the road
  _camPos.set(
    t.x + _f.tan.x * 14 - _f.lat.x * 4,
    t.y - gy + 1.7,
    t.z + _f.tan.z * 14 - _f.lat.z * 4
  );
  const k = dt >= 1 ? 1 : 1 - Math.exp(-5 * dt);
  camera.position.lerp(_camPos, k);
  _camLook.set(t.x, t.y - gy + 0.8, t.z);
  camera.lookAt(_camLook);
}

const clock = new THREE.Clock();
let acc = 0;
const NEUTRAL_INPUT = { left: false, right: false, nitroPulse: false, latDirSign: 1 };

// M4 harness: ?autopilot=1 loads the autopilot driver (dynamic import —
// zero download/parse cost for players), ?fast=N fast-forwards game time so
// scripted 3-lap races finish quickly in the harness. The import is kicked
// off inside boot() once track/physics/__td3 exist (module level is too
// early — track and physics are still undefined there).
const _params = new URLSearchParams(location.search);
const FAST = Math.max(1, Math.min(16, parseInt(_params.get('fast') || '1', 10) || 1));
const WANT_AUTOPILOT = _params.get('autopilot') === '1';
let autopilot = null;

// FPS tracking for the harness floor (rolling mean over the last 120 rAFs).
const frameDts = [];
function trackFps(dt) {
  frameDts.push(dt);
  if (frameDts.length > 120) frameDts.shift();
}

function loop() {
  requestAnimationFrame(loop);
  try {
    const dt = Math.min(clock.getDelta(), 0.1);
    trackFps(dt);
    // M6: when the world inspector is open it owns the frame (renders its
    // own stage/plan views); the game stays paused underneath.
    if (inspector && inspector.isOpen()) { inspector.update(dt); return; }
    if (!paused) {
      // Menu attract mode: the autopilot drives the car behind the title
      // (racing=true so it actually moves). Race time only accrues while
      // playing. In gameplay the autopilot only drives with ?autopilot=1.
      const attract = state === 'menu' && !!autopilot;
      if (autopilot && (attract || (state === 'playing' && WANT_AUTOPILOT))) {
        autopilot.update(dt);
      }
      // Physics always steps while unpaused; race time only accrues while playing.
      // FAST fast-forwards game time for harness races (acc grows FAST x).
      const driving = state === 'playing' || attract;
      acc += dt * FAST;
      let n = 0;
      const maxSteps = 5 * FAST;
      while (acc >= CFG.fixedDt && n < maxSteps) {
        physics.step(CFG.fixedDt, driving ? input : NEUTRAL_INPUT, driving);
        acc -= CFG.fixedDt;
        n++;
        if (state === 'playing') elapsed += CFG.fixedDt;
      }
      if (n === maxSteps) acc = 0; // drop backlog rather than spiral
      // Attract mode loops forever: restart the demo if the autopilot ever
      // finishes all 3 laps.
      if (attract && physics.arcade.raceDone) physics.reset();
      syncMeshes();
      updateLatDirSign();
      if (colliderDbg) updateColliderDebug();
      city.update(dt, elapsed, physics.bottles);
      // M6 B4: a traffic car whose visual hasn't finished fading in cannot
      // collide yet — no ghost-car hits. (Headless harness scenarios never
      // call this, so their contacts keep working as before.)
      physics.setTrafficFade(city.trafficFade());
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
      // M4 steering gate: freezeCamera(true) holds the camera pose so the
      // gate's NDC.x measurements see car motion only, never camera motion.
      if (camFrozen) { /* hold pose */ }
      else if (state === 'menu') updateAttractCamera(dt);
      else updateCamera(dt);
    }
    // Paused or not, keep presenting the (frozen) frame so screenshots work.
    renderer.render(scene, camera);
  } catch (err) {
    reportError('loop: ' + (err && err.message || err));
  }
}

boot().catch((e) => reportError('boot: ' + (e && e.message || e)));
