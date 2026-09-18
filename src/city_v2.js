// Tokyo Drift 3D — buildCityV2: the v2 plan-driven world (LAYOUT review).
//
// Procedural massing + road truth from city_plan_v2.json — NOT final art.
// Returns the same API as buildCity (src/city.js):
//   { update(dt, elapsed, bottles), syncTraffic(traffic), setTunnelGlow(f),
//     buildingsNear(s, range), trafficFade() }
// so main.js / physics.js / the harness work unchanged.
import * as THREE from 'three';
import { PLAN } from './plan_v2.js';
import { CFG } from './config.js';
import { mulberry32, makeGantryTexture, makeStartLineTexture } from './textures.js';
import { buildTrafficCarMesh } from './car.js';

const UP = new THREE.Vector3(0, 1, 0);

export function buildCityV2(scene, physics, track) {
  const L = track.length;
  const TUN = track.tunnel, BR = track.bridge;
  const BAY = {
    x0: PLAN.bay.rect[0], x1: PLAN.bay.rect[1],
    z0: PLAN.bay.rect[2], z1: PLAN.bay.rect[3], y: PLAN.bay.surface_y,
  };
  const inTun = (s, m) => s > TUN.s0 - m && s < TUN.s1 + m;
  const inBridge = (s, m) => s > BR.s0 - m && s < BR.s1 + m;
  const inBay = (x, z, m) => x > BAY.x0 - m && x < BAY.x1 + m && z > BAY.z0 - m && z < BAY.z1 + m;
  const yawFromTan = (tan) => Math.atan2(tan.x, tan.z);
  const wrapDelta = (d) => {
    d = d % L;
    if (d < -L / 2) d += L;
    if (d > L / 2) d -= L;
    return d;
  };

  // Coarse 2D distance to the circuit (XZ only), for clearance tests.
  // Samples every 2nd centerline point (~15 m apart) so the chord error
  // stays < 1 m even on hairpins.
  function trackDist(x, z) {
    let m = Infinity;
    for (let i = 0; i < track.N; i += 2) {
      const p = track.pos[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  }

  // ------------------------------------------------------------ instancing
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
  const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color }, o));
  const basic = (color, o) => new THREE.MeshBasicMaterial(Object.assign({ color }, o));

  // Ribbon strip along the lap: cross = array of [lat, h]; normalMode =
  // 'up' (road/ceiling) or 'lat' (walls, sign follows first cross lat).
  const _f = {};
  function ribbon(sList, cross, normalMode, mat, wrap) {
    const rows = sList.length, cols = cross.length;
    const verts = new Float32Array(rows * cols * 3);
    const norms = new Float32Array(rows * cols * 3);
    const idx = [];
    for (let k = 0; k < rows; k++) {
      const s = sList[k];
      track.frameAt(s, _f);
      for (let c = 0; c < cols; c++) {
        const [lat, h] = cross[c];
        const vi = (k * cols + c) * 3;
        const px = _f.pos.x + _f.lat.x * lat + _f.up.x * h;
        const py = _f.pos.y + _f.lat.y * lat + _f.up.y * h;
        const pz = _f.pos.z + _f.lat.z * lat + _f.up.z * h;
        verts[vi] = px; verts[vi + 1] = py; verts[vi + 2] = pz;
        let nx, ny, nz;
        if (normalMode === 'lat') {
          const sgn = cross[0][0] >= 0 ? 1 : -1;
          nx = -_f.lat.x * sgn; ny = 0; nz = -_f.lat.z * sgn; // face the road
        } else { nx = _f.up.x; ny = _f.up.y; nz = _f.up.z; }
        norms[vi] = nx; norms[vi + 1] = ny; norms[vi + 2] = nz;
      }
      if (wrap || k < rows - 1) {
        const k2 = (k + 1) % rows;
        for (let c = 0; c < cols - 1; c++) {
          const a = k * cols + c, b = k * cols + c + 1;
          const c2 = k2 * cols + c, d = k2 * cols + c + 1;
          idx.push(a, c2, b, b, c2, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(norms, 3));
    g.setIndex(idx);
    return new THREE.Mesh(g, mat);
  }
  const sRange = (s0, s1, step) => {
    const out = [];
    for (let s = s0; s <= s1; s += step) out.push(s);
    if (out[out.length - 1] < s1 - 1e-6) out.push(s1);
    return out;
  };

  // ------------------------------------------------------------ atmosphere
  scene.add(new THREE.HemisphereLight(0x2e4a6e, 0x05060a, 0.85));
  const dir = new THREE.DirectionalLight(0x8fb4ff, 0.45);
  dir.position.set(-300, 500, 200);
  scene.add(dir);
  scene.add(new THREE.AmbientLight(0x223355, 0.35));
  scene.background = new THREE.Color(0x070a18);
  scene.fog = new THREE.FogExp2(0x0d1233, 0.0011);
  // Tunnel fill (driven by main.js via setTunnelGlow); the tube ALSO has
  // always-on strip + point lights so sweeps never see black.
  const tunnelAmbient = new THREE.AmbientLight(0xaac4ff, 0);
  scene.add(tunnelAmbient);

  // ---------------------------------------------------------------- ground
  {
    const g = new THREE.Mesh(
      new THREE.PlaneGeometry(5200, 5200),
      std(0x070a12, { roughness: 1, metalness: 0 })
    );
    g.geometry.rotateX(-Math.PI / 2);
    g.position.set(660, -9, 960);
    label(g, 'v2-ground');
    scene.add(g);
  }
  // ------------------------------------------------------------------- bay
  {
    const g = new THREE.PlaneGeometry(BAY.x1 - BAY.x0, BAY.z1 - BAY.z0);
    g.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(g, std(0x0a2438, {
      roughness: 0.15, metalness: 0.8, envMapIntensity: 1.0,
    }));
    water.position.set((BAY.x0 + BAY.x1) / 2, BAY.y, (BAY.z0 + BAY.z1) / 2);
    label(water, 'v2-water-bay');
    scene.add(water);
  }

  // ------------------------------------------------------------------ road
  // Dark asphalt ribbon at the REAL plan elevations. One draw call.
  {
    const SEG = track.N * 2, segLen = L / SEG;
    const sList = [];
    for (let k = 0; k < SEG; k++) sList.push(k * segLen);
    const road = ribbon(sList, [[-12, 0.02], [12, 0.02]], 'up',
      std(0x232833, { roughness: 0.6, metalness: 0.2, envMapIntensity: 0.6 }), true);
    label(road, 'v2-road');
    scene.add(road);
    // Edge lines (emissive-ish white strips, read at night).
    for (const side of [-1, 1]) {
      const e = ribbon(sList, [[side * 11.0, 0.05], [side * 11.4, 0.05]], 'up',
        basic(0xdfe6f2), true);
      label(e, 'v2-road-edge');
      scene.add(e);
    }
  }
  // Dashed center line: instanced 3 m dashes every 12 m.
  {
    const n = Math.floor(L / 12);
    const dashIM = instIM(new THREE.BoxGeometry(0.35, 0.06, 3.2), basic(0xe8c84a), n);
    label(dashIM, 'v2-road-center');
    for (let k = 0; k < n; k++) {
      const s = k * 12 + 6;
      const p = track.toWorld(s, 0, 0.06);
      const yaw = yawFromTan(track.frameAt(s).tan);
      composeInst(dashIM, k, p.x, p.y, p.z, yaw);
    }
    scene.add(dashIM);
  }

  // ------------------------------------------------------------ guard rails
  // Geometry + Rapier colliders per physics.railSpec() (tag 'rail').
  // Skipped inside the tunnel tube (sealed concrete walls there); the
  // logical rail-plane clamp in physics still applies every step.
  {
    const spec = physics.railSpec();
    const RL = spec.railLat, SEG = spec.segLen;
    const steel = std(0x9aa4b8, { roughness: 0.35, metalness: 0.9, envMapIntensity: 1.2 });
    const stepN = Math.ceil(L / 6);
    const postIM = instIM(new THREE.BoxGeometry(0.14, 1.0, 0.14), steel, stepN * 2);
    const barIM = instIM(new THREE.BoxGeometry(0.1, 0.14, 6.4), steel, stepN * 4);
    label(postIM, 'v2-guard-rail-post');
    label(barIM, 'v2-guard-rail-bar');
    let pi = 0, bi = 0;
    for (let s = 0; s < L; s += 6) {
      if (inTun(s + 3, 20)) continue;
      for (const side of [-1, 1]) {
        const p = track.toWorld(s + 3, side * RL, 0);
        const yaw = yawFromTan(track.frameAt(s + 3).tan);
        composeInst(postIM, pi++, p.x, p.y + 0.5, p.z, yaw);
        for (const h of [0.55, 0.95]) {
          const bp = track.toWorld(s + 3, side * RL, h);
          composeInst(barIM, bi++, bp.x, bp.y, bp.z, yaw);
        }
      }
    }
    postIM.count = pi; barIM.count = bi;
    scene.add(postIM, barIM);
    let rc = 0;
    for (let s = 0; s < L; s += SEG) {
      if (inTun(s + SEG / 2, 20)) continue;
      for (const side of [-1, 1]) {
        const c = track.toWorld(s + SEG / 2, side * RL, spec.railHeight / 2);
        const yaw = yawFromTan(track.frameAt(s + SEG / 2).tan);
        physics.addStaticBox(spec.railThick, spec.railHeight / 2, SEG / 2 + 0.4,
          c.x, c.y, c.z, yaw, 'rail');
        rc++;
      }
    }
    console.log(`[city_v2] rail colliders: ${rc}`);
  }

  // ---------------------------------------------------------------- tunnel
  // Sealed concrete tube around section J: walls + ceiling follow the
  // spline (CFG.tunnelHalfW 13.5, tunnelH 7.2), emissive ceiling strips,
  // wall sconces, real point lights, glowing portal frames. The tube is
  // always lit — sweeps must never read black.
  {
    const HW = CFG.tunnelHalfW, TH = CFG.tunnelH;
    const sList = sRange(TUN.s0, TUN.s1, 8);
    const concMat = std(0x3a4048, { roughness: 0.95 });
    for (const side of [-1, 1]) {
      const wall = ribbon(sList, [[side * HW, 0.0], [side * HW, TH]], 'lat', concMat, false);
      label(wall, 'v2-tunnel-wall');
      scene.add(wall);
    }
    const ceil = ribbon(sList, [[-HW, TH], [HW, TH]], 'up',
      std(0x2c3138, { roughness: 0.95 }), false);
    label(ceil, 'v2-tunnel-ceiling');
    scene.add(ceil);
    // wall colliders (tag 'curb', like the classic city)
    for (let s = TUN.s0 + 6; s < TUN.s1; s += 12) {
      const yaw = yawFromTan(track.frameAt(s).tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * HW, TH / 2);
        physics.addStaticBox(0.5, TH / 2, 6.3, p.x, p.y, p.z, yaw, 'curb');
      }
    }
    // Emissive ceiling light strips (always on) at lat +/-6.
    for (const side of [-1, 1]) {
      const strip = ribbon(sList, [[side * 6 - 0.25, TH - 0.25], [side * 6 + 0.25, TH - 0.25]],
        'up', basic(0xcfeaff), false);
      label(strip, 'v2-tunnel-strip');
      scene.add(strip);
    }
    // Wall sconces every 40 m (emissive boxes).
    const nSc = Math.floor((TUN.s1 - TUN.s0) / 40);
    const scIM = instIM(new THREE.BoxGeometry(0.5, 0.9, 1.6), basic(0x9fe8ff), nSc * 2);
    label(scIM, 'v2-tunnel-sconce');
    let sci = 0;
    for (let k = 0; k < nSc; k++) {
      const s = TUN.s0 + 20 + k * 40;
      const yaw = yawFromTan(track.frameAt(s).tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * (HW - 0.6), 4.2);
        composeInst(scIM, sci++, p.x, p.y, p.z, yaw);
      }
    }
    scene.add(scIM);
    // Real point lights down the tube.
    for (let k = 0; k < 8; k++) {
      const s = TUN.s0 + (k + 0.5) * ((TUN.s1 - TUN.s0) / 8);
      const p = track.toWorld(s, 0, TH - 1);
      const pl = new THREE.PointLight(0x9fd0ff, 1200, 110, 1.8);
      pl.position.set(p.x, p.y, p.z);
      scene.add(pl);
    }
    // Glowing portal frames at both ends.
    for (const [sP, isEntry] of [[TUN.s0, true], [TUN.s1, false]]) {
      const f = track.frameAt(sP), yaw = yawFromTan(f.tan);
      const grp = new THREE.Group();
      const col = isEntry ? 0x35f2ff : 0xffb35c;
      const mk = (w, h, d, lat, hh) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), basic(col));
        const p = track.toWorld(sP, lat, 0);
        m.position.set(p.x, f.pos.y + hh, p.z);
        m.rotation.y = yaw;
        label(m, 'v2-tunnel-portal');
        grp.add(m);
      };
      mk(1.2, TH + 1.5, 1.2, -(HW + 0.6), (TH + 1.5) / 2);
      mk(1.2, TH + 1.5, 1.2, HW + 0.6, (TH + 1.5) / 2);
      mk((HW + 0.6) * 2 + 1.2, 1.2, 1.2, 0, TH + 1.2);
      scene.add(grp);
    }
  }
  // Ridge hills flanking the tunnel tube (from the plan — never over it).
  {
    const hillMat = std(0x141b2e, {
      roughness: 1, flatShading: true, emissive: 0x16233d, emissiveIntensity: 0.6,
    });
    const hills = PLAN.tunnel.hills;
    const hillIM = instIM(new THREE.IcosahedronGeometry(1, 1), hillMat, hills.length);
    label(hillIM, 'v2-hill-ridge');
    hills.forEach((h, i) => {
      composeInst(hillIM, i, h.x, -9 + h.peak * 0.35, h.z, i * 1.7, h.r, h.peak * 0.55, h.r);
    });
    scene.add(hillIM);
  }

  // ---------------------------------------------------------------- bridge
  // Section E: the road IS the deck. Two suspension towers (plan towers_x),
  // catenary main cables landing on the tower tops, suspenders to the deck
  // edge, emissive deck-edge light strips.
  {
    const bd = PLAN.bridge;
    const LAT = bd.column_lateral_m; // 17
    // Tower stations: s in section E minimizing |x - towers_x|.
    const towerS = bd.towers_x.map((tx) => {
      let bs = BR.s0, bdd = Infinity;
      for (let s = BR.s0; s <= BR.s1; s += 2) {
        const p = track.frameAt(s).pos;
        const d = Math.abs(p.x - tx);
        if (d < bdd) { bdd = d; bs = s; }
      }
      return bs;
    });
    console.log(`[city_v2] tower stations: ${towerS.map((s) => s.toFixed(0)).join(', ')}`);
    const towerMat = std(0x27395e, {
      roughness: 0.5, metalness: 0.6, emissive: 0x2a6bff, emissiveIntensity: 0.5,
    });
    const steelDark = std(0x1a2233, { roughness: 0.55, metalness: 0.75 });
    // columns: base -> top, at +/- LAT
    const colIM = instIM(new THREE.BoxGeometry(2.6, 1, 2.6), towerMat, 4);
    label(colIM, 'v2-bridge-tower');
    let tci = 0;
    for (const sT of towerS) {
      const yaw = yawFromTan(track.frameAt(sT).tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(sT, side * LAT, 0);
        const h = bd.column_top_y - bd.column_base_y;
        composeInst(colIM, tci++, p.x, bd.column_base_y + h / 2, p.z, yaw, 1, h, 1);
      }
    }
    scene.add(colIM);
    // crossbeams between the column pair at two heights
    for (const sT of towerS) {
      const f = track.frameAt(sT), yaw = yawFromTan(f.tan);
      const lat = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const c = track.toWorld(sT, 0, 0);
      for (const hy of [bd.column_top_y - 6, bd.column_top_y - 20]) {
        const a = c.clone().addScaledVector(lat, -LAT); a.y = hy;
        const b = c.clone().addScaledVector(lat, LAT); b.y = hy;
        const len = a.distanceTo(b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const beam = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 2.6), towerMat);
        beam.position.copy(mid);
        beam.rotation.y = yaw + Math.PI / 2;
        label(beam, 'v2-bridge-tower');
        scene.add(beam);
      }
    }
    // main cables: deck anchors -> tower tops -> mid sag -> tower tops
    const P3 = (s, lat, yAbs) => {
      const p = track.toWorld(s, lat, 0);
      return new THREE.Vector3(p.x, yAbs, p.z);
    };
    const cableCurves = [];
    for (const side of [-1, 1]) {
      const [sT1, sT2] = towerS;
      const pts = [
        P3(sT1 - 170, side * LAT, bd.cable_anchor_y),
        P3(sT1 - 80, side * LAT, bd.cable_anchor_y + 10),
        P3(sT1, side * LAT, bd.column_top_y - 1),
        P3((sT1 + sT2) / 2, side * LAT, bd.column_top_y - 26),
        P3(sT2, side * LAT, bd.column_top_y - 1),
        P3(sT2 + 80, side * LAT, bd.cable_anchor_y + 10),
        P3(sT2 + 170, side * LAT, bd.cable_anchor_y),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.35, 6), towerMat);
      label(tube, 'v2-bridge-cable');
      scene.add(tube);
      cableCurves.push(curve);
    }
    // suspenders: cable -> deck edge every 24 m between towers
    const cableSamples = cableCurves.map((c) => c.getPoints(200));
    const suspIM = instIM(new THREE.CylinderGeometry(0.12, 0.12, 1, 6), towerMat,
      Math.ceil((towerS[1] - towerS[0]) / 24) * 2);
    label(suspIM, 'v2-bridge-suspender');
    let sui = 0;
    for (let s = towerS[0]; s <= towerS[1]; s += 24) {
      for (let cs = 0; cs < 2; cs++) {
        const dp = track.toWorld(s, (cs === 0 ? -1 : 1) * LAT, 0);
        let cy = Infinity;
        for (const sp of cableSamples[cs]) {
          const d = (sp.x - dp.x) * (sp.x - dp.x) + (sp.z - dp.z) * (sp.z - dp.z);
          if (d < 400 && sp.y < cy) cy = sp.y;
        }
        if (!isFinite(cy)) continue;
        const h = Math.max(1, cy - dp.y);
        composeInst(suspIM, sui++, dp.x, dp.y + h / 2, dp.z, 0, 1, h, 1);
      }
    }
    suspIM.count = sui;
    scene.add(suspIM);
    // deck-edge light strips along the whole bridge section
    const nE = Math.floor((BR.s1 - BR.s0) / 6);
    const edgeIM = instIM(new THREE.BoxGeometry(0.35, 0.35, 6.2), basic(0x9fd0ff), nE * 2);
    label(edgeIM, 'v2-bridge-edge-light');
    let ei = 0;
    for (let k = 0; k < nE; k++) {
      const s = BR.s0 + k * 6 + 3;
      const yaw = yawFromTan(track.frameAt(s).tan);
      for (const side of [-1, 1]) {
        const p = track.toWorld(s, side * 12.2, 0.7);
        composeInst(edgeIM, ei++, p.x, p.y, p.z, yaw);
      }
    }
    scene.add(edgeIM);
  }

  // ------------------------------------------------------- district massing
  // Seeded by district index (deterministic). Blocks inside each district
  // rect, cleared >= 20 m from the circuit centerline and out of the bay.
  const buildings = []; // {x,z,yaw,w,h,d,s}
  {
    const padY = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: -99, 6: -4 };
    const placements = [];
    PLAN.districts.forEach((d, di) => {
      if (d.heights_m[1] <= 0) return; // SOUTH RIDGE: hills only, no massing
      const rnd = mulberry32(1000 + di);
      const [x0, x1, z0, z1] = d.rect;
      const [hMin, hMax] = d.heights_m;
      for (let gx = x0 + 14; gx < x1 - 14; gx += 44) {
        for (let gz = z0 + 14; gz < z1 - 14; gz += 44) {
          const x = gx + (rnd() - 0.5) * 14, z = gz + (rnd() - 0.5) * 14;
          if (inBay(x, z, 8)) continue;
          const w = 16 + rnd() * 14, dep = 16 + rnd() * 14;
          // B3: every footprint corner stays >= 16 m from the centerline.
          // (Center-based test alone lets 30 m-wide faces reach ~5 m from
          // the racing line — the chase camera at 10.5 m would clip inside.)
          if (trackDist(x, z) < 16 + Math.hypot(w, dep) / 2) continue;
          const h = Math.max(8, Math.min(60, hMin + rnd() * (hMax - hMin)));
          placements.push({ x, z, w, d: dep, h, color: d.color, yaw: (rnd() - 0.5) * 0.2, pad: padY[di] || 0 });
        }
      }
    });
    const bIM = instIM(new THREE.BoxGeometry(1, 1, 1),
      std(0xffffff, { roughness: 0.85, metalness: 0.1 }), placements.length);
    label(bIM, 'v2-building');
    const col = new THREE.Color();
    placements.forEach((b, i) => {
      composeInst(bIM, i, b.x, b.pad + b.h / 2, b.z, b.yaw, b.w, b.h, b.d);
      col.set(b.color).multiplyScalar(0.75 + 0.5 * ((i * 37) % 10) / 10);
      bIM.setColorAt(i, col);
      // nearest s for buildingsNear()
      let bi = 0, bd = Infinity;
      for (let k = 0; k < track.N; k += 8) {
        const p = track.pos[k];
        const dd = (p.x - b.x) * (p.x - b.x) + (p.z - b.z) * (p.z - b.z);
        if (dd < bd) { bd = dd; bi = k; }
      }
      buildings.push({ x: b.x, z: b.z, yaw: b.yaw, w: b.w, h: b.h, d: b.d, s: track.sOfIndex(bi) });
    });
    bIM.instanceColor.needsUpdate = true;
    scene.add(bIM);
    // district ground pads (tinted, sit on the big ground)
    PLAN.districts.forEach((d, di) => {
      if (d.heights_m[1] <= 0) return;
      const [x0, x1, z0, z1] = d.rect;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0),
        std(new THREE.Color(d.color).multiplyScalar(0.16), { roughness: 1 }));
      g.geometry.rotateX(-Math.PI / 2);
      g.position.set((x0 + x1) / 2, (padY[di] || 0) - 0.05, (z0 + z1) / 2);
      label(g, 'v2-district-pad');
      scene.add(g);
    });
    console.log(`[city_v2] buildings: ${placements.length}`);
  }

  // --------------------------------------------- sealed decorative streets
  // Thin (3 m) DIM flat strips for avenues_ns / cross_streets_ew, clipped
  // to clearance_m from the circuit (the gen_axonometric_v2.py approach:
  // sample the polyline finely, keep points >= clearance, split into runs).
  {
    const CLR = PLAN.sealed_streets.clearance_m;
    const streetMat = basic(0x39415a);
    function clippedStrips(xs, zs, width) {
      const runs = [];
      let cur = [];
      for (let i = 0; i < xs.length; i++) {
        if (trackDist(xs[i], zs[i]) >= CLR) cur.push([xs[i], zs[i]]);
        else if (cur.length) { runs.push(cur); cur = []; }
      }
      if (cur.length) runs.push(cur);
      for (const run of runs) {
        if (run.length < 2) continue;
        const rows = run.length;
        const verts = new Float32Array(rows * 2 * 3);
        const idx = [];
        // street direction for the perpendicular
        for (let k = 0; k < rows; k++) {
          const [x, z] = run[k];
          const [x2, z2] = run[Math.min(rows - 1, k + 1)];
          const [x0, z0] = run[Math.max(0, k - 1)];
          let dx = x2 - x0, dz = z2 - z0;
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const px = -dz * width / 2, pz = dx * width / 2;
          const vi = k * 6;
          verts[vi] = x + px; verts[vi + 1] = 0.12; verts[vi + 2] = z + pz;
          verts[vi + 3] = x - px; verts[vi + 4] = 0.12; verts[vi + 5] = z - pz;
          if (k < rows - 1) {
            const a = k * 2, b = k * 2 + 1, c = k * 2 + 2, d2 = k * 2 + 3;
            idx.push(a, c, b, b, c, d2);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        g.computeVertexNormals();
        g.setIndex(idx);
        const m = new THREE.Mesh(g, streetMat);
        label(m, 'v2-street');
        scene.add(m);
      }
    }
    const lin = (a, b, n) => {
      const out = [];
      for (let i = 0; i <= n; i++) out.push(a + (b - a) * (i / n));
      return out;
    };
    const av = PLAN.sealed_streets.avenues_ns;
    for (const gx of av.x) {
      clippedStrips(new Array(116).fill(gx), lin(av.z_range[0], av.z_range[1], 115), 3);
    }
    const cs = PLAN.sealed_streets.cross_streets_ew;
    for (const gz of cs.z) {
      clippedStrips(lin(cs.x_range[0], cs.x_range[1], 57), new Array(58).fill(gz), 3);
    }
  }

  // ------------------------------------------------------------------ S/F
  // Checkered gantry banner across the road + start line painted on the
  // road at the plan's start_finish s (348 m, mid-straight).
  {
    const sSF = PLAN.start_finish.s_m;
    const f = track.frameAt(sSF), yaw = yawFromTan(f.tan);
    const postMat = std(0x2a3140, { roughness: 0.6, metalness: 0.5 });
    for (const side of [-1, 1]) {
      const p = track.toWorld(sSF, side * 13.4, 0);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9, 0.9), postMat);
      post.position.set(p.x, f.pos.y + 4.5, p.z);
      post.rotation.y = yaw;
      label(post, 'v2-gantry');
      scene.add(post);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(27.5, 2.6),
      new THREE.MeshBasicMaterial({ map: makeGantryTexture(), side: THREE.DoubleSide }));
    const bp = track.toWorld(sSF, 0, 0);
    banner.position.set(bp.x, f.pos.y + 7.6, bp.z);
    banner.rotation.y = yaw;
    label(banner, 'v2-gantry');
    scene.add(banner);
    // checkered start line flat on the road
    const line = new THREE.Mesh(new THREE.PlaneGeometry(24, 3),
      new THREE.MeshBasicMaterial({ map: makeStartLineTexture() }));
    line.geometry.rotateX(-Math.PI / 2);
    const lp = track.toWorld(sSF, 0, 0.06);
    line.position.set(lp.x, lp.y, lp.z);
    line.rotation.y = yaw;
    label(line, 'v2-start-line');
    scene.add(line);
  }

  // ------------------------------------------------------------ nitro (14)
  const BOTTLES = 14;
  let botIM, botRingIM;
  {
    const dyn = (im) => { im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); return im; };
    botIM = dyn(instIM(new THREE.IcosahedronGeometry(0.55, 0), basic(0x39ff88), BOTTLES));
    label(botIM, 'v2-nitro-bottle');
    botRingIM = dyn(instIM(new THREE.TorusGeometry(0.95, 0.09, 6, 22), basic(0x39ff88), BOTTLES));
    label(botRingIM, 'v2-nitro-bottle');
    scene.add(botIM, botRingIM);
  }

  // ------------------------------------------------- traffic visuals (20)
  // Real Kenney car-kit GLB clones (preloaded by boot before buildCityV2),
  // one per car, fade/scale-in on spawn. physics gates colliders on
  // trafficFade(). Group origin is at ground level under the car center.
  const TRAFFIC_N = 20;
  const tCars = [];
  const T_MODELS = ['sedan', 'taxi', 'suv', 'truck'];
  const T_COLORS = { sedan: 0x3a5a9a, taxi: null, suv: 0x2a6a4a, truck: 0xd8d8d8 };
  {
    for (let i = 0; i < TRAFFIC_N; i++) {
      const model = T_MODELS[i % T_MODELS.length];
      const grp = buildTrafficCarMesh(model, T_COLORS[model]);
      grp.visible = false;
      label(grp, 'v2-traffic');
      scene.add(grp);
      tCars.push({ fade: 0, s: null, grp });
    }
  }

  function syncTraffic(traffic) {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - lastSyncT) / 1000));
    lastSyncT = now;
    for (let i = 0; i < TRAFFIC_N; i++) {
      const c = traffic[i], st = tCars[i];
      if (!c) { st.grp.visible = false; st.s = null; st.fade = 0; continue; }
      // a track-space jump > 150 m means spawn/respawn -> restart fade
      const ds = st.s === null ? 999 : wrapDelta(c.s - st.s);
      if (Math.abs(ds) > 150) st.fade = 0;
      else st.fade = Math.min(1, st.fade + dt * 1.4);
      st.s = c.s;
      const k = 0.05 + 0.95 * (1 - Math.pow(1 - st.fade, 3));
      const f = track.frameAt(c.s);
      const yaw = yawFromTan(f.tan) + (c.kind === 'oncoming' ? Math.PI : 0);
      const p = track.toWorld(c.s, c.lane, 0);
      st.grp.position.set(p.x, p.y, p.z);
      st.grp.rotation.set(0, yaw, 0);
      st.grp.scale.setScalar(Math.max(0.0001, k));
      st.grp.visible = true;
    }
  }
  let lastSyncT = 0;

  const _zero = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  _zero.setPosition(0, -100, 0);
  function hideSlot(im, idx) { im.setMatrixAt(idx, _zero); }

  function setTunnelGlow(f) {
    tunnelAmbient.intensity = Math.max(0, Math.min(1.4, f));
  }
  function buildingsNear(s, range) {
    return buildings.filter((b) => Math.abs(wrapDelta(b.s - s)) < range);
  }
  function trafficFade() {
    return tCars.map((c) => +c.fade.toFixed(3));
  }

  // Scratch objects reused in the per-frame loop.
  const _bv = new THREE.Vector3();

  function update(dt, elapsed, bottles) {
    // nitro bottles: bob + spin, hidden when taken
    if (bottles) {
      for (let i = 0; i < BOTTLES && i < bottles.length; i++) {
        const b = bottles[i];
        if (!b.active) { hideSlot(botIM, i); hideSlot(botRingIM, i); continue; }
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
