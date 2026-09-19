/**
 * Arcade drift + grip model vendored from pocket-racer (MIT, © 2026 inabako06).
 * Source: https://github.com/inabako06/pocket-racer — src/Car.ts
 *   (drift entry + applyDriftControl + applyStability), full license in ./LICENSE.
 * Reference values: ./CarTuning.js (faithful port of their CarTuning.ts).
 *
 * ADAPTATION (host: Tokyo Drift 3D kinematic arcade, Rapier-teleported chassis):
 * - cannon-es RaycastVehicle removed. Body state is a plain 2D vector
 *   {vx, vz} plus a body yaw `heading`. The host moves its chassis to match.
 * - Throttle is the host's auto-accelerate (always on while racing); there
 *   is no throttle button, so "off-throttle recovery" maps to "ease off the
 *   steering" (counter-steer / neutral release paths are unchanged).
 * - Steering is the host's yaw-rate model: `steerNorm` (-1..1) is the signed
 *   steering effort (input × progressive ramp), replacing their steer angle.
 * - Everything here is pure math — no THREE, no cannon-es, no DOM.
 *
 * @param tune  tune object (see CFG.drift in ../../config.js):
 *   { refMaxSpeed, speedThreshold, steerThreshold, engageSlow, engageFast,
 *     holdSpeed, turnRate, angleMaxDeg, buildRateDeg, releaseRateDeg,
 *     recoverRateDeg, exitAngleDeg, drag, brakeDrag, sideFriction,
 *     spinGripAccel, spinYawMargin, assistMinSpeed }
 */
const D2R = Math.PI / 180;

export function createDriftState() {
  return { drifting: false, angle: 0, dir: 1, charge: 0 };
}

export function resetDriftState(st) {
  st.drifting = false;
  st.angle = 0;
  st.dir = 1;
  st.charge = 0;
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * One step of the drift/grip model. Mutates `st` in place.
 *
 * p = { vx, vz, heading, steerNorm (-1..1 signed effort), throttle (bool),
 *       braking (bool), dt }
 * Returns { vx, vz, heading } — the new motion state. When not drifting,
 * heading is returned untouched (the host steers it); while drifting the
 * model sets it kinematically: heading = travel direction + slip angle.
 */
export function stepArcadeCar(st, tune, p) {
  let vx = p.vx, vz = p.vz;
  let heading = p.heading;
  const dt = p.dt;
  let sp = Math.hypot(vx, vz);
  const speedNorm = Math.min(sp / tune.refMaxSpeed, 1);

  // --- Drift entry: deliberate, sustained steering at speed ("tame"/charge).
  // Pocket-racer also requires throttle; here throttle = auto-accelerate.
  const steerEnough = Math.abs(p.steerNorm) > tune.steerThreshold;
  const wantDrift = p.throttle && steerEnough && sp > tune.speedThreshold;

  if (!st.drifting) {
    if (wantDrift) {
      st.charge += dt;
      const engage = tune.engageSlow + (tune.engageFast - tune.engageSlow) * speedNorm;
      if (st.charge >= engage) {
        st.drifting = true;
        st.charge = 0;
        st.dir = Math.sign(p.steerNorm) || 1;
        // Entry angle = current real slip angle: the car eases sideways,
        // it never snaps.
        const velAngle = Math.atan2(vx, vz);
        st.angle = Math.abs(angDiff(heading, velAngle));
      }
    } else {
      st.charge = 0;
    }
  } else if (sp < tune.holdSpeed) {
    st.drifting = false;
    st.charge = 0;
  }

  if (st.drifting) {
    // --- Sustained drift (Ridge-Racer style), ported from applyDriftControl.
    const maxAngle = tune.angleMaxDeg * D2R;
    const steerN = Math.max(-1, Math.min(1, p.steerNorm));
    const along = steerN * st.dir; // +1 steering into the drift, -1 counter
    const building = p.throttle && along > 0.15;

    if (!p.throttle) {
      st.angle -= tune.recoverRateDeg * D2R * dt;   // straighten up
    } else if (building) {
      st.angle += tune.buildRateDeg * D2R * dt;     // deepen the slide
    } else if (along < -0.15) {
      st.angle -= tune.releaseRateDeg * D2R * dt;   // counter-steer: quick out
    } else {
      st.angle -= tune.releaseRateDeg * 0.4 * D2R * dt; // neutral: ease out
    }
    st.angle = Math.max(0, Math.min(maxAngle, st.angle));

    if (!building && st.angle < tune.exitAngleDeg * D2R) {
      st.drifting = false; // recovered — back to grip physics
    } else {
      // Travel direction rotates toward the drift while "on throttle";
      // speed is roughly held (mild drag). Body points travel + slip angle.
      let velAngle = Math.atan2(vx, vz);
      if (p.throttle) {
        const depth = st.angle / maxAngle;
        velAngle += st.dir * tune.turnRate * depth * dt;
      }
      sp = Math.hypot(vx, vz);
      sp *= 1 - tune.drag * dt;
      if (p.braking) sp *= 1 - tune.brakeDrag * dt;
      vx = Math.sin(velAngle) * sp;
      vz = Math.cos(velAngle) * sp;
      heading = velAngle + st.angle * st.dir;
    }
  }

  if (!st.drifting) {
    st.angle = 0;
    // --- Grip (ported from applyStability): scrub lateral velocity so the
    // car feels planted, but never fully rigid — a hint of slip stays.
    if (sp > tune.assistMinSpeed) {
      const fx = Math.sin(heading), fz = Math.cos(heading);
      const rx = -fz, rz = fx; // right vector (sign-free: we remove the component)
      const lateral = vx * rx + vz * rz;
      const scrub = Math.min(tune.sideFriction * dt, 1);
      vx -= rx * lateral * scrub;
      vz -= rz * lateral * scrub;
    }
  }

  return { vx, vz, heading };
}

/**
 * Spin-safety yaw-rate cap (rad/s), ported from applyStability's maxYaw:
 * the faster the car, the less yaw the tires can support. The host clamps
 * its steering yaw rate with this so a full-lock yank at speed can't spin
 * the car — forgiving, keyboard-friendly.
 */
export function spinYawCap(tune, sp) {
  return tune.spinGripAccel / Math.max(sp, tune.assistMinSpeed) + tune.spinYawMargin;
}
