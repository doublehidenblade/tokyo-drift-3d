// Player/rival/traffic car meshes — REAL Kenney car-kit GLB models
// (~/workspace/tokyo-drift-godot/assets/packs/kenney/kenney_car-kit.zip,
// vendored into assets/models/). The procedural box-car is gone.
//
// Loading is async: boot() must `await preloadCarModels()` before any
// build call. buildCarMesh keeps the old interface (mesh + userData.wheels
// positioned by main.js at WHEEL_SPOTS, userData.spot headlight).
// Collider contract unchanged: visuals stay inside |x| <= 1.4,
// |z| <= 2.8, 0 <= y <= ~1.9 (mesh origin at road level).
// VISUAL-ONLY module: physics never reads anything here except
// userData.wheels / userData.spot.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

export const CAR_W = 2.8;
export const CAR_L = 5.6;
// Uniform bake scale applied to the Kenney models (authored ~1.2 x 2.6 m).
// 2.0 -> race car is 2.4 m wide, 5.1 m long, 1.86 m tall.
export const MODEL_SCALE = 2.0;
// race.glb wheel node translations x MODEL_SCALE, front pair first
// (main.js steers indices 0,1). Recomputed from the template at preload.
export let WHEEL_SPOTS = [[0.7, 1.28], [-0.7, 1.28], [0.7, -1.76], [-0.7, -1.76]];
export let WHEEL_RADIUS = 0.6;

const MODEL_FILES = {
  race: 'race.glb',
  sedan: 'sedan.glb',
  taxi: 'taxi.glb',
  suv: 'suv.glb',
  truck: 'truck.glb',
};

const templates = {};   // name -> { scene, bodyGeo, wheelNames, bbox, paintRefs, baseMat }
let baseImageData = null; // colormap.png pixels for tinting
const tintCache = new Map(); // `${model}:${colorHex}` -> THREE.Material

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
}
function hslToRgb(h, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q; r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3); }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// Area-weighted histogram over the body's texels: the most common
// saturated texel colors are the paint family (Kenney paint jobs are the
// largest saturated area on the body). Returns up to 3 [r,g,b] refs.
function detectPaintRefs(bodyGeo, imgData) {
  const uv = bodyGeo.attributes.uv, pos = bodyGeo.attributes.position;
  const idx = bodyGeo.index;
  const W = imgData.width, H = imgData.height, d = imgData.data;
  const votes = new Map();
  const ax = new THREE.Vector3(), bx = new THREE.Vector3(), cx = new THREE.Vector3();
  const triN = idx ? idx.count / 3 : pos.count / 3;
  for (let t = 0; t < triN; t++) {
    const ia = idx ? idx.getX(t * 3) : t * 3;
    const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    ax.fromBufferAttribute(pos, ia); bx.fromBufferAttribute(pos, ib); cx.fromBufferAttribute(pos, ic);
    const area = bx.clone().sub(ax).cross(cx.clone().sub(ax)).length() / 2;
    if (area <= 1e-9) continue;
    const u = (uv.getX(ia) + uv.getX(ib) + uv.getX(ic)) / 3;
    const v = (uv.getY(ia) + uv.getY(ib) + uv.getY(ic)) / 3;
    const x = Math.min(W - 1, Math.max(0, Math.floor(u * W)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    const o = (y * W + x) * 4;
    const r = d[o], g = d[o + 1], b = d[o + 2];
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
    if (mx - mn < 0.25 || mx < 0.25) continue; // skip grays/blacks (glass, trim)
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const e = votes.get(key);
    if (e) e.w += area; else votes.set(key, { w: area, r, g, b });
  }
  return [...votes.values()].sort((a, b) => b.w - a.w).slice(0, 3)
    .map((e) => [e.r, e.g, e.b]);
}

// Recolor the paint-family texels toward targetHex, preserving the baked
// shading (relative lightness/saturation vs the matched ref).
function makeTintedTexture(imgData, refs, targetHex) {
  const W = imgData.width, H = imgData.height;
  const out = new ImageData(W, H);
  out.data.set(imgData.data);
  const tc = new THREE.Color(targetHex);
  const th = rgbToHsl(tc.r * 255, tc.g * 255, tc.b * 255);
  const rh = refs.map((c) => rgbToHsl(c[0], c[1], c[2]));
  const TH2 = 110 * 110;
  const dd = out.data;
  for (let i = 0; i < dd.length; i += 4) {
    const r = dd[i], g = dd[i + 1], b = dd[i + 2];
    let m = -1, md = Infinity;
    for (let k = 0; k < refs.length; k++) {
      const dr = r - refs[k][0], dg = g - refs[k][1], db = b - refs[k][2];
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 < md) { md = d2; m = k; }
    }
    if (m < 0 || md > TH2) continue;
    const hsl = rgbToHsl(r, g, b), ref = rh[m];
    const nl = Math.min(1, Math.max(0, hsl.l * (th.l / Math.max(0.05, ref.l))));
    const ns = Math.min(1, Math.max(0, th.s * (hsl.s / Math.max(0.05, ref.s))));
    const [nr, ng, nb] = hslToRgb(th.h, ns, nl);
    dd[i] = nr; dd[i + 1] = ng; dd[i + 2] = nb;
  }
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function tintedMaterial(model, colorHex) {
  const tpl = templates[model];
  if (colorHex === null || colorHex === undefined) return tpl.baseMat;
  const key = `${model}:${colorHex}`;
  let m = tintCache.get(key);
  if (!m) {
    const tex = makeTintedTexture(baseImageData, tpl.paintRefs, colorHex);
    m = tpl.baseMat.clone();
    m.map = tex;
    m.needsUpdate = true;
    tintCache.set(key, m);
  }
  return m;
}

function loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      resolve(g.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Boot-time preload. Must be awaited before buildCarMesh /
// buildTrafficCarMesh (traffic is built inside buildCity).
export async function preloadCarModels() {
  if (templates.race) return;
  const loader = new GLTFLoader();
  baseImageData = await loadImageData('assets/models/Textures/colormap.png');
  for (const [name, file] of Object.entries(MODEL_FILES)) {
    const gltf = await loader.loadAsync(`assets/models/${file}`);
    const scene = gltf.scene;
    // Bake the uniform scale into geometry + node translations. Guard
    // against geometries shared between meshes (scale each only once).
    const scaled = new Set();
    scene.traverse((o) => {
      if (o.isMesh && !scaled.has(o.geometry)) {
        scaled.add(o.geometry);
        o.geometry.scale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
      }
      o.position.multiplyScalar(MODEL_SCALE);
    });
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const body = meshes.find((m) => /body/i.test(m.name)) ||
      meshes.slice().sort((a, b) =>
        new THREE.Box3().setFromObject(b).getSize(new THREE.Vector3()).length() -
        new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3()).length())[0];
    const wheels = meshes.filter((m) => m !== body && /wheel/i.test(m.name));
    if (wheels.length !== 4) {
      // Fallback: every non-body mesh, front (+z) pair first.
      wheels.length = 0;
      for (const m of meshes) if (m !== body) wheels.push(m);
    }
    wheels.sort((a, b) => {
      const pa = new THREE.Vector3(), pb = new THREE.Vector3();
      a.getWorldPosition(pa); b.getWorldPosition(pb);
      if (Math.abs(pa.z - pb.z) > 0.05) return pb.z - pa.z; // front first
      return pb.x - pa.x;
    });
    const bbox = new THREE.Box3().setFromObject(scene);
    const paintRefs = detectPaintRefs(body.geometry, baseImageData);
    let baseMat = null;
    scene.traverse((o) => { if (o.isMesh && !baseMat) baseMat = o.material; });
    templates[name] = { scene, body, wheels, bbox, paintRefs, baseMat };
  }
  // Recompute the shared wheel spots from the race template (player/rival).
  const rw = templates.race.wheels.map((w) => {
    const p = new THREE.Vector3(); w.getWorldPosition(p); return p;
  });
  if (rw.length === 4) {
    const spots = rw.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]);
    const r = Math.hypot(rw[0].x, rw[0].z); // sanity: not degenerate
    if (r > 0.1) {
      const exp = WHEEL_SPOTS;
      const dev = Math.max(...spots.flatMap((s, i) =>
        [Math.abs(s[0] - exp[i][0]), Math.abs(s[1] - exp[i][1])]));
      if (dev > 0.02) console.warn('[car] wheel spots deviate from expectation', spots);
      WHEEL_SPOTS = spots;
      const bb = new THREE.Box3();
      templates.race.wheels.forEach((w) => bb.expandByObject(w));
      WHEEL_RADIUS = +((bb.max.y - bb.min.y) / 2).toFixed(3);
    }
  }
}

function cloneCar(model, colorHex) {
  const tpl = templates[model];
  if (!tpl) throw new Error(`car model '${model}' not preloaded`);
  const g = tpl.scene.clone(true);
  const mat = tintedMaterial(model, colorHex);
  const wheels = [];
  g.traverse((o) => {
    if (o.isMesh) {
      o.material = mat;
      o.castShadow = false;
      if (/wheel/i.test(o.name)) wheels.push(o);
    }
  });
  if (wheels.length === 0) {
    // Name fallback: every non-body mesh is a wheel (matches preload).
    const bodyName = tpl.body.name;
    g.traverse((o) => { if (o.isMesh && o.name !== bodyName) wheels.push(o); });
  }
  wheels.sort((a, b) => {
    if (Math.abs(a.position.z - b.position.z) > 0.05) return b.position.z - a.position.z;
    return b.position.x - a.position.x;
  });
  return { g, wheels, tpl };
}

// Simple emissive tweaks so the lights read at night: the Kenney body is a
// single mesh (lights are painted texels), so these small quads sit just
// proud of the nose/tail. Positions derive from the baked bbox.
function addLightQuads(g, tpl) {
  const bb = tpl.bbox;
  const w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
  const yH = bb.min.y + h * 0.55;
  const zF = bb.max.z + 0.02, zR = bb.min.z - 0.02;
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xd8ecff });
  const hlGeo = new THREE.PlaneGeometry(w * 0.14, h * 0.11);
  for (const s of [-1, 1]) {
    const q = new THREE.Mesh(hlGeo, hlMat);
    q.position.set(s * w * 0.31, yH, zF);
    g.add(q);
  }
  const tl = new THREE.Mesh(
    new THREE.PlaneGeometry(w * 0.62, h * 0.09),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  tl.position.set(0, yH + h * 0.03, zR);
  tl.rotation.y = Math.PI;
  g.add(tl);
}

// assetLabel: 'player-racecar' / 'rival-racecar'. main.js calls
// buildCarMesh(color) without a label, so infer from the known body colors:
// 0xff6a1a = player (orange), 0x1ad1c0 = rival (teal).
export function buildCarMesh(bodyColor, assetLabel) {
  const { g, wheels } = cloneCar('race', bodyColor);
  g.userData.asset = assetLabel ||
    (bodyColor === 0xff6a1a ? 'player-racecar' :
     bodyColor === 0x1ad1c0 ? 'rival-racecar' : 'racecar');
  addLightQuads(g, templates.race);

  // Headlight LIGHT CONES: additive geometry (cheap, no extra lights).
  const coneGeo = new THREE.ConeGeometry(2.2, 16, 12, 1, true);
  coneGeo.translate(0, -8, 0);      // apex at origin, opens downward...
  coneGeo.rotateX(-Math.PI / 2);   // ...then point it forward (+Z)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbfe0ff, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    fog: false,
  });
  const bb = templates.race.bbox;
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(s * (bb.max.x - bb.min.x) * 0.31, bb.min.y + (bb.max.y - bb.min.y) * 0.5, bb.max.z + 0.15);
    cone.rotation.x = 0.045; // slight downward tilt onto the road
    g.add(cone);
  }

  // One real spotlight so the road ahead is genuinely lit.
  const spot = new THREE.SpotLight(0xcfe4ff, 1400, 70, 0.46, 0.55, 1.6);
  spot.position.set(0, 1.1, bb.max.z);
  spot.target.position.set(0, 0, 32);
  g.add(spot, spot.target);

  g.userData.wheels = wheels;
  g.userData.spot = spot;
  return g;
}

// Traffic car visual: a tinted (or native-color, when colorHex is null)
// Kenney model clone. Wheels stay at authored positions — traffic is never
// repositioned by main.js. Cheap: no spotlight, no light cones.
export function buildTrafficCarMesh(model, colorHex) {
  const { g } = cloneCar(model, colorHex);
  addLightQuads(g, templates[model]);
  g.userData.asset = `traffic-${model}`;
  return g;
}
