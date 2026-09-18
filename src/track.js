// Closed-loop lap circuit for Milestone 3.
// A centripetal Catmull-Rom spline through world-space control points
// (with elevation) defines the track. Cars live in track space
// (s = meters along the lap, lat = lateral offset) and are mapped to
// world space through per-sample frames that include slope and banking.
// The tunnel and bridge legs are derived from control-point indices so
// the city builder can place the tube / water under the right sections.
//
// All art remains procedural.
import * as THREE from 'three';

// [x, y, z] control points, closed loop. Start/finish at index 0.
const CONTROL = [
  [0, 0, 0],          // 0 start/finish gantry
  [0, 0, 470],        // 1 city straight
  [50, 1, 860],       // 2 gentle right
  [230, 5, 1170],     // 3 climbing right
  [510, 13, 1370],    // 4 bridge approach (climbing grade)
  [820, 20, 1440],    // 5 bridge apex (over water, 25 m above it)
  [1130, 16, 1370],   // 6 bridge descent
  [1330, 6, 1090],    // 7 right curve down
  [1390, 2, 740],     // 8 S-curves, dense signage district
  [1290, 0, 430],     // 9
  [1340, -2, 120],    // 10 tunnel entrance
  [1170, -3, -200],   // 11 tunnel mid (curved)
  [860, -3, -330],    // 12 tunnel exit
  [550, 0, -300],     // 13 climbing left sweeper
  [230, 1, -160],     // 14 final sweeper back to start
];

// Control-point indices belonging to the tunnel / bridge legs.
const TUNNEL_IDX = [10, 11, 12];
const BRIDGE_IDX = [4, 5, 6];

const SAMPLES = 1024;
const BANK_SMOOTH = 8;      // samples for curvature smoothing
const BANK_MAX = 0.14;      // rad (~8 deg)
const BANK_REF_SPEED = 45;  // m/s used to size the banking

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export class Track {
  constructor() {
    const pts = CONTROL.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    this.N = SAMPLES;

    // Per-sample: pos, yaw, pitch, bank. Lateral/up are derived.
    this.pos = new Array(SAMPLES);
    this.yaw = new Float64Array(SAMPLES);
    this.pitch = new Float64Array(SAMPLES);
    this.bank = new Float64Array(SAMPLES);

    const up = new THREE.Vector3(0, 1, 0);
    const curv = new Float64Array(SAMPLES);
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / SAMPLES;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).normalize();
      this.pos[i] = p;
      this.yaw[i] = Math.atan2(t.x, t.z);
      this.pitch[i] = Math.asin(Math.max(-1, Math.min(1, t.y)));
    }
    const ds = this.length / SAMPLES;
    for (let i = 0; i < SAMPLES; i++) {
      const a = this.yaw[(i + 1) % SAMPLES];
      const b = this.yaw[(i - 1 + SAMPLES) % SAMPLES];
      curv[i] = wrapAngle(a - b) / (2 * ds);
    }
    for (let i = 0; i < SAMPLES; i++) {
      let acc = 0;
      for (let k = -BANK_SMOOTH; k <= BANK_SMOOTH; k++) {
        acc += curv[(i + k + SAMPLES * 2) % SAMPLES];
      }
      const c = acc / (2 * BANK_SMOOTH + 1);
      // Bank down toward the inside of the turn. Right turn => d(yaw)/ds
      // > 0 => inside is +lat (right) => negative roll about the tangent
      // (right-hand rule) drops the right edge.
      const raw = -Math.atan((BANK_REF_SPEED * BANK_REF_SPEED * c) / 9.81) * 0.7;
      this.bank[i] = Math.max(-BANK_MAX, Math.min(BANK_MAX, raw));
    }

    // Locate the tunnel / bridge legs in s-space via nearest samples to
    // their control points.
    this.tunnel = this._legRange(TUNNEL_IDX, 40);
    this.bridge = this._legRange(BRIDGE_IDX, 70);
    // Water channel under the bridge: rect in XZ, top surface y.
    const bc = this._frameAtRaw(
      (this.bridge.s0 + this.bridge.s1) / 2
    );
    this.water = {
      cx: bc.pos.x, cz: bc.pos.z, w: 760, d: 520, y: -5,
      // channel runs roughly perpendicular to the bridge tangent
      yaw: bc.yaw,
    };
  }

  _nearestS(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.N; i += 4) {
      const p = this.pos[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) { bd = d; best = i; }
    }
    return (best / this.N) * this.length;
  }

  _legRange(idxs, margin) {
    let s0 = Infinity, s1 = -Infinity;
    for (const k of idxs) {
      const p = CONTROL[k];
      const s = this._nearestS(p[0], p[2]);
      if (s < s0) s0 = s;
      if (s > s1) s1 = s;
    }
    // Legs are designed not to wrap across s=0.
    return { s0: Math.max(0, s0 - margin), s1: Math.min(this.length, s1 + margin) };
  }

  _frameAtRaw(s) {
    s = ((s % this.length) + this.length) % this.length;
    const f = (s / this.length) * this.N;
    const i0 = Math.floor(f) % this.N;
    const i1 = (i0 + 1) % this.N;
    const t = f - Math.floor(f);
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
  // facing along +tan, +lat points to the driver's LEFT (M4 correction:
  // earlier revisions wrongly documented it as the driver's right, which
  // inverted the steering). Screen mapping is NEVER assumed from this —
  // main.js derives it per-frame from the camera projection.
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
    // Rotate lat0/up0 about tan by bank (Rodrigues, simplified since
    // lat0 . tan = 0 horizontally... use full quaternion-free form).
    // latB = lat0*cos(b) + (tan x lat0)*sin(b); upB = up0*cos(b) + (tan x up0)*sin(b)
    // with up0 = (0,1,0).
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

  // Road-surface height at (s, lat): centerline elevation plus the
  // banked lateral vector's vertical component. Same contract as
  // track_v2.js groundYAt so physics works on either world.
  groundYAt(s, lat) {
    const f = this.frameAt(s);
    return f.pos.y + f.lat.y * lat;
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

  // Nearest centerline point to a world position (M6 world/geometry API).
  // Coarse scan over every 8th sample, then refine in the neighborhood.
  // Returns { point, tangent, s }:
  //   point   — THREE.Vector3 on the track centerline (freshly allocated)
  //   tangent — THREE.Vector3 unit tangent at s (freshly allocated)
  //   s       — meters along the lap [0, length)
  // Stable interface for the handling agent (guard-rail / barrier logic).
  // Continuous: after the coarse sample search, the query point is projected
  // onto the two track segments adjacent to the best sample, so the returned
  // point/tangent/s are sub-sample accurate (not snapped to the ~5 m grid).
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
    const N = this.N, L = this.length;
    let bs = (best / N) * L, bp = null, bt = null, bdd = Infinity;
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
        const s0 = (i0 / N) * L, s1 = (i1 / N) * L;
        bs = s0 + (s1 >= s0 ? s1 - s0 : s1 - s0 + L) * t; // wrap-aware
        if (bs >= L) bs -= L;
        bp = new THREE.Vector3(px, py, pz);
        bt = T.clone().normalize();
      }
    }
    const f = this.frameAt(bs);
    return { point: bp || f.pos.clone(), tangent: bt || f.tan.clone(), s: bs };
  }
}
