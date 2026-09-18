// Tokyo Drift 3D — TrackV2: the v2 city-plan circuit.
//
// Same public interface as Track (src/track.js): frameAt(s,out),
// toWorld(s,lat,h,out), distAhead(sA,sB), inTunnel(s), inBridge(s,margin),
// nearestTrackPoint(pos), .length, .tunnel, .bridge, .water, plus the raw
// sample arrays (.pos/.yaw/.pitch/.bank/.N) and a chainage-aware
// sOfIndex(i) used by respawn.js.
//
// Built DIRECTLY from PLAN.route.sampled_centerline (768 points, no spline
// refit). IMPORTANT: the chainage column in the plan is NOT linear in the
// sample index (up to ~330 m off), so s <-> index mapping goes through the
// actual chainage values (binary search), never (i/N)*length.
//
// Bank formula and frame math are copied from track.js (same BANK_SMOOTH,
// BANK_MAX, BANK_REF_SPEED).
import * as THREE from 'three';
import { PLAN } from './plan_v2.js';

const BANK_SMOOTH = 8;      // samples for curvature smoothing
const BANK_MAX = 0.14;      // rad (~8 deg)
const BANK_REF_SPEED = 45;  // m/s used to size the banking

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class TrackV2 {
  constructor() {
    const sc = PLAN.route.sampled_centerline; // [x, z, y, s] per sample
    const N = sc.length;
    this.N = N;
    this.length = PLAN.meta.lap_length_m;

    // Per-sample: pos, yaw, pitch, bank. Lateral/up are derived.
    this.pos = new Array(N);
    this.yaw = new Float64Array(N);
    this.pitch = new Float64Array(N);
    this.bank = new Float64Array(N);
    this.chain = new Float64Array(N); // chainage s of each sample
    for (let i = 0; i < N; i++) {
      const p = sc[i];
      this.pos[i] = new THREE.Vector3(p[0], p[2], p[1]); // plan (x,z,y) -> three (x,y,z)
      this.chain[i] = p[3];
    }

    // yaw/pitch from central-difference segment tangents.
    const t = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      t.subVectors(this.pos[(i + 1) % N], this.pos[(i - 1 + N) % N]).normalize();
      this.yaw[i] = Math.atan2(t.x, t.z);
      this.pitch[i] = Math.asin(Math.max(-1, Math.min(1, t.y)));
    }

    // Curvature -> bank (track.js formula).
    const ds = this.length / N;
    const curv = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = this.yaw[(i + 1) % N];
      const b = this.yaw[(i - 1 + N) % N];
      curv[i] = wrapAngle(a - b) / (2 * ds);
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -BANK_SMOOTH; k <= BANK_SMOOTH; k++) {
        acc += curv[(i + k + N * 2) % N];
      }
      const c = acc / (2 * BANK_SMOOTH + 1);
      const raw = -Math.atan((BANK_REF_SPEED * BANK_REF_SPEED * c) / 9.81) * 0.7;
      this.bank[i] = Math.max(-BANK_MAX, Math.min(BANK_MAX, raw));
    }

    // Tunnel = section J from the plan; bridge = the plan's bridge
    // section_id resolved through the sections table.
    this.tunnel = { s0: PLAN.tunnel.s0_m, s1: PLAN.tunnel.s1_m };
    const bsec = PLAN.sections.find((s) => s.id === PLAN.bridge.section_id);
    this.bridge = { s0: bsec.s0_m, s1: bsec.s1_m };

    // Water: the bay rect from the plan, in the {cx,cz,w,d,y,yaw} shape
    // track.js used (kept for the inspector's water-channel overlay).
    const [bx0, bx1, bz0, bz1] = PLAN.bay.rect;
    this.water = {
      cx: (bx0 + bx1) / 2, cz: (bz0 + bz1) / 2,
      w: bx1 - bx0, d: bz1 - bz0,
      y: PLAN.bay.surface_y, yaw: 0,
    };

    // Dense road-elevation table (2x the physics sample rate — the same
    // tessellation the visual road mesh uses in city_v2.js). The car's Y
    // must come from this table, not from coarse frameAt interpolation:
    // on sharp crests the coarse curve cuts below the rendered road and
    // the car visibly sinks under the surface.
    const _mk = () => ({ pos: new THREE.Vector3(), tan: new THREE.Vector3(), lat: new THREE.Vector3(), yaw: 0 });
    const M = N * 2, yDense = new Float64Array(M), tf = _mk();
    for (let i = 0; i < M; i++) {
      this.frameAt((i / M) * this.length, tf);
      yDense[i] = tf.pos.y;
    }
    this._yDense = yDense;
    this._gy = _mk();
  }

  /** Linear-interpolated centerline elevation from the dense table. */
  roadYAt(s) {
    const T = this._yDense, n = T.length;
    const x = ((((s % this.length) + this.length) % this.length) / this.length) * n;
    const i0 = Math.floor(x), t = x - i0;
    return T[i0 % n] * (1 - t) + T[(i0 + 1) % n] * t;
  }

  /**
   * Exact road-surface height at (s, lat): dense centerline elevation
   * plus the banked lateral vector's vertical component. This is what the
   * visual road mesh renders, so physics must use it for the car body,
   * traffic, and rivals — the old code ignored the banked term and used
   * the coarse elevation, which put the car under the road on bumps.
   */
  groundYAt(s, lat) {
    this.frameAt(s, this._gy);
    return this.roadYAt(s) + this._gy.lat.y * lat;
  }

  // Chainage (meters) of sample i — the respawn.js contract uses this
  // instead of the (i/N)*length assumption (which is ~330 m off here).
  sOfIndex(i) {
    return this.chain[((i % this.N) + this.N) % this.N];
  }

  // Locate the bracketing sample pair for a lap distance s. Returns
  // { i0, i1, t } with t in [0,1] interpolating i0 -> i1 (i1 wraps to 0
  // past the final sample).
  _locate(s) {
    const N = this.N, ch = this.chain, L = this.length;
    s = ((s % L) + L) % L;
    if (s >= ch[N - 1]) {
      const span = L - ch[N - 1];
      return { i0: N - 1, i1: 0, t: span > 0 ? (s - ch[N - 1]) / span : 0 };
    }
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ch[mid] <= s) lo = mid; else hi = mid;
    }
    const span = ch[hi] - ch[lo];
    return { i0: lo, i1: hi, t: span > 0 ? (s - ch[lo]) / span : 0 };
  }

  _frameAtRaw(s) {
    const { i0, i1, t } = this._locate(s);
    const pos = new THREE.Vector3().lerpVectors(this.pos[i0], this.pos[i1], t);
    let dy = this.yaw[i1] - this.yaw[i0];
    dy = wrapAngle(dy);
    const yaw = this.yaw[i0] + dy * t;
    const pitch = this.pitch[i0] + (this.pitch[i1] - this.pitch[i0]) * t;
    const bank = this.bank[i0] + (this.bank[i1] - this.bank[i0]) * t;
    return { pos, yaw, pitch, bank };
  }

  // Full frame: pos, tan (unit, includes slope), lat (unit, banked).
  // lat = (cos(yaw), 0, -sin(yaw)) with yaw = atan2(t.x, t.z). For a driver
  // facing along +tan, +lat points to the driver's LEFT. Screen mapping is
  // NEVER assumed from this — main.js derives it per-frame from the camera
  // projection.
  // upB (unit, banked), yaw, bank.
  // Reuses scratch objects when `out` is supplied; otherwise allocates.
  frameAt(s, out) {
    const r = this._frameAtRaw(s);
    const cp = Math.cos(r.pitch), sp = Math.sin(r.pitch);
    const sy = Math.sin(r.yaw), cy = Math.cos(r.yaw);
    out = out || {};
    out.pos = out.pos || new THREE.Vector3();
    out.tan = out.tan || new THREE.Vector3();
    out.lat = out.lat || new THREE.Vector3();
    out.up = out.up || new THREE.Vector3();
    out.pos.copy(r.pos);
    out.tan.set(sy * cp, sp, cy * cp).normalize();
    // Horizontal right vector, then rolled about the tangent by bank.
    const lat0x = cy, lat0z = -sy;
    const cb = Math.cos(r.bank), sb = Math.sin(r.bank);
    const tx = out.tan.x, ty = out.tan.y, tz = out.tan.z;
    // tan x lat0
    const c1x = ty * lat0z - tz * 0;
    const c1y = tz * lat0x - tx * lat0z;
    const c1z = tx * 0 - ty * lat0x;
    out.lat.set(lat0x * cb + c1x * sb, c1y * sb, lat0z * cb + c1z * sb).normalize();
    // tan x up0 = (ty*0 - tz*1, tz*0 - tx*0, tx*1 - ty*0) = (-tz, 0, tx)
    out.up.set(-tz * sb, cb, tx * sb).normalize();
    out.yaw = r.yaw;
    out.bank = r.bank;
    out.pitch = r.pitch;
    return out;
  }

  // World position of a track-space point (s, lat, heightAboveRoad).
  toWorld(s, lat, h, out) {
    const f = this.frameAt(s);
    if (!out || !out.isVector3) out = new THREE.Vector3();
    out.copy(f.pos).addScaledVector(f.lat, lat).addScaledVector(f.up, h);
    return out;
  }

  // Signed wrap-aware distance from sA to sB along the lap (+ = ahead).
  distAhead(sA, sB) {
    let d = (sB - sA) % this.length;
    if (d < -this.length / 2) d += this.length;
    if (d > this.length / 2) d -= this.length;
    return d;
  }

  inTunnel(s) {
    return s > this.tunnel.s0 && s < this.tunnel.s1;
  }

  inBridge(s, margin) {
    const m = margin || 0;
    return s > this.bridge.s0 - m && s < this.bridge.s1 + m;
  }

  // Nearest centerline point to a world position.
  // Coarse scan over every 8th sample, then refine in the neighborhood.
  // Returns { point, tangent, s }:
  //   point   — THREE.Vector3 on the track centerline (freshly allocated)
  //   tangent — THREE.Vector3 unit tangent at s (freshly allocated)
  //   s       — meters along the lap [0, length), from the TRUE chainage
  //             (not the (i/N)*length assumption — see sOfIndex).
  // Continuous: after the coarse sample search, the query point is
  // projected onto the two track segments adjacent to the best sample.
  nearestTrackPoint(pos) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.N; i += 8) {
      const p = this.pos[i];
      const d = (p.x - pos.x) * (p.x - pos.x) +
                (p.y - pos.y) * (p.y - pos.y) +
                (p.z - pos.z) * (p.z - pos.z);
      if (d < bd) { bd = d; best = i; }
    }
    // Refine: walk the neighborhood for the true minimum sample.
    for (let k = -8; k <= 8; k++) {
      const i = (best + k + this.N) % this.N;
      const p = this.pos[i];
      const d = (p.x - pos.x) * (p.x - pos.x) +
                (p.y - pos.y) * (p.y - pos.y) +
                (p.z - pos.z) * (p.z - pos.z);
      if (d < bd) { bd = d; best = i; }
    }
    // Continuous projection onto the two segments around `best`.
    const N = this.N;
    let bs = this.sOfIndex(best), bp = null, bt = null, bdd = Infinity;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), T = new THREE.Vector3();
    for (const k of [-1, 0]) {
      const i0 = (best + k + N) % N, i1 = (best + k + 1) % N;
      A.copy(this.pos[i0]); B.copy(this.pos[i1]);
      T.subVectors(B, A);
      const segLen2 = T.lengthSq();
      let t = segLen2 > 1e-12 ? ((pos.x - A.x) * T.x + (pos.y - A.y) * T.y + (pos.z - A.z) * T.z) / segLen2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = A.x + T.x * t, py = A.y + T.y * t, pz = A.z + T.z * t;
      const d = (px - pos.x) * (px - pos.x) + (py - pos.y) * (py - pos.y) + (pz - pos.z) * (pz - pos.z);
      if (d < bdd) {
        bdd = d;
        const s0 = this.sOfIndex(i0), s1 = this.sOfIndex(i1);
        let span = s1 - s0;
        if (span < 0) span += this.length; // wrap: final segment -> s=0
        bs = s0 + span * t;
        if (bs >= this.length) bs -= this.length;
        bp = new THREE.Vector3(px, py, pz);
        bt = T.clone().normalize();
      }
    }
    const f = this.frameAt(bs);
    return { point: bp || f.pos.clone(), tangent: bt || f.tan.clone(), s: bs };
  }
}
