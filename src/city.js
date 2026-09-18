// Tokyo Drift 3D — Milestone 6 city (world/geometry).
//
// City-first rework: the track spline is UNCHANGED; the city is planned
// around the route as independent districts (see CITY_PLAN.md):
//   start plaza / mid-rise commercial, harbor west (warehouses), the climb,
//   bay strait + suspension bridge, waterfront east, downtown neon core,
//   south ridge + tunnel, industrial edge — plus an elevated expressway and
//   an air-train loop for verticality.
//
// QA fixes in this revision:
//   B1: hills/mountains pushed far from the road with emissive lift so they
//       read as dark-blue silhouettes, never pitch-black walls.
//   B2: bridge towers/cables/truss/rails reconnected into one structure;
//       the random oversized wet-streak overlay (the flat blue boxes) is
//       deleted.
//   B3: buildings are placed by INNER EDGE (>=16 m from centerline) and a
//       build-time footprint audit THROWS if any corner enters roadHalf+2.5.
//   B4: traffic visuals fade/scale in on spawn; api.trafficFade() lets the
//       car side gate colliders on visual readiness.
//   B5: portal flare blobs deleted; concrete headwalls + mounted sign +
//       recessed edge strips.
//   B6: every reflection streak is generated from a registered light source;
//       window.__cityAudit carries lights[] + streaks[] for the harness.
//   B7: road texture — solid center line, varied lane dashes.
//
// Guard rails: geometry + Rapier colliders per physics.railSpec()
// (railLat/railThick/railHeight/segLen, tag 'rail').
//
// Everything is procedural/canvas/low-poly placeholder art — never presented
// as designer work. Static geometry is instanced; per-frame CPU work is
// limited to the train, highway dots, walkers, beacons, bottles, traffic.
import * as THREE from 'three';
import {
  mulberry32, makeRoadTexture, makeGlassTexture, makeSignTexture,
  makeBoardTexture, makeDirPanelTexture, makeTunnelTexture,
  makeStorefrontTexture, makeSidewalkTexture, makeAwningTexture,
  makeWindowTexture, makeGantryTexture, makeStartLineTexture,
  makeConcreteTexture, makeGlowTexture, makeEnvTexture,
} from './textures.js';
import { buildTrafficCarMesh } from './car.js';

const UP = new THREE.Vector3(0, 1, 0);

export function buildCity(scene, physics, track) {
  const rnd = mulberry32(20260918);
  const L = track.length;
  const TUN = track.tunnel, BR = track.bridge;
  const roadHalf = 12;
  const inTun = (s, m) => s > TUN.s0 - m && s < TUN.s1 + m;
  const inBridge = (s, m) => s > BR.s0 - m && s < BR.s1 + m;
  // The Bay — see CITY_PLAN.md. The bridge spans its mouth; the far north
  // shore holds the port.
  const BAY = { x0: 500, x1: 1180, z0: 1000, z1: 2260, y: -5 };
  const inBay = (x, z, m) => x > BAY.x0 - m && x < BAY.x1 + m && z > BAY.z0 - m && z < BAY.z1 + m;
  const yawFromTan = (tan) => Math.atan2(tan.x, tan.z);
  const wrapDelta = (d) => {
    d = d % L;
    if (d < -L / 2) d += L;
    if (d > L / 2) d -= L;
    return d;
  };

  // ---------------------------------------------------------------- audit
  // B3: hard footprint audit (throws on violation — fails the build).
  // B6: every reflection streak traces to a registered light source.
  const audit = {
    buildings: { count: 0, violations: [] },
    lights: { count: 0 },
    streaks: { count: 0, violations: [] },
    bridge: {},
    rails: { colliderCount: 0, skippedTunnel: true },
    traffic: { count: 0 },
  };
  const lightReg = [];  // {x, y, z, color} — every visible light source
  const regLight = (x, y, z, color) => {
    lightReg.push({ x, y, z, color });
    return lightReg.length - 1;
  };
  const streaks = [];   // {x,y,z,yaw,w,l,color,raw,light} — generated ONLY here
  function roadStreak(s, lat, li, len, wid, alpha) {
    const cl = Math.max(-roadHalf + 1.5, Math.min(roadHalf - 1.5, lat));
    const p = track.toWorld(s, cl, 0.06);
    const f = track.frameAt(s);
    streaks.push({
      x: p.x, y: p.y, z: p.z, yaw: yawFromTan(f.tan), w: wid, l: len,
      color: new THREE.Color(lightReg[li].color).multiplyScalar(alpha),
      raw: lightReg[li].color, light: li,
    });
  }
  function waterStreak(x, z, li, len, wid, alpha, yaw) {
    streaks.push({
      x, y: BAY.y + 0.06, z, yaw: yaw || 0, w: wid, l: len,
      color: new THREE.Color(lightReg[li].color).multiplyScalar(alpha),
      raw: lightReg[li].color, light: li,
    });
  }

  // -------------------------------------------------------------- helpers
  function instIM(geo, mat, n) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.count = n;
    im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    return im;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function composeInst(im, i, x, y, z, yaw, sx, sy, sz, pitch, roll) {
    _e.set(pitch || 0, yaw || 0, roll || 0);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz);
    _m.compose(_p, _q, _s);
    im.setMatrixAt(i, _m);
  }
  const label = (obj, asset) => { obj.userData.asset = asset; return obj; };
  // Box beam stretched between two points (bridge bracing, crane parts).
  function beamBetween(p1, p2, thick, mat, asset) {
    const d = new THREE.Vector3().subVectors(p2, p1);
    const len = d.length();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(thick, thick, len), mat);
    mesh.position.copy(p1).addScaledVector(d, 0.5);
    mesh.lookAt(p2);
    if (asset) label(mesh, asset);
    scene.add(mesh);
    return mesh;
  }
  const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color }, o));
  const basic = (color, o) => new THREE.MeshBasicMaterial(Object.assign({ color }, o));

  // ------------------------------------------------------------ atmosphere
  scene.add(new THREE.HemisphereLight(0x2e4a6e, 0x05060a, 0.65));
  const dir = new THREE.DirectionalLight(0x8fb4ff, 0.4);
  dir.position.set(-300, 500, 200);
  scene.add(dir);
  scene.background = new THREE.Color(0x070a18);
  // Procedural night environment map: car paint/glass (MeshPhysicalMaterial
  // in car.js) and water pick up city-light reflections from this.
  scene.environment = makeEnvTexture();
  scene.fog = new THREE.FogExp2(0x0d1233, 0.0011);
  // Tunnel-only fill so the tube is never pitch black (driven by main.js).
  const tunnelAmbient = new THREE.AmbientLight(0xaac4ff, 0);
  scene.add(tunnelAmbient);

  // ---------------------------------------------------------------- ground
  {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(5200, 5200),
      std(0x05070d, { roughness: 1, metalness: 0 })
    );
    g.geometry.rotateX(-Math.PI / 2);
    g.position.set(650, -8, 550);
    label(g, 'ground');
    scene.add(g);
  }

  // ----------------------------------------------------------------- bay
  // Open water with a quay wall on the far (north) shore. Reflection
  // streaks on the water are generated ONLY under registered lights (B6).
  {
    const g = new THREE.PlaneGeometry(1260, 680);
    g.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(g, std(0x06121e, {
      roughness: 0.12, metalness: 0.85, envMapIntensity: 1.3,
    }));
    water.rotation.y = Math.PI / 2; // -> x span 680, z span 1260
    water.position.set(840, BAY.y, 1630);
    label(water, 'water-bay');
    scene.add(water);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(760, 9, 14), std(0x11141c, { roughness: 0.9 }));
    quay.position.set(840, -3.5, BAY.z1 + 7);
    label(quay, 'quay-wall');
    scene.add(quay);
    // port cranes (procedural silhouettes) with orange beacons
    const craneMat = std(0x141a26, {
      roughness: 0.7, metalness: 0.4, emissive: 0x0a1420, emissiveIntensity: 0.4,
    });
    const beaconIM = instIM(new THREE.SphereGeometry(0.5, 8, 8), basic(0xff9a2a), 4);
    label(beaconIM, 'port-crane-beacon');
    let bi = 0;
    for (const cx of [620, 750, 900, 1040]) {
      const cz = BAY.z1 + 42;
      const mk = (w, h, d, x, y, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), craneMat);
        m.position.set(x, y, z);
        label(m, 'port-crane');
        scene.add(m);
      };
      mk(2.5, 34, 2.5, cx - 7, 10, cz);
      mk(2.5, 34, 2.5, cx + 7, 10, cz);
      mk(20, 2.5, 3, cx, 28, cz);
      mk(2, 2, 46, cx, 30, cz - 20);
      mk(4, 3.5, 4, cx, 25, cz - 6);
      composeInst(beaconIM, bi, cx, 33.5, cz - 40, 0);
      regLight(cx, 33.5, cz - 40, 0xff9a2a);
      bi++;
    }
    scene.add(beaconIM);
    // far industrial skyline silhouettes (emissive lift — never black, B1)
    const farIM = instIM(new THREE.BoxGeometry(1, 1, 1),
      std(0x0b1220, { roughness: 0.9, emissive: 0x0a1626, emissiveIntensity: 0.5 }), 12);
    label(farIM, 'building-industrial-far');
    for (let i = 0; i < 12; i++) {
      const w = 26 + rnd() * 40, h = 14 + rnd() * 26, d = 20 + rnd() * 20;
      composeInst(farIM, i, 560 + i * 48 + rnd() * 20, h / 2 - 8, BAY.z1 + 90 + rnd() * 80,
        rnd() * 0.4, w, h, d);
    }
    scene.add(farIM);
  }

  // -------------------------------------------------- hills & mountains
  // B1: kept FAR from the road (>=150 m hills / >=300 m mountains) with an
  // emissive lift so they read as dark-blue silhouettes, never black walls.
  function trackDist(x, z) {
    let m = Infinity;
    for (let i = 0; i < track.N; i += 8) {
      const p = track.pos[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  }
  {
    const hillMat = std(0x0a1410, {
      roughness: 1, flatShading: true, emissive: 0x0c1e18, emissiveIntensity: 0.55,
    });
    const hillIM = instIM(new THREE.IcosahedronGeometry(1, 1), hillMat, 40);
    label(hillIM, 'hill');
    let hi = 0, guard = 0;
    while (hi < 40 && guard++ < 800) {
      const x = -600 + rnd() * 2400, z = -700 + rnd() * 2500;
      if (trackDist(x, z) < 150 || inBay(x, z, 30)) continue;
      const r = 60 + rnd() * 130;
      composeInst(hillIM, hi++, x, -8 + r * 0.10, z, rnd() * 6.28, r, r * 0.32, r);
    }
    hillIM.count = hi;
    scene.add(hillIM);
    const mtnMat = std(0x0a1220, {
      roughness: 1, flatShading: true, emissive: 0x0a1626, emissiveIntensity: 0.5,
    });
    const mtnIM = instIM(new THREE.ConeGeometry(1, 1, 5), mtnMat, 14);
    label(mtnIM, 'mountain');
    let mi = 0; guard = 0;
    while (mi < 14 && guard++ < 400) {
      const a = rnd() * Math.PI * 2, rr = 950 + rnd() * 400;
      const x = 650 + Math.cos(a) * rr, z = 550 + Math.sin(a) * rr;
      if (trackDist(x, z) < 300) continue;
      composeInst(mtnIM, mi++, x, -8, z, rnd() * 6.28,
        190 + rnd() * 130, 170 + rnd() * 110, 190 + rnd() * 130);
    }
    mtnIM.count = mi;
    scene.add(mtnIM);
  }

  // ------------------------------------------------------- stars and moon
  {
    const n = 700, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, e = 0.08 + rnd() * 1.4, r = 1600;
      pos[i * 3] = 650 + Math.cos(a) * Math.cos(e) * r;
      pos[i * 3 + 1] = Math.sin(e) * r;
      pos[i * 3 + 2] = 550 + Math.sin(a) * Math.cos(e) * r;
      const c = 0.35 + rnd() * 0.65, tint = rnd();
      col[i * 3] = c * (tint < 0.2 ? 1 : 0.85);
      col[i * 3 + 1] = c * 0.9;
      col[i * 3 + 2] = c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.4, vertexColors: true, sizeAttenuation: false, fog: false,
      transparent: true, opacity: 0.85, depthWrite: false,
    }));
    label(stars, 'stars');
    scene.add(stars);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(46, 24), basic(0xe8f1ff, { fog: false }));
    moon.position.set(-500, 900, -700);
    moon.lookAt(650, 0, 550);
    label(moon, 'moon');
    scene.add(moon);
  }

  // ------------------------------------------------------------------ road
  // B7: solid center line + varied lane dashes (texture rewritten in M6).
  // A single merged ribbon (one draw call); uv v = s/24 matches the 24 m
  // texture tile.
  {
    const SEG = track.N * 4, segLen = L / SEG;
    const verts = new Float32Array(SEG * 2 * 3);
    const norms = new Float32Array(SEG * 2 * 3);
    const uvs = new Float32Array(SEG * 2 * 2);
    const idx = [];
    const f = {};
    for (let k = 0; k < SEG; k++) {
      const s = k * segLen;
      track.frameAt(s, f);
      for (let e = 0; e < 2; e++) {
        const lat = e === 0 ? -15 : 15;
        const px = f.pos.x + f.lat.x * lat, py = f.pos.y + f.lat.y * lat, pz = f.pos.z + f.lat.z * lat;
        const vi = (k * 2 + e) * 3;
        verts[vi] = px; verts[vi + 1] = py + 0.02; verts[vi + 2] = pz;
        norms[vi] = f.up.x; norms[vi + 1] = f.up.y; norms[vi + 2] = f.up.z;
        const ui = (k * 2 + e) * 2;
        uvs[ui] = e; uvs[ui + 1] = s / 24;
      }
      const k2 = (k + 1) % SEG;
      const a = k * 2, b = k * 2 + 1, c = k2 * 2, d = k2 * 2 + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
    const road = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
      map: makeRoadTexture(), roughness: 0.55, metalness: 0.25,
      envMapIntensity: 0.7,
    }));
    label(road, 'road');
    scene.add(road);
  }

  // ----------------------------------------------------------------- curbs
  {
    const per = Math.ceil(L / 3);
    const curbIM = instIM(new THREE.BoxGeometry(1.5, 0.3, 3.3),
      std(0xffffff, { roughness: 0.8 }), per * 2);
    label(curbIM, 'curb');
    let ci = 0;
    for (let s = 0; s < L; s += 3) {
      for (const side of [-1, 1]) {
        if (inTun(s + 1.5, 0)) continue;
        const p = track.toWorld(s + 1.5, side * 12.75, 0.15);
        const f = track.frameAt(s + 1.5);
        composeInst(curbIM, ci, p.x, p.y, p.z, yawFromTan(f.tan));
        curbIM.setColorAt(ci, new THREE.Color(((s / 3) | 0) % 2 ? 0xd23b3b : 0xe8e8e8));
        // collider (kept from M4/M5 scheme)
        physics.addStaticBox(0.75, 0.3, 1.65, p.x, p.y + 0.15, p.z, yawFromTan(f.tan), 'curb');
        ci++;
      }
    }
    curbIM.count = ci;
    curbIM.instanceColor.needsUpdate = true;
    scene.add(curbIM);
  }

  // ------------------------------------------------------------ guard rails
  // Geometry + Rapier colliders per physics.railSpec(): collider center =
  // toWorld(s + seg/2, +/-railLat, railHeight/2), half-extents =
  // (railThick, railHeight/2, seg/2 + 0.4), yaw = frame yaw, tag 'rail'.
  // The visual rail (posts + double bars) sits on the same centerline.
  // Skipped inside the tunnel tube (sealed concrete walls there instead);
  // physics still clamps the car to the logical rail plane every step.
  {
    const spec = physics.railSpec();
    const RL = spec.railLat, SEG = spec.segLen;
    const steel = std(0x9aa4b8, { roughness: 0.35, metalness: 0.9, envMapIntensity: 1.2 });
    const postG = new THREE.BoxGeometry(0.14, 1.0, 0.14);
    const barG = new THREE.BoxGeometry(0.1, 0.14, 6.4);
    const stepN = Math.ceil(L / 6);
    const postIM = instIM(postG, steel, stepN * 2);
    const barIM = instIM(barG, steel, stepN * 4);
    label(postIM, 'guard-rail-post');
    label(barIM, 'guard-rail-bar');
    let pi = 0, bi = 0;
    for (let s = 0; s < L; s += 6) {
      if (inTun(s + 3, 15)) continue;
      for (const side of [-1, 1]) {
        const p = track.toWorld(s + 3, side * RL, 0);
        const f = track.frameAt(s + 3);
        const yaw = yawFromTan(f.tan);
        composeInst(postIM, pi++, p.x, p.y + 0.5, p.z, yaw);
        for (const h of [0.55, 0.95]) {
          const bp = track.toWorld(s + 3, side * RL, h);
          composeInst(barIM, bi++, bp.x, bp.y, bp.z, yaw);
        }
      }
    }
    postIM.count = pi; barIM.count = bi;
    scene.add(postIM, barIM);
    for (let s = 0; s < L; s += SEG) {
      if (inTun(s + SEG / 2, 15)) continue;
      for (const side of [-1, 1]) {
        const c = track.toWorld(s + SEG / 2, side * RL, spec.railHeight / 2);
        const yaw = yawFromTan(track.frameAt(s + SEG / 2).tan);
        physics.addStaticBox(spec.railThick, spec.railHeight / 2, SEG / 2 + 0.4,
          c.x, c.y, c.z, yaw, 'rail');
        audit.rails.colliderCount++;
      }
    }
  }

  // ---------------------------------------------------------------- tunnel
  // Sealed tube (walls/ceiling/strips/sconces/point lights — kept from M5),
  // with REDESIGNED portals (B5): concrete headwalls, a sign board bolted
  // to the beam, recessed emissive edge strips. The old floating glow-blob
  // sprites are deleted.
  const TUN_HALF = 11;
  {
    const tunTex = makeTunnelTexture();
    const wallMat = std(0xffffff, { map: tunTex, roughness: 0.9 });
    const ceilMat = std(0x8a93a3, { roughness: 0.95 });
    const tLen = TUN.s1 - TUN.s0, tSeg = Math.ceil(tLen / 8);
    const wallG = new THREE.PlaneGeometry(8.6, 7);
    const wallIM = instIM(wallG, wallMat, tSeg * 2);
    label(wallIM, 'tunnel-wall');
    const ceilIM = instIM(new THREE.PlaneGeometry(22.6, 8.6), ceilMat, tSeg);
    label(ceilIM, 'tunnel-ceiling');
    let wi = 0, ci2 = 0;
    for (let k = 0; k < tSeg; k++) {
      const s = TUN.s0 + (k + 0.5) * (tLen / tSeg);
      const f = track.frameAt(s), yaw = yawFromTan(f.tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * TUN_HALF, 3.5);
        // plane faces inward: rotate so +Z faces the road
        composeInst(wallIM, wi++, p.x, p.y, p.z, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2));
        physics.addStaticBox(0.5, 3.5, 4.3, p.x, p.y, p.z, yaw, 'curb');
      }
      const cp = track.toWorld(s, 0, 7);
      composeInst(ceilIM, ci2++, cp.x, cp.y, cp.z, yaw, 1, 1, 1, Math.PI / 2);
    }
    scene.add(wallIM, ceilIM);
    // light strips along both walls (emissive boxes) + sconces
    const stripIM = instIM(new THREE.BoxGeometry(0.25, 0.25, 8.4), basic(0xbfe9ff), tSeg * 2);
    label(stripIM, 'tunnel-strip');
    let si = 0;
    for (let k = 0; k < tSeg; k++) {
      const s = TUN.s0 + (k + 0.5) * (tLen / tSeg);
      const f = track.frameAt(s), yaw = yawFromTan(f.tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * (TUN_HALF - 0.4), 5.6);
        composeInst(stripIM, si, p.x, p.y, p.z, yaw);
        if (k % 4 === 0) {
          const li = regLight(p.x, p.y, p.z, 0xbfe9ff);
          roadStreak(s, side * 8, li, 9, 2.2, 0.10);
        }
        si++;
      }
    }
    scene.add(stripIM);
    const sconceIM = instIM(new THREE.BoxGeometry(0.5, 0.9, 1.4), basic(0x9fe8ff), 40);
    label(sconceIM, 'tunnel-sconce');
    let sci = 0;
    for (let k = 0; k < 20; k++) {
      const s = TUN.s0 + 20 + k * ((tLen - 40) / 19);
      const f = track.frameAt(s), yaw = yawFromTan(f.tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * (TUN_HALF - 0.5), 4.2);
        composeInst(sconceIM, sci++, p.x, p.y, p.z, yaw);
        if (k % 3 === 0) {
          const li = regLight(p.x, p.y, p.z, 0x9fe8ff);
          roadStreak(s, side * 7, li, 7, 1.8, 0.10);
        }
      }
    }
    scene.add(sconceIM);
    // point lights down the tube (kept: the tunnel must never go black)
    for (let k = 0; k < 8; k++) {
      const s = TUN.s0 + (k + 0.5) * (tLen / 8);
      const p = track.toWorld(s, 0, 6);
      const pl = new THREE.PointLight(0x9fd0ff, 900, 90, 1.8);
      pl.position.set(p.x, p.y, p.z);
      scene.add(pl);
    }
  }
  // Portals (B5): concrete headwall + bolted sign + recessed edge strips.
  function buildPortal(sP, isEntry) {
    const f = track.frameAt(sP), yaw = yawFromTan(f.tan);
    const dir = isEntry ? -1 : 1; // outward along the tangent
    const py = f.pos.y;
    const concMat = std(0xffffff, { map: makeConcreteTexture(isEntry ? 11 : 12), roughness: 0.95 });
    const grp = new THREE.Group();
    const asset = isEntry ? 'tunnel-portal-entry' : 'tunnel-portal-exit';
    const add = (mesh) => { label(mesh, asset); grp.add(mesh); return mesh; };
    // pylons + top beam
    for (const side of [-1, 1]) {
      const p = track.toWorld(sP, side * 13.6, 0);
      const py2 = new THREE.Mesh(new THREE.BoxGeometry(3.4, 12, 5.5), concMat);
      py2.position.set(p.x, py + 5, p.z);
      py2.rotation.y = yaw;
      add(py2);
      physics.addStaticBox(1.7, 6, 2.75, p.x, py + 5, p.z, yaw, 'curb');
    }
    {
      const bp = track.toWorld(sP, 0, 0);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(30.6, 3.4, 5.5), concMat);
      beam.position.set(bp.x, py + 9.2, bp.z);
      beam.rotation.y = yaw;
      add(beam);
      // sign board BOLTED to the beam face (not floating): offset outward
      const off = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(dir * 3.0);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(13, 2.4, 0.5),
        std(0xffffff, { map: makeBoardTexture(isEntry ? 'トンネル TUNNEL' : '出口 EXIT', isEntry ? '#35f2ff' : '#ffb35c'), emissive: 0xffffff, emissiveIntensity: 0.55, emissiveMap: null, roughness: 0.6 }));
      sign.material.emissiveMap = sign.material.map;
      sign.position.set(bp.x + off.x, py + 9.2, bp.z + off.z);
      sign.rotation.y = yaw + (dir < 0 ? Math.PI : 0);
      label(sign, 'tunnel-portal-sign');
      scene.add(sign);
      // mounting brackets (small boxes from beam to sign — physical attachment)
      for (const bx of [-4, 4]) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3.0), std(0x22262e, { roughness: 0.6, metalness: 0.7 }));
        const lat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        br.position.set(bp.x + off.x / 2 + lat.x * bx, py + 9.2, bp.z + off.z / 2 + lat.z * bx);
        br.rotation.y = yaw;
        label(br, 'tunnel-portal-sign');
        scene.add(br);
      }
    }
    // recessed edge strips flanking the opening (small, controlled — B5)
    const stripColor = isEntry ? 0x35f2ff : 0xffb35c;
    const stripMat = basic(stripColor);
    for (const side of [-1, 1]) {
      const p = track.toWorld(sP, side * (TUN_HALF - 0.15), 0);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.35, 7, 0.5), stripMat);
      strip.position.set(p.x, py + 3.5, p.z);
      strip.rotation.y = yaw;
      add(strip);
      const li = regLight(p.x, py + 5.5, p.z, stripColor);
      roadStreak(sP + dir * 10, side * 8, li, 8, 1.8, 0.12);
      const li2 = regLight(p.x, py + 1.5, p.z, stripColor);
      roadStreak(sP + dir * 12, side * 8, li2, 6, 1.5, 0.09);
    }
    // wing/retaining walls running outward 40 m
    const wallIM = instIM(new THREE.BoxGeometry(0.9, 8, 5.4),
      std(0xffffff, { map: makeConcreteTexture(isEntry ? 13 : 14), roughness: 0.95 }), 16);
    label(wallIM, 'tunnel-retaining-wall');
    let wi2 = 0;
    for (let k = 0; k < 8; k++) {
      const s = sP + dir * (6 + k * 5);
      const ff = track.frameAt(s), yy = yawFromTan(ff.tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * 13.1, 0);
        composeInst(wallIM, wi2++, p.x, p.y + 2.6, p.z, yy);
      }
    }
    scene.add(wallIM);
    scene.add(grp);
  }
  buildPortal(TUN.s0, true);
  buildPortal(TUN.s1, false);
  // Ridge hills flanking the tunnel tube (B1: emissive lift, never over the
  // tube and never in the road corridor).
  {
    const ridgeMat = std(0x0b1512, {
      roughness: 1, flatShading: true, emissive: 0x0e2018, emissiveIntensity: 0.5,
    });
    const ridgeIM = instIM(new THREE.IcosahedronGeometry(1, 1), ridgeMat, 26);
    label(ridgeIM, 'hill-ridge');
    let ri = 0, guard = 0;
    while (ri < 26 && guard++ < 300) {
      const s = TUN.s0 - 150 + rnd() * (TUN.s1 - TUN.s0 + 300);
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (38 + rnd() * 72);
      const p = track.toWorld(s, lat, 0);
      if (inBay(p.x, p.z, 20)) continue;
      const r = 26 + rnd() * 42;
      composeInst(ridgeIM, ri++, p.x, -8 + r * 0.22, p.z, rnd() * 6.28, r, r * 0.42, r);
    }
    ridgeIM.count = ri;
    scene.add(ridgeIM);
  }

  // ---------------------------------------------------------------- bridge
  // B2: towers, cables, suspenders, stiffening truss, deck girder, rails and
  // lamps reconnected into ONE readable structure. The main cable runs at
  // exactly the tower column lateral (TOWER_LAT == CABLE_LAT) and lands on
  // saddle blocks on the column tops — no more floating offset.
  {
    const TOWER_LAT = 17, H_TOWER = 64;
    const sT1 = 1600, sT2 = 2200;
    const towerMat = std(0x0e1c44, {
      roughness: 0.5, metalness: 0.6, emissive: 0x1c56ff, emissiveIntensity: 0.85,
    });
    const steelDark = std(0x1a2233, { roughness: 0.55, metalness: 0.75 });
    const f1 = track.frameAt(sT1), f2 = track.frameAt(sT2);
    const baseY = (f1.pos.y + f2.pos.y) / 2 - 2;
    // tower columns (portal frames)
    const colIM = instIM(new THREE.BoxGeometry(2.4, H_TOWER, 2.4), towerMat, 4);
    label(colIM, 'bridge-tower');
    let tci = 0;
    for (const sT of [sT1, sT2]) {
      const f = track.frameAt(sT), yaw = yawFromTan(f.tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(sT, side * TOWER_LAT, 0);
        composeInst(colIM, tci++, p.x, baseY + H_TOWER / 2, p.z, yaw);
      }
    }
    scene.add(colIM);
    // crossbeams + X-bracing between the columns (reads as one frame)
    const beamIM = instIM(new THREE.BoxGeometry(1, 1, 1), towerMat, 8);
    label(beamIM, 'bridge-tower');
    let bmi = 0;
    const braceMat = towerMat;
    for (const sT of [sT1, sT2]) {
      const f = track.frameAt(sT), yaw = yawFromTan(f.tan);
      const lat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const c = track.toWorld(sT, 0, 0);
      for (const hy of [42, 58]) {
        const a = c.clone().addScaledVector(lat, -TOWER_LAT - 1.2); a.y = baseY + hy;
        const b = c.clone().addScaledVector(lat, TOWER_LAT + 1.2); b.y = baseY + hy;
        const len = a.distanceTo(b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        // orient a unit box along the lateral: yaw + 90°
        composeInst(beamIM, bmi++, mid.x, mid.y, mid.z, yaw + Math.PI / 2, len, 2.4, 3);
      }
      // X-bracing between deck+8 and +56
      for (const sgn of [1, -1]) {
        const a = c.clone().addScaledVector(lat, sgn * (TOWER_LAT - 1.2)); a.y = baseY + 8;
        const b = c.clone().addScaledVector(lat, -sgn * (TOWER_LAT - 1.2)); b.y = baseY + 56;
        beamBetween(a, b, 1.1, braceMat, 'bridge-tower');
      }
    }
    scene.add(beamIM);
    // saddle blocks on the column tops — the cable lands exactly here
    const sadIM = instIM(new THREE.BoxGeometry(3, 1.6, 3), steelDark, 4);
    label(sadIM, 'bridge-cable');
    let sdi = 0;
    for (const sT of [sT1, sT2]) {
      const yaw = yawFromTan(track.frameAt(sT).tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(sT, side * TOWER_LAT, 0);
        composeInst(sadIM, sdi++, p.x, baseY + H_TOWER - 2.2, p.z, yaw);
      }
    }
    scene.add(sadIM);
    // main cables: control points put the cable exactly over the saddles
    const cablePts = [];
    for (const side of [-1, 1]) {
      const pts = [];
      const P = (s, h) => { const p = track.toWorld(s, side * TOWER_LAT, 0); return new THREE.Vector3(p.x, p.y + h, p.z); };
      pts.push(P(BR.s0 - 60, 1.5));
      pts.push(P(sT1 - 120, 6));
      pts.push(P(sT1, H_TOWER - 3));       // over saddle 1
      pts.push(P((sT1 + sT2) / 2, 12));    // mid-span sag
      pts.push(P(sT2, H_TOWER - 3));       // over saddle 2
      pts.push(P(sT2 + 120, 6));
      pts.push(P(BR.s1 + 60, 1.5));
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.35, 6), towerMat);
      label(tube, 'bridge-cable');
      scene.add(tube);
      cablePts.push(curve);
    }
    // suspenders: cable -> deck edge, every 12 m between towers
    const suspIM = instIM(new THREE.CylinderGeometry(0.12, 0.12, 1, 6), towerMat,
      Math.ceil((sT2 - sT1) / 12) * 2);
    label(suspIM, 'bridge-suspender');
    let sui = 0, suspenderCount = 0;
    for (let s = sT1; s <= sT2; s += 12) {
      for (let cs = 0; cs < 2; cs++) {
        const t = (s - (BR.s0 - 60)) / ((BR.s1 + 60) - (BR.s0 - 60));
        const cp = cablePts[cs].getPoint(Math.max(0, Math.min(1, t)));
        const dp = track.toWorld(s, (cs === 0 ? -1 : 1) * TOWER_LAT, 0);
        const h = Math.max(1, cp.y - dp.y);
        composeInst(suspIM, sui++, cp.x, dp.y + h / 2, cp.z, 0, 1, h, 1);
        suspenderCount++;
      }
    }
    suspIM.count = sui;
    scene.add(suspIM);
    // Warren stiffening truss under both deck edges, tower to tower (NEW)
    {
      const nT = Math.ceil((sT2 - sT1) / 8);
      const chordIM = instIM(new THREE.BoxGeometry(0.32, 0.32, 8.4), steelDark, nT * 4);
      label(chordIM, 'bridge-truss');
      const diagIM = instIM(new THREE.BoxGeometry(0.24, 0.24, 8.9), steelDark, nT * 2);
      label(diagIM, 'bridge-truss');
      let ci3 = 0, di = 0;
      for (let k = 0; k < nT; k++) {
        const s = sT1 + (k + 0.5) * ((sT2 - sT1) / nT);
        const f = track.frameAt(s), yaw = yawFromTan(f.tan);
        for (const side of [-1, 1]) {
          for (const dy of [-0.6, -3.4]) {
            const p = track.toWorld(s, side * 14.6, dy);
            composeInst(chordIM, ci3++, p.x, p.y, p.z, yaw);
          }
          const p = track.toWorld(s, side * 14.6, -2.0);
          composeInst(diagIM, di++, p.x, p.y, p.z, yaw, 1, 1, 1, (k % 2 ? 1 : -1) * 0.34);
        }
      }
      scene.add(chordIM, diagIM);
    }
    // deck girder under the road ribbon (NEW — the old road floated)
    {
      const nD = Math.ceil((BR.s1 - BR.s0) / 8);
      const deckIM = instIM(new THREE.BoxGeometry(30, 2.6, 8.4), steelDark, nD);
      label(deckIM, 'bridge-deck');
      for (let k = 0; k < nD; k++) {
        const s = BR.s0 + (k + 0.5) * ((BR.s1 - BR.s0) / nD);
        const f = track.frameAt(s), yaw = yawFromTan(f.tan);
        const p = track.toWorld(s, 0, -1.7);
        composeInst(deckIM, k, p.x, p.y, p.z, yaw);
      }
      scene.add(deckIM);
    }
    // lamps mounted on the guard-rail line, arms reaching over the road
    {
      const nLp = Math.ceil((BR.s1 - BR.s0) / 30);
      const poleIM = instIM(new THREE.CylinderGeometry(0.14, 0.18, 6, 8), steelDark, nLp * 2);
      label(poleIM, 'bridge-lamp');
      const armIM = instIM(new THREE.BoxGeometry(2.4, 0.16, 0.16), steelDark, nLp * 2);
      label(armIM, 'bridge-lamp');
      const headIM = instIM(new THREE.BoxGeometry(1.0, 0.28, 0.45), basic(0xfff2d8), nLp * 2);
      label(headIM, 'bridge-lamp');
      let lpi = 0;
      for (let k = 0; k < nLp; k++) {
        const s = BR.s0 + 15 + k * 30;
        if (s > BR.s1 - 10) break;
        const f = track.frameAt(s), yaw = yawFromTan(f.tan);
        for (const side of [-1, 1]) {
          const pp = track.toWorld(s, side * 12.75, 0);
          composeInst(poleIM, lpi, pp.x, pp.y + 1.0 + 3.0, pp.z, yaw);
          const ap = track.toWorld(s, side * (12.75 - 1.2), 6.9);
          composeInst(armIM, lpi, ap.x, ap.y, ap.z, yaw + Math.PI / 2);
          const hp = track.toWorld(s, side * (12.75 - 2.4), 6.8);
          composeInst(headIM, lpi, hp.x, hp.y, hp.z, yaw);
          const li = regLight(hp.x, hp.y, hp.z, 0xfff2d8);
          roadStreak(s, side * 9, li, 9, 2.2, 0.13);
          lpi++;
        }
      }
      poleIM.count = armIM.count = headIM.count = lpi;
      scene.add(poleIM, armIM, headIM);
    }
    // pillars down to the water where the deck is over the bay
    {
      const pilIM = instIM(new THREE.BoxGeometry(3.2, 1, 3.2),
        std(0x232c40, { roughness: 0.8 }), 24);
      label(pilIM, 'bridge-pillar');
      let pi2 = 0;
      for (let s = BR.s0 + 40; s < BR.s1 - 40 && pi2 < 24; s += 80) {
        const f = track.frameAt(s), yaw = yawFromTan(f.tan);
        for (const side of [-1, 1]) {
          const p = track.toWorld(s, side * 10, 0);
          if (!inBay(p.x, p.z, 0)) continue;
          const top = p.y - 3.0, bot = BAY.y - 2;
          composeInst(pilIM, pi2++, p.x, (top + bot) / 2, p.z, yaw, 1, top - bot, 1);
        }
      }
      pilIM.count = pi2;
      scene.add(pilIM);
    }
    // tower-top beacons (registered; streak on the water below)
    {
      const bcIM = instIM(new THREE.SphereGeometry(0.55, 8, 8), basic(0x4d8dff), 2);
      label(bcIM, 'bridge-beacon');
      let bci = 0;
      for (const sT of [sT1, sT2]) {
        const p = track.toWorld(sT, 0, 0);
        composeInst(bcIM, bci++, p.x, baseY + H_TOWER + 1, p.z, 0);
        const li = regLight(p.x, baseY + H_TOWER + 1, p.z, 0x4d8dff);
        if (inBay(p.x, p.z, 40)) waterStreak(p.x, p.z + 10, li, 26, 5, 0.10);
        else roadStreak(sT, 8, li, 10, 2.5, 0.10);
      }
      scene.add(bcIM);
    }
    // concrete approach walls at both ends
    {
      const conc = std(0xffffff, { map: makeConcreteTexture(21), roughness: 0.95 });
      for (const sA of [BR.s0, BR.s1]) {
        const f = track.frameAt(sA), yaw = yawFromTan(f.tan);
        for (const side of [-1, 1]) {
          const p = track.toWorld(sA, side * 15.5, 0);
          const w = new THREE.Mesh(new THREE.BoxGeometry(2, 5, 24), conc);
          w.position.set(p.x, p.y + 1, p.z);
          w.rotation.y = yaw;
          label(w, 'bridge-approach-wall');
          scene.add(w);
        }
      }
    }
    audit.bridge = {
      towerStations: [sT1, sT2], cableLat: TOWER_LAT, towerLat: TOWER_LAT,
      cableTowerGapM: 0, suspenderCount, trussSpans: true, deckGirder: true,
    };
  }

  // ------------------------------------------------- districts & buildings
  // The city exists independently of the route; the track passes through
  // these districts (see CITY_PLAN.md). Buildings are placed by INNER EDGE
  // (>=16 m from the centerline, B3) and every footprint corner is audited
  // against the road corridor — any overlap THROWS (fails the build).
  const SIGN_WORDS = [
    ['24H', '#7df9ff'], ['酒', '#ff5fa2'], ['NEON', '#ff9f43'], ['喫茶', '#b6ffe0'],
    ['DRIFT', '#ff5fa2'], ['夜', '#7df9ff'], ['RAMEN', '#ffd27a'], ['東京', '#c4b5fd'],
    ['カラオケ', '#ff8a5c'], ['BAR', '#b6ffe0'], ['寿司', '#ffd27a'], ['GAME', '#7df9ff'],
    ['ラーメン', '#ffd27a'], ['パチンコ', '#ff5fa2'], ['ホテル', '#7df9ff'], ['薬', '#b6ffe0'],
    ['本', '#ff9f43'], ['映画', '#c4b5fd'], ['駅', '#7df9ff'], ['居酒屋', '#ff8a5c'],
    ['焼肉', '#ff5fa2'], ['コンビニ', '#b6ffe0'], ['カフェ', '#ffd27a'], ['温泉', '#7df9ff'],
    ['交番', '#7df9ff'], ['ダーツ', '#ff9f43'], ['CD', '#c4b5fd'], ['駐車場', '#b6ffe0'],
  ];
  function districtAt(s) {
    if (s > 4941 || s < 470) return 'plaza';
    if (s < 1235) return 'harbor';
    if (s < 1502) return 'climb';
    if (s < 2285) return 'bridge';
    if (s < 2573) return 'waterfront';
    if (s < 3533) return 'downtown';
    if (s < 4318) return 'tunnel';
    return 'industrial';
  }
  const DIST = {
    plaza:      { hMin: 8,  hMax: 20, den: 0.75, kinds: ['mid', 'glass', 'mid'] },
    harbor:     { hMin: 6,  hMax: 12, den: 0.50, kinds: ['ware'] },
    climb:      { hMin: 10, hMax: 25, den: 0.60, kinds: ['mid', 'glass'] },
    waterfront: { hMin: 8,  hMax: 18, den: 0.65, kinds: ['mid', 'glass'] },
    downtown:   { hMin: 15, hMax: 30, den: 0.85, kinds: ['tower', 'mid', 'glass', 'tower'] },
    industrial: { hMin: 6,  hMax: 14, den: 0.55, kinds: ['ware', 'ware', 'mid'] },
  };
  // Air-train loop path (CITY_PLAN.md): rounded rect x in [1120,1520],
  // z in [480,1120], rail y=13. Sampled every 5 m for corridor tests.
  const loopPts = (() => {
    const pts = [];
    const straight = (x, z0, z1) => {
      const n = Math.ceil(Math.abs(z1 - z0) / 5);
      for (let i = 0; i <= n; i++) {
        const z = z0 + (z1 - z0) * (i / n);
        pts.push({ x, z, yaw: z1 > z0 ? 0 : Math.PI });
      }
    };
    const arc = (cx, cz, r, a0, a1) => {
      const n = Math.ceil(Math.abs(a1 - a0) * r / 5);
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, yaw: Math.atan2(-Math.sin(a) * Math.sign(a1 - a0), Math.cos(a) * Math.sign(a1 - a0)) });
      }
    };
    straight(1120, 680, 920);
    arc(1320, 920, 200, Math.PI, 0);
    straight(1520, 920, 680);
    arc(1320, 680, 200, 0, -Math.PI);
    return pts;
  })();
  function loopDist(x, z) {
    let m = Infinity;
    for (let i = 0; i < loopPts.length; i += 4) {
      const dx = x - loopPts[i].x, dz = z - loopPts[i].z;
      const d = dx * dx + dz * dz;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  }
  const nearHighway = (x, z) => Math.abs(z - 860) < 16 && x > -330 && x < 1130;
  const nearOverpass = (s, lat) => s > 2870 && s < 2930 && Math.abs(lat) < 22;
  const nearGantry = (s, lat) => (s < 45 || s > L - 25) && Math.abs(lat) < 22;

  const buildings = []; // {x,z,yaw,w,h,d,kind,s,inner,side,yBase}
  {
    const f = {};
    for (let s = 0; s < L; s += 7) {
      for (const side of [-1, 1]) {
        const dist = districtAt(s);
        if (dist === 'bridge' || dist === 'tunnel') continue;
        const D = DIST[dist];
        if (rnd() > D.den) continue;
        track.frameAt(s, f);
        const kind = D.kinds[(rnd() * D.kinds.length) | 0];
        let w, h, d;
        if (kind === 'tower') { w = 16 + rnd() * 8; d = 16 + rnd() * 8; h = 35 + rnd() * 35; }
        else if (kind === 'ware') { w = 18 + rnd() * 14; d = 14 + rnd() * 12; h = D.hMin + rnd() * (D.hMax - D.hMin); }
        else { w = 10 + rnd() * 10; d = 10 + rnd() * 10; h = D.hMin + rnd() * (D.hMax - D.hMin); }
        // B3: place by INNER EDGE, never by center.
        const inner = side * (16 + rnd() * 34);
        const latC = inner + side * (w / 2);
        if (nearOverpass(s, latC) || nearGantry(s, latC)) continue;
        const bx = f.pos.x + f.lat.x * latC, bz = f.pos.z + f.lat.z * latC;
        if (inBay(bx, bz, 12)) continue;
        if (inBridge(s, 20) || inTun(s, 40)) continue;
        if (loopDist(bx, bz) < 18 || nearHighway(bx, bz)) continue;
        buildings.push({
          x: bx, z: bz, yaw: f.yaw, w, h, d, kind, s, inner, side,
          yBase: f.pos.y - 0.5,
        });
      }
    }
  }
  // B3 HARD AUDIT: a 3x3 grid over each footprint (corners + edge midpoints +
  // center) must stay outside roadHalf + 2.5. Corners alone can miss a curved
  // road clipping a footprint edge. Throws -> fails the build (and the
  // harness asserts violations == 0).
  {
    const viols = [];
    const c = new THREE.Vector3();
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      const f = track.frameAt(b.s);
      let minLat = Infinity;
      for (const gx of [-1, 0, 1]) for (const gz of [-1, 0, 1]) {
        c.set(
          b.x + f.lat.x * gx * (b.w / 2) + f.tan.x * gz * (b.d / 2),
          0,
          b.z + f.lat.z * gx * (b.w / 2) + f.tan.z * gz * (b.d / 2)
        );
        const np = track.nearestTrackPoint(c);
        const vx = c.x - np.point.x, vz = c.z - np.point.z;
        // lateral dir (horizontal): (cos yaw, 0, -sin yaw)
        const nyaw = Math.atan2(np.tangent.x, np.tangent.z);
        const lat = Math.abs(vx * Math.cos(nyaw) + vz * -Math.sin(nyaw));
        if (lat < minLat) minLat = lat;
      }
      if (minLat < roadHalf + 2.5)
        viols.push({ i, s: Math.round(b.s), minLat: +minLat.toFixed(2) });
    }
    audit.buildings.count = buildings.length;
    audit.buildings.violations = viols;
    if (viols.length) {
      console.error('[city] BUILDING AUDIT FAILED', JSON.stringify(viols.slice(0, 8)));
      throw new Error(`CITY AUDIT FAILED: ${viols.length} building footprint(s) overlap the road corridor`);
    }
  }
  // Building meshes (instanced by kind) + colliders + roof caps.
  {
    const byKind = { mid: [], glass: [], tower: [], ware: [] };
    for (const b of buildings) byKind[b.kind].push(b);
    const texFor = {
      mid: makeWindowTexture(0, 5), glass: makeGlassTexture(9), tower: makeWindowTexture(1, 6),
      ware: makeWindowTexture(2, 7),
    };
    const tintFor = { mid: 0x8a93a8, glass: 0x9fd8ff, tower: 0x7a86a0, ware: 0x6e7688 };
    const assetFor = {
      mid: 'building-midrise', glass: 'building-glass',
      tower: 'building-downtown-tower', ware: 'building-warehouse',
    };
    const allCaps = [];
    for (const kind of Object.keys(byKind)) {
      const list = byKind[kind];
      if (!list.length) continue;
      const im = instIM(new THREE.BoxGeometry(1, 1, 1),
        std(0xffffff, { map: texFor[kind], roughness: 0.85 }), list.length);
      label(im, assetFor[kind]);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        composeInst(im, i, b.x, b.yBase + b.h / 2, b.z, b.yaw, b.w, b.h, b.d);
        im.setColorAt(i, new THREE.Color(tintFor[kind]).multiplyScalar(0.75 + rnd() * 0.5));
        physics.addStaticBox(b.w / 2, b.h / 2, b.d / 2, b.x, b.yBase + b.h / 2, b.z, b.yaw, 'building');
        allCaps.push(b);
      }
      im.instanceColor.needsUpdate = true;
      scene.add(im);
    }
    // roof caps
    const capIM = instIM(new THREE.BoxGeometry(1, 0.6, 1), std(0x11141c, { roughness: 0.9 }), allCaps.length);
    label(capIM, 'building-roof');
    for (let i = 0; i < allCaps.length; i++) {
      const b = allCaps[i];
      composeInst(capIM, i, b.x, b.yBase + b.h + 0.2, b.z, b.yaw, b.w + 0.6, 1, b.d + 0.6);
    }
    scene.add(capIM);
    // rooftop beacons on towers (registered lights, no streaks — too high)
    const towers = allCaps.filter((b) => b.kind === 'tower');
    const bcIM = instIM(new THREE.SphereGeometry(0.5, 8, 8), basic(0xff4444), Math.max(1, towers.length));
    label(bcIM, 'building-beacon');
    for (let i = 0; i < towers.length; i++) {
      const b = towers[i];
      composeInst(bcIM, i, b.x, b.yBase + b.h + 1, b.z, 0);
      regLight(b.x, b.yBase + b.h + 1, b.z, 0xff4444);
    }
    bcIM.count = towers.length;
    scene.add(bcIM);
  }
  // Facade-mounted signs ONLY (standing rule): boards bolted to the
  // street-facing wall + vertical signboards on brackets. Never floating,
  // never on timers. 6 texture variants x 2 orientations = 12 draw calls.
  {
    const varN = 6;
    const vTex = [], bTex = [];
    for (let v = 0; v < varN; v++) {
      const [word, color] = SIGN_WORDS[(rnd() * SIGN_WORDS.length) | 0];
      vTex.push(makeSignTexture(word, color));
      const [word2, color2] = SIGN_WORDS[(rnd() * SIGN_WORDS.length) | 0];
      bTex.push(makeBoardTexture(word2, color2));
    }
    const vLists = [], bLists = [];
    for (let v = 0; v < varN; v++) { vLists.push([]); bLists.push([]); }
    for (const b of buildings) {
      if (b.kind === 'ware' && rnd() < 0.6) continue;
      const dist = districtAt(b.s);
      const p = dist === 'downtown' ? 0.95 : dist === 'plaza' ? 0.6 : 0.4;
      if (rnd() > p) continue;
      const nSigns = dist === 'downtown' ? 1 + ((rnd() * 2) | 0) : 1;
      for (let k = 0; k < nSigns; k++) {
        const v = (rnd() * varN) | 0;
        const y = b.yBase + 3 + rnd() * Math.max(2, Math.min(b.h - 6, 22));
        const tOff = (rnd() - 0.5) * b.d * 0.7;
        const f = track.frameAt(b.s);
        if (rnd() < 0.55) {
          // horizontal board, bolted flush to the street-facing wall
          const lat = b.inner - b.side * 0.35;
          bLists[v].push({ s: b.s, lat, y, tOff, yaw: b.yaw });
        } else {
          // vertical signboard on brackets, perpendicular to the wall
          const lat = b.inner - b.side * 0.9;
          vLists[v].push({ s: b.s, lat, y, tOff, yaw: b.yaw });
        }
      }
    }
    const placeOnWall = (im, list, isBoard) => {
      for (let i = 0; i < list.length; i++) {
        const sg = list[i];
        const f = track.frameAt(sg.s);
        const px = f.pos.x + f.lat.x * sg.lat + f.tan.x * sg.tOff;
        const pz = f.pos.z + f.lat.z * sg.lat + f.tan.z * sg.tOff;
        const py = sg.y;
        // board: thin axis along lat (rotation.y = yaw + PI/2);
        // vertical: thin axis along tangent (rotation.y = yaw)
        composeInst(im, i, px, py, pz, sg.yaw + (isBoard ? Math.PI / 2 : 0));
      }
    };
    for (let v = 0; v < varN; v++) {
      if (vLists[v].length) {
        const im = instIM(new THREE.BoxGeometry(1.1, 4.6, 0.32),
          std(0xffffff, { map: vTex[v], emissive: 0xffffff, emissiveIntensity: 0.9, emissiveMap: vTex[v] }), vLists[v].length);
        label(im, 'sign-vertical');
        placeOnWall(im, vLists[v], false);
        scene.add(im);
      }
      if (bLists[v].length) {
        const im = instIM(new THREE.BoxGeometry(6.4, 1.7, 0.32),
          std(0xffffff, { map: bTex[v], emissive: 0xffffff, emissiveIntensity: 0.9, emissiveMap: bTex[v] }), bLists[v].length);
        label(im, 'sign-board');
        placeOnWall(im, bLists[v], true);
        scene.add(im);
      }
    }
    // a few sign glows get registered lights + streaks (sampled)
    let reg = 0;
    for (const b of buildings) {
      if (reg >= 60 || rnd() > 0.06) continue;
      if (Math.abs(b.inner) > 24) continue; // B6: streak must sit within 15 m of its sign
      const f = track.frameAt(b.s);
      const px = f.pos.x + f.lat.x * (b.inner - b.side * 2);
      const pz = f.pos.z + f.lat.z * (b.inner - b.side * 2);
      const li = regLight(px, b.yBase + 6, pz, 0xff5fa2);
      roadStreak(b.s, b.inner - b.side * 2, li, 7, 1.8, 0.09);
      reg++;
    }
  }
  // Shopfronts with striped awnings (facade-attached) on low commercial.
  {
    const shops = [];
    for (const b of buildings) {
      if (b.h > 26 || b.kind === 'ware' || b.kind === 'tower') continue;
      const dist = districtAt(b.s);
      if ((dist === 'plaza' || dist === 'waterfront' || dist === 'downtown') && rnd() < 0.55)
        shops.push(b);
    }
    const shopTex = [makeStorefrontTexture(0), makeStorefrontTexture(1)];
    const lists = [[], []];
    for (const b of shops) lists[(rnd() * 2) | 0].push(b);
    for (let v = 0; v < 2; v++) {
      if (!lists[v].length) continue;
      const im = instIM(new THREE.PlaneGeometry(7.5, 3.2),
        std(0xffffff, { map: shopTex[v], emissive: 0xffffff, emissiveIntensity: 0.85, emissiveMap: shopTex[v] }), lists[v].length);
      label(im, 'storefront');
      const awnIM = instIM(new THREE.PlaneGeometry(8.2, 2.4),
        std(0xffffff, { map: makeAwningTexture(v), roughness: 0.9, side: THREE.DoubleSide }), lists[v].length);
      label(awnIM, 'awning');
      for (let i = 0; i < lists[v].length; i++) {
        const b = lists[v][i];
        const f = track.frameAt(b.s);
        const lat = b.inner - b.side * 0.28;
        const px = f.pos.x + f.lat.x * lat, pz = f.pos.z + f.lat.z * lat;
        const yaw = b.yaw + Math.PI / 2 + (b.side > 0 ? Math.PI : 0);
        composeInst(im, i, px, b.yBase + 1.9, pz, yaw);
        // awning: angled out over the sidewalk
        const ax = f.pos.x + f.lat.x * (lat - b.side * 1.1);
        const az = f.pos.z + f.lat.z * (lat - b.side * 1.1);
        composeInst(awnIM, i, ax, b.yBase + 3.6, az, yaw, 1, 1, 1, -0.5);
      }
      scene.add(im, awnIM);
    }
    // vending machines beside some shopfronts
    const vendIM = instIM(new THREE.BoxGeometry(1.1, 2.0, 0.8),
      std(0xffffff, { map: makeStorefrontTexture(2), emissive: 0xffffff, emissiveIntensity: 0.7, emissiveMap: makeStorefrontTexture(2) }),
      Math.max(1, Math.ceil(shops.length / 3)));
    label(vendIM, 'vending-machine');
    let vi2 = 0;
    for (let i = 0; i < shops.length && vi2 < Math.ceil(shops.length / 3); i += 3) {
      const b = shops[i];
      const f = track.frameAt(b.s);
      const lat = b.inner - b.side * 1.6;
      const px = f.pos.x + f.lat.x * lat + f.tan.x * 5;
      const pz = f.pos.z + f.lat.z * lat + f.tan.z * 5;
      composeInst(vendIM, vi2++, px, b.yBase + 1.0, pz, b.yaw + Math.PI / 2);
    }
    vendIM.count = vi2;
    scene.add(vendIM);
  }

  // ------------------------------------------------------- street-level
  // Sidewalks, streetlights (registered + streaks), power poles with
  // sagging wires, pruned trees, pedestrians, parked cars.
  const walkers = []; // {s, lat, dir, speed, mesh refs via index}
  let pedBodyIM, pedHeadIM; // assigned in the street-level block, animated in update()
  {
    // sidewalks (outside the guard rail)
    const swN = Math.ceil(L / 6);
    const swIM = instIM(new THREE.BoxGeometry(3.4, 0.18, 6.4),
      std(0x2a2f3a, { roughness: 0.95 }), swN * 2);
    label(swIM, 'sidewalk');
    let swi = 0;
    for (let s = 0; s < L && swi < swN * 2; s += 6) {
      if (inTun(s + 3, 10) || inBridge(s + 3, 10)) continue;
      for (const side of [-1, 1]) {
        const p = track.toWorld(s + 3, side * 16.2, 0);
        const f = track.frameAt(s + 3);
        composeInst(swIM, swi++, p.x, p.y + 0.02, p.z, yawFromTan(f.tan));
      }
    }
    swIM.count = swi;
    scene.add(swIM);
    // streetlights: teal heads, every 30 m, registered sources (B6)
    const lampN = Math.ceil(L / 30);
    const poleIM = instIM(new THREE.CylinderGeometry(0.11, 0.15, 6.6, 8),
      std(0x1c212c, { roughness: 0.6, metalness: 0.6 }), lampN * 2);
    label(poleIM, 'streetlight');
    const headIM = instIM(new THREE.BoxGeometry(1.1, 0.3, 0.5), basic(0x7de8ff), lampN * 2);
    label(headIM, 'streetlight');
    let lpi2 = 0;
    for (let s = 15; s < L && lpi2 < lampN * 2; s += 30) {
      if (inTun(s, 10) || inBridge(s, 30)) continue;
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * 15.5, 0);
        if (loopDist(p.x, p.z) < 10 || nearHighway(p.x, p.z) || nearOverpass(s, side * 15.5)) continue;
        const f = track.frameAt(s), yaw = yawFromTan(f.tan);
        composeInst(poleIM, lpi2, p.x, p.y + 3.3, p.z, yaw);
        const hp = track.toWorld(s, side * 14.2, 6.7);
        composeInst(headIM, lpi2, hp.x, hp.y, hp.z, yaw);
        const li = regLight(hp.x, hp.y, hp.z, 0x7de8ff);
        roadStreak(s + 2, side * 9, li, 8, 2.0, 0.11);
        lpi2++;
      }
    }
    poleIM.count = headIM.count = lpi2;
    scene.add(poleIM, headIM);
    // power poles + sagging catenary wires
    const poles = [];
    for (let s = 30; s < L; s += 60) {
      if (inTun(s, 20) || inBridge(s, 40)) continue;
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * 18, 0);
        if (loopDist(p.x, p.z) < 10 || nearHighway(p.x, p.z) || nearOverpass(s, side * 18)) continue;
        poles.push({ s, side, x: p.x, y: p.y, z: p.z });
      }
    }
    const ppIM = instIM(new THREE.CylinderGeometry(0.14, 0.18, 9, 7),
      std(0x241d16, { roughness: 0.9 }), Math.max(1, poles.length));
    label(ppIM, 'power-pole');
    const armIM = instIM(new THREE.BoxGeometry(2.4, 0.14, 0.14),
      std(0x241d16, { roughness: 0.9 }), Math.max(1, poles.length));
    label(armIM, 'power-pole');
    const wirePts = [];
    const bySide = [[], []];
    for (const pl of poles) bySide[pl.side > 0 ? 1 : 0].push(pl);
    for (let i = 0; i < poles.length; i++) {
      const pl = poles[i];
      composeInst(ppIM, i, pl.x, pl.y + 4.5, pl.z, 0);
      composeInst(armIM, i, pl.x, pl.y + 8.2, pl.z, yawFromTan(track.frameAt(pl.s).tan) + Math.PI / 2);
    }
    ppIM.count = armIM.count = poles.length;
    scene.add(ppIM, armIM);
    for (const list of bySide) {
      list.sort((a, b) => a.s - b.s);
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i], b = list[i + 1];
        if (Math.abs(wrapDelta(b.s - a.s)) > 90) continue; // span broken by a skip
        for (const dy of [8.2, 7.4]) {
          let prev = null;
          for (let k = 0; k <= 8; k++) {
            const t = k / 8;
            const sag = Math.sin(t * Math.PI) * 1.1;
            const pt = new THREE.Vector3(
              a.x + (b.x - a.x) * t, a.y + dy - sag + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
            if (prev) wirePts.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z);
            prev = pt;
          }
        }
      }
    }
    const wireG = new THREE.BufferGeometry();
    wireG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePts), 3));
    const wires = new THREE.LineSegments(wireG, new THREE.LineBasicMaterial({ color: 0x0a0c12 }));
    label(wires, 'power-line');
    scene.add(wires);
    // pruned street trees
    const treeN = Math.ceil(L / 24);
    const trunkIM = instIM(new THREE.CylinderGeometry(0.22, 0.3, 2.6, 7),
      std(0x2a2018, { roughness: 0.95 }), treeN * 2);
    label(trunkIM, 'tree');
    const leafIM = instIM(new THREE.IcosahedronGeometry(1.9, 1),
      std(0x0e2a14, { roughness: 1, flatShading: true, emissive: 0x0a1a0e, emissiveIntensity: 0.35 }),
      treeN * 2);
    label(leafIM, 'tree');
    let tri = 0;
    for (let s = 12; s < L && tri < treeN * 2; s += 24) {
      if (inTun(s, 15) || inBridge(s, 30)) continue;
      for (const side of [-1, 1]) {
        const lat = side * (15.5 + rnd() * 10);
        const p = track.toWorld(s, lat, 0);
        if (loopDist(p.x, p.z) < 9 || nearHighway(p.x, p.z) || nearOverpass(s, lat)) continue;
        composeInst(trunkIM, tri, p.x, p.y + 1.3, p.z, 0);
        composeInst(leafIM, tri, p.x, p.y + 3.6 + rnd(), p.z, rnd() * 6.28, 1, 0.85 + rnd() * 0.3, 1);
        tri++;
      }
    }
    trunkIM.count = leafIM.count = tri;
    scene.add(trunkIM, leafIM);
    // sidewalk pedestrians (instanced, animated in update())
    // Capacity covers sidewalk walkers + the 8 overpass walkers below.
    const PED = 40;
    pedBodyIM = instIM(new THREE.CapsuleGeometry(0.32, 0.9, 3, 8),
      std(0x3a4a6a, { roughness: 0.9 }), PED);
    label(pedBodyIM, 'pedestrian');
    pedBodyIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pedHeadIM = instIM(new THREE.SphereGeometry(0.22, 8, 8),
      std(0xd8b89a, { roughness: 0.8 }), PED);
    label(pedHeadIM, 'pedestrian');
    pedHeadIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const pedCols = [0x4a5a7a, 0x6a4a5a, 0x3a6a5a, 0x5a5a4a, 0x7a3a3a];
    for (let i = 0; i < 26; i++) {
      const s = rnd() * L, side = rnd() < 0.5 ? -1 : 1;
      walkers.push({
        s, lat: side * (15 + rnd() * 2), dir: rnd() < 0.5 ? 1 : -1,
        speed: 1 + rnd() * 0.8, phase: rnd() * 6.28, overpass: false,
      });
      pedBodyIM.setColorAt(i, new THREE.Color(pedCols[i % pedCols.length]));
    }
    pedBodyIM.instanceColor.needsUpdate = true;
    scene.add(pedBodyIM, pedHeadIM);
    // parked cars (improved low-poly) with colliders
    const PARK = 16;
    const pkBodyIM = instIM(new THREE.BoxGeometry(2.0, 0.72, 4.4),
      std(0xffffff, { roughness: 0.4, metalness: 0.6, envMapIntensity: 1.0 }), PARK);
    label(pkBodyIM, 'parked-car');
    const pkCabIM = instIM(new THREE.BoxGeometry(1.7, 0.62, 2.1),
      std(0x0d1420, { roughness: 0.15, metalness: 0.8, envMapIntensity: 1.4 }), PARK);
    label(pkCabIM, 'parked-car');
    const pkWheelG = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
    pkWheelG.rotateZ(Math.PI / 2);
    const pkWheelIM = instIM(pkWheelG, std(0x111111, { roughness: 0.9 }), PARK * 4);
    label(pkWheelIM, 'parked-car');
    const pkTailIM = instIM(new THREE.BoxGeometry(1.8, 0.16, 0.1), basic(0x881111), PARK);
    label(pkTailIM, 'parked-car');
    const parkCols = [0x5a6a8a, 0x8a3a3a, 0x3a3a3a, 0x9a9aa2, 0x2a5a8a, 0x6a6a2a];
    let pki = 0, pguard = 0;
    while (pki < PARK && pguard++ < 200) {
      const s = rnd() * L;
      if (inTun(s, 30) || inBridge(s, 30)) continue;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * 10.6;
      const f = track.frameAt(s), yaw = yawFromTan(f.tan) + (rnd() < 0.5 ? 0 : Math.PI);
      const p = track.toWorld(s, lat, 0);
      const col = parkCols[(rnd() * parkCols.length) | 0];
      composeInst(pkBodyIM, pki, p.x, p.y + 0.62, p.z, yaw);
      pkBodyIM.setColorAt(pki, new THREE.Color(col));
      const cp = track.toWorld(s, lat, 0);
      // cabin offset toward the car's own forward — approximate with frame
      composeInst(pkCabIM, pki, cp.x - Math.sin(yaw) * 0.2, cp.y + 1.2, cp.z - Math.cos(yaw) * 0.2, yaw);
      for (let wI = 0; wI < 4; wI++) {
        const wx = [-0.85, 0.85, -0.85, 0.85][wI], wz = [1.45, 1.45, -1.45, -1.45][wI];
        const wy = p.y + 0.36;
        const rx = p.x + Math.cos(yaw) * wx + Math.sin(yaw) * wz;
        const rz = p.z - Math.sin(yaw) * wx + Math.cos(yaw) * wz;
        composeInst(pkWheelIM, pki * 4 + wI, rx, wy, rz, 0);
      }
      composeInst(pkTailIM, pki, p.x - Math.sin(yaw) * -2.21, p.y + 0.72, p.z - Math.cos(yaw) * -2.21, yaw);
      physics.addStaticBox(1.1, 0.8, 2.3, p.x, p.y + 0.8, p.z, yaw, 'traffic');
      pki++;
    }
    pkBodyIM.count = pkCabIM.count = pkTailIM.count = pki;
    pkWheelIM.count = pki * 4;
    pkBodyIM.instanceColor.needsUpdate = true;
    scene.add(pkBodyIM, pkCabIM, pkWheelIM, pkTailIM);
  }
  // ------------------------------------------------- skyline & landmark
  // Distant tower ring (emissive lift, never black) + a bay landmark spire.
  {
    const skyIM = instIM(new THREE.BoxGeometry(1, 1, 1),
      std(0xffffff, {
        map: makeWindowTexture(3, 21), roughness: 0.9,
        emissive: 0x8fb4ff, emissiveIntensity: 0.25, emissiveMap: makeWindowTexture(3, 21),
      }), 60);
    label(skyIM, 'building-skyline');
    let ski = 0, guard = 0;
    while (ski < 60 && guard++ < 400) {
      const a = rnd() * Math.PI * 2, rr = 420 + rnd() * 320;
      const x = 650 + Math.cos(a) * rr, z = 550 + Math.sin(a) * rr;
      if (trackDist(x, z) < 120 || inBay(x, z, 20)) continue;
      const w = 24 + rnd() * 30, h = 30 + rnd() * 80, d = 24 + rnd() * 30;
      composeInst(skyIM, ski++, x, h / 2 - 8, z, rnd() * 0.6, w, h, d);
    }
    skyIM.count = ski;
    scene.add(skyIM);
    // landmark spire rising from the bay (procedural)
    const spire = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 120, 8),
      std(0x1a2440, { roughness: 0.5, metalness: 0.6, emissive: 0xff2fb3, emissiveIntensity: 0.35 }));
    shaft.position.y = 60;
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(10, 1.2, 8, 24), basic(0xff2fb3));
    ring1.rotation.x = Math.PI / 2; ring1.position.y = 96;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 10), basic(0xff2fb3));
    tip.position.y = 122;
    for (const m of [shaft, ring1, tip]) { label(m, 'landmark-spire'); spire.add(m); }
    spire.position.set(940, BAY.y, 1650);
    scene.add(spire);
    const li = regLight(940, BAY.y + 122, 1650, 0xff2fb3);
    waterStreak(940, 1650 + 12, li, 40, 7, 0.14);
    waterStreak(940, 1650 - 13, li, 30, 5, 0.10, 0.4);
  }
  // --------------------------------------------- gantries & start & overpass
  {
    const gantryS = [900, 2100, 3300, 4600];
    const postIM = instIM(new THREE.BoxGeometry(0.8, 8.5, 0.8),
      std(0x2a3140, { roughness: 0.6, metalness: 0.6 }), gantryS.length * 2);
    label(postIM, 'gantry-dir');
    let gi = 0;
    for (const s of gantryS) {
      const f = track.frameAt(s), yaw = yawFromTan(f.tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * 16, 0);
        composeInst(postIM, gi++, p.x, p.y + 4.25, p.z, yaw);
      }
      const c = track.toWorld(s, 0, 8.2);
      const panelTex = makeDirPanelTexture(s < 2500 ? 'BAY BRIDGE →' : 'DOWNTOWN →', s < 2500 ? '1100 m' : '800 m');
      const panel = new THREE.Mesh(new THREE.BoxGeometry(20, 2.6, 0.5),
        std(0xffffff, { map: panelTex, emissive: 0xffffff, emissiveIntensity: 0.5, emissiveMap: panelTex }));
      panel.position.set(c.x, c.y, c.z);
      panel.rotation.y = yaw + Math.PI;
      label(panel, 'gantry-dir');
      scene.add(panel);
    }
    scene.add(postIM);
    // start gantry + checkered start line at s=0
    {
      const f = track.frameAt(0), yaw = yawFromTan(f.tan);
      const grp = new THREE.Group();
      for (const side of [-1, 1]) {
        const p = track.toWorld(0, side * 16, 0);
        const post = new THREE.Mesh(new THREE.BoxGeometry(1, 10, 1), std(0xd83a5c, { roughness: 0.5, metalness: 0.4 }));
        post.position.set(p.x, p.y + 5, p.z);
        label(post, 'gantry-start');
        grp.add(post);
      }
      const c = track.toWorld(0, 0, 9.6);
      const banner = new THREE.Mesh(new THREE.BoxGeometry(33, 2.8, 0.6),
        std(0xffffff, {
          map: makeGantryTexture(), emissive: 0xffffff,
          emissiveIntensity: 0.6, emissiveMap: makeGantryTexture(),
        }));
      banner.position.set(c.x, c.y, c.z);
      banner.rotation.y = yaw + Math.PI;
      label(banner, 'gantry-start');
      grp.add(banner);
      scene.add(grp);
      // start line strip laid flat on the road
      const sl = new THREE.Mesh(new THREE.PlaneGeometry(24, 2),
        basic(0xffffff, { map: makeStartLineTexture() }));
      sl.geometry.rotateX(-Math.PI / 2);
      const sp = track.toWorld(8, 0, 0.05);
      sl.position.set(sp.x, sp.y, sp.z);
      sl.rotation.y = yaw;
      label(sl, 'start-line');
      scene.add(sl);
    }
    // pedestrian overpass at s=2900 with walkers
    {
      const sO = 2900;
      const f = track.frameAt(sO), yaw = yawFromTan(f.tan);
      const deckY = f.pos.y + 6.5;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(40, 1.2, 3.4),
        std(0x2a3140, { roughness: 0.7 }));
      deck.position.set(f.pos.x, deckY, f.pos.z);
      deck.rotation.y = yaw + Math.PI / 2;
      label(deck, 'overpass');
      scene.add(deck);
      for (const side of [-1, 1]) {
        const p = track.toWorld(sO, side * 19, 0);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 7.5, 2.4), std(0x2a3140, { roughness: 0.7 }));
        leg.position.set(p.x, p.y + 3.2, p.z);
        label(leg, 'overpass');
        scene.add(leg);
        const railO = new THREE.Mesh(new THREE.BoxGeometry(40, 1.0, 0.25), basic(0x35f2ff));
        const rp = track.toWorld(sO, side * 1.6, deckY + 1.1);
        railO.position.set(rp.x, rp.y, rp.z);
        railO.rotation.y = yaw + Math.PI / 2;
        label(railO, 'overpass');
        scene.add(railO);
      }
      for (let i = 0; i < 8; i++)
        walkers.push({
          s: sO - 18 + i * 5, lat: (i % 2 ? 1 : -1) * 1.1, dir: i % 2 ? 1 : -1,
          speed: 0.9 + rnd() * 0.5, phase: rnd() * 6.28, overpass: true,
        });
    }
  }

  // --------------------------------------- elevated expressway (verticality)
  // Straight deck at z=860, x in [-300,1100], deck y=15 — crosses OVER the
  // west straight (track y~1 there). Pillars, edge light strips, animated
  // car-light dots both directions.
  const hwyDots = [];
  let hwyDotIM;
  {
    const deckIM = instIM(new THREE.BoxGeometry(20, 1.2, 12),
      std(0x1c2333, { roughness: 0.8 }), 70);
    label(deckIM, 'highway-deck');
    for (let i = 0; i < 70; i++)
      composeInst(deckIM, i, -300 + 10 + i * 20, 15, 860, 0);
    scene.add(deckIM);
    const stripIM = instIM(new THREE.BoxGeometry(20.4, 0.18, 0.35), basic(0xffe9c4), 140);
    label(stripIM, 'highway-strip');
    let hsi = 0;
    for (let i = 0; i < 70; i++) {
      for (const dz of [-5.7, 5.7])
        composeInst(stripIM, hsi++, -300 + 10 + i * 20, 15.75, 860 + dz, 0);
    }
    scene.add(stripIM);
    for (const hx of [-200, 200, 600, 1000])
      regLight(hx, 15.9, 860, 0xffe9c4);
    const pilIM = instIM(new THREE.BoxGeometry(2.4, 23, 2.4),
      std(0x232c40, { roughness: 0.8 }), 36);
    label(pilIM, 'highway-pillar');
    let hpi = 0;
    for (let x = -280; x <= 1080 && hpi < 36; x += 40) {
      if (trackDist(x, 860) < 24) continue; // never on the race road
      composeInst(pilIM, hpi++, x, 3.5, 860, 0);
    }
    pilIM.count = hpi;
    scene.add(pilIM);
    // animated car-light dots
    hwyDotIM = instIM(new THREE.BoxGeometry(1.7, 0.7, 3.8), basic(0xffffff), 24);
    label(hwyDotIM, 'highway-car-dot');
    hwyDotIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 24; i++) {
      const dirH = i % 2 ? 1 : -1;
      hwyDots.push({ x: -300 + rnd() * 1400, dir: dirH, speed: 20 + rnd() * 12, z: 860 + dirH * 2.8 });
      hwyDotIM.setColorAt(i, new THREE.Color(dirH > 0 ? 0xfff6e0 : 0xff3333));
    }
    hwyDotIM.instanceColor.needsUpdate = true;
    scene.add(hwyDotIM);
  }
  // ------------------------------------------------------- air-train loop
  // Rounded-rect guideway at y=13 threading downtown (CITY_PLAN.md), one
  // 4-car train looping. Crosses over the race track twice.
  const train = { d: 0, speed: 22, cars: 4 };
  let trainIM, trainWinIM;
  {
    const railIM = instIM(new THREE.BoxGeometry(1.8, 0.6, 5.6),
      std(0x2c3650, { roughness: 0.5, metalness: 0.7, emissive: 0x1a2c5a, emissiveIntensity: 0.5 }),
      Math.ceil(loopPts.length / 2));
    label(railIM, 'air-train-rail');
    let rri = 0;
    for (let i = 0; i < loopPts.length; i += 2) {
      const p = loopPts[i];
      composeInst(railIM, rri++, p.x, 13, p.z, p.yaw);
    }
    railIM.count = rri;
    scene.add(railIM);
    const pilIM = instIM(new THREE.BoxGeometry(1.5, 21, 1.5),
      std(0x232c40, { roughness: 0.8 }), 60);
    label(pilIM, 'air-train-pillar');
    let api2 = 0;
    for (let i = 0; i < loopPts.length && api2 < 60; i += 6) {
      const p = loopPts[i];
      if (trackDist(p.x, p.z) < 17) continue; // never on the race road
      composeInst(pilIM, api2++, p.x, 2.5, p.z, 0);
    }
    pilIM.count = api2;
    scene.add(pilIM);
    trainIM = instIM(new THREE.BoxGeometry(2.4, 2.6, 9),
      std(0x2adfd0, { roughness: 0.35, metalness: 0.6, envMapIntensity: 1.2 }), train.cars);
    label(trainIM, 'air-train');
    trainIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    trainWinIM = instIM(new THREE.BoxGeometry(2.5, 0.7, 8.2), basic(0xfff2c8), train.cars);
    label(trainWinIM, 'air-train');
    trainWinIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(trainIM, trainWinIM);
  }
  // ------------------------------------------------------------ nitro
  const BOTTLES = 14;
  let botIM, botRingIM;
  {
    botIM = instIM(new THREE.IcosahedronGeometry(0.55, 0), basic(0x39ff88), BOTTLES);
    label(botIM, 'nitro-bottle');
    botIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    botRingIM = instIM(new THREE.TorusGeometry(0.95, 0.09, 6, 22), basic(0x39ff88), BOTTLES);
    label(botRingIM, 'nitro-bottle');
    botRingIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(botIM, botRingIM);
    for (let i = 0; i < BOTTLES; i++) {
      const s = (300 + i * (L / BOTTLES)) % L;
      const f = track.frameAt(s);
      const p = track.toWorld(s, i % 2 ? 6 : -6, 0);
      const li = regLight(p.x, p.y + 1.4, p.z, 0x39ff88);
      roadStreak(s + 3, i % 2 ? 5 : -5, li, 5, 1.4, 0.08);
    }
  }
  // ------------------------------------------------- traffic visuals (B4)
  // Real Kenney car-kit GLB clones (preloaded by boot before buildCity),
  // one group per car; each fades/scales in over ~0.8 s after spawn or
  // respawn (respawn = track-space jump > 150 m). api.trafficFade() exposes
  // per-car readiness so the car side can gate colliders on it. Group origin
  // is at ground level under the car center.
  const TRAFFIC_N = 20;
  const tCars = [];
  const T_MODELS = ['sedan', 'taxi', 'suv', 'truck'];
  const T_COLORS = { sedan: 0x3a5a9a, taxi: null, suv: 0x2a6a4a, truck: 0xd8d8d8 };
  {
    for (let i = 0; i < TRAFFIC_N; i++) {
      const model = T_MODELS[i % T_MODELS.length];
      const grp = buildTrafficCarMesh(model, T_COLORS[model]);
      grp.visible = false;
      label(grp, 'traffic-' + model);
      scene.add(grp);
      tCars.push({ fade: 0, s: null, grp });
    }
    audit.traffic.count = TRAFFIC_N;
  }
  const _zero = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  _zero.setPosition(0, -100, 0);
  function hideSlot(im, idx) { im.setMatrixAt(idx, _zero); }
  function placeTrafficCar(i, c, st) {
    const k = 0.05 + 0.95 * (1 - Math.pow(1 - st.fade, 3));
    const f = track.frameAt(c.s);
    const yaw = yawFromTan(f.tan) + (c.kind === 'oncoming' ? Math.PI : 0);
    const p = track.toWorld(c.s, c.lane, 0);
    st.grp.position.set(p.x, p.y, p.z);
    st.grp.rotation.set(0, yaw, 0);
    st.grp.scale.setScalar(Math.max(0.0001, k));
    st.grp.visible = true;
  }
  let lastSyncT = 0;
  function syncTraffic(traffic) {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastSyncT) / 1000));
    lastSyncT = now;
    for (let i = 0; i < TRAFFIC_N; i++) {
      const c = traffic[i], st = tCars[i];
      if (!c) { st.grp.visible = false; st.s = null; st.fade = 0; continue; }
      // B4: a track-space jump > 150 m means spawn/respawn -> restart fade.
      const ds = st.s === null ? 999 : wrapDelta(c.s - st.s);
      if (Math.abs(ds) > 150) st.fade = 0;
      else st.fade = Math.min(1, st.fade + dt * 1.4);
      st.s = c.s;
      placeTrafficCar(i, c, st);
    }
  }
  // --------------------------------------------- small glow points (B5/B6)
  // Only small controlled points — the old large random portal/tower flares
  // are deleted. Positions are fixed (never on timers).
  {
    const pts = [], cols = [];
    const push = (x, y, z, hex, size) => {
      pts.push({ x, y, z, hex, size });
      cols.push(hex);
    };
    // warm dots at shopfront canopies (sampled buildings)
    let n = 0;
    for (const b of buildings) {
      if (n >= 90 || b.kind === 'ware' || b.kind === 'tower' || rnd() > 0.12) continue;
      const f = track.frameAt(b.s);
      const lat = b.inner - b.side * 2.2;
      push(f.pos.x + f.lat.x * lat, b.yBase + 4.2, f.pos.z + f.lat.z * lat, 0xffc37a, 1);
      n++;
    }
    // cool dots along the air-train guideway
    for (let i = 0; i < loopPts.length; i += 12) {
      const p = loopPts[i];
      push(p.x, 13.8, p.z, 0x35f2ff, 1);
    }
    const g = new THREE.BufferGeometry();
    const parr = new Float32Array(pts.length * 3), carr = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      parr.set([pts[i].x, pts[i].y, pts[i].z], i * 3);
      const cc = new THREE.Color(pts[i].hex);
      carr.set([cc.r, cc.g, cc.b], i * 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(parr, 3));
    g.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    const glow = new THREE.Points(g, new THREE.PointsMaterial({
      map: makeGlowTexture(), size: 22, vertexColors: true, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
      sizeAttenuation: true,
    }));
    label(glow, 'glow-points');
    scene.add(glow);
  }
  // --------------------------------------- streak mesh + B6 source audit
  // Every streak below was generated from a registered light source above;
  // nothing here is random or untethered (B2/B6).
  {
    const im = instIM(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    }), Math.max(1, streaks.length));
    label(im, 'reflection-streak');
    im.geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < streaks.length; i++) {
      const st = streaks[i];
      composeInst(im, i, st.x, st.y, st.z, st.yaw, st.w, 1, st.l);
      im.setColorAt(i, st.color);
    }
    im.count = streaks.length;
    if (streaks.length) im.instanceColor.needsUpdate = true;
    scene.add(im);
    const viols = [];
    for (let i = 0; i < streaks.length; i++) {
      const st = streaks[i], Ls = lightReg[st.light];
      if (!Ls) { viols.push({ i, why: 'no-source' }); continue; }
      const d = Math.hypot(st.x - Ls.x, st.z - Ls.z);
      if (d > 15 || st.raw !== Ls.color) viols.push({ i, d: +d.toFixed(1), colorMismatch: st.raw !== Ls.color });
    }
    audit.streaks.count = streaks.length;
    audit.streaks.violations = viols;
    audit.lights.count = lightReg.length;
    if (viols.length) {
      console.error('[city] STREAK AUDIT FAILED', JSON.stringify(viols.slice(0, 8)));
      throw new Error(`CITY AUDIT FAILED: ${viols.length} reflection streak(s) without a valid source`);
    }
  }
  // ---------------------------------------------------------- public API
  // B3: the bay rectangle must spatially contain the suspended bridge span
  // (tower to tower, s = 1600..2200), with a 20 m margin. The land
  // approaches outside the towers are correctly NOT water.
  {
    let bayContainsBridge = true;
    for (let s = 1600; s <= 2200; s += 20) {
      const bp = track.toWorld(s, 0, 0);
      if (bp.x < BAY.x0 + 20 || bp.x > BAY.x1 - 20 || bp.z < BAY.z0 + 20 || bp.z > BAY.z1 - 20) {
        bayContainsBridge = false; break;
      }
    }
    audit.bayContainsBridge = bayContainsBridge;
    if (!bayContainsBridge) {
      console.error('[city] BAY AUDIT FAILED: bridge span not inside the bay rectangle');
      throw new Error('CITY AUDIT FAILED: bridge span outside the bay');
    }
  }
  window.__cityAudit = {
    buildings: audit.buildings,
    bayContainsBridge: audit.bayContainsBridge,
    lights: { count: audit.lights.count, sources: lightReg.map((l) => ({ x: +l.x.toFixed(1), y: +l.y.toFixed(1), z: +l.z.toFixed(1), color: l.color })) },
    streaks: {
      count: audit.streaks.count, violations: audit.streaks.violations,
      samples: streaks.filter((_, i) => i % 37 === 0).map((st) => ({
        x: +st.x.toFixed(1), z: +st.z.toFixed(1), raw: st.raw, light: st.light,
      })),
    },
    bridge: audit.bridge,
    rails: audit.rails,
    traffic: audit.traffic,
  };

  function setTunnelGlow(f) {
    tunnelAmbient.intensity = Math.max(0, Math.min(1.4, f));
  }
  function buildingsNear(s, range) {
    return buildings.filter((b) => Math.abs(wrapDelta(b.s - s)) < range);
  }
  // B4: per-car visual readiness 0..1 (1 = fully visible). The car side can
  // gate traffic collider activation on this.
  function trafficFade() {
    return tCars.map((c) => +c.fade.toFixed(3));
  }

  // Scratch objects reused in the per-frame loops (frameAt/toWorld allocate
  // when called without a target — reuse avoids GC churn on phones).
  const _pf = {};
  const _bv = new THREE.Vector3();

  function update(dt, elapsed, bottles) {
    // air-train
    train.d = (train.d + train.speed * dt) % 200000;    for (let k = 0; k < train.cars; k++) {
      const dd = train.d - k * 12;
      const idx = ((Math.round(dd / 5) % loopPts.length) + loopPts.length) % loopPts.length;
      const p = loopPts[idx];
      composeInst(trainIM, k, p.x, 14.7, p.z, p.yaw);
      composeInst(trainWinIM, k, p.x, 15.1, p.z, p.yaw);
    }
    trainIM.instanceMatrix.needsUpdate = true;
    trainWinIM.instanceMatrix.needsUpdate = true;
    // highway dots
    for (let i = 0; i < hwyDots.length; i++) {
      const d = hwyDots[i];
      d.x += d.dir * d.speed * dt;
      if (d.x > 1120) d.x = -320;
      if (d.x < -320) d.x = 1120;
      composeInst(hwyDotIM, i, d.x, 16.1, d.z, Math.PI / 2);
    }
    hwyDotIM.instanceMatrix.needsUpdate = true;
    // pedestrians
    for (let i = 0; i < walkers.length; i++) {
      const w = walkers[i];
      if (!w.overpass) {
        w.s = (w.s + w.dir * w.speed * dt + L) % L;
        if (rnd() < 0.0004) w.dir *= -1;
      } else {
        w.lat += w.dir * w.speed * dt;
        if (Math.abs(w.lat) > 17) w.dir *= -1;
      }
      const f = track.frameAt(w.s, _pf);
      const bob = Math.abs(Math.sin(elapsed * 7 + w.phase)) * 0.09;
      const px = f.pos.x + f.lat.x * w.lat, pz = f.pos.z + f.lat.z * w.lat;
      const py = w.overpass ? f.pos.y + 7.9 + bob : f.pos.y + 1.05 + bob;
      const yaw = yawFromTan(f.tan) + (w.dir > 0 ? 0 : Math.PI) + (w.overpass ? Math.PI / 2 : 0);
      composeInst(pedBodyIM, i, px, py, pz, yaw);
      composeInst(pedHeadIM, i, px, py + 0.95 + bob * 0.4, pz, yaw);
    }
    pedBodyIM.instanceMatrix.needsUpdate = true;
    pedHeadIM.instanceMatrix.needsUpdate = true;
    // nitro bottles
    if (bottles) {
      for (let i = 0; i < BOTTLES && i < bottles.length; i++) {
        const b = bottles[i];
        if (!b.active) { hideSlot(botIM, i); hideSlot(botRingIM, i); continue; } // taken -> hidden
        const p = track.toWorld(b.s, b.lat, 0, _bv);
        const bobY = 1.15 + Math.sin(elapsed * 3 + i * 1.7) * 0.18;
        composeInst(botIM, i, p.x, p.y + bobY, p.z, elapsed * 1.5 + i, 1, 1.25, 1);
        composeInst(botRingIM, i, p.x, p.y + 0.25, p.z, 0, 1, 1, 1, Math.PI / 2.4);
      }
      botIM.instanceMatrix.needsUpdate = true;
      botRingIM.instanceMatrix.needsUpdate = true;
    }
  }

  return { update, syncTraffic, setTunnelGlow, buildingsNear, trafficFade };
}
