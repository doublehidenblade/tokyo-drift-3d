// Autopilot driver for the M4 self-iteration harness + menu attract mode.
// Gated behind ?autopilot=1 via dynamic import — players never download or
// parse this module. M6: the player car is heading-driven (zero input =
// straight), but the autopilot EXPLICITLY track-follows: it pure-pursuits
// the racing line 110 m ahead in track space (pure pursuit is designed for
// heading-based vehicles), and it sets input.autopilot on every update so
// physics applies the attract-mode tangent bias for that step. It drives
// like a human otherwise: it only sets input.left / input.right (screen
// semantics) and input.nitroPulse, so the screen-space steering path it
// exercises is the same one players use.
//
// Strategy: pure-pursuit of the road 110 m ahead (in track space), emergency
// lane-change when traffic threatens the corridor, nitro burn when the
// meter is full and the road ahead is clear.
import { CFG } from './config.js';

export function createAutopilot(track, physics, input) {
  const L = track.length;
  const _a = {}, _b = {};
  const laps = [];
  let lastLap = 1;

  function threats(a, range) {
    const out = [];
    for (const c of physics.traffic) {
      const da = track.distAhead(a.s, c.s);
      if (da > -5 && da < range && Math.abs(c.lane - a.lat) < 3.6) out.push({ c, da });
    }
    out.sort((x, y) => x.da - y.da);
    return out;
  }

  const api = {
    update(dt) {
      const a = physics.arcade;
      // M6: one-shot flag consumed by physics.step — marks this step as
      // autopilot-driven so the attract-mode tangent bias applies.
      input.autopilot = true;
      if (a.lap !== lastLap) {
        laps.push(a.lastLapT);
        lastLap = a.lap;
      }
      if (a.raceDone) {
        input.left = input.right = false;
        return;
      }
      // Desired lateral: where the road goes 110 m ahead, expressed in the
      // current track frame (no yaw-sign conventions — pure vector math).
      track.frameAt(a.s, _a);
      track.frameAt((a.s + 110) % L, _b);
      const dx = _b.pos.x - _a.pos.x;
      const dy = _b.pos.y - _a.pos.y;
      const dz = _b.pos.z - _a.pos.z;
      const aheadLat = dx * _a.lat.x + dy * _a.lat.y + dz * _a.lat.z;
      let desired = Math.max(-7, Math.min(7, aheadLat * 0.85));

      // Traffic dodge: nearest threat in the corridor -> pick the freer side.
      const th = threats(a, 75);
      if (th.length) {
        const t0 = th[0];
        const opts = [];
        for (const dl of [5.5, -5.5, 9, -9]) {
          const cand = Math.max(-10.5, Math.min(10.5, a.lat + dl));
          let blocked = false;
          for (const t of physics.traffic) {
            const da = track.distAhead(a.s, t.s);
            if (da > -5 && da < 45 && Math.abs(t.lane - cand) < 3.4) { blocked = true; break; }
          }
          if (!blocked) opts.push({ cand, cost: Math.abs(dl) + Math.abs(cand - desired) * 0.5 });
        }
        if (opts.length) {
          opts.sort((x, y) => x.cost - y.cost);
          desired = opts[0].cand;
        } else {
          // Nowhere to go: aim behind the threat's lane.
          desired = Math.max(-10.5, Math.min(10.5, t0.c.lane + (t0.c.lane >= a.lat ? 5 : -5)));
        }
      }

      const err = desired - a.lat;
      const sgn = input.latDirSign || 1; // +1: +lat appears screen-left
      // err > 0 => want +lat => press the screen side that yields +lat.
      input.left = err > 0.3 ? sgn > 0 : (err < -0.3 ? sgn < 0 : false);
      input.right = err > 0.3 ? sgn < 0 : (err < -0.3 ? sgn > 0 : false);

      // Nitro: burn a full meter when it's full and the road ahead is clear.
      if (a.nitro > 0.98 && !a.nitroBurning && threats(a, 130).length === 0) {
        input.nitroPulse = true;
      }
    },
    status() {
      const a = physics.arcade;
      return {
        done: a.raceDone, lap: a.lap, laps,
        s: +a.s.toFixed(1), lat: +a.lat.toFixed(2),
        speed: +a.speed.toFixed(1), nitro: +a.nitro.toFixed(3),
      };
    },
  };
  return api;
}
