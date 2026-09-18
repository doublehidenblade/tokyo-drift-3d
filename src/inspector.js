// Tokyo Drift 3D — World Inspector (Milestone 6).
// ---------------------------------------------------------------------------
// View-only inspector for iterating on model fidelity/variety and world
// design separately. Two sub-views, toggled from the inspector top bar:
//
//   ASSET VIEWER — every distinct 3D model asset in the live scene, one row
//     per asset class (name + instance count). Selecting a row isolates the
//     asset on a neutral stage with manual orbit + pinch-zoom (no
//     OrbitControls dependency). Per-asset stats: triangle count, material
//     count, bounding-box size.
//
//   CITY PLAN — 2D top-down map of the whole world: districts (clustered
//     from building data), the track spline as a polyline, bridge span,
//     tunnel cut, signage district, water/bay area. Pan + pinch-zoom.
//
// Asset discovery: traverses the scene graph reading mesh.userData.asset
// labels when present (the world agent is adding these). When labels are
// missing it falls back to grouping meshes by geometry/material signature
// (geometry type + dimensions + material type/color/texture). Composite
// assets (e.g. the player/rival race cars, which are Groups of meshes) can
// be registered via deps.extraAssets = [{ name, object }].
//
// INTEGRATION (main.js — coordinator applies; this file is standalone):
//   import { createInspector } from './inspector.js';
//   // in boot(), after scene.add(playerMesh, rivalMesh):
//   inspector = createInspector({ scene, track, city, renderer,
//     extraAssets: [ { name:'player-racecar', object: playerMesh },
//                    { name:'rival-racecar',  object: rivalMesh } ] });
//   document.getElementById('btn-inspect').addEventListener('click', () => {
//     togglePause(true); setPauseVisible(false);
//     document.getElementById('overlay').style.display = 'none';
//     inspector.open('assets');
//   });
//   inspector.onClose = () => { togglePause(false); setPauseVisible(false);
//     document.getElementById('overlay').style.display = 'flex'; };
//   // in loop(), right after trackFps(dt):
//   if (inspector && inspector.isOpen()) { inspector.update(dt); return; }
//   // in onResize(): if (inspector) inspector.onResize();
//   // in the keydown handler, before the P/Escape toggle:
//   if (inspector && inspector.isOpen() && e.code === 'Escape')
//     { e.preventDefault(); inspector.close(); return; }
//
// All models are procedural — the inspector never edits the game scene; the
// stage reuses (never mutates) the game's geometries/materials.
import * as THREE from 'three';

const HONESTY = 'ALL MODELS PROCEDURAL \u2014 NO DESIGNER ASSETS';
// s-range of the dense-signage district. Source: city.js inDistrict()
// (s >= 2400 && s <= 3500). Hardcoded here because it lives in a closure
// inside buildCity; if city.js changes it, update this to match.
const SIGNAGE_S0 = 2400, SIGNAGE_S1 = 3500;
// HUD / menu element ids the inspector hides while it is open.
const HIDE_IDS = ['topbar', 'laptimebar', 'speedo', 'nitro-lbl', 'nitro-meter',
  'btn-nitro', 'btn-pause', 'paused-pill'];

// ---------------------------------------------------------------------------
// Signature helpers (the no-label fallback for asset discovery).
// ---------------------------------------------------------------------------
function geoDesc(g) {
  const p = g.parameters || {};
  const n = (v) => (typeof v === 'number' ? +v.toFixed(2) : v);
  switch (g.type) {
    case 'BoxGeometry': return `box ${n(p.width)}\u00d7${n(p.height)}\u00d7${n(p.depth)}`;
    case 'PlaneGeometry': return `plane ${n(p.width)}\u00d7${n(p.height)}`;
    case 'CylinderGeometry': return `cyl r${n(p.radiusTop)}/${n(p.radiusBottom)} h${n(p.height)}`;
    case 'SphereGeometry': return `sphere r${n(p.radius)}`;
    case 'ConeGeometry': return `cone r${n(p.radius)} h${n(p.height)}`;
    case 'CircleGeometry': return `disc r${n(p.radius)}`;
    case 'TubeGeometry': return 'tube';
    case 'TorusGeometry': return `torus r${n(p.radius)}`;
    default: return (g.type || 'mesh').replace(/Geometry$/, '').toLowerCase() || 'mesh';
  }
}
function geoSig(g) {
  const pos = g.attributes && g.attributes.position;
  const tess = g.index ? 'i' + g.index.count : 'v' + (pos ? pos.count : 0);
  return geoDesc(g) + '|' + tess;
}
function matSig(m) {
  if (!m) return 'nomat';
  if (Array.isArray(m)) return 'multi[' + m.map(matSig).join(',') + ']';
  const parts = [m.type || '?'];
  if (m.color) parts.push('#' + m.color.getHexString());
  if (m.map) parts.push('map' + m.map.uuid.slice(0, 8));
  if (m.emissiveMap) parts.push('em' + m.emissiveMap.uuid.slice(0, 8));
  if (m.emissive) parts.push('e#' + m.emissive.getHexString());
  if (m.emissiveIntensity !== undefined) parts.push('ei' + (+m.emissiveIntensity).toFixed(2));
  if (m.roughness !== undefined) parts.push('r' + (+m.roughness).toFixed(2));
  if (m.metalness !== undefined) parts.push('m' + (+m.metalness).toFixed(2));
  if (m.transparent) parts.push('T');
  if (m.opacity !== undefined && m.opacity < 1) parts.push('o' + (+m.opacity).toFixed(2));
  return parts.join('|');
}
function shortMat(t) {
  return { MeshStandardMaterial: 'std', MeshBasicMaterial: 'basic',
    MeshPhysicalMaterial: 'phys', MeshLambertMaterial: 'lamb' }[t] || (t || '?');
}
function triCount(g) {
  const p = g.attributes && g.attributes.position;
  if (!p) return 0;
  return Math.round((g.index ? g.index.count : p.count) / 3);
}
// Light-touch, shape-only hint for the asset list subtitle. Deliberately
// generic ("-like") — the authoritative names come from userData.asset
// labels once the world agent adds them.
function shapeHint(desc) {
  if (/^box/.test(desc)) {
    const dims = desc.match(/[\d.]+/g).map(Number);
    const mx = Math.max(...dims);
    if (mx >= 25) return 'tower-like block';
    if (mx >= 6) return 'block / kiosk-like';
    return 'small box part';
  }
  if (/^plane/.test(desc)) return 'sign face / panel-like';
  if (/^cyl/.test(desc)) {
    const d = desc.match(/[\d.]+/g).map(Number);
    if (d[0] < 0.7 && d[2] < 0.7) return 'wheel-like';
    return 'pole / column-like';
  }
  if (/^sphere/.test(desc)) return 'beacon / lamp-like';
  if (/^cone/.test(desc)) return 'light cone-like';
  if (/^disc/.test(desc)) return 'disc (moon?)';
  if (/^tube/.test(desc)) return 'wire / cable-like';
  return '';
}

export function createInspector(deps) {
  const scene = deps.scene, track = deps.track, city = deps.city, renderer = deps.renderer;
  const extraAssets = deps.extraAssets || [];

  let isOpen = false, view = 'assets';
  let dom = null;
  let stageScene = null, stageCam = null, stageGroup = null, orbit = null;
  let stageMatClone = null; // per-selection material clone (instance tint), disposed on reselect
  let classes = null, selIdx = 0;
  let plan = null, planView = null, planBase = 1;
  let onCloseCb = null, lastInteract = 0;

  // -----------------------------------------------------------------------
  // DOM + CSS (injected; index.html only needs the menu button).
  // -----------------------------------------------------------------------
  function buildDom() {
    if (dom) return;
    const st = document.createElement('style');
    st.textContent = `
#insp-root{position:fixed;inset:0;z-index:60;display:none;color:#fff;
 font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
 user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
#insp-root.open{display:block}
#insp-stage{position:absolute;inset:0;touch-action:none}
#insp-plan{position:absolute;inset:0;width:100%;height:100%;touch-action:none;display:none;background:#05070f}
#insp-topbar{position:absolute;top:0;left:0;right:0;min-height:60px;display:flex;align-items:center;
 gap:10px;padding:calc(10px + env(safe-area-inset-top)) 12px 10px;z-index:6;pointer-events:none;
 background:linear-gradient(180deg,rgba(4,6,14,.94) 0%,rgba(4,6,14,.55) 70%,transparent 100%)}
#insp-topbar>*{pointer-events:auto}
#insp-back{min-width:84px;min-height:46px;padding:10px 16px;border-radius:12px;cursor:pointer;
 border:1px solid rgba(53,242,255,.55);background:rgba(8,14,28,.75);color:#8ff7ff;
 font-weight:800;font-size:15px;letter-spacing:.06em}
#insp-back:active{background:rgba(53,242,255,.25)}
#insp-seg{flex:1;display:flex;justify-content:center}
#insp-segbox{display:flex;border:1px solid rgba(255,95,162,.55);border-radius:14px;overflow:hidden;background:rgba(8,10,24,.6)}
#insp-segbox button{min-height:46px;padding:10px 22px;background:transparent;border:0;cursor:pointer;
 color:#ffb3d4;font-weight:800;font-size:14px;letter-spacing:.1em}
#insp-segbox button.on{background:rgba(255,95,162,.28);color:#fff}
#insp-assetui{position:absolute;left:0;right:0;bottom:0;z-index:5;display:flex;flex-direction:column;
 max-height:48%;padding:8px 12px calc(10px + env(safe-area-inset-bottom));
 background:linear-gradient(0deg,rgba(4,6,13,.97) 55%,rgba(4,6,13,.78) 85%,transparent 100%)}
#insp-stats{background:rgba(10,16,32,.85);border:1px solid rgba(53,242,255,.3);border-radius:14px;padding:10px 12px}
#insp-stats h2{font-size:15px;font-weight:800;letter-spacing:.04em;color:#8ff7ff;margin-bottom:6px;word-break:break-word}
#insp-statgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}
.insp-stat{background:rgba(255,255,255,.05);border-radius:8px;padding:6px 8px}
.insp-stat .k{font-size:9px;letter-spacing:.14em;opacity:.6}
.insp-stat .v{font-size:13px;font-weight:700;margin-top:2px;word-break:break-word}
#insp-note{font-size:11px;opacity:.65;margin-top:8px;line-height:1.5}
#insp-hint{font-size:10px;opacity:.45;margin-top:4px;letter-spacing:.06em}
#insp-list{overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:8px;touch-action:pan-y}
.insp-row{display:flex;align-items:center;gap:10px;min-height:54px;padding:8px 10px;cursor:pointer;
 border-bottom:1px solid rgba(255,255,255,.07);border-radius:8px}
.insp-row.on{background:rgba(53,242,255,.14)}
.insp-dot{width:16px;height:16px;border-radius:5px;flex:none;border:1px solid rgba(255,255,255,.25)}
.insp-name{font-size:13px;font-weight:700;line-height:1.3;word-break:break-word}
.insp-sub{font-size:11px;opacity:.62;margin-top:2px}
.insp-count{margin-left:auto;flex:none;font-size:12px;font-weight:800;color:#ffd319;background:rgba(255,211,25,.1);
 border:1px solid rgba(255,211,25,.35);border-radius:999px;padding:4px 10px}
#insp-afoot{font-size:9px;letter-spacing:.22em;opacity:.5;text-align:center;margin-top:8px}
#insp-planui{position:absolute;top:0;left:0;right:0;bottom:0;z-index:5;pointer-events:none;display:none}
#insp-legend{position:absolute;top:calc(66px + env(safe-area-inset-top));left:0;right:0;
 display:flex;gap:6px;overflow-x:auto;padding:6px 12px;pointer-events:auto;touch-action:pan-x}
.chip{flex:none;display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.04em;
 background:rgba(8,12,24,.78);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 11px}
.chip i{width:12px;height:12px;border-radius:4px;flex:none}
#insp-planfoot{position:absolute;left:12px;bottom:calc(10px + env(safe-area-inset-bottom));
 font-size:9px;letter-spacing:.2em;opacity:.55;pointer-events:none}`;
    document.head.appendChild(st);

    const root = document.createElement('div');
    root.id = 'insp-root';
    root.innerHTML = `
<div id="insp-stage"></div>
<canvas id="insp-plan"></canvas>
<div id="insp-topbar">
  <button id="insp-back">&lsaquo; BACK</button>
  <div id="insp-seg"><div id="insp-segbox">
    <button data-v="assets" class="on">ASSETS</button><button data-v="plan">CITY PLAN</button>
  </div></div>
</div>
<div id="insp-assetui">
  <div id="insp-stats"><h2 id="insp-sname">\u2014</h2>
    <div id="insp-statgrid"></div>
    <div id="insp-note"></div><div id="insp-hint">DRAG TO ORBIT &middot; PINCH TO ZOOM &middot; TWO-FINGER DRAG TO PAN</div>
  </div>
  <div id="insp-list"></div>
  <div id="insp-afoot">${HONESTY}</div>
</div>
<div id="insp-planui">
  <div id="insp-legend"></div>
  <div id="insp-planfoot">${HONESTY}</div>
</div>`;
    document.body.appendChild(root);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.querySelector('#insp-back').addEventListener('click', () => close());
    root.querySelectorAll('#insp-segbox button').forEach((b) =>
      b.addEventListener('click', () => setView(b.dataset.v)));

    dom = {
      root,
      stage: root.querySelector('#insp-stage'),
      plan: root.querySelector('#insp-plan'),
      assetui: root.querySelector('#insp-assetui'),
      planui: root.querySelector('#insp-planui'),
      list: root.querySelector('#insp-list'),
      sname: root.querySelector('#insp-sname'),
      statgrid: root.querySelector('#insp-statgrid'),
      note: root.querySelector('#insp-note'),
      legend: root.querySelector('#insp-legend'),
    };
    attachPlanGestures();
  }

  function setHudVisible(v) {
    for (const id of HIDE_IDS) {
      const el = document.getElementById(id);
      if (el) el.style.display = v ? '' : 'none';
    }
  }

  // -----------------------------------------------------------------------
  // Asset discovery.
  // -----------------------------------------------------------------------
  function scanScene() {
    if (classes) return classes;
    const byKey = new Map();
    const composites = [];
    scene.traverse((o) => {
      if (!o || o.userData && o.userData.assetIgnore) return;
      const label = o.userData && typeof o.userData.asset === 'string' ? o.userData.asset : null;
      const isInst = !!o.isInstancedMesh;
      const isMesh = !!o.isMesh && !isInst;
      if (!isMesh && !isInst) {
        // Composite asset: a labeled Group (or any labeled non-mesh node).
        if (label && o !== scene) composites.push({ name: label, label, composite: o });
        return;
      }
      if (!o.geometry) return;
      const key = label
        ? 'L:' + label
        : 'S:' + geoSig(o.geometry) + '|' + matSig(o.material) + (isInst ? '|I' : '|M');
      let rec = byKey.get(key);
      if (!rec) {
        rec = { key, label, items: [], isInst: false,
          geo: o.geometry, mat: o.material, geoDesc: geoDesc(o.geometry) };
        byKey.set(key, rec);
      }
      rec.items.push(o);
      if (isInst) rec.isInst = true;
    });
    const out = [];
    for (const rec of byKey.values()) {
      const instItems = rec.items.filter((o) => o.isInstancedMesh);
      const count = instItems.reduce((a, o) => a + (o.count || 0), 0)
        + (rec.items.length - instItems.length);
      const mats = new Set();
      for (const o of rec.items) {
        const m = o.material;
        if (Array.isArray(m)) m.forEach((x) => mats.add(x));
        else if (m) mats.add(m);
      }
      out.push({ ...rec, count, matCount: mats.size, geoTris: triCount(rec.geo) });
    }
    // Registered composites (player/rival cars etc.).
    for (const c of composites) out.push({ ...c, count: 1, matCount: 0, geoTris: 0, isComposite: true });
    for (const c of extraAssets) {
      if (c && c.object) out.push({ name: c.name, label: c.name, composite: c.object,
        count: 1, matCount: 0, geoTris: 0, isComposite: true, items: [] });
    }
    // Labeled classes first, then by instance count (empties last).
    out.sort((a, b) =>
      ((b.label ? 1 : 0) - (a.label ? 1 : 0)) || (b.count - a.count));
    for (const rec of out) rec.name = rec.name || autoName(rec);
    // Disambiguate identical auto-names (same signature text, different
    // textures — e.g. the per-word neon sign faces). First keeps the name,
    // the rest get v2, v3... Labeled assets never collide.
    const nameSeen = new Map();
    for (const rec of out) {
      if (rec.label) continue;
      const k = (nameSeen.get(rec.name) || 0) + 1;
      nameSeen.set(rec.name, k);
      if (k > 1) rec.name = `${rec.name} \u00b7 v${k}`;
    }
    classes = out;
    return classes;
  }

  function autoName(rec) {
    if (rec.label) return rec.label;
    const m = Array.isArray(rec.mat) ? rec.mat[0] : rec.mat;
    const col = m && m.color ? '#' + m.color.getHexString() : '';
    const tint = rec.items.some((o) => o.instanceColor) ? ' inst-tint' : '';
    const tex = m && m.map ? ' +tex' : '';
    return `${rec.geoDesc} \u00b7 ${shortMat(m && m.type)}${col}${tex}${tint}`.trim();
  }

  function instanceStats(rec) {
    // Union bbox over sampled instances + median per-axis scale (used for
    // the stage representative so a unit-box building shows at a typical size).
    const geoBB = new THREE.Box3();
    if (rec.geo.boundingBox) geoBB.copy(rec.geo.boundingBox);
    else { rec.geo.computeBoundingBox(); geoBB.copy(rec.geo.boundingBox); }
    const corners = [];
    for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++)
      corners.push(new THREE.Vector3(
        ix ? geoBB.max.x : geoBB.min.x, iy ? geoBB.max.y : geoBB.min.y,
        iz ? geoBB.max.z : geoBB.min.z));
    const bb = new THREE.Box3();
    const xs = [], ys = [], zs = [];
    const m4 = new THREE.Matrix4(), pv = new THREE.Vector3(),
      qv = new THREE.Quaternion(), sv = new THREE.Vector3(), cv = new THREE.Vector3();
    for (const o of rec.items) {
      if (!o.isInstancedMesh) { bb.expandByObject(o); continue; }
      const n = o.count || 0;
      const stride = Math.max(1, Math.floor(n / 160));
      for (let i = 0; i < n; i += stride) {
        o.getMatrixAt(i, m4);
        m4.decompose(pv, qv, sv);
        xs.push(Math.abs(sv.x)); ys.push(Math.abs(sv.y)); zs.push(Math.abs(sv.z));
        for (const c of corners) { cv.copy(c).applyMatrix4(m4); bb.expandByPoint(cv); }
      }
    }
    const med = (a) => {
      if (!a.length) return 1;
      a.sort((x, y) => x - y);
      return a[a.length >> 1] || 1;
    };
    return { bb, medianScale: new THREE.Vector3(med(xs), med(ys), med(zs)) };
  }

  // -----------------------------------------------------------------------
  // Stage scene + manual orbit (touch + pinch + wheel). No OrbitControls.
  // -----------------------------------------------------------------------
  // Studio environment for the stage: a bright neutral "studio HDRI"
  // (procedural equirect + PMREM). The game's night env is near-black,
  // which makes metallic car paint unreadable; the studio env lights the
  // model like a turntable without touching the game scene.
  function makeStudioEnv() {
    try {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      // Bright studio sky: full-metal materials (metalness 1, no diffuse)
      // show only the blurred env, so the upper hemisphere must be
      // luminous on average or top faces render near-black. Canvas top
      // maps to +Y (verified by probe), so the bright sky goes at the top.
      const grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, '#eef2fb');
      grad.addColorStop(0.35, '#b9c4da');
      grad.addColorStop(0.6, '#5c667e');
      grad.addColorStop(1, '#181d29');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#ffffff'; g.fillRect(10, 6, 110, 26);   // big key softbox
      g.fillStyle = '#fff6e8'; g.fillRect(150, 12, 80, 20);  // warm second softbox
      g.fillStyle = '#d8ecff'; g.fillRect(90, 44, 76, 14);   // cool strip
      g.fillStyle = '#ffe3f1'; g.fillRect(196, 58, 48, 12);  // magenta kicker
      g.fillStyle = '#ffd9a8'; g.fillRect(0, 76, 256, 8);    // warm horizon band
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      // CanvasTexture defaults flipY=true, which would put the bright sky
      // at -Y (top faces would sample the dark ground half). Verified by
      // probe: with flipY=false the canvas top maps to +Y.
      tex.flipY = false;
      const pm = new THREE.PMREMGenerator(renderer);
      const env = pm.fromEquirectangular(tex).texture;
      tex.dispose(); pm.dispose();
      return env;
    } catch (_) { return scene.environment || null; }
  }

  function ensureStage() {
    if (stageScene) return;
    stageScene = new THREE.Scene();
    stageScene.background = new THREE.Color(0x0a0d16);
    const studio = makeStudioEnv();
    if (studio) stageScene.environment = studio;
    stageScene.add(new THREE.HemisphereLight(0x9db4ff, 0x0a0c12, 0.8));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(6, 10, 7);
    stageScene.add(key);
    const rim = new THREE.DirectionalLight(0x35f2ff, 0.8);
    rim.position.set(-8, 4, -6);
    stageScene.add(rim);
    const grid = new THREE.GridHelper(120, 60, 0x2a3a5f, 0x141c36);
    grid.position.y = -0.02;
    stageScene.add(grid);
    stageGroup = new THREE.Group();
    stageScene.add(stageGroup);
    stageCam = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 6000);
    orbit = makeOrbit(dom.stage, stageCam);
  }

  function makeOrbit(layer, cam) {
    const target = new THREE.Vector3();
    const st = { theta: 0.7, phi: 1.08, dist: 30, minD: 0.4, maxD: 3000 };
    const pts = new Map();
    let pinchD = 0, pinchMid = null;
    const _r = new THREE.Vector3(), _u = new THREE.Vector3();
    function apply() {
      const sp = Math.sin(st.phi), cp = Math.cos(st.phi);
      cam.position.set(
        target.x + st.dist * sp * Math.sin(st.theta),
        target.y + st.dist * cp,
        target.z + st.dist * sp * Math.cos(st.theta));
      cam.lookAt(target);
    }
    function panBy(dx, dy) {
      const s = st.dist * 0.0016;
      _r.setFromMatrixColumn(cam.matrix, 0);
      _u.setFromMatrixColumn(cam.matrix, 1);
      target.addScaledVector(_r, -dx * s).addScaledVector(_u, dy * s);
    }
    function frame(center, radius) {
      target.copy(center);
      const d = radius / Math.tan(cam.fov * Math.PI / 360) * 1.3;
      st.dist = Math.min(st.maxD, Math.max(st.minD, Math.max(d, radius * 1.2)));
      st.theta = 0.7; st.phi = 1.08;
      apply();
    }
    layer.addEventListener('pointerdown', (e) => {
      try { layer.setPointerCapture(e.pointerId); } catch (_) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastInteract = performance.now();
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchD = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
    });
    layer.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      lastInteract = performance.now();
      if (pts.size === 1) {
        st.theta -= dx * 0.006;
        st.phi = Math.min(2.95, Math.max(0.06, st.phi - dy * 0.006));
        apply();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        st.dist = Math.min(st.maxD, Math.max(st.minD, st.dist * pinchD / d));
        panBy(mid.x - pinchMid.x, mid.y - pinchMid.y);
        pinchD = d; pinchMid = mid;
        apply();
      }
    });
    const release = (e) => { pts.delete(e.pointerId); pinchD = 0; };
    layer.addEventListener('pointerup', release);
    layer.addEventListener('pointercancel', release);
    layer.addEventListener('wheel', (e) => {
      e.preventDefault();
      lastInteract = performance.now();
      st.dist = Math.min(st.maxD, Math.max(st.minD, st.dist * (1 + e.deltaY * 0.001)));
      apply();
    }, { passive: false });
    return { apply, frame, idle(dt) { st.theta += dt * 0.12; apply(); } };
  }

  function solidBox(root) {
    // Bbox of the "solid" parts only: excludes faint transparent helpers
    // (e.g. the race car's 16 m additive headlight cones) so the stage
    // frames the model, not its light fx. The helpers are still shown.
    const bb = new THREE.Box3();
    const tmp = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const m = o.material;
      const mats = Array.isArray(m) ? m : [m];
      const faint = mats.length && mats.every((x) => x && x.transparent && x.opacity < 0.35);
      if (faint) return;
      tmp.setFromObject(o);
      bb.union(tmp);
    });
    return bb;
  }

  function selectAsset(i) {
    selIdx = Math.max(0, Math.min(classes.length - 1, i));
    while (stageGroup.children.length) stageGroup.remove(stageGroup.children[0]);
    const rec = classes[selIdx];
    let rep, bb, note;
    if (rec.isComposite) {
      rep = rec.composite.clone(true);
      // Normalize: show the asset upright at the origin facing +Z, not in
      // its arbitrary game-world pose, so the first impression is a
      // consistent 3/4 view and the orbit target is sane.
      rep.position.set(0, 0, 0);
      rep.rotation.set(0, 0, 0);
      const full = new THREE.Box3().setFromObject(rep);
      const solid = solidBox(rep);
      bb = solid.isEmpty() ? full : solid;
      note = (rec.label ? `labeled asset \u2014 userData.asset = "${rec.label}"` : 'composite asset (registered group)') +
        (!solid.isEmpty() && solid.getSize(new THREE.Vector3()).length() < full.getSize(new THREE.Vector3()).length() * 0.7
          ? '; framed on solid parts (excludes faint fx helpers)' : '');
    } else if (rec.isInst) {
      const st8 = instanceStats(rec);
      if (stageMatClone) { stageMatClone.dispose(); stageMatClone = null; }
      let mat = rec.mat, tintNote = '';
      // Per-instance colors live on the InstancedMesh, not the material —
      // without this the representative renders the (usually white) base
      // color. Show the first instance's color on a cloned material.
      const tinted = rec.items.find((o) => o.isInstancedMesh && o.instanceColor);
      if (tinted && mat && !Array.isArray(mat) && mat.color) {
        mat = mat.clone();
        stageMatClone = mat;
        const c = new THREE.Color();
        tinted.getColorAt(0, c);
        mat.color.copy(c);
        mat.needsUpdate = true;
        tintNote = '; shown in first instance\u2019s color';
      }
      rep = new THREE.Mesh(rec.geo, mat);
      rep.scale.copy(st8.medianScale);
      bb = new THREE.Box3().setFromObject(rep);
      note = 'instanced mesh \u2014 shown at median instance scale' + tintNote + '; ' +
        (rec.label ? `labeled "${rec.label}"` : 'grouped by geometry/material signature (no label yet)');
    } else {
      rep = rec.items[0].clone(true);
      rep.position.set(0, 0, 0);
      rep.rotation.set(0, 0, 0);
      bb = new THREE.Box3().setFromObject(rep);
      note = rec.label ? `labeled "${rec.label}"`
        : 'grouped by geometry/material signature (no label yet)';
    }
    if (bb.isEmpty()) bb.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
    const center = bb.getCenter(new THREE.Vector3());
    const size = bb.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) / 2;
    stageGroup.add(rep);
    orbit.frame(center, Math.max(radius, 0.5));
    lastInteract = performance.now();
    renderStats(rec, size, radius, note);
    [...dom.list.children].forEach((row, k) => row.classList.toggle('on', k === selIdx));
    const row = dom.list.children[selIdx];
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function fmtInt(n) {
    return n >= 1000 ? n.toLocaleString('en-US') : String(n);
  }
  function renderStats(rec, size, radius, note) {
    dom.sname.textContent = rec.name;
    const totalTris = rec.isComposite
      ? compositeTris(rec.composite)
      : Math.round(rec.geoTris * Math.max(rec.count, 1));
    const mats = rec.isComposite ? countMats(rec.composite) : rec.matCount;
    const hint = shapeHint(rec.geoDesc || '');
    const cells = [
      ['INSTANCES', fmtInt(rec.count)],
      ['TRIANGLES', fmtInt(totalTris)],
      ['MATERIALS', String(mats)],
      ['SIZE (m)', `${size.x.toFixed(1)}\u00d7${size.y.toFixed(1)}\u00d7${size.z.toFixed(1)}`],
    ];
    dom.statgrid.innerHTML = cells.map(([k, v]) =>
      `<div class="insp-stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    dom.note.textContent = note + (hint ? ` \u2014 looks ${hint}.` : '');
  }
  function compositeTris(root) {
    let t = 0;
    root.traverse((o) => { if (o.isMesh && o.geometry) t += triCount(o.geometry); });
    return t;
  }
  function countMats(root) {
    const s = new Set();
    root.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => s.add(m));
        else s.add(o.material);
      }
    });
    return s.size;
  }

  function buildAssetList() {
    dom.list.innerHTML = '';
    const frag = document.createDocumentFragment();
    classes.forEach((rec, i) => {
      const m = Array.isArray(rec.mat) ? rec.mat[0] : rec.mat;
      const dot = m && m.color ? '#' + m.color.getHexString() : '#666';
      const trisEach = rec.isComposite ? compositeTris(rec.composite) : rec.geoTris;
      const mats = rec.isComposite ? countMats(rec.composite) : rec.matCount;
      const row = document.createElement('div');
      row.className = 'insp-row' + (i === selIdx ? ' on' : '');
      row.innerHTML = `<div class="insp-dot" style="background:${dot}"></div>
<div><div class="insp-name"></div>
<div class="insp-sub">${rec.geoDesc || 'composite group'} \u00b7 ${fmtInt(trisEach)} tris/mesh \u00b7 ${mats} mat</div></div>
<div class="insp-count">\u00d7${fmtInt(rec.count)}</div>`;
      row.querySelector('.insp-name').textContent = rec.name;
      row.addEventListener('click', () => selectAsset(i));
      frag.appendChild(row);
    });
    dom.list.appendChild(frag);
    const total = classes.reduce((a, r) => a + r.count, 0);
    const head = document.createElement('div');
    head.style.cssText = 'font-size:11px;letter-spacing:.12em;opacity:.55;padding:6px 10px 2px';
    head.textContent = `${classes.length} ASSET CLASSES \u00b7 ${fmtInt(total)} INSTANCES IN SCENE`;
    dom.list.prepend(head);
  }

  // -----------------------------------------------------------------------
  // CITY PLAN — 2D top-down map.
  // -----------------------------------------------------------------------
  function buildPlan() {
    if (plan) return plan;
    // Buildings via the city API (falls back to an empty set with a note).
    const seen = new Map();
    let haveBuildings = false;
    if (city && typeof city.buildingsNear === 'function') {
      const L = track.length;
      for (let s = 0; s < L; s += 40) {
        let list = null;
        try { list = city.buildingsNear(s, 40); } catch (_) { list = null; }
        if (!list) continue;
        haveBuildings = true;
        for (const b of list) {
          const k = Math.round(b.x) + ':' + Math.round(b.z);
          if (!seen.has(k)) seen.set(k, b);
        }
      }
    }
    const buildings = [...seen.values()];
    // Districts from CITY_PLAN.md (authoritative). The race track spline is
    // unchanged by the plan, so its s-ranges map onto the current track
    // directly. Names/character come from the plan; the per-district
    // building counts and average heights are the CURRENT scene's truth
    // via city.buildingsNear().
    const L = track.length;
    const PLAN_DISTRICTS = [
      { name: 'START PLAZA', char: 'mid-rise commercial 8\u201320 m', ranges: [[4941, 5227], [0, 470]], color: '#5ef2c8' },
      { name: 'HARBOR WEST', char: 'warehouses \u00b7 container stacks', ranges: [[470, 1235]], color: '#9fb4cc' },
      { name: 'THE CLIMB', char: 'mixed mid-rise 10\u201325 m', ranges: [[1235, 1502]], color: '#7dd8a8' },
      { name: 'BAY STRAIT', char: 'suspension bridge', ranges: [[1502, 2285]], color: '#ffb14e' },
      { name: 'WATERFRONT EAST', char: 'promenade \u00b7 piers', ranges: [[2285, 2573]], color: '#5ec8f2' },
      { name: 'DOWNTOWN', char: 'neon core \u00b7 towers 35\u201370 m \u00b7 densest signage', ranges: [[2573, 3573]], color: '#ff5fa2' },
      { name: 'SOUTH RIDGE', char: 'tunnel + ridge hills', ranges: [[3533, 4318]], color: '#b8c4d8' },
      { name: 'INDUSTRIAL EDGE', char: 'warehouses \u00b7 chimneys', ranges: [[4318, 4941]], color: '#d8a05e' },
    ];
    const inRanges = (s, ranges) => ranges.some(([a, b]) => s >= a && s <= b);
    for (const b of buildings) {
      const s = ((b.s % L) + L) % L;
      b._pd = PLAN_DISTRICTS.find((pd) => inRanges(s, pd.ranges)) || null;
    }
    const districts = [];
    PLAN_DISTRICTS.forEach((pd) => {
      const list = buildings.filter((b) => b._pd === pd);
      const di = districts.length;
      const avgH = list.length ? list.reduce((a, b) => a + b.h, 0) / list.length : 0;
      for (const b of list) b._di = di;
      districts.push({
        pd, n: list.length, avgH, name: pd.name, char: pd.char, color: pd.color,
        cx: 0, cz: 0, // anchored to the track span below (after segPts)
      });
    });
    // Track polyline (world XZ).
    const NPTS = 160, pts = [];
    for (let i = 0; i < NPTS; i++) {
      const p = track.pos[(i * track.N / NPTS) | 0];
      pts.push([p.x, p.z]);
    }
    const segPts = (s0, s1) => {
      const out = [];
      for (let s = s0; s <= s1; s += 8) {
        const p = track.pos[Math.min(track.N - 1, (s / track.length * track.N) | 0)];
        out.push([p.x, p.z]);
      }
      return out;
    };
    // Water channel corners (inverse of city.js inWaterRect).
    const W = track.water, cy = Math.cos(W.yaw), sy = Math.sin(W.yaw);
    const waterCorners = [];
    for (const [u, v] of [[-W.w / 2, -W.d / 2], [W.w / 2, -W.d / 2], [W.w / 2, W.d / 2], [-W.w / 2, W.d / 2]])
      waterCorners.push([W.cx + u * cy - v * sy, W.cz - (u * sy + v * cy)]);
    // Anchor each district label to the middle of its track span, so even
    // building-free districts (BAY STRAIT over the water) get labeled.
    for (const d of districts) {
      const spans = [];
      for (const [a, b] of d.pd.ranges) spans.push(...segPts(a, b));
      const m = spans[(spans.length / 2) | 0];
      if (m) { d.cx = m[0]; d.cz = m[1]; }
    }
    // Bounds.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const eat = (x, z) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    };
    pts.forEach(([x, z]) => eat(x, z));
    waterCorners.forEach(([x, z]) => eat(x, z));
    buildings.forEach((b) => eat(b.x, b.z));
    const pad = 0.06;
    plan = {
      buildings, districts, haveBuildings, pts,
      bridge: segPts(track.bridge.s0, track.bridge.s1),
      tunnel: segPts(track.tunnel.s0, track.tunnel.s1),
      signage: segPts(SIGNAGE_S0, SIGNAGE_S1),
      waterCorners,
      start: pts[0],
      bounds: { minX, maxX, minZ, maxZ, pad },
    };
    return plan;
  }

  function fitPlan() {
    const c = dom.plan;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    const { minX, maxX, minZ, maxZ, pad } = plan.bounds;
    const bw = (maxX - minX) * (1 + pad * 2), bh = (maxZ - minZ) * (1 + pad * 2);
    planBase = Math.min(w / bw, h / bh);
    planView = {
      cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2,
      scale: planBase,
    };
  }

  function drawPlan() {
    const c = dom.plan, ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, w, h);
    const s = planView.scale;
    const X = (x) => (x - planView.cx) * s + w / 2;
    const Z = (z) => (z - planView.cz) * s + h / 2;
    const fs = Math.max(11, Math.min(16, w / 34));
    const halo = (txt, x, y) => {
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.strokeText(txt, x, y); ctx.fillText(txt, x, y);
    };
    const strokePts = (pts, style, widthM, dash) => {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), Z(pts[0][1]));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Z(pts[i][1]));
      ctx.closePath();
      ctx.strokeStyle = style;
      ctx.lineWidth = Math.max(1, widthM * s);
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    // Water.
    ctx.beginPath();
    plan.waterCorners.forEach(([x, z], i) => i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)));
    ctx.closePath();
    ctx.fillStyle = '#0e2c5e'; ctx.fill();
    ctx.strokeStyle = '#2a5aa8'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#7db4ff'; ctx.font = `700 ${fs}px system-ui`;
    halo('BAY', X(plan.waterCorners[0][0]) + 10, Z(plan.waterCorners[0][1]) + fs + 8);
    // Buildings, tinted by sector.
    for (const b of plan.buildings) {
      const d = b._di !== undefined ? plan.districts[b._di] : null;
      ctx.save();
      ctx.translate(X(b.x), Z(b.z));
      ctx.rotate(-(b.yaw || 0));
      ctx.fillStyle = d ? d.color : '#6b7280';
      ctx.globalAlpha = 0.88;
      ctx.fillRect(-b.w / 2 * s, -b.d / 2 * s, Math.max(1.5, b.w * s), Math.max(1.5, b.d * s));
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // Road band + centerline.
    strokePts(plan.pts, '#12151f', 26);
    strokePts(plan.pts, 'rgba(53,242,255,.85)', 2.5);
    // Tunnel cut (dark band) + bridge span (amber band).
    strokePts(plan.tunnel, '#020306', 30);
    strokePts(plan.tunnel, 'rgba(255,255,255,.35)', 1.2, [8, 8]);
    strokePts(plan.bridge, 'rgba(255,180,61,.9)', 34);
    // Dense-signage district highlight.
    strokePts(plan.signage, 'rgba(255,95,162,.45)', 32, [14, 10]);
    const clampX = (x) => Math.max(90, Math.min(w - 90, x));
    // Keep block labels clear of the legend row at the top.
    const clampY = (y) => Math.max(152, Math.min(h - 56, y));
    // Block labels (signage + districts): vertical de-collision so adjacent
    // districts never print on top of each other.
    const blocks = [];
    {
      const m = plan.signage[(plan.signage.length / 2) | 0];
      blocks.push({
        x: clampX(X(m[0])) + 8, y: clampY(Z(m[1])) - 10,
        title: 'SIGNAGE DISTRICT', color: '#ff8fc4', sub: null,
      });
    }
    for (let i = 0; i < plan.districts.length; i++) {
      const d = plan.districts[i];
      blocks.push({
        x: clampX(X(d.cx)), y: clampY(Z(d.cz)),
        title: d.name,
        color: d.color,
        sub: d.n ? `${d.n} bldgs \u00b7 avg ${d.avgH.toFixed(0)} m \u00b7 ${d.char}` : d.char,
      });
    }
    blocks.sort((a, b) => a.y - b.y);
    const gap = fs * 2.7;
    for (let i = 1; i < blocks.length; i++)
      if (blocks[i].y < blocks[i - 1].y + gap) blocks[i].y = blocks[i - 1].y + gap;
    for (const b of blocks) {
      b.y = Math.min(b.y, h - 56);
      // Fit the full text width inside the canvas (center-aligned).
      ctx.textAlign = 'center';
      ctx.font = `800 ${fs}px system-ui`;
      const wTitle = ctx.measureText(b.title).width;
      ctx.font = `600 ${fs - 2}px system-ui`;
      const wSub = b.sub ? ctx.measureText(b.sub).width : 0;
      const half = Math.max(wTitle, wSub) / 2 + 10;
      b.x = Math.max(half, Math.min(w - half, b.x));
      ctx.font = `800 ${fs}px system-ui`;
      ctx.fillStyle = b.color;
      halo(b.title, b.x, b.y);
      if (b.sub) {
        ctx.font = `600 ${fs - 2}px system-ui`;
        ctx.fillStyle = '#aeb6cc';
        halo(b.sub, b.x, b.y + fs + 2);
      }
    }
    ctx.textAlign = 'left';
    if (!plan.haveBuildings)
      halo('NO BUILDING DATA (city.buildingsNear unavailable)', 14, h - 60);
    // Start/finish.
    ctx.beginPath();
    ctx.arc(X(plan.start[0]), Z(plan.start[1]), 7, 0, Math.PI * 2);
    ctx.fillStyle = '#7dff9e'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#04120a'; ctx.stroke();
    ctx.font = `800 ${fs - 1}px system-ui`;
    ctx.fillStyle = '#7dff9e';
    halo('START/FINISH', X(plan.start[0]) + 12, Z(plan.start[1]) + 4);
    // Compass (N = -Z, i.e. up on this map). Kept clear of the legend row
    // and the top-right sector labels.
    const nx = w - 46, ny = 214;
    ctx.beginPath(); ctx.arc(nx, ny, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,24,.8)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nx, ny + 10); ctx.lineTo(nx, ny - 10);
    ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(nx, ny - 14); ctx.lineTo(nx - 5, ny - 5); ctx.lineTo(nx + 5, ny - 5);
    ctx.closePath(); ctx.fillStyle = '#ff5fa2'; ctx.fill();
    ctx.font = `800 11px system-ui`; ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 34); ctx.textAlign = 'left';
    // Scale bar.
    const cands = [25, 50, 100, 200, 500, 1000];
    let best = cands[0], bd = Infinity;
    for (const m of cands) { const d = Math.abs(m * s - 90); if (d < bd) { bd = d; best = m; } }
    const bw = best * s, bx = w - bw - 16, by = h - 34;
    ctx.fillStyle = 'rgba(8,12,24,.8)';
    ctx.fillRect(bx - 8, by - 16, bw + 16, 34);
    ctx.fillStyle = '#fff'; ctx.fillRect(bx, by, bw, 3);
    ctx.fillRect(bx, by - 4, 2, 7); ctx.fillRect(bx + bw - 2, by - 4, 2, 7);
    ctx.font = `700 11px system-ui`; ctx.textAlign = 'center';
    ctx.fillText(best >= 1000 ? (best / 1000) + ' km' : best + ' m', bx + bw / 2, by + 14);
    ctx.textAlign = 'left';
  }

  function buildLegend() {
    dom.legend.innerHTML = '';
    const chips = [
      ['TRACK', '#35f2ff'], ['ROAD', '#3a3f4a'], ['BRIDGE', '#ffb43d'],
      ['TUNNEL', '#cdd6ea'], ['BAY', '#2a5aa8'], ['SIGNAGE', '#ff5fa2'],
      ['BUILDING', '#6b7280'],
    ];
    for (const d of plan.districts) {
      chips.push([d.name, d.color]);
    }
    for (const [t, c] of chips) {
      const el = document.createElement('div');
      el.className = 'chip';
      el.innerHTML = `<i style="background:${c}"></i><span></span>`;
      el.querySelector('span').textContent = t;
      dom.legend.appendChild(el);
    }
  }

  function attachPlanGestures() {
    // Attached once at buildDom time; handlers no-op unless plan view is up.
    const pts = new Map();
    let pinchD = 0, lastTap = 0;
    const cv = () => dom.plan;
    const onDown = (e) => {
      if (view !== 'plan' || !isOpen) return;
      try { cv().setPointerCapture(e.pointerId); } catch (_) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinchD = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      }
    };
    const onMove = (e) => {
      if (view !== 'plan' || !isOpen || !pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) {
        planView.cx -= dx / planView.scale;
        planView.cz -= dy / planView.scale;
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const r = cv().getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
        zoomAt(mx, my, d / pinchD);
        pinchD = d;
      }
      drawPlan();
    };
    const onUp = (e) => {
      const wasSingle = pts.size === 1 && pts.has(e.pointerId);
      pts.delete(e.pointerId);
      if (wasSingle && view === 'plan' && isOpen) {
        const now = performance.now();
        if (now - lastTap < 320) { fitPlan(); drawPlan(); lastTap = 0; }
        else lastTap = now;
      }
    };
    const zoomAt = (mx, my, f) => {
      const ns = Math.min(planBase * 60, Math.max(planBase * 0.4, planView.scale * f));
      const k = ns / planView.scale;
      const r = cv().getBoundingClientRect();
      const wx = planView.cx + (mx - r.width / 2) / planView.scale;
      const wz = planView.cz + (my - r.height / 2) / planView.scale;
      planView.scale = ns;
      planView.cx = wx - (mx - r.width / 2) / ns;
      planView.cz = wz - (my - r.height / 2) / ns;
    };
    // Listeners are bound lazily on first plan view to keep buildDom light.
    dom._planBound = false;
    dom.bindPlan = () => {
      if (dom._planBound) return;
      dom._planBound = true;
      const el = dom.plan;
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      el.addEventListener('wheel', (e) => {
        if (view !== 'plan' || !isOpen) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        zoomAt(e.clientX - r.left, e.clientY - r.top, 1 - e.deltaY * 0.001);
        drawPlan();
      }, { passive: false });
    };
  }

  // -----------------------------------------------------------------------
  // View switching + public API.
  // -----------------------------------------------------------------------
  function setView(v) {
    view = v === 'plan' ? 'plan' : 'assets';
    dom.root.querySelectorAll('#insp-segbox button')
      .forEach((b) => b.classList.toggle('on', b.dataset.v === view));
    const isPlan = view === 'plan';
    dom.plan.style.display = isPlan ? 'block' : 'none';
    dom.planui.style.display = isPlan ? 'block' : 'none';
    dom.stage.style.display = isPlan ? 'none' : 'block';
    dom.assetui.style.display = isPlan ? 'none' : 'flex';
    if (isPlan) {
      dom.bindPlan();
      buildPlan();
      fitPlan();
      buildLegend();
      // Defer one frame so clientWidth is final.
      requestAnimationFrame(() => { if (isOpen && view === 'plan') { fitPlan(); drawPlan(); } });
    } else {
      ensureStage();
      selectAsset(selIdx);
    }
  }

  function open(v) {
    buildDom();
    if (isOpen) { setView(v || view); return; }
    isOpen = true;
    setHudVisible(false);
    dom.root.classList.add('open');
    scanScene();
    buildAssetList();
    setView(v || 'assets');
    lastInteract = performance.now();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    dom.root.classList.remove('open');
    setHudVisible(true);
    if (onCloseCb) { const f = onCloseCb; f(); }
  }

  function update(dt) {
    if (!isOpen) return;
    if (view === 'assets') {
      // Gentle auto-rotate until the user grabs the model.
      if (performance.now() - lastInteract > 5000 && orbit) orbit.idle(dt);
      renderer.render(stageScene, stageCam);
    }
    // Plan view is a static 2D canvas, redrawn on demand by gestures.
  }

  function onResize() {
    if (!isOpen || !dom) return;
    if (stageCam) {
      stageCam.aspect = window.innerWidth / window.innerHeight;
      stageCam.updateProjectionMatrix();
    }
    if (view === 'plan' && planView) drawPlan();
  }

  return {
    open, close,
    isOpen: () => isOpen,
    getView: () => view,
    setView: (v) => { if (isOpen) setView(v); },
    update, onResize,
    // Test/debug hooks (do not use in gameplay code paths).
    assetCount: () => (classes ? classes.length : 0),
    debug: () => ({
      hasStage: !!stageScene,
      hasEnv: !!(stageScene && stageScene.environment),
      envIsStudio: !!(stageScene && stageScene.environment && stageScene.environment !== scene.environment),
    }),
    // Raycast through a normalized stage-viewport point; reports what the
    // topmost surface is (material color / geometry) for visual debugging.
    probeAt: (nx, ny) => {
      if (!stageScene || !stageCam) return null;
      const rc = new THREE.Raycaster();
      rc.setFromCamera(new THREE.Vector2(nx, ny), stageCam);
      const hits = rc.intersectObjects(stageGroup.children, true);
      if (!hits.length) return { hit: false };
      const o = hits[0].object;
      const m = o.material;
      const mat = Array.isArray(m) ? m.map((x) => x.color ? '#' + x.color.getHexString() : '?').join(',')
        : (m && m.color ? '#' + m.color.getHexString() : String(m && m.type));
      return {
        hit: true, dist: +hits[0].distance.toFixed(2),
        geo: o.geometry ? o.geometry.type : '?',
        mat, metalness: m && m.metalness, roughness: m && m.roughness,
        name: o.name || '(unnamed)',
      };
    },
    probeMetal: () => {
      if (!stageScene) return null;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshPhysicalMaterial({
          color: 0xff6a1a, metalness: 1.0, roughness: 0.18, envMapIntensity: 1.8,
        }));
      box.position.set(0, 2, 0);
      stageScene.add(box);
      orbit.frame(new THREE.Vector3(0, 2, 0), 1.6);
      renderer.render(stageScene, stageCam);
      const src = renderer.domElement;
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0, 64, 64);
      const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
      const out = { front: px(32, 36), top: px(32, 22) };
      stageScene.remove(box);
      box.geometry.dispose();
      box.material.dispose();
      selectAsset(selIdx); // restore the selected asset's framing
      return out;
    },
    set onClose(fn) { onCloseCb = fn; },
  };
}
