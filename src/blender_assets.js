// Tokyo Drift 3D — Blender asset-pack integration (bt- namespace).
//
// Manifest-driven: assets/models/blender/manifest.json is fetched, every
// GLB in every category loads in parallel via GLTFLoader, and new models
// added to the manifest later load with NO code change here.
//
// Performance bake: per model, all geometries sharing a material are
// merged (BufferGeometryUtils.mergeGeometries) into ONE geometry, then a
// single THREE.InstancedMesh is created per (model, material). Draw calls
// stay ~= models x materials — never models x placements x meshes.
// Emissive materials (windows / neon signs / lamp heads) keep their
// authored emissive properties; glow materials are collected at bake time
// for the day/night cycle (see setGlowMode).
//
// Coordinate facts (measured from the GLBs — Blender convention, +Y up;
// the task text's "+Z up" was wrong):
//   models are centered at the origin (buildings span y in [-h/2, +h/2]).
// Every baked model is translated so its footprint centers on x/z = 0 and
// its BASE sits at y = 0 — placements then just supply the ground height.
//
// buildBlenderAssets(scene, track) starts the async GLB bake and returns
// a handle immediately; buildCityV2 awaits handle.ready before resolving
// (main.js does `city = await buildCity(...)`). Placements are computed
// deterministically (mulberry32); a failed pack load only warns — the
// world still boots on procedural massing.
//
// Scale discipline: models are used at authored scale 1.0 (never upscaled
// for buildings); props at most 1.2x (trees only). No floating signs —
// the bt- buildings carry their own mounted signboards.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/utils/BufferGeometryUtils.js';
import { PLAN } from './plan_v2.js';
import { mulberry32 } from './textures.js';

const BASE = 'assets/models/blender/';
const GLOW_RE = /window|sign|lamp|light|neon|emissive/i;
const GROUND_Y = -9; // the big v2 ground plane

// ------------------------------------------------------------------ handle
// Returned synchronously; the GLB bake streams in behind it.
export function buildBlenderAssets(scene, track) {
  const glowMats = []; // {mat, base}
  let glowFactor = 1, glowLive = false;
  const counts = {};
  let drawCalls = 0;
  const errors = [];

  function setGlowMode(f) {
    glowFactor = f;
    if (!glowLive) return;
    for (const g of glowMats) g.mat.emissiveIntensity = g.base * f;
  }

  const ready = (async () => {
    let manifest;
    try {
      const res = await fetch(BASE + 'manifest.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      manifest = await res.json();
    } catch (e) {
      errors.push(`manifest fetch failed: ${e.message}`);
      console.warn('[blender] manifest fetch failed — Blender dressing skipped:', e.message);
      return;
    }
    const entries = [];
    for (const cat of Object.values(manifest.categories || {}))
      for (const e of cat) entries.push(e);
    const byName = new Map(entries.map((e) => [e.name, e]));
    console.log(`[blender] manifest: ${entries.length} models`);
    const placements = computePlacements(track, byName);
    buildTrafficLights(scene, track, glowMats, counts);
    const loader = new GLTFLoader();
    await Promise.all(entries.map((e) =>
      bakeAndPlace(loader, scene, e, placements.get(e.name), glowMats, counts, errors)
        .catch((err) => {
          errors.push(`${e.name}: ${err.message}`);
          console.warn(`[blender] ${e.name} failed:`, err.message);
        })
    ));
    glowLive = true;
    setGlowMode(glowFactor);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`[blender] done: ${total} placements, ${drawCalls} draw calls, ` +
      `${glowMats.length} glow materials, ${errors.length} errors`);
  })();

  return {
    ready,          // Promise<void> — resolves when the pack finished baking
    setGlowMode,    // (f) emissive multiplier for glow materials (0.12 day / 1.0 night)
    counts,         // model name -> placement count (fills in as models bake)
    errors,         // load problems, if any
    get drawCalls() { return drawCalls; },
  };

  // -- bake one model, instance it at its placements ---------------------
  async function bakeAndPlace(loader, scene, entry, list, glowMats, counts, errors) {
    if (!list || !list.length) return; // loaded in manifest, but nothing placed
    const gltf = await loader.loadAsync(BASE + entry.file);
    gltf.scene.updateMatrixWorld(true);
    const perMat = new Map(); // material.uuid -> {mat, geos[]}
    const bbox = new THREE.Box3();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      g.computeBoundingBox();
      bbox.union(g.boundingBox);
      if (g.index) { const ng = g.toNonIndexed(); g.dispose(); g = ng; }
      const mat = o.material; // single material per mesh (verified: no multi-prim meshes)
      const key = mat.uuid;
      if (!perMat.has(key)) perMat.set(key, { mat, geos: [] });
      perMat.get(key).geos.push(g);
    });
    // Recenter: footprint centered on x/z = 0, BASE at y = 0.
    const c = bbox.getCenter(new THREE.Vector3());
    const ox = -c.x, oy = -bbox.min.y, oz = -c.z;
    for (const rec of perMat.values()) {
      for (const g of rec.geos) g.translate(ox, oy, oz);
      rec.merged = mergeGeometries(rec.geos, false);
      if (!rec.merged)
        console.warn(`[blender] merge failed for ${entry.name}/${rec.mat.name} — using split meshes`);
    }
    const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
          _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
    for (const rec of perMat.values()) {
      const geos = rec.merged ? [rec.merged] : rec.geos;
      for (const g of geos) {
        const im = new THREE.InstancedMesh(g, rec.mat, Math.max(1, list.length));
        im.frustumCulled = false; // placements span the whole lap
        im.userData.asset = 'bt/' + entry.name;
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          _e.set(0, p.yaw, 0); _q.setFromEuler(_e);
          _p.set(p.x, p.y, p.z); _s.set(p.sx, p.sy, p.sz);
          _m.compose(_p, _q, _s);
          im.setMatrixAt(i, _m);
        }
        im.count = list.length;
        im.instanceMatrix.needsUpdate = true;
        scene.add(im);
        drawCalls++;
      }
      if (isGlow(rec.mat)) glowMats.push({ mat: rec.mat, base: rec.mat.emissiveIntensity });
    }
    counts[entry.name] = list.length;
    console.log(`[blender] ${entry.name}: ${list.length} placements, ` +
      `${[...perMat.values()].length} material(s)`);
  }
}

function isGlow(mat) {
  return !!(mat && mat.emissive && mat.emissive.getHex() !== 0 &&
    (mat.emissiveIntensity > 0.25 || GLOW_RE.test(mat.name || '')));
}

// ------------------------------------------------------- placement tables
// Deterministic (mulberry32). byName gives manifest footprints so heights
// come from the pack, not hardcoded numbers.
function computePlacements(track, byName) {
  const L = track.length;
  const TUN = track.tunnel, BR = track.bridge;
  const bayR = PLAN.bay.rect;
  const inBay = (x, z, m) => x > bayR[0] - m && x < bayR[1] + m && z > bayR[2] - m && z < bayR[3] + m;
  const inTun = (s, m) => s > TUN.s0 - m && s < TUN.s1 + m;
  const inBr = (s, m) => s > BR.s0 - m && s < BR.s1 + m;
  const sections = PLAN.sections;
  const sectionOf = (s) => {
    for (const sec of sections) if (s >= sec.s0_m && s < sec.s1_m) return sec;
    return sections[sections.length - 1];
  };
  const yawFromTan = (tan) => Math.atan2(tan.x, tan.z);
  const rnd = mulberry32(20260918);
  const P = new Map();
  const add = (name, x, y, z, yaw, sc) => {
    if (!byName.has(name)) return; // model not in this manifest revision
    if (!P.has(name)) P.set(name, []);
    const s = sc === undefined ? 1 : sc;
    P.get(name).push({ x, y, z, yaw, sx: s, sy: s, sz: s });
  };
  const H = (name) => byName.get(name).footprint[2];

  // District pads (city_v2's padY table); null outside any district rect.
  const PAD = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: -99, 6: -4 };
  const padAt = (x, z) => {
    for (let di = 0; di < PLAN.districts.length; di++) {
      const r = PLAN.districts[di].rect;
      if (x >= r[0] && x <= r[1] && z >= r[2] && z <= r[3]) return PAD[di] ?? 0;
    }
    return null;
  };
  // Buildings always rest on something real: district pad, or the global
  // ground plane. The top is never buried below the road: keep >= 2 m of
  // facade above it.
  const buildingBaseY = (x, z, roadY, h) => {
    const pad = padAt(x, z);
    let base = pad === null
      ? Math.min(roadY - 0.3, GROUND_Y - 0.3)
      : Math.min(roadY - 0.3, pad - 0.35);
    if (base + h < roadY + 2) base = roadY + 2 - h;
    return base;
  };

  // ------------------------------------------------------------ buildings
  // Along the circuit every ~70 m, both sides, lat 26–50 m, yaw facing the
  // road. Skips: tunnel interior, bridge deck, bay water. Authored scale.
  const TOWERS = ['bt-commercial-tower-1', 'bt-commercial-tower-1a', 'bt-commercial-tower-1b',
    'bt-commercial-tower-2', 'bt-commercial-tower-2a', 'bt-commercial-tower-2b', 'bt-corner-building'];
  const SHOP = ['bt-shophouse-1', 'bt-shophouse-2', 'bt-midrise-1', 'bt-midrise-1a'];
  const MID = ['bt-midrise-1', 'bt-midrise-1a', 'bt-midrise-2'];
  const IND = ['bt-midrise-2', 'bt-corner-building'];
  const poolFor = (secId) => ({
    A: SHOP, B: SHOP, C: MID, D: MID, F: MID,
    G: TOWERS, H: TOWERS, I: TOWERS, K: IND, L: IND,
  }[secId] || MID);
  for (let s = 40; s < L - 20; s += 70) {
    if (inTun(s, 40) || inBr(s, 40)) continue;
    const pool = poolFor(sectionOf(s).id);
    for (const side of [-1, 1]) {
      const lat = side * (26 + rnd() * 24);
      const wp = track.toWorld(s + (rnd() - 0.5) * 8, lat, 0);
      if (inBay(wp.x, wp.z, 12)) continue;
      const name = pool[Math.floor(rnd() * pool.length)];
      const f = track.frameAt(s);
      const yaw = Math.atan2(-side * f.lat.x, -side * f.lat.z); // +Z faces the road
      add(name, wp.x, buildingBaseY(wp.x, wp.z, wp.y, H(name)), wp.z, yaw + (rnd() - 0.5) * 0.15);
    }
  }

  // ---------------------------------------------------------------- props
  // Lamp posts: every 45 m, alternating sides, lat ±13.5 (skip tunnel).
  // The arm (local +X) is flipped toward the road per side.
  let lside = 1;
  for (let s = 20; s < L; s += 45) {
    if (inTun(s, 15)) { lside = -lside; continue; }
    const wp = track.toWorld(s, lside * 13.5, 0);
    add('bt-lamp-post', wp.x, wp.y - 0.05, wp.z,
      yawFromTan(track.frameAt(s).tan) + (lside > 0 ? Math.PI : 0));
    lside = -lside;
  }
  // Planter boxes: every 30 m through DOWNTOWN (sections G–I), lat ±14.
  for (let s = 3360; s < 4370; s += 30) {
    if (inTun(s, 15)) continue;
    const yaw = yawFromTan(track.frameAt(s).tan);
    for (const sd of [-1, 1]) {
      const wp = track.toWorld(s, sd * 14, 0);
      add('bt-planter-box', wp.x, wp.y - 0.05, wp.z, yaw);
    }
  }
  // Traffic barriers: 5-per-side rows flanking the S/F gantry and both
  // tunnel portals (rows sit just outside the portals).
  for (const [sB, off] of [[PLAN.start_finish.s_m, -7], [TUN.s0, -16], [TUN.s1, 4]]) {
    const yaw = yawFromTan(track.frameAt(sB).tan) + Math.PI / 2;
    for (const sd of [-1, 1]) for (let k = 0; k < 5; k++) {
      const wp = track.toWorld(sB + off + k * 2.7, sd * 13.8, 0);
      add('bt-traffic-barrier', wp.x, wp.y - 0.05, wp.z, yaw);
    }
  }
  // Traffic cones: 6 clusters through section G (PACHINKO CHICANE).
  for (let c = 0; c < 6; c++) {
    const sC = 3380 + c * 48;
    for (let k = 0; k < 5; k++) {
      const wp = track.toWorld(sC + rnd() * 10, (rnd() - 0.5) * 11, 0);
      add('bt-traffic-cone', wp.x, wp.y - 0.02, wp.z, rnd() * Math.PI * 2);
    }
  }
  // Bus stops: 5 spots along the circuit, alternating sides.
  [600, 1500, 2500, 3800, 5300].forEach((sB, i) => {
    if (inTun(sB, 10) || inBr(sB, 10)) return;
    const sd = i % 2 === 0 ? 1 : -1;
    const wp = track.toWorld(sB, sd * 14.5, 0);
    add('bt-bus-stop', wp.x, wp.y - 0.05, wp.z, yawFromTan(track.frameAt(sB).tan) + Math.PI / 2);
  });
  // Signboard poles: every 60 m through DOWNTOWN, both sides.
  for (let s = 3360; s < 4370; s += 60) {
    if (inTun(s, 15)) continue;
    const f = track.frameAt(s);
    for (const sd of [-1, 1]) {
      const wp = track.toWorld(s, sd * 14.5, 0);
      add('bt-signboard-pole', wp.x, wp.y - 0.05, wp.z,
        Math.atan2(-sd * f.lat.x, -sd * f.lat.z));
    }
  }

  // ----------------------------------------------------------------- trees
  // Street trees: every 35 m through START PLAZA + HARBOR WEST, lat ±15.
  for (let s = 30; s < 1336; s += 35) {
    for (const sd of [-1, 1]) {
      const wp = track.toWorld(s, sd * 15, 0);
      add('bt-tree-street', wp.x, wp.y - 0.05, wp.z, rnd() * Math.PI * 2, 0.85 + rnd() * 0.3);
    }
  }
  // Park trees: scattered through THE CLIMB (sections C–D).
  for (let k = 0; k < 46; k++) {
    const s = 1340 + rnd() * 750;
    const sd = rnd() < 0.5 ? -1 : 1;
    const wp = track.toWorld(s, sd * (20 + rnd() * 50), 0);
    if (inBay(wp.x, wp.z, 10)) continue;
    const pad = padAt(wp.x, wp.z);
    const gy = pad === null ? Math.min(wp.y - 0.1, GROUND_Y - 0.1) : Math.min(wp.y - 0.1, pad - 0.15);
    add('bt-tree-park', wp.x, gy, wp.z, rnd() * Math.PI * 2, 0.8 + rnd() * 0.4);
  }

  // Sakura: if the manifest carries any /sakura/i model (none in the
  // current pack — noted), cluster them near the suburban districts
  // START PLAZA + HARBOR WEST (s 0–1336), lat ±(15–25) m, every ~50 m.
  // Manifest-driven: a future sakura GLB is placed with no code change.
  const sakura = [...byName.keys()].filter((n) => /sakura/i.test(n));
  if (sakura.length) {
    for (let s = 25; s < 1336; s += 50) {
      for (const sd of [-1, 1]) {
        const wp = track.toWorld(s + (rnd() - 0.5) * 10, sd * (15 + rnd() * 10), 0);
        add(sakura[Math.floor(rnd() * sakura.length)],
          wp.x, wp.y - 0.05, wp.z, rnd() * Math.PI * 2, 0.9 + rnd() * 0.3);
      }
    }
    console.log(`[blender] sakura models in manifest: ${sakura.join(', ')}`);
  }

  return P;
}

// ------------------------------------------------------ traffic lights
// No GLB exists — procedural: dark pole + head box + 3 emissive lamp
// spheres (red/yellow/green). Instanced: 5 draw calls total. Green on by
// default. Placed at all 12 section boundaries, both sides, lat ±13.5,
// skipping tunnel/bridge.
function buildTrafficLights(scene, track, glowMats, counts) {
  const TUN = track.tunnel, BR = track.bridge;
  const skip = (s) => (s > TUN.s0 - 20 && s < TUN.s1 + 20) || (s > BR.s0 - 20 && s < BR.s1 + 20);
  const spots = [];
  for (const sec of PLAN.sections) {
    for (const s of [sec.s0_m, sec.s1_m]) {
      if (skip(s)) continue;
      for (const sd of [-1, 1]) spots.push({ s, sd });
    }
  }
  // dedupe the shared A/L lap-line boundary (s=0 == s=L)
  const seen = new Set();
  const uniq = spots.filter((p) => {
    const k = `${Math.round(p.s)}:${p.sd}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const n = uniq.length;
  if (!n) return;
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.6, metalness: 0.4 });
  const lampMat = (color, on) => {
    const m = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, emissive: color, emissiveIntensity: on ? 2.4 : 0.12, roughness: 0.4,
    });
    m.name = on ? 'traffic-green' : 'traffic-off';
    return m;
  };
  const mk = (geo, mat, asset) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.frustumCulled = false;
    im.userData.asset = asset;
    scene.add(im);
    return im;
  };
  const poleIM = mk(new THREE.BoxGeometry(0.28, 5.4, 0.28), dark, 'proc/traffic-light-pole');
  const headIM = mk(new THREE.BoxGeometry(0.95, 2.1, 0.65), dark, 'proc/traffic-light-head');
  const redIM = mk(new THREE.SphereGeometry(0.24, 10, 8), lampMat(0xff2222, false), 'proc/traffic-light');
  const yelIM = mk(new THREE.SphereGeometry(0.24, 10, 8), lampMat(0xffaa00, false), 'proc/traffic-light');
  const grnIM = mk(new THREE.SphereGeometry(0.24, 10, 8), lampMat(0x22ff55, true), 'proc/traffic-light');
  glowMats.push({ mat: grnIM.material, base: 2.4 }); // green dims at day like other glow
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(),
        _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const set = (im, i, x, y, z, yaw) => {
    _e.set(0, yaw, 0); _q.setFromEuler(_e); _p.set(x, y, z);
    _m.compose(_p, _q, _s); im.setMatrixAt(i, _m);
  };
  uniq.forEach((sp, i) => {
    const f = track.frameAt(sp.s);
    const yaw = Math.atan2(f.tan.x, f.tan.z);
    const bp = track.toWorld(sp.s, sp.sd * 13.5, 0);
    // head hangs toward the road from the pole top
    const hx = bp.x - sp.sd * f.lat.x * 0.55, hz = bp.z - sp.sd * f.lat.z * 0.55;
    const hy = bp.y + 5.9;
    set(poleIM, i, bp.x, bp.y + 2.7, bp.z, yaw);
    set(headIM, i, hx, hy, hz, yaw);
    // lamps face the approaching drivers (-tangent side of the head box)
    const lx = hx - f.tan.x * 0.36, lz = hz - f.tan.z * 0.36;
    set(redIM, i, lx, hy + 0.65, lz, 0);
    set(yelIM, i, lx, hy, lz, 0);
    set(grnIM, i, lx, hy - 0.65, lz, 0);
  });
  for (const im of [poleIM, headIM, redIM, yelIM, grnIM]) im.instanceMatrix.needsUpdate = true;
  counts['proc-traffic-light'] = n;
  console.log(`[blender] proc traffic lights: ${n} masts, 5 draw calls (green default)`);
}
