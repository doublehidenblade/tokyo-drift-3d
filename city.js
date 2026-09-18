// Night-city scene, Milestone 2: dense vibrant neon city, lit tunnel,
// median-divided highway with two-way traffic, overpass with pedestrians,
// power poles with sagging wires, trees, directional gantries, wet asphalt.
// All art is procedural (canvas textures, low-poly meshes) — placeholder,
// never designer-drawn.
import * as THREE from 'three';
import { CFG } from './config.js';
import {
  mulberry32, makeWindowTexture, makeGlassTexture, makeRoadTexture,
  makeGantryTexture, makeSignTexture, makeBoardTexture, makeDirPanelTexture,
  makeTunnelTexture, makeGlowTexture, makeWetStreakTexture, makeEnvTexture,
} from './textures.js';

const SIGN_WORDS = [
  ['24H', '#7df9ff'], ['酒', '#ff5fa2'], ['NEON', '#ff9f43'], ['喫茶', '#b6ffe0'],
  ['DRIFT', '#ff5fa2'], ['夜', '#7df9ff'], ['RAMEN', '#ffd27a'], ['東京', '#c4b5fd'],
  ['カラオケ', '#ff8a5c'], ['BAR', '#b6ffe0'], ['寿司', '#ffd27a'], ['GAME', '#7df9ff'],
];

const DIR_PANELS = [
  [['銀座', 'GINZA →'], ['東京', 'TOKYO']],
  [['← 羽田', 'HANEDA'], ['新宿', 'SHINJUKU →']],
  [['渋谷', 'SHIBUYA →'], ['← 横浜', 'YOKOHAMA']],
  [['秋葉原', 'AKIHABARA'], ['お台場', 'ODAIBA →']],
  [['← 品川', 'SHINAGAWA'], ['新橋', 'SHIMBASHI →']],
];

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

function composeInst(im, i, x, y, z, ry, sx, sy, sz) {
  _p.set(x, y, z); _e.set(0, ry, 0); _q.setFromEuler(_e); _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  im.setMatrixAt(i, _m);
}

export function buildCity(scene, physics) {
  const rnd = mulberry32(20260917);
  const L = CFG.trackLength;
  const T0 = CFG.tunnelStart, T1 = CFG.tunnelEnd;
  const inTunnelZ = (z, margin) => z > T0 - margin && z < T1 + margin;

  // ---- Lighting / atmosphere ----
  scene.add(new THREE.HemisphereLight(0x2a3a5f, 0x05060a, 0.6));
  const dir = new THREE.DirectionalLight(0x8fb4ff, 0.4);
  dir.position.set(-120, 200, -80);
  scene.add(dir);
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x070a14, 110, 640);
  // Procedural night env map: gives metal/glass something neon to reflect.
  scene.environment = makeEnvTexture();
  // Tunnel-only ambient boost, driven per-frame by main.js (never pitch black).
  const tunnelAmbient = new THREE.AmbientLight(0xaac4ff, 0);
  scene.add(tunnelAmbient);

  // ---- Ground skirt ----
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(900, L + 600),
    new THREE.MeshBasicMaterial({ color: 0x04050a })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(0, -0.08, L / 2);
  scene.add(skirt);

  // ---- Road: wet reflective asphalt, emissive lane markers ----
  const roadTex = makeRoadTexture();
  roadTex.repeat.set(1, (L + 200) / 24);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(30, L + 200),
    new THREE.MeshStandardMaterial({
      map: roadTex, emissiveMap: roadTex, emissive: 0x9db8ff, emissiveIntensity: 0.22,
      roughness: 0.38, metalness: 0.5, envMapIntensity: 1.1,
    })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, L / 2);
  scene.add(road);
  // Wet streak overlay: additive fake reflections.
  const wetTex = makeWetStreakTexture();
  wetTex.repeat.set(1, (L + 200) / 24);
  const wet = new THREE.Mesh(
    new THREE.PlaneGeometry(30, L + 200),
    new THREE.MeshBasicMaterial({
      map: wetTex, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.set(0, 0.02, L / 2);
  scene.add(wet);

  // ---- Median barrier (divides same-direction / oncoming traffic) ----
  {
    const segs = Math.ceil((L + 200) / 6);
    const baseIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.5, 1.0, 6),
      new THREE.MeshStandardMaterial({ color: 0x565c68, roughness: 0.8 }), segs);
    const stripIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.54, 0.1, 6),
      new THREE.MeshBasicMaterial({ color: 0xbfe0ff }), segs);
    for (let i = 0; i < segs; i++) {
      const z = -100 + i * 6 + 3;
      composeInst(baseIM, i, 0, 0.5, z, 0, 1, 1, 1);
      composeInst(stripIM, i, 0, 1.03, z, 0, 1, 1, 1);
    }
    baseIM.instanceMatrix.needsUpdate = true;
    stripIM.instanceMatrix.needsUpdate = true;
    scene.add(baseIM, stripIM);
    physics.addStaticBox(0.3, 0.55, L / 2 + 100, 0, 0.55, L / 2, 'barrier');
  }

  // ---- Curb visuals + reflective guardrails ----
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(1.5, CFG.curbTopY, L + 200), curbMat);
    curb.position.set(s * CFG.curbX, CFG.curbTopY / 2, L / 2);
    scene.add(curb);
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.02, L + 200),
      new THREE.MeshBasicMaterial({ color: s < 0 ? 0xcfe0ff : 0xff5040 })
    );
    strip.position.set(s * (CFG.curbX - 0.55), CFG.curbTopY + 0.012, L / 2);
    scene.add(strip);
    // guardrail: reflective metal rail on posts
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.32, L + 200),
      new THREE.MeshStandardMaterial({
        color: 0x9aa4b5, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.2,
      })
    );
    rail.position.set(s * 14.15, 0.78, L / 2);
    scene.add(rail);
  }
  {
    const n = Math.ceil((L + 200) / 6);
    const postIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.12, 0.8, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.8 }), n * 2);
    let i = 0;
    for (let k = 0; k < n; k++) for (const s of [-1, 1])
      composeInst(postIM, i++, s * 14.15, 0.4, -100 + k * 6 + 3, 0, 1, 1, 1);
    postIM.instanceMatrix.needsUpdate = true;
    scene.add(postIM);
  }

  // ---- Buildings: 6 variants (4 lit-window + 2 reflective glass), denser ----
  const variants = [];
  for (let v = 0; v < 4; v++) {
    const tex = makeWindowTexture(v, 1000 + v);
    variants.push({
      mat: new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.95,
        roughness: 0.9, metalness: 0.05, envMapIntensity: 0.5,
      }), list: [],
    });
  }
  for (let v = 0; v < 2; v++) {
    const tex = makeGlassTexture(5000 + v);
    variants.push({
      mat: new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55,
        roughness: 0.3, metalness: 0.75, envMapIntensity: 1.5,
      }), list: [],
    });
  }
  const buildings = [];
  for (const side of [-1, 1]) {
    let z = -50;
    while (z < L + 60) {
      const tower = rnd() < 0.3;
      const w = 8 + rnd() * 12, d = 8 + rnd() * 12;
      const h = tower ? 35 + rnd() * 35 : 8 + rnd() * 24;
      // Keep the whole building (and its collider) clear of the tunnel
      // tube: inner face must stay outside the tunnel's outer wall (15.5).
      const x = side * (16 + w / 2 + rnd() * 40);
      const b = { x, z: z + d / 2, w, d, h, side };
      buildings.push(b);
      const vi = tower && rnd() < 0.6 ? 4 + ((rnd() * 2) | 0) : (rnd() * 4) | 0;
      variants[vi].list.push(b);
      physics.addStaticBox(w / 2, h / 2, d / 2, x, h / 2, b.z, 'building');
      z += d + 3 + rnd() * 7;
    }
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const v of variants) {
    const im = new THREE.InstancedMesh(boxGeo, v.mat, v.list.length);
    v.list.forEach((b, i) => composeInst(im, i, b.x, b.h / 2, b.z, 0, b.w, b.h, b.d));
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  }

  // ---- Glow points collector (cheap fake bloom, one draw call per size) ----
  const glowSmall = { pos: [], col: [] }; // lamps, signs, sconces
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

  // ---- Neon signs, physically mounted on building facades facing the road ----
  // Vertical signs: one InstancedMesh per word/color (shared material).
  const vFaceIMs = SIGN_WORDS.map(([word, color]) => {
    const im = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(word, color) }),
      90
    );
    im.count = 0;
    scene.add(im);
    return im;
  });
  const vBackIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.8 }), 90);
  vBackIM.count = 0;
  scene.add(vBackIM);
  // Horizontal boards: one InstancedMesh per word/color.
  const bFaceIMs = SIGN_WORDS.map(([word, color]) => {
    const im = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: makeBoardTexture(word, color) }),
      60
    );
    im.count = 0;
    scene.add(im);
    return im;
  });
  const bBackIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.8 }), 60);
  bBackIM.count = 0;
  scene.add(bBackIM);

  let vPlaced = 0, bPlaced = 0;
  for (const b of buildings) {
    const faceX = b.x - b.side * (b.w / 2 + 0.18);
    const ry = b.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    if (vPlaced < 88 && rnd() < 0.30) {
      const wi = (rnd() * SIGN_WORDS.length) | 0;
      const [, color] = SIGN_WORDS[wi];
      const sw = 1.4, sh = 3.5 + rnd() * 4;
      const y = 5 + rnd() * Math.max(2, b.h - 12);
      composeInst(vBackIM, vBackIM.count++, faceX, y, b.z, 0, 0.24, sh, sw);
      const im = vFaceIMs[wi];
      if (im.count < 90) {
        composeInst(im, im.count++, faceX - b.side * 0.14, y, b.z, ry, sw * 0.92, sh * 0.94, 1);
        addGlow(glowSmall, faceX - b.side * 0.5, y, b.z, color);
      }
      vPlaced++;
    } else if (bPlaced < 58 && rnd() < 0.20) {
      const wi = (rnd() * SIGN_WORDS.length) | 0;
      const [, color] = SIGN_WORDS[wi];
      const bw = 4 + rnd() * 4, bh = 1.3;
      const y = 3 + rnd() * Math.max(2, Math.min(b.h - 6, 14));
      composeInst(bBackIM, bBackIM.count++, faceX, y, b.z, 0, 0.24, bh + 0.2, bw + 0.2);
      const im = bFaceIMs[wi];
      if (im.count < 60) {
        composeInst(im, im.count++, faceX - b.side * 0.14, y, b.z, ry, bw, bh, 1);
        addGlow(glowSmall, faceX - b.side * 0.5, y, b.z, color);
      }
      bPlaced++;
    }
  }
  for (const im of [...vFaceIMs, ...bFaceIMs, vBackIM, bBackIM]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.count === 0) im.visible = false;
  }

  // ---- Street lamps: instanced poles + emissive heads + glow (skip tunnel) ----
  {
    const zs = [];
    for (let z = -20; z < L + 40; z += 30) if (!inTunnelZ(z, 25)) zs.push(z);
    const n = zs.length * 2;
    const poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.09, 0.12, 7.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.8 }), n);
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.28, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0 }), n);
    let i = 0;
    zs.forEach((z, k) => {
      for (const s of [-1, 1]) {
        const x = s * 14.6;
        composeInst(poles, i, x, 3.6, z, 0, 1, 1, 1);
        composeInst(heads, i, x - s * 0.9, 7.15, z, 0, 1, 1, 1);
        addGlow(glowSmall, x - s * 0.9, 7.15, z, 0xffd9a0);
        i++;
      }
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    scene.add(poles, heads);
  }

  // ---- Power/telephone poles + sagging catenary wires (right side, skip tunnel) ----
  {
    const px = 17.2, zs = [];
    for (let z = -40; z < L + 40; z += 40) if (!inTunnelZ(z, 45)) zs.push(z);
    const poleIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.14, 0.18, 9, 6),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.85 }), zs.length);
    const armIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.7, 0.12, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.85 }), zs.length);
    zs.forEach((z, i) => {
      composeInst(poleIM, i, px, 4.5, z, 0, 1, 1, 1);
      composeInst(armIM, i, px, 8.2, z, 0, 1, 1, 1);
    });
    poleIM.instanceMatrix.needsUpdate = true;
    armIM.instanceMatrix.needsUpdate = true;
    scene.add(poleIM, armIM);
    // Sagging wires between consecutive pole tops (skip spans crossing the tunnel).
    const pts = [];
    for (let i = 0; i + 1 < zs.length; i++) {
      const z0 = zs[i], z1 = zs[i + 1];
      if (z1 - z0 > 60) continue; // gap where tunnel poles were skipped
      for (const off of [-0.7, 0.7]) {
        const SEG = 8, sag = 1.3;
        for (let k = 0; k < SEG; k++) {
          const t0 = k / SEG, t1 = (k + 1) / SEG;
          const y = (t) => 8.2 - sag * 4 * t * (1 - t);
          pts.push(px + off, y(t0), z0 + (z1 - z0) * t0, px + off, y(t1), z0 + (z1 - z0) * t1);
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a4a5f })));
  }

  // ---- Trees: instanced trunks + foliage (skip tunnel) ----
  {
    const items = [];
    for (let z = -30; z < L + 30; z += 24 + rnd() * 14) {
      if (inTunnelZ(z, 25)) continue;
      for (const s of [-1, 1]) {
        if (rnd() < 0.25) continue;
        items.push({ x: s * (15.8 + rnd() * 1.2), z: z + rnd() * 8, s: 0.8 + rnd() * 0.7 });
      }
    }
    const trunkIM = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b2119, roughness: 0.9 }), items.length);
    const folIM = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1.15, 2.8, 7),
      new THREE.MeshStandardMaterial({ color: 0x1d4a38, roughness: 0.9 }), items.length);
    const col = new THREE.Color();
    items.forEach((t, i) => {
      composeInst(trunkIM, i, t.x, 0.8 * t.s, t.z, 0, t.s, t.s, t.s);
      composeInst(folIM, i, t.x, (1.6 + 1.3) * t.s, t.z, rnd() * Math.PI, t.s, t.s, t.s);
      folIM.setColorAt(i, col.setHSL(0.38 + rnd() * 0.08, 0.45, 0.22 + rnd() * 0.1));
    });
    trunkIM.instanceMatrix.needsUpdate = true;
    folIM.instanceMatrix.needsUpdate = true;
    if (folIM.instanceColor) folIM.instanceColor.needsUpdate = true;
    scene.add(trunkIM, folIM);
  }

  // ---- Tunnel: tube the road passes through, z in [T0, T1] ----
  {
    const tunTex = makeTunnelTexture();
    tunTex.repeat.set(24, 1);
    const wallMat = new THREE.MeshStandardMaterial({
      map: tunTex, roughness: 0.85, metalness: 0.05,
    });
    const tz = (T0 + T1) / 2, tlen = T1 - T0;
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 8.5, tlen), wallMat);
      wall.position.set(s * (CFG.tunnelHalfW + 0.5), 4.25, tz);
      scene.add(wall);
      physics.addStaticBox(0.5, 4.25, tlen / 2, s * (CFG.tunnelHalfW + 0.5), 4.25, tz, 'building');
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(2 * CFG.tunnelHalfW + 2, 0.8, tlen), wallMat);
    ceil.position.set(0, CFG.tunnelH + 0.4, tz);
    scene.add(ceil);
    // Emissive ceiling light strips (the tunnel is never dark).
    const stripMat = new THREE.MeshBasicMaterial({ color: 0xd8f4ff });
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.1, tlen), stripMat);
      strip.position.set(s * 4, CFG.tunnelH - 0.05, tz);
      scene.add(strip);
    }
    // Wall sconces: instanced emissive boxes + glow.
    const nS = Math.floor(tlen / 20);
    const scIM = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.25, 0.6, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffb35c }), nS * 2);
    let si = 0;
    for (let k = 0; k < nS; k++) {
      const z = T0 + 10 + k * 20;
      for (const s of [-1, 1]) {
        composeInst(scIM, si++, s * (CFG.tunnelHalfW - 0.2), 3.4, z, 0, 1, 1, 1);
        addGlow(glowSmall, s * (CFG.tunnelHalfW - 0.6), 3.4, z, 0xffb35c);
      }
    }
    scIM.instanceMatrix.needsUpdate = true;
    scene.add(scIM);
    // A few real point lights so standard materials inside aren't flat.
    const plZ = [T0 + 60, T0 + 140, T0 + 220, T1 - 20];
    plZ.forEach((z, i) => {
      const pl = new THREE.PointLight(0x9fd0ff, 500, 75, 1.8);
      pl.position.set(i % 2 ? -6 : 6, 6.2, z);
      scene.add(pl);
    });
    // Glowing portal frames at entrance/exit.
    const portal = (z, color) => {
      const m = new THREE.MeshBasicMaterial({ color });
      const w = 2 * CFG.tunnelHalfW + 2;
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(1, 9.4, 1.2), m);
        side.position.set(s * (w / 2 - 0.5), 4.7, z);
        scene.add(side);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, 1.2), m);
      top.position.set(0, 9.0, z);
      scene.add(top);
      for (let k = 0; k < 10; k++)
        addGlow(glowBig, (rnd() - 0.5) * (w - 2), 1 + rnd() * 7, z, color);
    };
    portal(T0, 0x35f2ff); // cyan entrance
    portal(T1, 0xff9f43); // orange exit
  }

  // ---- Pedestrian overpass at z=420 + walking peds (never on the roadway) ----
  const pedWalkers = [];
  {
    const oz = 420, deckY = 5.6;
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.8 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(34, 0.4, 3), deckMat);
    deck.position.set(0, deckY, oz);
    scene.add(deck);
    const railM = new THREE.MeshStandardMaterial({ color: 0x8a93a5, roughness: 0.4, metalness: 0.7 });
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(34, 0.9, 0.08), railM);
      r.position.set(0, deckY + 0.65, oz + s * 1.45);
      scene.add(r);
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.8, deckY, 0.8), deckMat);
      col.position.set(s * 16.2, deckY / 2, oz);
      scene.add(col);
      physics.addStaticBox(0.4, deckY / 2, 0.4, s * 16.2, deckY / 2, oz, 'building');
    }
    // Walkers pace back and forth across the deck.
    const NW = 14;
    const bodyIM = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.22, 0.75, 3, 8),
      new THREE.MeshStandardMaterial({ roughness: 0.85 }), NW);
    const headIM = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9a98c, roughness: 0.7 }), NW);
    const col = new THREE.Color();
    for (let i = 0; i < NW; i++) {
      const p = {
        off: rnd() * 30, speed: (0.7 + rnd() * 0.7) * (rnd() < 0.5 ? 1 : -1),
        y: deckY + 0.2,
      };
      pedWalkers.push(p);
      bodyIM.setColorAt(i, col.setHSL(rnd(), 0.5, 0.35 + rnd() * 0.2));
    }
    if (bodyIM.instanceColor) bodyIM.instanceColor.needsUpdate = true;
    scene.add(bodyIM, headIM);
    pedWalkers.bodyIM = bodyIM;
    pedWalkers.headIM = headIM;
    // Static sidewalk peds (both sides, skip tunnel).
    const NS = 52;
    const sBodyIM = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.22, 0.75, 3, 8),
      new THREE.MeshStandardMaterial({ roughness: 0.85 }), NS);
    const sHeadIM = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xd9a98c, roughness: 0.7 }), NS);
    for (let i = 0; i < NS; i++) {
      const s = i % 2 ? 1 : -1;
      let z = rnd() * L;
      if (inTunnelZ(z, 20)) z = (T1 + 40 + rnd() * 200) % L;
      const x = s * (15.3 + rnd() * 1.6);
      composeInst(sBodyIM, i, x, 0.85, z, rnd() * Math.PI * 2, 1, 0.92 + rnd() * 0.16, 1);
      sHeadIM.setColorAt(i, col.setHSL(rnd(), 0.5, 0.35 + rnd() * 0.2));
      _p.set(x, 1.62, z); _q.identity(); _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      sHeadIM.setMatrixAt(i, _m);
    }
    sBodyIM.instanceMatrix.needsUpdate = true;
    sHeadIM.instanceMatrix.needsUpdate = true;
    if (sBodyIM.instanceColor) sBodyIM.instanceColor.needsUpdate = true;
    scene.add(sBodyIM, sHeadIM);
  }

  // ---- Directional gantries OVER the road (panels bolted to the beam) ----
  DIR_PANELS.forEach(([p1, p2], gi) => {
    const z = [500, 1050, 1450, 2100, 2800][gi];
    const grp = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x39404e, roughness: 0.6, metalness: 0.5 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.8, 0.6), postMat);
      post.position.set(s * 13.9, 3.9, z);
      grp.add(post);
      physics.addStaticBox(0.3, 3.9, 0.3, s * 13.9, 3.9, z, 'building');
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(28.4, 0.9, 0.6), postMat);
    beam.position.set(0, 7.35, z);
    grp.add(beam);
    [p1, p2].forEach(([l1, l2], pi) => {
      const tex = makeDirPanelTexture(l1, l2);
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(5.6, 1.4),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      );
      panel.position.set(pi === 0 ? -3.2 : 3.2, 6.35, z);
      grp.add(panel);
      addGlow(glowSmall, panel.position.x, 6.35, z - 0.4, 0x7dff9e);
    });
    scene.add(grp);
  });

  // ---- Start gantry at z = 0 (kept from M1; posts now collide) ----
  {
    const gantry = new THREE.Group();
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.6, metalness: 0.3 });
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), postMat);
      post.position.set(s * 10.5, 4, 0);
      gantry.add(post);
      physics.addStaticBox(0.35, 4, 0.35, s * 10.5, 4, 0, 'building');
    }
    const bannerTex = makeGantryTexture();
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(22, 1.7, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.7 })
    );
    beam.position.set(0, 7.4, 0);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(21.4, 1.6),
      new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
    );
    banner.position.set(0, 7.4, 0.26);
    const banner2 = banner.clone();
    banner2.rotation.y = Math.PI;
    banner2.position.z = -0.26;
    gantry.add(beam, banner, banner2);
    scene.add(gantry);
  }

  // ---- Stars + moon ----
  {
    const n = 700, pos = new Float32Array(n * 3);
    const sr = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const th = sr() * Math.PI * 2, ph = sr() * Math.PI * 0.42;
      const r = 950;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      pos[i * 3 + 1] = 60 + Math.sin(ph) * r * 0.6;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r + 600;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaFC4e8, size: 1.6, sizeAttenuation: false })));
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
    );
    moon.position.set(-260, 260, 1100);
    moon.lookAt(0, 0, 0);
    scene.add(moon);
  }

  // ---- Static glow points (one draw call per size class) ----
  buildGlowPoints(glowSmall, 2.6);
  buildGlowPoints(glowBig, 9);

  // ---- Traffic visuals: instanced bodies/cabins/wheels/lights ----
  const trafficVis = buildTrafficVisuals(scene);

  return {
    setTunnelGlow: (f) => { tunnelAmbient.intensity = 0.9 * f; },
    update: (dt, t) => {
      // Pedestrians pacing across the overpass deck.
      const { bodyIM, headIM } = pedWalkers;
      for (let i = 0; i < pedWalkers.length; i++) {
        const p = pedWalkers[i];
        let x = -15 + ((p.off + t * p.speed) % 30 + 30) % 30;
        _p.set(x, p.y + 0.62, 420); _q.identity(); _s.set(1, 1, 1);
        _m.compose(_p, _q, _s);
        bodyIM.setMatrixAt(i, _m);
        _p.y = p.y + 1.42;
        _m.compose(_p, _q, _s);
        headIM.setMatrixAt(i, _m);
      }
      bodyIM.instanceMatrix.needsUpdate = true;
      headIM.instanceMatrix.needsUpdate = true;
    },
    syncTraffic: (traffic) => trafficVis.sync(traffic),
  };
}

const TRAFFIC_COLORS = [
  0x3a6ff7, 0xf7d63a, 0xb03af7, 0x3af7c8, 0xf73a5e, 0xe8ecf4,
  0x3a9ff7, 0xf78a3a, 0x7df73a, 0xf73ad1, 0x8a93a5, 0x2a4ad1,
];

function buildTrafficVisuals(scene) {
  const N = CFG.trafficCount + CFG.oncomingCount;
  const bodyIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.9, 0.62, 4.4),
    new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.45, envMapIntensity: 1.0 }), N);
  const cabinIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.6, 0.5, 2.0),
    new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.4, metalness: 0.3 }), N);
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelIM = new THREE.InstancedMesh(
    wheelGeo, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }), N * 4);
  // same-direction cars show red taillights; oncoming cars show white headlights
  const tailIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.7, 0.14, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a }), CFG.trafficCount);
  const headIM = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 0.16, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xd8ecff }), CFG.oncomingCount);
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) bodyIM.setColorAt(i, col.set(TRAFFIC_COLORS[i % TRAFFIC_COLORS.length]));
  if (bodyIM.instanceColor) bodyIM.instanceColor.needsUpdate = true;
  scene.add(bodyIM, cabinIM, wheelIM, tailIM, headIM);

  const WHEEL_OFF = [[0.85, 1.45], [-0.85, 1.45], [0.85, -1.45], [-0.85, -1.45]];
  const off = new THREE.Vector3();

  function sync(traffic) {
    let ti = 0, hi = 0;
    for (let i = 0; i < traffic.length; i++) {
      const c = traffic[i];
      const t = c.body.translation();
      const yaw = c.kind === 'same' ? 0 : Math.PI;
      _p.set(t.x, 0, t.z); _e.set(0, yaw, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      bodyIM.setMatrixAt(i, _m);
      // cabin sits slightly toward the rear for same-dir cars
      off.set(0, 1.12, c.kind === 'same' ? -0.25 : 0.25).applyQuaternion(_q).add(_p);
      const m2 = new THREE.Matrix4().compose(off, _q, _s);
      cabinIM.setMatrixAt(i, m2);
      WHEEL_OFF.forEach((w, k) => {
        off.set(w[0], 0.35, w[1]).applyQuaternion(_q).add(_p);
        wheelIM.setMatrixAt(i * 4 + k, new THREE.Matrix4().compose(off, _q, _s));
      });
      if (c.kind === 'same') {
        off.set(0, 0.72, -2.21).applyQuaternion(_q).add(_p);
        tailIM.setMatrixAt(ti++, new THREE.Matrix4().compose(off, _q, _s));
      } else {
        off.set(0, 0.62, -2.71).applyQuaternion(_q).add(_p);
        headIM.setMatrixAt(hi++, new THREE.Matrix4().compose(off, _q, _s));
      }
    }
    bodyIM.instanceMatrix.needsUpdate = true;
    cabinIM.instanceMatrix.needsUpdate = true;
    wheelIM.instanceMatrix.needsUpdate = true;
    tailIM.instanceMatrix.needsUpdate = true;
    headIM.instanceMatrix.needsUpdate = true;
  }
  return { sync };
}
