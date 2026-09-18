// Night-city scene, Milestone 3: closed lap circuit through a neon city.
// Tunnel tube bored through a hill ridge, bridge over animated-looking
// water, real terrain hills (not flat ground everywhere), facade-mounted
// neon signs, street lamps, power poles with sagging wires, trees,
// directional gantries, start gantry + checkered start line, pedestrian
// overpass with walkers, sidewalk pedestrians, nitro bottles, and full
// traffic visuals (bodies, cabins, wheels, light strips, headlight cones).
// All art is procedural (canvas textures, low-poly meshes) — placeholder,
// never designer-drawn. Signs are physically mounted on building facades
// only: never floating, never on independent timers.
import * as THREE from 'three';
import { CFG } from './config.js';
import {
  mulberry32, makeWindowTexture, makeRoofTexture, makeStorefrontTexture,
  makeSidewalkTexture, makeAwningTexture, makeGlassTexture, makeRoadTexture,
  makeGantryTexture, makeSignTexture, makeBoardTexture, makeDirPanelTexture,
  makeTunnelTexture, makeGlowTexture, makeWetStreakTexture, makeEnvTexture,
  makeStartLineTexture,
} from './textures.js';

const SIGN_WORDS = [
  ['24H', '#7df9ff'], ['酒', '#ff5fa2'], ['NEON', '#ff9f43'], ['喫茶', '#b6ffe0'],
  ['DRIFT', '#ff5fa2'], ['夜', '#7df9ff'], ['RAMEN', '#ffd27a'], ['東京', '#c4b5fd'],
  ['カラオケ', '#ff8a5c'], ['BAR', '#b6ffe0'], ['寿司', '#ffd27a'], ['GAME', '#7df9ff'],
  ['ラーメン', '#ffd27a'], ['パチンコ', '#ff5fa2'], ['ホテル', '#7df9ff'], ['薬', '#b6ffe0'],
  ['本', '#ff9f43'], ['映画', '#c4b5fd'], ['駅', '#7df9ff'], ['居酒屋', '#ff8a5c'],
  ['焼肉', '#ff5fa2'], ['コンビニ', '#b6ffe0'], ['カフェ', '#ffd27a'], ['温泉', '#7df9ff'],
  ['交番', '#7df9ff'], ['ダーツ', '#ff9f43'], ['CD', '#c4b5fd'], ['駐車場', '#b6ffe0'],
];

const DIR_PANELS = [
  [['銀座', 'GINZA →'], ['東京', 'TOKYO']],
  [['← 羽田', 'HANEDA'], ['新宿', 'SHINJUKU →']],
  [['渋谷', 'SHIBUYA →'], ['← 横浜', 'YOKOHAMA']],
  [['秋葉原', 'AKIHABARA'], ['お台場', 'ODAIBA →']],
  [['← 品川', 'SHINAGAWA'], ['新橋', 'SHIMBASHI →']],
];

// Module scratch (reused every frame; never allocate in hot paths).
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _off = new THREE.Vector3();
const _n = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _lat2 = new THREE.Vector3();
const _tan2 = new THREE.Vector3();
const _up0 = new THREE.Vector3(0, 1, 0);
const _one = new THREE.Vector3(1, 1, 1);
const _beaconCol = new THREE.Color(); // beacon pulse scratch (no per-frame alloc)
const _f = {}; // shared track-frame scratch

// Yaw-only instance placement (upright objects: buildings, trees, pillars).
function composeInst(im, i, x, y, z, ry, sx, sy, sz) {
  _p.set(x, y, z); _e.set(0, ry, 0); _q.setFromEuler(_e); _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  im.setMatrixAt(i, _m);
}

export function buildCity(scene, physics, track) {
  const rnd = mulberry32(20260917);
  const L = track.length;
  const TUN = track.tunnel, BR = track.bridge, W = track.water;
  const stats = {
    buildings: 0, vSigns: 0, bSigns: 0, lamps: 0, bridgeLamps: 0,
    trees: 0, walkers: 0, peds: 0, bottles: 0, tunnelSegs: 0,
  };
  const inTun = (s, m) => s > TUN.s0 - m && s < TUN.s1 + m;
  const inDistrict = (s) => s >= 2400 && s <= 3500;

  // Instance placement fully aligned to the banked track frame.
  // Geometry axes map x=lat, y=up, z=tan (direction of travel).
  function placeFrame(im, i, s, lat, h, sx, sy, sz) {
    track.frameAt(s, _f);
    _p.copy(_f.pos).addScaledVector(_f.lat, lat).addScaledVector(_f.up, h);
    _m.makeBasis(_f.lat, _f.up, _f.tan);
    _m.scale(_v.set(sx, sy, sz));
    _m.setPosition(_p);
    im.setMatrixAt(i, _m);
  }

  // Point-in-rotated-rect test against the water channel (exact inverse of
  // the water plane's yaw transform below).
  function inWaterRect(x, z, margin) {
    const dx = x - W.cx, dz = z - W.cz;
    const cy = Math.cos(W.yaw), sy = Math.sin(W.yaw);
    const u = dx * cy - dz * sy;
    const v = -(dx * sy + dz * cy);
    return Math.abs(u) < W.w / 2 + margin && Math.abs(v) < W.d / 2 + margin;
  }

  // ---- Lighting / atmosphere (M4: synthwave grade) ----
  // Teal-tinted hemisphere so the whole night reads cyan; subtle
  // blue-purple exponential haze for depth.
  scene.add(new THREE.HemisphereLight(0x2e4a6e, 0x05060a, 0.65));
  const dir = new THREE.DirectionalLight(0x8fb4ff, 0.4);
  dir.position.set(-120, 200, -80);
  scene.add(dir);
  scene.background = new THREE.Color(0x070a18);
  scene.fog = new THREE.FogExp2(0x0d1233, 0.0011);
  scene.environment = makeEnvTexture();
  // Tunnel-only ambient boost, driven per-frame by main.js (never pitch black).
  const tunnelAmbient = new THREE.AmbientLight(0xaac4ff, 0);
  scene.add(tunnelAmbient);

  // ---- Track bounding box (drives ground / hill / star placement) ----
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) {
    const p = track.pos[i];
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const gw = (maxX - minX) + 1200, gd = (maxZ - minZ) + 1200;

  // ---- Ground plane (dark, at y=-8) + real terrain hills ----
  {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(gw, gd),
      new THREE.MeshStandardMaterial({ color: 0x05070c, roughness: 1, metalness: 0 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -8, cz);
    scene.add(ground);
  }
  // ~40 instanced low hill mounds (flattened icosahedrons, dark blue-green),
  // scattered 60-250 m from the track, skipping the water channel.
  {
    const hillIM = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x0e2a24, roughness: 1, metalness: 0, flatShading: true,
      }), 40);
    const dist2ToTrack = (x, z) => {
      let d = Infinity;
      for (let k = 0; k < track.N; k += 8) {
        const p = track.pos[k];
        const dd = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
        if (dd < d) d = dd;
      }
      return Math.sqrt(d);
    };
    let hi = 0, guard = 0;
    while (hi < 40 && guard++ < 1200) {
      const x = minX - 300 + rnd() * gw;
      const z = minZ - 300 + rnd() * gd;
      if (inWaterRect(x, z, 20)) continue;
      const d = dist2ToTrack(x, z);
      if (d < 60 || d > 250) continue;
      const r = 22 + rnd() * 48;
      composeInst(hillIM, hi++, x, -8 + r * 0.18, z, rnd() * Math.PI * 2,
        r, r * (0.28 + rnd() * 0.25), r * (0.7 + rnd() * 0.6));
    }
    hillIM.count = hi;
    hillIM.instanceMatrix.needsUpdate = true;
    scene.add(hillIM);
    stats.hills = hi;
  }
  // A few distant mountain silhouettes on the horizon.
  {
    const mIM = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 7),
      new THREE.MeshStandardMaterial({
        color: 0x0a1322, roughness: 1, metalness: 0, flatShading: true,
      }), 6);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd() * 0.6;
      const dist = 680 + rnd() * 140;
      const x = cx + Math.cos(a) * dist, z = cz + Math.sin(a) * dist;
      const h = 170 + rnd() * 130, r = 130 + rnd() * 90;
      composeInst(mIM, k, x, -8 + h / 2 - 12, z, rnd() * Math.PI, r, h, r);
    }
    mIM.instanceMatrix.needsUpdate = true;
    scene.add(mIM);
  }

  // ---- Road ribbon: BufferGeometry along the spline ----
  // Canvas maps 30 m across, so u = (lat + 15) / 30 keeps the +/-12 m edge
  // lines exactly on the ribbon's +/-12 m laterals. v = s/24 tiles the dash.
  function ribbonGeometry(halfW, lift) {
    const M = 512; // stations: every 2nd of the 1024 track samples
    const verts = new Float32Array((M + 1) * 2 * 3);
    const uvs = new Float32Array((M + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= M; i++) {
      const s = (i / M) * L;
      track.frameAt(s, _f);
      for (let k = 0; k < 2; k++) {
        const lat = k === 0 ? -halfW : halfW;
        const vi = (i * 2 + k) * 3;
        verts[vi] = _f.pos.x + _f.lat.x * lat + _f.up.x * lift;
        verts[vi + 1] = _f.pos.y + _f.lat.y * lat + _f.up.y * lift;
        verts[vi + 2] = _f.pos.z + _f.lat.z * lat + _f.up.z * lift;
        const ui = (i * 2 + k) * 2;
        uvs[ui] = (lat + 15) / 30;
        uvs[ui + 1] = s / 24;
      }
      if (i < M) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  {
    const roadTex = makeRoadTexture();
    const road = new THREE.Mesh(
      ribbonGeometry(CFG.roadHalf + 1.5, 0.02),
      new THREE.MeshStandardMaterial({
        map: roadTex, emissiveMap: roadTex, emissive: 0x9db8ff,
        emissiveIntensity: 0.30, roughness: 0.32, metalness: 0.55,
        envMapIntensity: 1.3,
      })
    );
    scene.add(road);
    // Wet streak overlay: additive fake reflections (brighter, denser).
    const wetTex = makeWetStreakTexture();
    const wet = new THREE.Mesh(
      ribbonGeometry(CFG.roadHalf + 1.5, 0.05),
      new THREE.MeshBasicMaterial({
        map: wetTex, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    scene.add(wet);
  }

  // ---- Curb visuals (physics curbs already exist in physics.js) ----
  {
    const n = Math.ceil(L / 6);
    const curbIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.5, CFG.curbTopY, 6.3),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 }), n * 2);
    const stripIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.28, 0.02, 6.3),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 2);
    const col = new THREE.Color();
    let i = 0;
    for (let k = 0; k < n; k++) {
      const s = k * 6 + 3;
      for (const side of [-1, 1]) {
        placeFrame(curbIM, i, s, side * CFG.curbLat, CFG.curbTopY / 2, 1, 1, 1);
        placeFrame(stripIM, i, s, side * (CFG.curbLat - 0.55), CFG.curbTopY + 0.012, 1, 1, 1);
        stripIM.setColorAt(i, col.set(side < 0 ? 0xcfe0ff : 0xff5040));
        i++;
      }
    }
    curbIM.instanceMatrix.needsUpdate = true;
    stripIM.instanceMatrix.needsUpdate = true;
    if (stripIM.instanceColor) stripIM.instanceColor.needsUpdate = true;
    scene.add(curbIM, stripIM);
  }

  // ---- Glow points collector (cheap fake bloom, one draw call per size) ----
  const glowSmall = { pos: [], col: [] }; // lamps, signs, sconces, streaks
  const glowBig = { pos: [], col: [] };   // tunnel portals
  const glowTex = makeGlowTexture();
  function addGlow(store, x, y, z, hex) {
    store.pos.push(x, y, z);
    const c = new THREE.Color(hex);
    store.col.push(c.r, c.g, c.b);
  }
  function buildGlowPoints(store, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(store.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(store.col, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({
      map: glowTex, size, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, vertexColors: true, sizeAttenuation: true,
    }));
    p.frustumCulled = false;
    scene.add(p);
  }

  // ---- Tunnel tube: sealed walls + ceiling + lights along the FULL leg ----
  {
    const tlen = TUN.s1 - TUN.s0;
    const nSeg = Math.ceil(tlen / 8);
    stats.tunnelSegs = nSeg;
    const tunnelTex = makeTunnelTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      map: tunnelTex, roughness: 0.85, metalness: 0.05,
      // M4: the tube is never pure black — a flat dim emissive lifts the
      // walls/ceiling so the tunnel reads as a lit space even between
      // point lights. (No emissiveMap: the wall texture is too dark and
      // would multiply the glow back to black.)
      emissive: 0x46586e, emissiveIntensity: 0.55,
    });
    const wallIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.0, 8.5, 8.4), wallMat, nSeg * 2);
    const ceilIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2 * (CFG.tunnelHalfW + 0.4) + 1.2, 0.8, 8.4),
      wallMat, nSeg);
    // Emissive ceiling light strips (continuous instanced segments).
    const stripIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.6, 0.1, 8.4),
      new THREE.MeshBasicMaterial({ color: 0xd8f4ff }), nSeg * 2);
    let wi = 0, ci = 0, si = 0;
    for (let k = 0; k < nSeg; k++) {
      const s = TUN.s0 + k * 8 + 4;
      for (const side of [-1, 1]) {
        placeFrame(wallIM, wi, s, side * (CFG.tunnelHalfW + 0.4), 4.25, 1, 1, 1);
        placeFrame(stripIM, si, s, side * 4, CFG.tunnelH - 0.05, 1, 1, 1);
        // Physics: sealed wall colliders so the tube is solid.
        track.frameAt(s, _f);
        _p2.copy(_f.pos)
          .addScaledVector(_f.lat, side * (CFG.tunnelHalfW + 0.4))
          .addScaledVector(_f.up, 4.25);
        physics.addStaticBox(0.5, 4.25, 4.2, _p2.x, _p2.y, _p2.z, _f.yaw, 'building');
        wi++; si++;
      }
      placeFrame(ceilIM, ci++, s, 0, CFG.tunnelH + 0.4, 1, 1, 1);
    }
    wallIM.instanceMatrix.needsUpdate = true;
    ceilIM.instanceMatrix.needsUpdate = true;
    stripIM.instanceMatrix.needsUpdate = true;
    scene.add(wallIM, ceilIM, stripIM);
    // Wall sconces every 20 m: emissive + glow.
    const nS = Math.floor(tlen / 20);
    const scIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.25, 0.6, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffb35c }), nS * 2);
    let sci = 0;
    for (let k = 0; k < nS; k++) {
      const s = TUN.s0 + 10 + k * 20;
      for (const side of [-1, 1]) {
        placeFrame(scIM, sci++, s, side * (CFG.tunnelHalfW - 0.2), 3.4, 1, 1, 1);
        track.toWorld(s, side * (CFG.tunnelHalfW - 0.6), 3.4, _p2);
        addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0xffb35c);
      }
    }
    scIM.instanceMatrix.needsUpdate = true;
    scene.add(scIM);
    // M4: 8 real point lights so standard materials inside are never flat
    // black (the tube is ~900 m; 4 lights left long dark gaps).
    for (let k = 0; k < 8; k++) {
      const s = TUN.s0 + tlen * (0.06 + k * 0.125);
      track.toWorld(s, k % 2 ? -6 : 6, 6.2, _p2);
      const pl = new THREE.PointLight(0x9fd0ff, 900, 110, 1.8);
      pl.position.copy(_p2);
      scene.add(pl);
    }
    // Glowing portal frames at BOTH ends, oriented to the end frames.
    const portalAt = (s, color) => {
      track.frameAt(s, _f);
      const grp = new THREE.Group();
      grp.position.copy(_f.pos);
      grp.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(_f.lat, _f.up, _f.tan));
      const m = new THREE.MeshBasicMaterial({ color });
      const w = 2 * CFG.tunnelHalfW + 2;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(1, 9.4, 1.2), m);
        post.position.set(side * (w / 2 - 0.5), 4.7, 0);
        grp.add(post);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 1.2), m);
      top.position.set(0, 9.0, 0);
      grp.add(top);
      scene.add(grp);
      for (let k = 0; k < 10; k++) {
        track.toWorld(s, (rnd() - 0.5) * (w - 2), 1 + rnd() * 7, _p2);
        addGlow(glowBig, _p2.x, _p2.y, _p2.z, color);
      }
    };
    portalAt(TUN.s0, 0x35f2ff); // cyan entrance
    portalAt(TUN.s1, 0xff9f43); // orange exit
    // M4: the hill-ridge spheres are REMOVED. They were decorative (a hill
    // over the tunnel), but their interiors intersected the tube and
    // blocked the chase camera (raycast: #0b181d sphere 7 m ahead at
    // s=3800), and when raised above the tube they read as a black blob
    // looming over the tunnel interior. The tube + portals carry the
    // tunnel visually on their own.
  }

  // ---- Bridge: Rainbow-Bridge-style suspension bridge, blue-lit ----
  // (Procedural homage — boxes/cylinders/tubes + emissive materials + glow
  // sprites. The reference photo is direction only; no photo pixels anywhere.
  // All art here is generated in code at runtime — placeholder, never
  // designer-drawn.)
  {
    const blen = BR.s1 - BR.s0;
    const BLUE = 0x2f80ff;
    const CABLE_LAT = CFG.roadHalf + 4.5; // 16.5
    const TOWER_LAT = CFG.roadHalf + 5;   // 17
    const sT1 = BR.s0 + 250, sT2 = BR.s1 - 250;
    const H_TOWER = 62, H_ANCH = 3, H_MID = 5;
    // Main-cable height profile (frame-up meters above the deck): quadratic
    // ramps from the anchorages up over the tower saddles, parabolic dip
    // mid-span between the towers.
    function cableH(s) {
      if (s <= sT1) { const t = (s - BR.s0) / Math.max(1, sT1 - BR.s0); return H_ANCH + (H_TOWER - H_ANCH) * t * t; }
      if (s >= sT2) { const t = (BR.s1 - s) / Math.max(1, BR.s1 - sT2); return H_ANCH + (H_TOWER - H_ANCH) * t * t; }
      const mid = (sT1 + sT2) / 2, half = (sT2 - sT1) / 2;
      const u = (s - mid) / half;
      return H_MID + (H_TOWER - H_MID) * u * u;
    }
    const _sa = new THREE.Vector3(), _sb = new THREE.Vector3(), _sd = new THREE.Vector3();
    const _lh = new THREE.Vector3();

    // Railing posts + reflective rails along both edges (follow the grades).
    const nP = Math.ceil(blen / 6);
    const postIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.8, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.8 }), nP * 2);
    const nR = Math.ceil(blen / 12);
    const railIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.3, 12.3),
      new THREE.MeshStandardMaterial({
        color: 0x9aa4b5, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.2,
      }), nR * 2);
    let pi = 0, ri = 0;
    for (let k = 0; k < nP; k++) {
      const s = BR.s0 + k * 6 + 3;
      if (s > BR.s1) break;
      for (const side of [-1, 1])
        placeFrame(postIM, pi++, s, side * (CFG.roadHalf + 1.9), 0.7, 1, 1, 1);
    }
    for (let k = 0; k < nR; k++) {
      const s = BR.s0 + k * 12 + 6;
      if (s > BR.s1) break;
      for (const side of [-1, 1])
        placeFrame(railIM, ri++, s, side * (CFG.roadHalf + 1.9), 1.05, 1, 1, 1);
    }
    postIM.count = pi; railIM.count = ri;
    postIM.instanceMatrix.needsUpdate = true;
    railIM.instanceMatrix.needsUpdate = true;
    scene.add(postIM, railIM);
    // Deck edge light strips: warm white (-lat) / cyan (+lat), continuous.
    {
      const nE = Math.ceil(blen / 12);
      const edgeIM = new THREE.InstancedMesh(
        new THREE.BoxGeometry(0.25, 0.12, 12.3),
        new THREE.MeshBasicMaterial({ color: 0xffffff }), nE * 2);
      const col2 = new THREE.Color();
      let ei = 0;
      for (let k = 0; k < nE; k++) {
        const s = BR.s0 + k * 12 + 6;
        if (s > BR.s1) break;
        for (const side of [-1, 1]) {
          placeFrame(edgeIM, ei, s, side * (CFG.roadHalf + 1.55), 1.25, 1, 1, 1);
          edgeIM.setColorAt(ei, col2.set(side < 0 ? 0xffe2b0 : 0xaee9ff));
          ei++;
        }
      }
      edgeIM.count = ei;
      edgeIM.instanceMatrix.needsUpdate = true;
      if (edgeIM.instanceColor) edgeIM.instanceColor.needsUpdate = true;
      scene.add(edgeIM);
    }
    // Bridge street lamps every 40 m (the bridge's own lighting).
    const lampS = [];
    for (let s = BR.s0 + 20; s < BR.s1; s += 40) lampS.push(s);
    const bPoleIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.12, 7.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.8 }),
      lampS.length * 2);
    const bHeadIM = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.28, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0 }), lampS.length * 2);
    let bi = 0;
    const lampXZ = [];
    lampS.forEach((s) => {
      for (const side of [-1, 1]) {
        placeFrame(bPoleIM, bi, s, side * (CFG.roadHalf + 2.6), 3.6, 1, 1, 1);
        placeFrame(bHeadIM, bi, s, side * (CFG.roadHalf + 1.7), 7.15, 1, 1, 1);
        track.toWorld(s, side * (CFG.roadHalf + 1.7), 7.15, _p2);
        addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0xffd9a0);
        lampXZ.push([_p2.x, _p2.z]);
        bi++;
      }
    });
    bPoleIM.instanceMatrix.needsUpdate = true;
    bHeadIM.instanceMatrix.needsUpdate = true;
    scene.add(bPoleIM, bHeadIM);
    stats.bridgeLamps = bi;
    // Support pillars every 80 m, from the road down to the water —
    // blue-lit caps + blue glow at the waterline (approach piers).
    const pilIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(3.5, 1, 5),
      new THREE.MeshStandardMaterial({
        color: 0x23262e, emissive: 0x0a1430, emissiveIntensity: 0.8, roughness: 0.9,
      }),
      Math.ceil(blen / 80) + 1);
    const capIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(5, 1.2, 6),
      new THREE.MeshStandardMaterial({
        color: 0x1a2340, emissive: 0x1e56ff, emissiveIntensity: 0.7, roughness: 0.6,
      }),
      Math.ceil(blen / 80) + 1);
    let pli = 0;
    for (let s = BR.s0 + 40; s < BR.s1; s += 80) {
      track.frameAt(s, _f);
      track.toWorld(s, 0, 0, _p2);
      const hgt = _p2.y - W.y;
      if (hgt < 3) continue;
      composeInst(pilIM, pli, _p2.x, W.y + hgt / 2, _p2.z, _f.yaw, 1, hgt, 1);
      composeInst(capIM, pli, _p2.x, _p2.y - 0.6, _p2.z, _f.yaw, 1, 1, 1);
      addGlow(glowSmall, _p2.x, W.y + 1.2, _p2.z, BLUE);
      pli++;
    }
    pilIM.count = pli; capIM.count = pli;
    pilIM.instanceMatrix.needsUpdate = true;
    capIM.instanceMatrix.needsUpdate = true;
    scene.add(pilIM, capIM);

    // ---- Suspension towers: world-vertical, emissive blue ----
    const towerMat = new THREE.MeshBasicMaterial({ color: BLUE });
    for (const sT of [sT1, sT2]) {
      track.frameAt(sT, _f);
      const mid = new THREE.Vector3();
      for (const side of [-1, 1]) {
        const base = track.toWorld(sT, side * TOWER_LAT, 0, new THREE.Vector3());
        mid.add(base);
        // Concrete pylon from the water up to the deck (grounds the tower).
        const ph = Math.max(1, base.y - W.y);
        const pylon = new THREE.Mesh(
          new THREE.BoxGeometry(4.5, ph, 6),
          new THREE.MeshStandardMaterial({
            color: 0x23262e, emissive: 0x0a1430, emissiveIntensity: 0.8, roughness: 0.9,
          }));
        pylon.position.set(base.x, W.y + ph / 2, base.z);
        pylon.rotation.y = _f.yaw;
        scene.add(pylon);
        addGlow(glowSmall, base.x, W.y + 1.2, base.z, BLUE);
        // World-vertical column, base at deck level, ~64 m tall.
        const colm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 64, 2.4), towerMat);
        colm.position.set(base.x, base.y + 32, base.z);
        scene.add(colm);
        addGlow(glowBig, base.x, base.y + 64, base.z, BLUE);
      }
      mid.multiplyScalar(0.5);
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(2 * TOWER_LAT + 5, 2.6, 2.6), towerMat);
      beam.position.set(mid.x, mid.y + H_TOWER, mid.z);
      beam.rotation.y = _f.yaw;
      scene.add(beam);
    }
    stats.towers = 2;
    // Anchorage blocks at both bridge ends.
    const anchMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f4a, emissive: 0x0a0e18, emissiveIntensity: 0.7, roughness: 0.9,
    });
    for (const sA of [BR.s0 + 5, BR.s1 - 5]) {
      track.frameAt(sA, _f);
      for (const side of [-1, 1]) {
        track.toWorld(sA, side * CABLE_LAT, 1.4, _p2);
        const blk = new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 7), anchMat);
        blk.position.copy(_p2);
        blk.rotation.y = _f.yaw;
        scene.add(blk);
      }
    }
    // Main suspension cables: catenary tubes through sampled track points,
    // plus blue cable lights every ~10 m along each cable.
    for (const side of [-1, 1]) {
      const pts = [];
      for (let s = BR.s0; s <= BR.s1; s += 10)
        pts.push(track.toWorld(s, side * CABLE_LAT, cableH(s), new THREE.Vector3()));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.18, 6, false),
        new THREE.MeshBasicMaterial({ color: BLUE }));
      scene.add(tube);
      for (let s = BR.s0; s <= BR.s1; s += 10) {
        track.toWorld(s, side * CABLE_LAT, cableH(s), _p2);
        addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0x4d9fff);
      }
    }
    // Vertical suspenders every ~20 m, slanting from cable to deck edge.
    {
      const nS = Math.ceil(blen / 20) + 2;
      const suspIM = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.09, 0.09, 1, 5),
        new THREE.MeshBasicMaterial({ color: 0x5aa2ff }), nS * 2);
      let spi = 0;
      for (let s = BR.s0 + 10; s < BR.s1; s += 20) {
        const hTop = cableH(s) - 0.2;
        for (const side of [-1, 1]) {
          track.toWorld(s, side * CABLE_LAT, hTop, _sa);
          track.toWorld(s, side * (CFG.roadHalf + 1.9), 0.6, _sb);
          _sd.copy(_sa).sub(_sb);
          const len = _sd.length();
          _q.setFromUnitVectors(_up0, _sd.normalize());
          _p.copy(_sa).add(_sb).multiplyScalar(0.5);
          _s.set(1, len, 1);
          _m.compose(_p, _q, _s);
          suspIM.setMatrixAt(spi++, _m);
        }
      }
      suspIM.count = spi;
      suspIM.instanceMatrix.needsUpdate = true;
      scene.add(suspIM);
      stats.suspenders = spi;
    }

    // Water: dark reflective plane (no real planar reflection — mobile perf).
    const waterGrp = new THREE.Group();
    waterGrp.position.set(W.cx, W.y, W.cz);
    waterGrp.rotation.y = W.yaw;
    const waterMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W.w, W.d),
      new THREE.MeshStandardMaterial({
        color: 0x0a2f45, metalness: 0.85, roughness: 0.25, envMapIntensity: 1.2,
      })
    );
    waterMesh.rotation.x = -Math.PI / 2;
    waterGrp.add(waterMesh);
    scene.add(waterGrp);

    // ---- Skyline: dense lit towers beyond the far end + far shore ----
    const sMid = (BR.s0 + BR.s1) / 2;
    const skySpots = [];
    track.frameAt(BR.s1, _f);
    _sd.set(_f.tan.x, 0, _f.tan.z).normalize();
    _lh.set(_f.lat.x, 0, _f.lat.z).normalize();
    for (let k = 0; k < 30; k++) {
      const dist = 150 + rnd() * 250;
      const off = (rnd() - 0.5) * 380;
      skySpots.push({
        x: _f.pos.x + _sd.x * dist + _lh.x * off,
        z: _f.pos.z + _sd.z * dist + _lh.z * off,
        w: 16 + rnd() * 16, d: 16 + rnd() * 16, h: 55 + rnd() * 65,
        glass: rnd() < 0.3, yaw: _f.yaw + (rnd() - 0.5) * 0.6,
      });
    }
    for (let k = 0; k < 22; k++) {
      const s = BR.s0 + rnd() * blen;
      const side = rnd() < 0.5 ? -1 : 1;
      track.toWorld(s, side * (W.w / 2 + 60 + rnd() * 140), 0, _p2);
      skySpots.push({
        x: _p2.x, z: _p2.z, w: 16 + rnd() * 14, d: 16 + rnd() * 14,
        h: 50 + rnd() * 55, glass: rnd() < 0.3, yaw: rnd() * Math.PI,
      });
    }
    {
      const winTex = makeWindowTexture(7, 777);
      const glsTex = makeGlassTexture(4242);
      const skyMat = new THREE.MeshStandardMaterial({
        map: winTex, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 0.9,
        roughness: 0.9, metalness: 0.05,
      });
      const skyGl = new THREE.MeshStandardMaterial({
        map: glsTex, emissiveMap: glsTex, emissive: 0xffffff, emissiveIntensity: 0.5,
        roughness: 0.3, metalness: 0.75, envMapIntensity: 1.4,
      });
      const winS = skySpots.filter((sp) => !sp.glass);
      const glsS = skySpots.filter((sp) => sp.glass);
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      const winIM = new THREE.InstancedMesh(unitBox, skyMat, Math.max(1, winS.length));
      const glsIM = new THREE.InstancedMesh(unitBox, skyGl, Math.max(1, glsS.length));
      winS.forEach((sp, i) => composeInst(winIM, i, sp.x, -8 + sp.h / 2, sp.z, sp.yaw, sp.w, sp.h, sp.d));
      glsS.forEach((sp, i) => composeInst(glsIM, i, sp.x, -8 + sp.h / 2, sp.z, sp.yaw, sp.w, sp.h, sp.d));
      winIM.count = winS.length; glsIM.count = glsS.length;
      winIM.instanceMatrix.needsUpdate = true;
      glsIM.instanceMatrix.needsUpdate = true;
      scene.add(winIM, glsIM);
      stats.skyline = skySpots.length;
    }

    // ---- Landmark: Tokyo-tower-like tapered spire, orange-lit ----
    let landmarkXZ = null;
    {
      track.toWorld(sMid, W.w / 2 + 50, 0, _p2);
      const lx = _p2.x, lz = _p2.z, baseY = -8;
      const darkMat = new THREE.MeshStandardMaterial({
        color: 0x141821, emissive: 0x201207, emissiveIntensity: 0.7, roughness: 0.8,
      });
      const edgeMat = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
      const widths = [18, 14.5, 11, 8, 5.5, 3.5];
      const segH = 20;
      let y = baseY;
      for (const w of widths) {
        const seg = new THREE.Mesh(new THREE.BoxGeometry(w, segH, w), darkMat);
        seg.position.set(lx, y + segH / 2, lz);
        scene.add(seg);
        for (const ex of [-1, 1]) for (const ez of [-1, 1]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.45, segH, 0.45), edgeMat);
          edge.position.set(lx + ex * (w / 2), y + segH / 2, lz + ez * (w / 2));
          scene.add(edge);
        }
        y += segH;
      }
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, 22, 8), edgeMat);
      spire.position.set(lx, y + 11, lz);
      scene.add(spire);
      for (let k = 0; k < 6; k++)
        addGlow(glowBig, lx, baseY + 12 + k * 20, lz, 0xff7a1a);
      track.toWorld(sMid, W.w / 2 - 40, 0, _p2);
      landmarkXZ = [_p2.x, _p2.z];
    }

    // FAKE reflections on the water — additive streak quads, all cheap:
    // warm streaks under the deck lamps, blue streaks under the towers and
    // main cables, one orange streak under the landmark, plus scattered
    // neon streaks along the bridge.
    const streakGeo = new THREE.PlaneGeometry(1, 1);
    streakGeo.rotateX(-Math.PI / 2);
    const extraStreaks = [];
    for (const sT of [sT1, sT2]) for (const side of [-1, 1]) {
      track.toWorld(sT, side * TOWER_LAT, 0, _p2);
      extraStreaks.push({ x: _p2.x, z: _p2.z, sx: 4.5, sz: 13, c: BLUE });
    }
    for (const s of [sMid - 40, sMid + 40]) for (const side of [-1, 1]) {
      track.toWorld(s, side * CABLE_LAT, 0, _p2);
      extraStreaks.push({ x: _p2.x, z: _p2.z, sx: 3, sz: 9, c: BLUE });
    }
    if (landmarkXZ)
      extraStreaks.push({ x: landmarkXZ[0], z: landmarkXZ[1], sx: 5, sz: 15, c: 0xff7a1a });
    const nStreak = lampXZ.length + 30 + extraStreaks.length;
    const streakIM = new THREE.InstancedMesh(
      streakGeo,
      new THREE.MeshBasicMaterial({
        map: glowTex, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }), nStreak);
    const col = new THREE.Color();
    let sti = 0;
    for (const [x, z] of lampXZ) {
      composeInst(streakIM, sti, x, W.y + 0.08, z, W.yaw, 3, 1, 9);
      streakIM.setColorAt(sti, col.set(0xffd9a0));
      sti++;
    }
    for (const es of extraStreaks) {
      composeInst(streakIM, sti, es.x, W.y + 0.08, es.z, W.yaw, es.sx, 1, es.sz);
      streakIM.setColorAt(sti, col.set(es.c));
      sti++;
    }
    const NEON = [0x7df9ff, 0xff5fa2, 0xff9f43, 0xb6ffe0, 0xc4b5fd];
    for (let k = 0; k < 30; k++) {
      const s = BR.s0 + rnd() * blen;
      track.toWorld(s, (rnd() - 0.5) * 44, 0, _p2);
      composeInst(streakIM, sti, _p2.x, W.y + 0.08, _p2.z, W.yaw,
        1.5 + rnd() * 2, 1, 4 + rnd() * 8);
      streakIM.setColorAt(sti, col.set(NEON[(rnd() * NEON.length) | 0]));
      sti++;
    }
    streakIM.count = sti;
    streakIM.instanceMatrix.needsUpdate = true;
    if (streakIM.instanceColor) streakIM.instanceColor.needsUpdate = true;
    scene.add(streakIM);
  }

  // ---- Buildings: 6 anime-facade variants + 2 reflective glass ----
  // Single-material boxes (one draw pass each) + a shared thin roof-cap
  // instanced mesh for rooftop detail. Towers may get a stepped-back upper
  // tier (collider covers the full envelope so meshes stay inside it).
  // Skipped inside the water channel, near the tunnel tube, and beside the
  // elevated bridge (their bases would float above the ground plane).
  // Facades sit at |lat| >= 18 — clear of the +/-14 m car corridor.
  const variants = [];
  for (let v = 0; v < 6; v++) {
    const sideTex = makeWindowTexture(v, 1000 + v);
    variants.push({
      mat: new THREE.MeshStandardMaterial({
        map: sideTex, emissiveMap: sideTex, emissive: 0xffffff, emissiveIntensity: 1.0,
        roughness: 0.85, metalness: 0.08, envMapIntensity: 0.6,
      }),
      list: [], upperList: [],
    });
  }
  for (let v = 0; v < 2; v++) {
    const tex = makeGlassTexture(5000 + v);
    variants.push({
      mat: new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55,
        roughness: 0.3, metalness: 0.75, envMapIntensity: 1.5,
      }),
      list: [], upperList: [],
    });
  }
  const buildings = [];
  const beacons = []; // {x,y,z,phase} — red aviation lights, sine-pulsed in update()
  const hvacList = []; // rooftop AC boxes
  for (const side of [-1, 1]) {
    let s = 20;
    while (s < L - 20) {
      const inD = inDistrict(s);
      const tower = rnd() < 0.3;
      const w = 8 + rnd() * 12, d = 8 + rnd() * 12;
      const h = tower ? 35 + rnd() * 35 : 8 + rnd() * 24;
      const latC = side * (CFG.roadHalf + 6 + w / 2 + rnd() * 38);
      track.frameAt(s, _f);
      track.toWorld(s, latC, 0, _p2);
      const skipWater = inWaterRect(_p2.x, _p2.z, 40);
      const skipTun = inTun(s, 40) && Math.abs(latC) < 50;
      const skipBridge = track.inBridge(s, 20);
      if (!skipWater && !skipTun && !skipBridge) {
        const b = {
          s, side, w, d, h, latC,
          latF: latC - side * (w / 2), // road-facing facade lateral
          yBase: _p2.y, x: _p2.x, z: _p2.z, yaw: _f.yaw,
          upper: null,
        };
        const vi = tower && rnd() < 0.55 ? 6 + ((rnd() * 2) | 0) : (rnd() * 6) | 0;
        // Stepped-back upper tier on some towers (window variants only).
        if (tower && vi < 6 && rnd() < 0.55) {
          b.upper = { w: w * 0.68, d: d * 0.68, h: h * (0.3 + rnd() * 0.2) };
          variants[vi].upperList.push(b);
          stats.setbacks = (stats.setbacks | 0) + 1;
        }
        buildings.push(b);
        variants[vi].list.push(b);
        const totalH = b.h + (b.upper ? b.upper.h : 0);
        physics.addStaticBox(w / 2, totalH / 2, d / 2,
          _p2.x, _p2.y + totalH / 2, _p2.z, _f.yaw, 'building');
        // Rooftop HVAC box on ~45% of roofs (top tier if set back).
        const topW = b.upper ? b.upper.w : b.w, topD = b.upper ? b.upper.d : b.d;
        const topH = totalH;
        if (rnd() < 0.45 && topW > 5 && topD > 5) {
          track.toWorld(s + (rnd() - 0.5) * topD * 0.4,
            latC + (rnd() - 0.5) * topW * 0.4, topH + 0.9, _p2);
          hvacList.push({ x: _p2.x, y: _p2.y, z: _p2.z, yaw: b.yaw });
        }
        // Red aviation beacons on the road-facing top corners of towers.
        if (totalH >= 24) {
          const bw = topW / 2 - 0.5, bd = topD / 2 - 0.5;
          for (const cz of [-bd, bd]) {
            track.toWorld(s + cz, latC - side * bw, topH + 0.75, _p2);
            beacons.push({ x: _p2.x, y: _p2.y, z: _p2.z, phase: rnd() * Math.PI * 2 });
            addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0xff2a2a);
          }
        }
      }
      s += (inD ? 10 : 16) + rnd() * 4; // ~10 m downtown, ~16 m elsewhere
    }
  }
  stats.buildings = buildings.length;
  stats.beacons = beacons.length;
  stats.hvac = hvacList.length;
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const roofCaps = []; // {x,y,z,yaw,w,d} — thin detailed rooftop slabs
  for (const v of variants) {
    const im = new THREE.InstancedMesh(boxGeo, v.mat, Math.max(1, v.list.length));
    v.list.forEach((b, i) => {
      composeInst(im, i, b.x, b.yBase + b.h / 2, b.z, b.yaw, b.w, b.h, b.d);
      const tw = b.upper ? b.upper.w : b.w, td = b.upper ? b.upper.d : b.d;
      const th = b.upper ? b.h + b.upper.h : b.h;
      roofCaps.push({ x: b.x, y: b.yBase + th + 0.21, z: b.z, yaw: b.yaw, w: tw, d: td });
    });
    im.count = v.list.length;
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    if (v.upperList.length) {
      const uim = new THREE.InstancedMesh(boxGeo, v.mat, v.upperList.length);
      v.upperList.forEach((b, i) => composeInst(uim, i, b.x,
        b.yBase + b.h + b.upper.h / 2, b.z, b.yaw, b.upper.w, b.upper.h, b.upper.d));
      uim.instanceMatrix.needsUpdate = true;
      scene.add(uim);
    }
  }
  // Thin roof caps with the detailed rooftop skin — one extra draw call
  // total (a 6-material box would cost 6 renderer passes per mesh).
  {
    const capTex = makeRoofTexture(7777);
    const capIM = new THREE.InstancedMesh(boxGeo,
      new THREE.MeshStandardMaterial({
        map: capTex, emissiveMap: capTex, emissive: 0xffffff, emissiveIntensity: 0.5,
        roughness: 0.95, metalness: 0.05,
      }), Math.max(1, roofCaps.length));
    roofCaps.forEach((rc, i) => composeInst(capIM, i, rc.x, rc.y, rc.z, rc.yaw,
      rc.w + 0.15, 0.3, rc.d + 0.15));
    capIM.count = roofCaps.length;
    capIM.instanceMatrix.needsUpdate = true;
    scene.add(capIM);
    stats.roofCaps = roofCaps.length;
  }
  // Rooftop HVAC boxes (dark, faintly lit so they never read as black blobs).
  {
    const him = new THREE.InstancedMesh(boxGeo,
      new THREE.MeshStandardMaterial({
        color: 0x161b24, emissive: 0x0d1420, emissiveIntensity: 0.7, roughness: 0.9,
      }), Math.max(1, hvacList.length));
    hvacList.forEach((hb, i) => composeInst(him, i, hb.x, hb.y, hb.z, hb.yaw,
      2.2 + (i % 3) * 0.5, 1.1, 1.6));
    him.count = hvacList.length;
    him.instanceMatrix.needsUpdate = true;
    scene.add(him);
  }
  // Aviation beacons: instanced red spheres, smooth ~2 s sine pulse
  // (NOT a harsh on/off timer). Colors updated per-frame in api.update().
  const beaconIM = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.32, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, beacons.length));
  {
    const bc = new THREE.Color();
    beacons.forEach((bn, i) => {
      composeInst(beaconIM, i, bn.x, bn.y, bn.z, 0, 1, 1, 1);
      beaconIM.setColorAt(i, bc.setRGB(0.5, 0.05, 0.05));
    });
    beaconIM.count = beacons.length;
    beaconIM.instanceMatrix.needsUpdate = true;
    if (beaconIM.instanceColor) beaconIM.instanceColor.needsUpdate = true;
    scene.add(beaconIM);
  }

  // ---- Neon signs: facade-mounted ONLY, never floating ----
  // Two passes: collect candidates with the district/elsewhere probabilities,
  // then stride-sample down to the ~320-sign target for an even spread.
  {
    const vCands = [], bCands = [];
    for (const b of buildings) {
      const pV = inDistrict(b.s) ? 0.62 : 0.45;
      const pB = inDistrict(b.s) ? 0.40 : 0.30;
      const r = rnd();
      const wi = (rnd() * SIGN_WORDS.length) | 0;
      if (r < pV) {
        // 35% are low storefront-fixed vertical signboards.
        const shop = rnd() < 0.35;
        vCands.push({
          b, wi, sSign: b.s + (rnd() * 2 - 1) * Math.max(0, b.d / 2 - 2),
          y: shop ? b.yBase + 3.4 + rnd() * 2
                  : b.yBase + 5 + rnd() * Math.max(2, b.h - 12),
          sw: shop ? 1.0 : 1.4, sh: shop ? 2.4 + rnd() * 1.2 : 3.5 + rnd() * 4,
        });
      } else if (r < pV + pB) {
        bCands.push({
          b, wi, sSign: b.s,
          y: b.yBase + 3 + rnd() * Math.max(2, Math.min(b.h - 6, 14)),
          bw: 4 + rnd() * 4, bh: 1.3,
        });
      }
    }
    const stridePick = (arr, cap) => {
      if (arr.length <= cap) return arr;
      const out = [], step = arr.length / cap;
      for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
      return out;
    };
    const vSigns = stridePick(vCands, 190);
    const bSigns = stridePick(bCands, 130);
    stats.vSigns = vSigns.length; stats.bSigns = bSigns.length;
    // Per-word face meshes + shared dark back boxes (the mounting hardware).
    const vFaceIMs = SIGN_WORDS.map(([word, color]) => {
      const im = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: makeSignTexture(word, color) }), 40);
      im.count = 0; scene.add(im); return im;
    });
    const vBackIM = new THREE.InstancedMesh(boxGeo,
      new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.8 }), 190);
    vBackIM.count = 0; scene.add(vBackIM);
    const bFaceIMs = SIGN_WORDS.map(([word, color]) => {
      const im = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: makeBoardTexture(word, color) }), 28);
      im.count = 0; scene.add(im); return im;
    });
    const bBackIM = new THREE.InstancedMesh(boxGeo,
      new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.8 }), 130);
    bBackIM.count = 0; scene.add(bBackIM);
    // Mount one sign on its building's road-facing facade: the face plane's
    // +z (normal) points at the road; the back box is sunk into the wall.
    function mountSign(sSign, latF, side, y, fw, fh, faceIM, backIM, color) {
      track.frameAt(sSign, _f);
      _n.copy(_f.lat); _n.y = 0;
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
      _n.normalize().multiplyScalar(-side); // toward the road
      _x.crossVectors(_up0, _n).normalize();
      _y.crossVectors(_n, _x).normalize();
      // Facade point at absolute height y (h measured along the frame up).
      track.toWorld(sSign, latF, 0, _p2);
      track.toWorld(sSign, latF, y - _p2.y, _p2);
      _m.makeBasis(_x, _y, _n);
      _m.scale(_v.set(fw, fh, 1));
      _p.copy(_p2).addScaledVector(_n, 0.03);
      _m.setPosition(_p);
      if (faceIM.count < faceIM.instanceMatrix.count) {
        faceIM.setMatrixAt(faceIM.count++, _m);
        _m.makeBasis(_x, _y, _n);
        _m.scale(_v.set(fw + 0.15, fh + 0.15, 0.24));
        _p.copy(_p2).addScaledVector(_n, -0.09);
        _m.setPosition(_p);
        if (backIM.count < backIM.instanceMatrix.count)
          backIM.setMatrixAt(backIM.count++, _m);
        addGlow(glowSmall, _p2.x, _p2.y, _p2.z, color);
      }
    }
    for (const sg of vSigns) {
      const [, color] = SIGN_WORDS[sg.wi];
      mountSign(sg.sSign, sg.b.latF, sg.b.side, sg.y, sg.sw * 0.92, sg.sh * 0.94,
        vFaceIMs[sg.wi], vBackIM, color);
    }
    for (const sg of bSigns) {
      const [, color] = SIGN_WORDS[sg.wi];
      mountSign(sg.sSign, sg.b.latF, sg.b.side, sg.y, sg.bw, sg.bh,
        bFaceIMs[sg.wi], bBackIM, color);
    }
    for (const im of [...vFaceIMs, ...bFaceIMs, vBackIM, bBackIM]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.count === 0) im.visible = false;
    }
  }

  // ---- Lit shopfronts at building bases: glowing storefront planes +
  // striped awnings, all facade-mounted (never floating) ----
  {
    const cands = [];
    for (const b of buildings) {
      if (b.h > 26 || Math.abs(b.latF) > 30 || rnd() > 0.5) continue;
      cands.push({
        b, vi: (rnd() * 3) | 0,
        sSign: b.s + (rnd() * 2 - 1) * Math.max(0, b.d / 2 - 2.5),
        w: 4 + rnd() * 2,
      });
    }
    const faceIMs = [0, 1, 2].map((v) => {
      const im = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: makeStorefrontTexture(v, 9000 + v) }), 60);
      im.count = 0; scene.add(im); return im;
    });
    const awnIM = new THREE.InstancedMesh(boxGeo,
      new THREE.MeshStandardMaterial({
        map: makeAwningTexture(31337), emissiveMap: makeAwningTexture(31337),
        emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.85,
      }), 160);
    awnIM.count = 0; scene.add(awnIM);
    for (const st of cands) {
      const { b } = st;
      track.frameAt(st.sSign, _f);
      _n.copy(_f.lat); _n.y = 0;
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
      _n.normalize().multiplyScalar(-b.side); // toward the road
      _x.crossVectors(_up0, _n).normalize();
      _y.crossVectors(_n, _x).normalize();
      // storefront glass at ground level
      track.toWorld(st.sSign, b.latF, 0, _p2);
      track.toWorld(st.sSign, b.latF, b.yBase + 1.5 - _p2.y, _p2);
      _m.makeBasis(_x, _y, _n);
      _m.scale(_v.set(st.w, 2.6, 1));
      _p.copy(_p2).addScaledVector(_n, 0.04);
      _m.setPosition(_p);
      const fim = faceIMs[st.vi];
      if (fim.count < fim.instanceMatrix.count) fim.setMatrixAt(fim.count++, _m);
      // awning jutting 1.5 m out over the sidewalk
      _m.makeBasis(_x, _y, _n);
      _m.scale(_v.set(st.w + 0.8, 0.18, 1.5));
      _p.copy(_p2).addScaledVector(_n, 0.75);
      _p.y = _p2.y + 1.75; // just above the glass top
      _m.setPosition(_p);
      if (awnIM.count < awnIM.instanceMatrix.count)
        awnIM.setMatrixAt(awnIM.count++, _m);
      addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0xffb35c);
    }
    for (const im of [...faceIMs, awnIM]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.count === 0) im.visible = false;
    }
    stats.storefronts = cands.length;
  }

  // ---- Street lamps every 30 m, both sides (skip tunnel +/-25, bridge) ----
  // Teal/cyan heads + glow for the synthwave street tint.
  {
    const lampS = [];
    for (let s = 0; s < L; s += 30) {
      if (inTun(s, 25) || track.inBridge(s, 0)) continue;
      lampS.push(s);
    }
    const n = lampS.length * 2;
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.12, 7.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.8 }), n);
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.28, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xcdf3ff }), n);
    let i = 0;
    lampS.forEach((s) => {
      for (const side of [-1, 1]) {
        placeFrame(poles, i, s, side * (CFG.roadHalf + 2.6), 3.6, 1, 1, 1);
        placeFrame(heads, i, s, side * (CFG.roadHalf + 1.7), 7.15, 1, 1, 1);
        track.toWorld(s, side * (CFG.roadHalf + 1.7), 7.15, _p2);
        addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0x4de8ff);
        i++;
      }
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    scene.add(poles, heads);
    stats.lamps = i;
  }

  // ---- Power poles + sagging catenary wires (one side, skip tunnel/bridge) ----
  {
    const px = CFG.roadHalf + 5.2, ps = [];
    for (let s = 0; s < L; s += 34) {
      if (inTun(s, 45) || track.inBridge(s, 0)) continue;
      ps.push(s);
    }
    const poleIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.14, 0.18, 9, 6),
      new THREE.MeshStandardMaterial({
        color: 0x23262e, emissive: 0x0a0e18, emissiveIntensity: 0.6, roughness: 0.85,
      }), ps.length);
    const armIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.7, 0.12, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0x23262e, emissive: 0x0a0e18, emissiveIntensity: 0.6, roughness: 0.85,
      }), ps.length);
    const tops = [];
    ps.forEach((s, i) => {
      placeFrame(poleIM, i, s, px, 4.5, 1, 1, 1);
      placeFrame(armIM, i, s, px, 8.2, 1, 1, 1);
      track.frameAt(s, _f);
      tops.push({
        s,
        latH: new THREE.Vector3(_f.lat.x, 0, _f.lat.z).normalize(),
        p0: track.toWorld(s, px, 8.2, new THREE.Vector3()),
      });
    });
    poleIM.instanceMatrix.needsUpdate = true;
    armIM.instanceMatrix.needsUpdate = true;
    scene.add(poleIM, armIM);
    // Sagging wires between consecutive pole tops (skip spans > 60 m).
    const pts = [];
    for (let i = 0; i + 1 < tops.length; i++) {
      const A = tops[i], B = tops[i + 1];
      if (track.distAhead(A.s, B.s) > 60) continue;
      for (const [off, sag] of [[-0.7, 1.3], [0, 1.7], [0.7, 1.3]]) {
        const SEG = 8;
        let prev = null;
        for (let k = 0; k <= SEG; k++) {
          const t = k / SEG;
          _p2.lerpVectors(A.p0, B.p0, t);
          _v.lerpVectors(A.latH, B.latH, t).multiplyScalar(off);
          const cur = [_p2.x + _v.x, _p2.y - sag * 4 * t * (1 - t), _p2.z + _v.z];
          if (prev) pts.push(...prev, ...cur);
          prev = cur;
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a4a5f })));
  }

  // ---- Trees every ~24 m, both sides (skip tunnel +/-25, bridge) ----
  // Pruned street trees: tapered trunk + two foliage blobs, faint emissive
  // so canopies read deep green instead of black at night.
  {
    const items = [];
    for (let s = 0; s < L; s += 24) {
      if (inTun(s, 25) || track.inBridge(s, 0)) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.25) continue;
        items.push({ s: s + rnd() * 8, side, sc: 0.8 + rnd() * 0.7 });
      }
    }
    const trunkIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.13, 0.22, 2.0, 6),
      new THREE.MeshStandardMaterial({
        color: 0x2e2318, emissive: 0x0d0a06, emissiveIntensity: 0.7, roughness: 0.9,
      }), items.length);
    const folIM = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1.35, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0x0c241a, emissiveIntensity: 0.55,
        roughness: 0.9, flatShading: true,
      }), items.length * 2);
    const col = new THREE.Color();
    items.forEach((t, i) => {
      const lat = t.side * (CFG.roadHalf + 3.8 + rnd() * 1.2);
      const sc = t.sc;
      placeFrame(trunkIM, i, t.s, lat, 1.0 * sc, sc, sc, sc);
      // lower canopy blob
      placeFrame(folIM, i * 2, t.s, lat, 2.6 * sc, sc, sc * 0.78, sc);
      folIM.setColorAt(i * 2, col.setHSL(0.36 + rnd() * 0.1, 0.5, 0.16 + rnd() * 0.1));
      // upper canopy blob
      placeFrame(folIM, i * 2 + 1, t.s + 0.4, lat, 3.9 * sc, sc * 0.68, sc * 0.6, sc * 0.68);
      folIM.setColorAt(i * 2 + 1, col.setHSL(0.36 + rnd() * 0.1, 0.5, 0.2 + rnd() * 0.1));
    });
    trunkIM.instanceMatrix.needsUpdate = true;
    folIM.instanceMatrix.needsUpdate = true;
    if (folIM.instanceColor) folIM.instanceColor.needsUpdate = true;
    scene.add(trunkIM, folIM);
    stats.trees = items.length;
  }

  // ---- Sidewalks: raised lighter-concrete strips, both sides ----
  // Ribbon strips following the track frame; skipped inside the tunnel
  // (would hit the tube walls) and on the bridge (deck preserved).
  {
    const swTex = makeSidewalkTexture(4242);
    const swMat = new THREE.MeshStandardMaterial({
      map: swTex, roughness: 0.95, metalness: 0.02, side: THREE.DoubleSide,
    });
    const LAT0 = CFG.roadHalf + 1.6, LAT1 = CFG.roadHalf + 5.4, LIFT = 0.14;
    for (const side of [-1, 1]) {
      const step = 4, nS = Math.ceil(L / step);
      const verts = [], uvs = [], idx = [];
      const rowOf = new Array(nS + 1).fill(-1);
      for (let k = 0; k <= nS; k++) {
        const s = Math.min(k * step, L - 0.01);
        if (inTun(s, 14) || track.inBridge(s, 8)) continue;
        track.frameAt(s, _f);
        const row = verts.length / 3;
        rowOf[k] = row;
        for (const lat of [side * LAT0, side * LAT1]) {
          verts.push(
            _f.pos.x + _f.lat.x * lat + _f.up.x * LIFT,
            _f.pos.y + _f.lat.y * lat + _f.up.y * LIFT,
            _f.pos.z + _f.lat.z * lat + _f.up.z * LIFT);
          uvs.push(lat === side * LAT0 ? 0 : 1, s / 8);
        }
      }
      for (let k = 0; k < nS; k++) {
        const r0 = rowOf[k], r1 = rowOf[k + 1];
        if (r0 < 0 || r1 < 0) continue;
        idx.push(r0, r1, r0 + 1, r1, r1 + 1, r0 + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      scene.add(new THREE.Mesh(g, swMat));
    }
    stats.sidewalks = 2;
  }

  // ---- Directional gantries OVER the road (panels bolted to the beam) ----
  [400, 1100, 2500, 3100, 4600, 5000].forEach((gs, gi) => {
    const grp = new THREE.Group();
    track.frameAt(gs, _f);
    grp.position.copy(_f.pos);
    grp.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(_f.lat, _f.up, _f.tan));
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x39404e, roughness: 0.6, metalness: 0.5,
    });
    const px = CFG.roadHalf + 3.6; // M4: beyond car reach (14.0 m) — no phantom post hits
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.8, 0.6), postMat);
      post.position.set(side * px, 3.9, 0);
      grp.add(post);
      track.toWorld(gs, side * px, 3.9, _p2);
      physics.addStaticBox(0.3, 3.9, 0.3, _p2.x, _p2.y, _p2.z, _f.yaw, 'building');
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * px + 0.6, 0.9, 0.6), postMat);
    beam.position.set(0, 7.35, 0);
    grp.add(beam);
    const [p1, p2] = DIR_PANELS[gi % DIR_PANELS.length];
    [p1, p2].forEach(([l1, l2], pi) => {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 1.4),
        new THREE.MeshBasicMaterial({
          map: makeDirPanelTexture(l1, l2), side: THREE.DoubleSide,
        })
      );
      panel.position.set(pi === 0 ? -3.2 : 3.2, 6.35, 0);
      grp.add(panel);
      track.toWorld(gs, pi === 0 ? -3.2 : 3.2, 6.35, _p2);
      addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0x7dff9e);
    });
    scene.add(grp);
  });

  // ---- Start/finish gantry at s=0 + checkered start-line strip ----
  {
    track.frameAt(0, _f);
    const grp = new THREE.Group();
    grp.position.copy(_f.pos);
    grp.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(_f.lat, _f.up, _f.tan));
    const px = CFG.roadHalf + 3.6; // M4: beyond car reach (14.0 m) — no phantom post hits
    const postMat = new THREE.MeshStandardMaterial({
      color: 0x8a1f1f, roughness: 0.6, metalness: 0.3,
    });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), postMat);
      post.position.set(side * px, 4, 0);
      grp.add(post);
      track.toWorld(0, side * px, 4, _p2);
      physics.addStaticBox(0.35, 4, 0.35, _p2.x, _p2.y, _p2.z, _f.yaw, 'building');
    }
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(2 * px + 0.6, 1.7, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.7 })
    );
    beam.position.set(0, 7.4, 0);
    const bannerTex = makeGantryTexture();
    const mkBanner = (z, ry) => {
      const b = new THREE.Mesh(
        new THREE.PlaneGeometry(2 * px, 1.6),
        new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
      );
      b.position.set(0, 7.4, z);
      b.rotation.y = ry;
      return b;
    };
    grp.add(beam, mkBanner(0.26, 0), mkBanner(-0.26, Math.PI));
    scene.add(grp);
    // Checkered strip across the road at s=0.
    const stripTex = makeStartLineTexture();
    stripTex.repeat.set(4, 1);
    const sgeo = new THREE.PlaneGeometry(2 * (CFG.roadHalf + 1.5), 1.5);
    sgeo.rotateX(-Math.PI / 2);
    const strip = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ map: stripTex }));
    track.frameAt(0, _f);
    strip.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(_f.lat, _f.up, _f.tan));
    strip.position.copy(_f.pos).addScaledVector(_f.up, 0.03);
    scene.add(strip);
  }

  // ---- Pedestrian overpass at s=900 + walkers; sidewalk peds elsewhere ----
  const OVER_S = 900, DECK_TOP = 5.8;
  const overWalkers = [];
  {
    track.frameAt(OVER_S, _f);
    const grp = new THREE.Group();
    grp.position.copy(_f.pos);
    grp.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(_f.lat, _f.up, _f.tan));
    const deckMat = new THREE.MeshStandardMaterial({
      // M4: faint emissive so the deck/columns never read as black blobs
      // from the road below.
      color: 0x2a2e38, emissive: 0x0d1220, emissiveIntensity: 0.8, roughness: 0.8,
    });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 0.4, 3), deckMat);
    deck.position.set(0, DECK_TOP - 0.2, 0);
    grp.add(deck);
    const railM = new THREE.MeshStandardMaterial({
      color: 0x8a93a5, roughness: 0.4, metalness: 0.7,
    });
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(34, 0.9, 0.08), railM);
      r.position.set(0, DECK_TOP + 0.45, side * 1.45);
      grp.add(r);
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.8, DECK_TOP - 0.2, 0.8), deckMat);
      col.position.set(side * 16.2, (DECK_TOP - 0.2) / 2, 0);
      grp.add(col);
      track.toWorld(OVER_S, side * 16.2, (DECK_TOP - 0.2) / 2, _p2);
      physics.addStaticBox(0.4, (DECK_TOP - 0.2) / 2, 0.4, _p2.x, _p2.y, _p2.z, _f.yaw, 'building');
    }
    scene.add(grp);
    // Walkers pace back and forth across the deck, facing along +/-lat.
    const NW = 14;
    const bodyIM = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.22, 0.75, 3, 8),
      new THREE.MeshStandardMaterial({ roughness: 0.85 }), NW);
    const headIM = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9a98c, roughness: 0.7 }), NW);
    const col = new THREE.Color();
    track.frameAt(OVER_S, _f);
    const latH = new THREE.Vector3(_f.lat.x, 0, _f.lat.z).normalize();
    for (let i = 0; i < NW; i++) {
      const speed = (0.7 + rnd() * 0.7) * (rnd() < 0.5 ? 1 : -1);
      const dir = latH.clone().multiplyScalar(Math.sign(speed));
      overWalkers.push({ off: rnd() * 30, speed, yaw: Math.atan2(dir.x, dir.z) });
      bodyIM.setColorAt(i, col.setHSL(rnd(), 0.5, 0.35 + rnd() * 0.2));
    }
    if (bodyIM.instanceColor) bodyIM.instanceColor.needsUpdate = true;
    scene.add(bodyIM, headIM);
    overWalkers.bodyIM = bodyIM;
    overWalkers.headIM = headIM;
    stats.walkers = NW;
    // Static sidewalk peds: every ~55 m, both sides, skip tunnel + bridge.
    // Varied heights, builds, and clothing colors.
    const items = [];
    for (let s = 0; s < L; s += 55) {
      if (inTun(s, 20) || track.inBridge(s, 5)) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.2) continue;
        items.push({
          s: s + rnd() * 30, side,
          lat: side * (CFG.roadHalf + 2.2 + rnd() * 2.2),
          hgt: 0.85 + rnd() * 0.3,
        });
      }
    }
    const sBodyIM = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.22, 0.75, 3, 8),
      new THREE.MeshStandardMaterial({ roughness: 0.85 }), items.length);
    const sHeadIM = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9a98c, roughness: 0.7 }), items.length);
    items.forEach((pd, i) => {
      track.toWorld(pd.s, pd.lat, 0.14, _p2);
      composeInst(sBodyIM, i, _p2.x, _p2.y + 0.85 * pd.hgt, _p2.z,
        rnd() * Math.PI * 2, 0.9 + rnd() * 0.3, pd.hgt, 0.9 + rnd() * 0.3);
      composeInst(sHeadIM, i, _p2.x, _p2.y + (0.85 + 0.77) * pd.hgt, _p2.z, 0, 1, 1, 1);
      sBodyIM.setColorAt(i, col.setHSL(rnd(), 0.35 + rnd() * 0.4, 0.25 + rnd() * 0.35));
    });
    sBodyIM.instanceMatrix.needsUpdate = true;
    sHeadIM.instanceMatrix.needsUpdate = true;
    if (sBodyIM.instanceColor) sBodyIM.instanceColor.needsUpdate = true;
    scene.add(sBodyIM, sHeadIM);
    stats.peds = items.length;
  }

  // ---- Parked cars along the outer sidewalk edge ----
  // Simple low-poly bodies + cabins + red tail strips, parked on the
  // sidewalk at |lat| = 15.6 — outside the +/-14 m car corridor, with
  // colliders so they are solid.
  {
    const items = [];
    for (let s = 30; s < L - 30; s += 46) {
      if (inTun(s, 30) || track.inBridge(s, 10)) continue;
      for (const side of [-1, 1]) {
        if (rnd() < 0.5) continue;
        items.push({ s: s + rnd() * 10, side });
      }
    }
    const PCOL = [0xd8dce4, 0x1a1d24, 0x8a93a5, 0x5a2020, 0x1f3a5a, 0x2a4a3a];
    const nP = Math.max(1, items.length);
    const pBodyIM = new THREE.InstancedMesh(
      boxGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.5, envMapIntensity: 1.0 }),
      nP);
    const pCabIM = new THREE.InstancedMesh(
      boxGeo,
      new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.35, metalness: 0.4 }),
      nP);
    const pTailIM = new THREE.InstancedMesh(
      boxGeo, new THREE.MeshBasicMaterial({ color: 0xff2a2a }), nP);
    const col = new THREE.Color();
    items.forEach((pc, i) => {
      const lat = pc.side * (CFG.roadHalf + 3.6);
      track.frameAt(pc.s, _f);
      _p.copy(_f.pos).addScaledVector(_f.lat, lat);
      _m.makeBasis(_f.lat, _f.up, _f.tan);
      _m.scale(_v.set(1.9, 0.62, 4.4));
      _p2.copy(_p).addScaledVector(_f.up, 0.69);
      _m.setPosition(_p2);
      pBodyIM.setMatrixAt(i, _m);
      pBodyIM.setColorAt(i, col.set(PCOL[(rnd() * PCOL.length) | 0]));
      _m.makeBasis(_f.lat, _f.up, _f.tan);
      _m.scale(_v.set(1.7, 0.5, 2.2));
      _p2.copy(_p).addScaledVector(_f.up, 1.19).addScaledVector(_f.tan, -0.3);
      _m.setPosition(_p2);
      pCabIM.setMatrixAt(i, _m);
      _m.makeBasis(_f.lat, _f.up, _f.tan);
      _m.scale(_v.set(1.7, 0.12, 0.1));
      _p2.copy(_p).addScaledVector(_f.up, 0.76).addScaledVector(_f.tan, -2.21);
      _m.setPosition(_p2);
      pTailIM.setMatrixAt(i, _m);
      track.toWorld(pc.s, lat, 0.74, _p2);
      physics.addStaticBox(0.95, 0.6, 2.2, _p2.x, _p2.y, _p2.z, _f.yaw, 'building');
      track.toWorld(pc.s, lat, 0.76, _p2);
      addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0xff2a2a);
    });
    pBodyIM.count = pCabIM.count = pTailIM.count = items.length;
    for (const im of [pBodyIM, pCabIM, pTailIM]) {
      im.instanceMatrix.needsUpdate = true;
      scene.add(im);
    }
    if (pBodyIM.instanceColor) pBodyIM.instanceColor.needsUpdate = true;
    stats.parked = items.length;
  }

  // ---- Nitro bottles: glowing pickups synced to physics.bottles ----
  const NB = physics.bottles.length;
  const bottleBodyIM = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.3, 0.7, 10),
    new THREE.MeshBasicMaterial({ color: 0x35f2ff }), NB);
  const bottleCapIM = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.18, 8),
    new THREE.MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.6 }), NB);
  scene.add(bottleBodyIM, bottleCapIM);
  physics.bottles.forEach((b) => {
    track.toWorld(b.s, b.lat, 0.55, _p2);
    addGlow(glowSmall, _p2.x, _p2.y, _p2.z, 0x35f2ff);
  });
  stats.bottles = NB;

  // ---- Stars + moon ----
  {
    const n = 700, pos = new Float32Array(n * 3);
    const sr = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const th = sr() * Math.PI * 2, ph = sr() * Math.PI * 0.42;
      const r = 950;
      pos[i * 3] = cx + Math.cos(th) * Math.cos(ph) * r;
      pos[i * 3 + 1] = 60 + Math.sin(ph) * r * 0.6;
      pos[i * 3 + 2] = cz + Math.sin(th) * Math.cos(ph) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xafc4e8, size: 1.6, sizeAttenuation: false,
    })));
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
    );
    moon.position.set(cx - 260, 260, cz + 550);
    moon.lookAt(cx, 0, cz);
    scene.add(moon);
  }

  // ---- Static glow points (one draw call per size class) ----
  buildGlowPoints(glowSmall, 2.6);
  buildGlowPoints(glowBig, 9);

  // ---- Traffic visuals: instanced bodies/cabins/wheels/lights/cones ----
  const trafficVis = buildTrafficVisuals(scene, track);
  console.info('[city] M3 built:', JSON.stringify(stats));

  const api = {
    setTunnelGlow: (f) => { tunnelAmbient.intensity = 0.9 * f; },
    update: (dt, t, bottles) => {
      // Aviation beacons: smooth ~2 s sine pulse — gradual fade, never a
      // harsh on/off timer.
      if (beaconIM.count > 0 && beaconIM.instanceColor) {
        for (let i = 0; i < beacons.length; i++) {
          const k = 0.12 + 0.88 * (0.5 + 0.5 * Math.sin(Math.PI * t + beacons[i].phase));
          beaconIM.setColorAt(i, _beaconCol.setRGB(k, k * 0.1, k * 0.1));
        }
        beaconIM.instanceColor.needsUpdate = true;
      }
      // Overpass walkers pacing across the deck.
      const { bodyIM, headIM } = overWalkers;
      for (let i = 0; i < overWalkers.length; i++) {
        const w = overWalkers[i];
        const x = -15 + (((w.off + t * w.speed) % 30) + 30) % 30;
        track.toWorld(OVER_S, x, DECK_TOP + 0.62, _p);
        _e.set(0, w.yaw, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        bodyIM.setMatrixAt(i, _m);
        track.toWorld(OVER_S, x, DECK_TOP + 1.42, _p);
        _m.compose(_p, _q, _s);
        headIM.setMatrixAt(i, _m);
      }
      bodyIM.instanceMatrix.needsUpdate = true;
      headIM.instanceMatrix.needsUpdate = true;
      // Nitro bottles: bob + slow spin while active, scale 0 when taken.
      for (let i = 0; i < bottles.length; i++) {
        const b = bottles[i];
        if (b.active) {
          track.toWorld(b.s, b.lat, 0.55 + Math.sin(t * 3 + i * 1.7) * 0.12, _p);
          _e.set(0, t * 1.5 + i, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
          _m.compose(_p, _q, _s);
          bottleBodyIM.setMatrixAt(i, _m);
          _p.y += 0.44;
          _m.compose(_p, _q, _s);
          bottleCapIM.setMatrixAt(i, _m);
        } else {
          _p.set(0, -10, 0); _q.identity(); _s.set(0, 0, 0);
          _m.compose(_p, _q, _s);
          bottleBodyIM.setMatrixAt(i, _m);
          bottleCapIM.setMatrixAt(i, _m);
        }
      }
      bottleBodyIM.instanceMatrix.needsUpdate = true;
      bottleCapIM.instanceMatrix.needsUpdate = true;
    },
    syncTraffic: (traffic) => trafficVis.sync(traffic),
    // M4 harness: building boxes near s (for camera-clip diagnosis).
    buildingsNear: (s, range) => buildings
      .filter((b) => Math.abs(b.s - s) < range)
      .map((b) => ({
        s: +b.s.toFixed(1), latC: +b.latC.toFixed(1), w: +b.w.toFixed(1),
        d: +b.d.toFixed(1), h: +b.h.toFixed(1),
        latF: +b.latF.toFixed(1), x: +b.x.toFixed(1), z: +b.z.toFixed(1),
      })),
  };
  // Initialize walkers + bottles before the first frame.
  api.update(0, 0, physics.bottles);
  return api;
}

const TRAFFIC_COLORS = [
  0x3a6ff7, 0xf7d63a, 0xb03af7, 0x3af7c8, 0xf73a5e, 0xe8ecf4,
  0x3a9ff7, 0xf78a3a, 0x7df73a, 0xf73ad1, 0x8a93a5, 0x2a4ad1,
];

// Car scale matches the M3 player car: 2.8 m wide body (70% of a 4 m lane).
function buildTrafficVisuals(scene, track) {
  const N = CFG.trafficCount + CFG.oncomingCount;
  const bodyIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.8, 0.62, 5.6),
    new THREE.MeshStandardMaterial({
      roughness: 0.45, metalness: 0.45, envMapIntensity: 1.0,
    }), N);
  const cabinIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.2, 0.55, 2.8),
    new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.4, metalness: 0.3 }), N);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelIM = new THREE.InstancedMesh(
    wheelGeo, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }), N * 4);
  // same-direction cars show red taillights; oncoming cars show white headlights
  const tailIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.6, 0.14, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }), CFG.trafficCount);
  const headIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.4, 0.16, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xd8ecff }), CFG.oncomingCount);
  // Additive headlight cones (fake volumetrics), one per car, all cars.
  const coneGeo = new THREE.ConeGeometry(1.5, 7, 12, 1, true);
  coneGeo.rotateX(-Math.PI / 2); // apex toward the car, base opening forward
  const coneIM = new THREE.InstancedMesh(
    coneGeo,
    new THREE.MeshBasicMaterial({
      color: 0xfff2cc, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }), N);
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) bodyIM.setColorAt(i, col.set(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]));
  if (bodyIM.instanceColor) bodyIM.instanceColor.needsUpdate = true;
  scene.add(bodyIM, cabinIM, wheelIM, tailIM, headIM, coneIM);

  const WHEEL_OFF = [[1.05, 1.9], [-1.05, 1.9], [1.05, -1.9], [-1.05, -1.9]];
  const put = (im, i, lx, ly, lz) => {
    _off.set(lx, ly, lz).applyQuaternion(_q).add(_p);
    _m2.compose(_off, _q, _one);
    im.setMatrixAt(i, _m2);
  };

  function sync(traffic) {
    let ti = 0, hi = 0;
    for (let i = 0; i < traffic.length; i++) {
      const c = traffic[i];
      const oncoming = c.kind !== 'same';
      track.frameAt(c.s, _f);
      // Full grade/banking alignment via the track basis; oncoming cars get
      // yaw + PI (basis rotated 180 deg about up).
      _lat2.copy(_f.lat); _tan2.copy(_f.tan);
      if (oncoming) { _lat2.negate(); _tan2.negate(); }
      _m.makeBasis(_lat2, _f.up, _tan2);
      _q.setFromRotationMatrix(_m);
      _p.copy(_f.pos).addScaledVector(_f.lat, c.lane);
      put(bodyIM, i, 0, 0.46, 0);
      put(cabinIM, i, 0, 1.02, -0.3);
      WHEEL_OFF.forEach((w, k) => put(wheelIM, i * 4 + k, w[0], 0.42, w[1]));
      put(coneIM, i, 0, 0.55, 6.3);
      if (oncoming) put(headIM, hi++, 0, 0.55, 2.82);
      else put(tailIM, ti++, 0, 0.55, -2.82);
    }
    for (const im of [bodyIM, cabinIM, wheelIM, tailIM, headIM, coneIM])
      im.instanceMatrix.needsUpdate = true;
  }
  return { sync };
}
