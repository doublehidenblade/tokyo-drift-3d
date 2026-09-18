// M6 respawn + containment (car-side logic). The world agent owns rail /
// city geometry; this module is the stable contract it can rely on:
//
//   nearestTrackPoint(track, x, z, out)
//     out = { s, lat, roadY, yaw } — all plain numbers, no allocation
//     after the first call (scratch frame reused). Finds the closest point
//     on the track centerline to world (x, z): coarse scan over the 1024
//     precomputed spline samples (XZ only — the track never crosses itself
//     horizontally, so height is irrelevant for identity), refined to
//     1-sample resolution. lat is the signed lateral offset in the banked
//     track frame; roadY is the centerline height; yaw the tangent yaw.
//
//   containmentBreach(x, y, z)
//     -> 'nan' | 'bounds' | 'void' | null. y is the car's road height.
//
//   respawnPlayer({ arcade, track }, reason)
//     Places the car on the track centerline at the nearest s (or the last
//     known-good s when the position is NaN), aligned to the track tangent,
//     at CFG.respawnSpeed, with CFG.ghostTime seconds of invulnerability.
//     Returns the breach reason string. Only touches arcade + track.
import { CFG } from './config.js';

const _f = {};   // scratch track frame (reused — no per-call allocation)
const _np = {};  // scratch nearest-point (reused)

export function nearestTrackPoint(track, x, z, out) {
  out = out || {};
  const pos = track.pos, N = track.N;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < N; i += 4) {
    const p = pos[i];
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bi = i; }
  }
  for (let k = -4; k <= 4; k++) {
    const i = (bi + k + N) % N;
    const p = pos[i];
    const dx = p.x - x, dz = p.z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; bi = i; }
  }
  // Chainage-aware s: TrackV2's sample chainage is NOT linear in the
  // sample index (up to ~330 m off), so it exposes sOfIndex(i). The
  // classic Track keeps the (i/N)*length contract.
  const s = typeof track.sOfIndex === 'function' ? track.sOfIndex(bi) : (bi / N) * track.length;
  track.frameAt(s, _f);
  out.s = s;
  out.lat = (x - _f.pos.x) * _f.lat.x + (z - _f.pos.z) * _f.lat.z;
  out.roadY = _f.pos.y;
  out.yaw = _f.yaw;
  return out;
}

export function containmentBreach(x, y, z) {
  if (!isFinite(x + y + z)) return 'nan';
  if (Math.abs(x) > CFG.worldBounds.x || Math.abs(z) > CFG.worldBounds.z) return 'bounds';
  if (y < CFG.voidY) return 'void';
  return null;
}

export function respawnPlayer(phys, reason) {
  const a = phys.arcade, track = phys.track;
  let s = a.lastGoodS;
  if (isFinite(a.x) && isFinite(a.z)) {
    nearestTrackPoint(track, a.x, a.z, _np);
    if (isFinite(_np.s)) s = _np.s;
  }
  track.frameAt(s, _f);
  a.x = _f.pos.x;
  a.z = _f.pos.z;
  a.s = s;
  a.lat = 0;
  a.heading = _f.yaw;      // aligned to the track tangent
  a.speed = CFG.respawnSpeed;
  a.ghostT = CFG.ghostTime;
  a.respawns = (a.respawns || 0) + 1;
  a.lastGoodS = s;
  return reason || 'respawned';
}
