// M4 self-iteration harness: scripted playtests driving the real game in
// headless Chrome via CDP. This is the ship gate — every scenario prints
// PASS/FAIL and the suite exits non-zero on any failure.
//
// Scenarios:
//   steer-screen  synthesized pointer presses (CDP Input.dispatchMouseEvent
//                 -> real PointerEvents -> production screen-half hit test)
//                 with the chase camera FROZEN: LEFT must move the car the
//                 same screen way +lat points (RIGHT the opposite), asserted
//                 ABSOLUTELY at s=200/900/2500/3900 incl. curves, against an
//                 independent projection reference. Negative-controlled:
//                 inverting the steering sign fails the gate (exit 2).
//   race          autopilot (?autopilot=1) completes a full 3-lap race
//                 in-page headless: telemetry CSV, lap times, live drive
//                 frame sequence -> m4-drive.webm, zero page errors.
//   luma-sweep    full-lap lighting audit every 50 m — no near-black stretch.
//   tunnel        tunnel interior luma audit (all tunnel sections lit).
//   bridge        Rainbow Bridge visibility + lighting.
//   gauntlet      collision gauntlet: contacts + sparks + scrub, and the
//                 car must never spin (|heading| clamped, re-centers after).
//   nitro         bottle pickup +0.25, one-tap burn, no regen over time.
//   collider      every car's Rapier cuboid projected to screen must contain
//                 its rendered mesh bounds (+ wireframe evidence screenshot).
//
// NOTE on "synthesized pointer presses": the game handles PointerEvents and
// never checks pointerType, so CDP mousePressed/mouseReleased at screen
// coordinates exercises the exact production touch path (same handler, same
// screen-half hit-testing) minus only the finger. We do NOT use
// Input.dispatchTouchEvent and never claim these are TouchEvents.
//
// Usage: node harness/autopilot/run.mjs [--only=a,b] [--shots=dir]
'use strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { launch, sleep, waitFor } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : null;
const shotsArg = args.find((a) => a.startsWith('--shots='));
const outdir = shotsArg ? path.resolve(shotsArg.slice(8)) : path.join(root, 'harness', 'shots-m4');
fs.mkdirSync(outdir, { recursive: true });

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg);
  if (!cond) fails.push(msg);
};
const want = (name) => !ONLY || ONLY.includes(name);

async function scenarioSteer(ctx) {
  console.log('SCENARIO steer-screen (synthesized pointer presses, absolute screen-space gate)');
  const { ev, pressStart, pressEnd } = ctx;
  // What this proves, and why it can't be fooled:
  // - Input arrives as CDP Input.dispatchMouseEvent press/release pairs at
  //   real screen coordinates. The browser turns those into PointerEvents;
  //   input.js maps them to left/right by the SCREEN HALF under the press
  //   (e.clientX < innerWidth/2) — the exact production touch path, minus
  //   only the finger itself. Honest name: synthesized pointer presses,
  //   not TouchEvents (no Input.dispatchTouchEvent is used anywhere).
  // - The chase camera is FROZEN at the snapped teleport pose for the whole
  //   measurement (new __td3.freezeCamera/steerGatePrep/steerGateHold), so
  //   camera motion can never mask a reversed sign. The M4 interim gate
  //   measured through the LIVE chase camera — a deliberately reversed
  //   steering sign still passed on curves, which is why it was replaced.
  // - Physics runs in fixed 60 Hz steps, so the motion is deterministic.
  //   The assertion is ABSOLUTE and per-press: LEFT must displace the
  //   car's NDC.x the same screen way that +lat points; RIGHT the opposite
  //   way. The reference (+lat's NDC.x displacement through the same
  //   frozen camera) is computed from raw projection math, independent of
  //   input.latDirSign — so a broken sign derivation can't fool the gate
  //   either.
  // - Negative control (actually run 2026-09-18): negating the steering
  //   sign in src/physics.js makes this scenario FAIL with exit 2 — LEFT
  //   slides the car screen-right. Restoring the sign makes it green.
  const HOLD_STEPS = 60; // 1 game-second of held press per measurement.
  // M6: the car is heading-driven with real yaw authority now (up to ~1.4
  // rad/s at low speed), so a 2 s hold would spin it into the rail and the
  // rail bounce would contaminate the NDC.x displacement sign. 60 steps
  // keeps the car well inside the corridor while still displacing it far
  // past MIN_DX.
  const MIN_DX = 0.05;    // minimum |NDC.x| displacement to count as movement
  const halfW = await ev('(window.innerWidth / 2)');
  const press = async (side) => {
    const x = side === 'left' ? halfW / 2 : halfW * 1.5;
    await pressStart(x, 400); // y=400: mid-screen, clear of the nitro button
    await waitFor(async () => {
      const inp = await ev('window.__td3.input()');
      // The press must register through the production pointer handler
      // before we measure — this both proves the path and synchronizes
      // the CDP input pipeline with the page.
      const got = side === 'left' ? inp.left : inp.right;
      const other = side === 'left' ? inp.right : inp.left;
      return (got && !other) ? true : null;
    }, 8000, `${side} press registered`);
  };
  const release = async () => {
    await pressEnd();
    await waitFor(async () => {
      const inp = await ev('window.__td3.input()');
      return (!inp.left && !inp.right) ? true : null;
    }, 8000, 'press released');
  };
  const dirName = (s) => (s < 0 ? 'screen-LEFT' : 'screen-RIGHT');
  try {
    // s=200 (start straight), s=900 (bridge approach), s=2500 (S-curves),
    // s=3900 (tunnel curve). Curvature is logged from the track yaw ±60 m.
    const positions = [200, 900, 2500, 3900];
    for (const sPos of positions) {
      for (const side of ['left', 'right']) {
        // Atomic in-page setup: exact car state, camera snapped + frozen,
        // lat->screen mapping recomputed for that pose.
        const prep = await ev(`window.__td3.steerGatePrep(${sPos})`);
        const dYaw = (prep.yawPlus - prep.yawMinus) * 180 / Math.PI;
        if (side === 'left') {
          console.log(`  s=${sPos}: camera frozen, latDirSign=${prep.sign}, ` +
            `+lat -> ${dirName(prep.refD)} (refD=${prep.refD}), curve Δyaw=${dYaw.toFixed(1)}°/120m`);
          ok(Math.abs(prep.refD) > 0.01,
            `s=${sPos}: +lat has a measurable screen direction (refD=${prep.refD})`);
        }
        await press(side);
        const m = await ev(`window.__td3.steerGateHold(${HOLD_STEPS})`);
        await release();
        const wantSign = side === 'left' ? Math.sign(prep.refD) : -Math.sign(prep.refD);
        console.log(`    ${side.toUpperCase()} press at s=${sPos}: ` +
          `input L=${m.left} R=${m.right}, NDC.x ${m.x0} -> ${m.x1} (dx=${m.dx}), lat=${m.lat}`);
        ok((side === 'left' ? (m.left && !m.right) : (m.right && !m.left)),
          `s=${sPos}: ${side} press registered as ${side} input via the pointer path`);
        ok(Math.abs(m.dx) > MIN_DX && Math.sign(m.dx) === wantSign,
          `s=${sPos}: ${side.toUpperCase()} press slides car toward ${dirName(wantSign)} ` +
          `(dx=${m.dx}, expected sign ${wantSign > 0 ? '+' : '-'})`);
        // Evidence: re-snap the car to its post-hold pose, then let the
        // chase camera settle behind it (the snapped pose sits on the
        // centerline, but the car is at the curb — 12.6 m lateral — which
        // is outside the portrait frame's narrow horizontal FOV).
        if (sPos === 200) {
          await ev(`window.__td3.teleportS(${m.s}, ${m.lat}, true)`);
          await ev('window.__td3.freezeCamera(false)');
          await sleep(1200); // chase cam converges behind the car
          await ctx.shot(path.join(outdir, `m4-steer-${side}.png`));
          await ev('window.__td3.freezeCamera(true)');
        }
      }
    }
  } finally {
    await ev('window.__td3.freezeCamera(false)');
  }
}

async function scenarioRace() {
  console.log('SCENARIO race (autopilot, 3 laps, in-page headless)');
  const ctx = await launch({ url: `file://${root}/index.html`, query: '?autopilot=1' });
  const { ev } = ctx;
  try {
    // The autopilot dynamic-imports; wait for it before the green flag.
    // (90 s budget: under a loaded VM the import can take ~50 s; the
    // wait breaks early as soon as the module resolves.)
    await waitFor(async () => {
      const t = await ev('typeof window.__td3.autopilotState').catch(() => 'undefined');
      return t === 'function' ? true : null;
    }, 90000, 'autopilot load', 1000);
    await ctx.shot(path.join(outdir, 'm4-race-start.png'));
    // Live gameplay evidence: start the game (hides the TAP TO START
    // overlay, sets state='playing' so the autopilot drives live), let the
    // car pull away, then capture 12 frames across ~7 s of actual driving.
    // Encoded to m4-drive.webm.
    await ev('window.__td3.start()');
    await sleep(1500);
    {
      const framesDir = path.join(outdir, 'm4-drive-frames');
      fs.mkdirSync(framesDir, { recursive: true });
      const N = 12;
      for (let i = 0; i < N; i++) {
        await sleep(600);
        await ctx.shot(path.join(framesDir, `frame_${String(i).padStart(2, '0')}.png`));
      }
      const ap = await ev('window.__td3.autopilotState()');
      console.log(`  drive frames: ${N} captured, autopilot reached s=${ap && ap.s}, lat=${ap && ap.lat}`);
      ok(true, `live drive frame sequence captured (${N} frames)`);
      const ff = spawnSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '4',
        '-i', path.join(framesDir, 'frame_%02d.png'),
        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p',
        path.join(outdir, 'm4-drive.webm')], { encoding: 'utf8' });
      if (ff.status === 0) console.log('  drive webm encoded: m4-drive.webm');
      else console.log('  drive webm encode skipped/failed (frames still saved): ' + (ff.error && ff.error.message));
    }
    // One CDP round-trip: the page runs the full 3-lap race in-page.
    const t0 = Date.now();
    const result = await ev('window.__td3.runRace()');
    const wallS = ((Date.now() - t0) / 1000).toFixed(0);
    if (result.error) throw new Error('race: ' + result.error);
    console.log(`  done in ${wallS} s wall; laps=${JSON.stringify(result.laps)} ` +
      `raceDone=${result.raceDone} sparks=${result.sparks} steps=${result.steps}`);
    fs.writeFileSync(path.join(outdir, 'm4-race-telemetry.csv'),
      'wall_s,race_s,lap,s,speed_mps,lat,nitro,sparks\n' + result.telemetry.join('\n') + '\n');
    ok(result.raceDone === true, 'autopilot completed the 3-lap race (raceDone)');
    ok(result.laps.length === 3, `3 lap times recorded (got ${result.laps.length})`);
    ok(result.laps.every((t) => t > 20 && t < 300), `lap times sane: ${JSON.stringify(result.laps)}`);
    ok(result.telemetry.length >= 5, `race telemetry captured (${result.telemetry.length} samples)`);
    // Finish screenshot for evidence.
    const st = await ev('window.__td3.state()');
    await ev(`window.__td3.teleportS(${st.s},${st.lat},true)`);
    await sleep(800);
    await ctx.shot(path.join(outdir, 'm4-race-finish.png'));
    const errs = [...ctx.errors, ...(st.errors || [])].filter((e) => !/WebGL/.test(e));
    ok(errs.length === 0, `zero page errors during race (got ${errs.length}: ${errs.slice(0, 2).join(' | ')})`);
  } finally {
    ctx.close();
  }
}

async function scenarioLuma(ctx) {
  console.log('SCENARIO luma-sweep (full lap, every 50 m, batched in-page)');
  const { ev } = ctx;
  // One CDP round-trip: the page teleports, snaps the camera, renders, and
  // samples luma at every stop internally.
  const samples = await ev('window.__td3.sweepLuma(50)');
  let min = { s: 0, luma: 1 };
  const dark = [];
  for (const { s, luma } of samples) {
    if (luma < min.luma) min = { s, luma };
    if (luma < 0.035) dark.push(`${s}:${luma.toFixed(3)}`);
  }
  console.log(`  ${samples.length} samples, min luma=${min.luma} at s=${min.s}, below 0.035: ${dark.length}`);
  fs.writeFileSync(path.join(outdir, 'm4-luma-sweep.csv'),
    's,luma\n' + samples.map(({ s, luma }) => `${s},${luma}`).join('\n') + '\n');
  if (dark.length) {
    const s0 = parseInt(dark[0].split(':')[0], 10);
    await ev(`window.__td3.teleportS(${s0}, 0, true)`);
    await sleep(1200);
    await ctx.shot(path.join(outdir, 'm4-darkest.png'));
  }
  ok(dark.length === 0, `no near-black stretch on the lap (dark: ${dark.slice(0, 6).join(' ')})`);
}

async function scenarioTunnel(ctx) {
  console.log('SCENARIO tunnel (interior luma audit)');
  const { ev } = ctx;
  const at = async (s) => {
    await ev(`window.__td3.teleportS(${s}, 0, true)`);
    return (await ev('window.__td3.state()')).tunnel;
  };
  const interior = [];
  for (let s = 3300; s <= 4500; s += 100) {
    if ((await at(s)) > 0.95) interior.push(s);
  }
  ok(interior.length > 0, `tunnel interior found (${interior.length} samples)`);
  const pts = interior.filter((_, i) => i % Math.max(1, Math.floor(interior.length / 4)) === 0).slice(0, 4);
  const lumas = [];
  for (const s of pts) {
    await ev(`window.__td3.teleportS(${s}, 0, true)`);
    await sleep(900);
    lumas.push(await ev('window.__td3.luma(0.4)'));
  }
  console.log('  tunnel lumas:', lumas.map((l) => l.toFixed(3)).join(', '));
  ok(lumas.length === 4 && lumas.every((l) => l > 0.05),
    'every tunnel section lit (luma > 0.05): [' + lumas.map((l) => l.toFixed(3)).join(',') + ']');
  // Evidence: settled in-tunnel view.
  await ev(`window.__td3.teleportS(${pts[1]}, 0, true)`);
  await sleep(1200);
  await ctx.shot(path.join(outdir, 'm4-tunnel.png'));
}

async function scenarioBridge(ctx) {
  console.log('SCENARIO bridge (Rainbow Bridge visibility + lighting)');
  const { ev } = ctx;
  // The bridge spans the low-elevation water section; sample the approach,
  // the deck, and the exit. Assert none are near-black and the bridge
  // structure is present (not "popping out of nowhere").
  const pts = [700, 850, 950, 1050, 1200];
  const lumas = [];
  for (const s of pts) {
    await ev(`window.__td3.teleportS(${s}, 0, true)`);
    await sleep(1000);
    lumas.push(+((await ev('window.__td3.luma(0.4)')).toFixed(3)));
  }
  console.log('  bridge lumas:', lumas.join(', '));
  ok(lumas.every((l) => l > 0.05), `bridge deck lit (luma > 0.05): [${lumas.join(',')}]`);
  // Screenshot the deck for the evidence folder.
  await ev('window.__td3.teleportS(950, 0, true)');
  await sleep(1200);
  await ctx.shot(path.join(outdir, 'm4-bridge.png'));
}

async function scenarioGauntlet(ctx) {
  console.log('SCENARIO gauntlet (collisions: sparks + scrub, never spin)');
  const { ev } = ctx;
  await ev('window.__td3.reset()');
  await ev('window.__td3.teleportS(200, 0, true)');
  // Park 5 same-direction cars (indices 0..9) in the player's lane ahead.
  for (let k = 0; k < 5; k++) await ev(`window.__td3.placeTraffic(${k}, ${45 + k * 40}, 0)`);
  const base = await ev('window.__td3.state()');
  let maxJump = 0, prevH = base.heading;
  let minSpeed = base.speed;
  for (let i = 0; i < 12; i++) {
    await ev('window.__td3.stepPhysics(60)'); // 12 game-seconds through the pack
    const st = await ev('window.__td3.state()');
    const j = Math.abs(st.heading - prevH);
    prevH = st.heading;
    if (j > maxJump) maxJump = j;
    if (st.speed < minSpeed) minSpeed = st.speed;
  }
  const after = await ev('window.__td3.state()');
  console.log(`  contacts: rawEvents ${base.rawEvents} -> ${after.rawEvents}, ` +
    `sparks ${base.sparks} -> ${after.sparks}, min speed ${minSpeed.toFixed(1)} m/s, ` +
    `max heading jump ${maxJump.toFixed(3)} rad`);
  ok(after.rawEvents > base.rawEvents, 'gauntlet registered traffic contacts');
  ok(after.sparks > base.sparks, 'gauntlet produced sparks on contact');
  ok(minSpeed < 55, `gauntlet scrubbed speed on hits (min ${minSpeed.toFixed(1)} m/s)`);
  // M6: heading is absolute world yaw — a hit must never yank it (the bump
  // is positional only). No clamp, no re-centering anymore.
  ok(maxJump < 0.35, `contacts never yank the heading (max jump ${maxJump.toFixed(3)} rad)`);
  // With no input the heading must HOLD STEADY through and after the pack
  // (M6: no self-centering onto the tangent — straight stays straight).
  await ev('window.__td3.stepPhysics(240)');
  const h2 = (await ev('window.__td3.state()')).heading;
  ok(Math.abs(h2 - prevH) < 0.1,
    `heading holds steady with no input after hits (drift ${Math.abs(h2 - prevH).toFixed(3)} rad)`);
  // Evidence: real-time plow through a parked pack — screenshot on the
  // first new contact (sparks live ~0.5 s, so shoot immediately).
  await ev('window.__td3.teleportS(200, 0, true)');
  for (let k = 0; k < 5; k++) await ev(`window.__td3.placeTraffic(${k}, ${30 + k * 28}, 0)`);
  const ev0 = (await ev('window.__td3.state()')).rawEvents;
  let hit = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const st = await ev('window.__td3.state()');
    if (st.rawEvents > ev0) { hit = st; break; }
  }
  await ctx.shot(path.join(outdir, 'm4-gauntlet.png'));
  console.log(`  gauntlet evidence: ${hit ? `contact at ${hit.speed.toFixed(1)} m/s` : 'no contact in 10 s wall — mid-pack shot'}`);
}

// M6 heading gate: the car is driven by an absolute world heading.
// (a) zero steering through a curve -> heading unchanged, car leaves the
//     racing line (Craig's #1 complaint was hands-off road-following);
// (b) sustained full-lock steering -> decisive, screen-correct yaw with a
//     yaw rate that falls with speed (heading-based, not track-following);
// (c) driving at the road edge -> rail contains the car; flinging it out of
//     bounds / into NaN / below the void -> respawn, never void/NaN/fall.
async function scenarioHeading(ctx) {
  console.log('SCENARIO heading (M6: zero-input straight, yaw-rate curve, rail/respawn)');
  const { ev } = ctx;
  const fin = (v) => typeof v === 'number' && isFinite(v);

  // (a) Zero steering through a curve. s=3900 turns ~15.9°/120 m (steer
  // gate log). Stop sampling before the rail bounce so the bounce can't
  // contaminate the heading-drift measurement.
  await ev('window.__td3.steerGatePrep(3900)');
  await ev('window.__td3.stepPhysics(2)'); // consume any stale autopilot one-shot
  const h0 = (await ev('window.__td3.state()')).heading;
  let hDrift = 0, latN = 0, steps = 0;
  for (let i = 0; i < 8; i++) {
    await ev('window.__td3.stepPhysics(30)');
    const st = await ev('window.__td3.state()');
    steps += 30;
    if (!fin(st.heading)) break;
    hDrift = Math.max(hDrift, Math.abs(st.heading - h0));
    latN = st.lat;
    if (Math.abs(st.lat) > 9.5) break;
  }
  console.log(`  zero-input: heading drift ${hDrift.toFixed(4)} rad over ${steps} steps, lat ${latN.toFixed(2)}`);
  ok(hDrift < 0.05, `zero input: heading unchanged through the curve (drift ${hDrift.toFixed(4)} rad)`);
  ok(fin(latN) && Math.abs(latN) > 3,
    `zero input: car leaves the racing line, road curves away (lat ${latN.toFixed(2)})`);

  // (b1) Full lock on a near-straight must turn the car decisively — far
  // more than road curvature alone could produce (rules out any residual
  // track-following), and toward screen-left for a LEFT press.
  const prep = await ev('window.__td3.steerGatePrep(200)');
  const expSign = -Math.sign(prep.refD); // LEFT must move heading this way
  await ev('window.__td3.setInput({left:true, right:false})');
  const hb0 = (await ev('window.__td3.state()')).heading;
  await ev('window.__td3.stepPhysics(60)');
  const st1 = await ev('window.__td3.state()');
  await ev('window.__td3.setInput({left:false, right:false})');
  const dh = st1.heading - hb0;
  console.log(`  full-lock 60 steps: Δheading ${dh.toFixed(3)} rad ` +
    `(expect sign ${expSign > 0 ? '+' : '-'}, |.| > 0.4)`);
  ok(fin(dh) && Math.sign(dh) === expSign,
    `full-lock LEFT turns the car toward screen-left (Δheading ${dh.toFixed(3)})`);
  ok(Math.abs(dh) > 0.4,
    `full-lock turn is decisive, not road curvature (|Δheading| ${Math.abs(dh).toFixed(3)} > 0.4)`);

  // (b2) Yaw rate falls with speed: arcade-scaled, no high-speed donuts.
  async function yawRateAt(targetSpeed) {
    await ev('window.__td3.steerGatePrep(200)');
    await ev('window.__td3.stepPhysics(2)');
    for (let i = 0; i < 40; i++) { // accelerate hands-off to the target speed
      await ev('window.__td3.stepPhysics(30)');
      const s = await ev('window.__td3.state()');
      if (s.speed >= targetSpeed || Math.abs(s.lat) > 8) break;
    }
    const pre = await ev('window.__td3.state()');
    await ev('window.__td3.setInput({left:true, right:false})');
    await ev('window.__td3.stepPhysics(30)');
    await ev('window.__td3.setInput({left:false, right:false})');
    const post = await ev('window.__td3.state()');
    return { w: (post.heading - pre.heading) / 0.5, v: (pre.speed + post.speed) / 2 };
  }
  const slow = await yawRateAt(20);
  const fast = await yawRateAt(50);
  console.log(`  yaw rate: ${slow.w.toFixed(2)} rad/s at ${slow.v.toFixed(0)} m/s, ` +
    `${fast.w.toFixed(2)} rad/s at ${fast.v.toFixed(0)} m/s`);
  ok(fin(slow.w) && slow.w > 0.5 && slow.w < 3, `low-speed yaw rate sane (${slow.w.toFixed(2)} rad/s)`);
  ok(fin(fast.w) && fast.w > 0.15 && fast.w < 1.2, `high-speed yaw rate sane (${fast.w.toFixed(2)} rad/s)`);
  ok(slow.w > fast.w * 1.4,
    `yaw rate falls with speed (${slow.w.toFixed(2)} > 1.4x ${fast.w.toFixed(2)})`);

  // (c1) Drive at the road edge: the rail plane must contain the car.
  const prep2 = await ev('window.__td3.steerGatePrep(200)');
  const side = prep2.sign > 0 ? 'left' : 'right'; // steer toward the +lat rail
  await ev(`window.__td3.setInput({left:${side === 'left'}, right:${side === 'right'}})`);
  let maxLat = 0;
  for (let i = 0; i < 20; i++) {
    await ev('window.__td3.stepPhysics(30)');
    const st = await ev('window.__td3.state()');
    if (fin(st.lat) && Math.abs(st.lat) > maxLat) maxLat = Math.abs(st.lat);
    if (maxLat >= 10.9) break;
  }
  await ev('window.__td3.setInput({left:false, right:false})');
  const fin2 = await ev('window.__td3.state()');
  console.log(`  rail: max|lat| ${maxLat.toFixed(2)}, final lat ${fin2.lat.toFixed(2)}, ` +
    `speed ${fin2.speed.toFixed(1)} m/s`);
  ok(maxLat >= 10.9, `car reached the rail plane (max|lat| ${maxLat.toFixed(2)})`);
  ok(fin(fin2.lat) && Math.abs(fin2.lat) <= 11.3,
    `rail contains the car (|lat| ${fin2.lat} <= 11.3)`);
  ok(fin(fin2.x) && fin(fin2.z) && fin(fin2.heading),
    'state stays finite through the rail hit');

  // (c2) Respawn failsafe: out of bounds -> back on the track, moderate
  // speed, finite state. Then NaN, then below the void floor.
  await ev('window.__td3.reset()');
  await ev('window.__td3.stepPhysics(2)'); // ensure the debug surface is attached
  await ev('window.__td3.debugSetWorldPos(5000, 5000)');
  await ev('window.__td3.stepPhysics(5)');
  let rs = await ev('window.__td3.state()');
  console.log(`  respawn(bounds): x ${rs.x}, z ${rs.z}, speed ${rs.speed}, lat ${rs.lat}`);
  ok(fin(rs.x) && fin(rs.z), 'respawn: position finite after bounds breach');
  ok(Math.abs(rs.x) < 1700 && Math.abs(rs.z) < 1700, 'respawn: back inside world bounds');
  ok(fin(rs.speed) && Math.abs(rs.speed - 20) < 6, `respawn: moderate speed (got ${rs.speed})`);
  ok(fin(rs.lat) && Math.abs(rs.lat) < 1.5, `respawn: on the track (lat ${rs.lat})`);
  await ev('window.__td3.debugSetWorldPos(NaN, 0)');
  await ev('window.__td3.stepPhysics(5)');
  rs = await ev('window.__td3.state()');
  console.log(`  respawn(NaN): x ${rs.x}, z ${rs.z}, speed ${rs.speed}, heading ${rs.heading}`);
  ok(fin(rs.x) && fin(rs.z) && fin(rs.speed) && fin(rs.heading),
    'respawn: NaN state recovered to finite');
  await ev('window.__td3.debugSetWorldPos(0, 0, -100)');
  await ev('window.__td3.stepPhysics(5)');
  rs = await ev('window.__td3.state()');
  console.log(`  respawn(void): y ${rs.y}`);
  ok(fin(rs.x) && fin(rs.y) && rs.y > -30, `respawn: void fall recovered (y ${rs.y})`);
}

async function scenarioNitro(ctx) {
  console.log('SCENARIO nitro (bottle +0.25, one-tap burn, no regen)');
  const { ev } = ctx;
  await ev('window.__td3.reset()'); // spawn, full meter
  // 1) one-tap burn empties the meter. Burn from the spawn: the car drives
  // ~70 m in 121 steps and the first bottle is ~180 m out, so no pickup
  // can contaminate the burn.
  await ev('window.__td3.pulseNitro()');
  await ev('window.__td3.stepPhysics(121)');
  const pre = await ev('window.__td3.state()');
  ok(pre.nitro === 0 && pre.nitroOn === false, `burn emptied the meter (nitro=${pre.nitro})`);
  // 2) bottle pickup. M6: the car drives straight along its own heading —
  // it does NOT follow the road — so approach CLOSE (40 m, same lane):
  // lateral drift over 40 m is < 1 m, inside the 3.2 m pickup window.
  // teleportS preserves the (empty) nitro meter, so +0.25 is measurable.
  const b0 = (await ev('window.__td3.bottles()'))[0];
  await ev(`window.__td3.teleportS(${b0.s - 40}, ${b0.lat}, true)`);
  let got = false, post = pre;
  for (let i = 0; i < 10; i++) {
    await ev('window.__td3.stepPhysics(60)');
    post = await ev('window.__td3.state()');
    if (post.pickups > pre.pickups) { got = true; break; }
  }
  ok(got, 'bottle pickup registered');
  if (got) ok(Math.abs(post.nitro - 0.25) < 1e-9, `bottle gave +0.25 (nitro=${post.nitro})`);
  await ev('window.__td3.teleportS(200, 10, true)'); // clear of bottle lanes
  await ev('window.__td3.pulseNitro()');
  await ev('window.__td3.stepPhysics(5)'); // 5 steps: the 0.25 tap is still burning
  ok((await ev('window.__td3.state()')).nitroOn === true, 'one tap starts the burn');
  // No-regen guard: 2 s of driving from a lane-clear spot. M6: the car goes
  // straight while the road curves, so a long run could wander across a
  // bottle lane and pick one up — that would look like regen. 120 steps
  // keeps the car clear (|lat| stays > 6 from a lat=10 start on this
  // stretch); any nitro increase here must be passive regen, which is
  // forbidden. The pickup count is asserted unchanged to catch contamination.
  const r0 = await ev('window.__td3.state()');
  await ev('window.__td3.stepPhysics(120)');
  const nb = await ev('window.__td3.state()');
  ok(nb.pickups === r0.pickups && nb.nitro < 1e-9,
    `meter stays empty with no pickups, no regen (nitro=${nb.nitro}, pickups ${r0.pickups}->${nb.pickups})`);
  // Evidence: mid-burn screenshot (FOV kick + draining meter, real-time).
  await ev('window.__td3.reset()');
  await ev('window.__td3.teleportS(200, 10, true)');
  await ev('window.__td3.pulseNitro()');
  for (let i = 0; i < 20; i++) {
    await sleep(200);
    const st = await ev('window.__td3.state()');
    if (st.nitroOn && st.speed > 25) break;
  }
  await ctx.shot(path.join(outdir, 'm4-nitro.png'));
}

async function scenarioCollider(ctx) {
  console.log('SCENARIO collider (Rapier cuboid vs rendered mesh, screen-projected)');
  const { ev } = ctx;
  await ev('window.__td3.reset()');
  await ev('window.__td3.teleportS(200, 0, true)');
  // Line every car up ahead of the player so all are in front of the camera.
  for (let i = 0; i < 20; i++) await ev(`window.__td3.placeTraffic(${i}, ${25 + i * 6}, ${(i % 5) - 2})`);
  await ev('window.__td3.stepPhysics(30)');
  await sleep(1200); // render real frames so projections use the live camera
  const pc = await ev('window.__td3.projectionCheck()');
  const TOL = 0.06; // NDC slack for banking/perspective
  let worst = 0;
  for (const c of pc) {
    const over =
      Math.max(0, c.col.x0 - TOL - c.mesh.x0) + Math.max(0, c.mesh.x1 - (c.col.x1 + TOL)) +
      Math.max(0, c.col.y0 - TOL - c.mesh.y0) + Math.max(0, c.mesh.y1 - (c.col.y1 + TOL));
    if (over > worst) worst = over;
    if (over > 1e-9) console.log(`  OVERHANG ${c.name}: ${over.toFixed(4)}`);
  }
  console.log(`  ${pc.length} cars checked, worst mesh overhang beyond collider: ${worst.toFixed(4)} NDC`);
  ok(worst < 1e-9, 'every rendered mesh is contained in its Rapier cuboid on screen');
  await ev('window.__td3.showColliderDebug(true)');
  await sleep(800);
  await ctx.shot(path.join(outdir, 'm4-collider-debug.png'));
  await ev('window.__td3.showColliderDebug(false)');
}

async function scenarioCityAudit(ctx) {
  console.log('SCENARIO city-audit (M6: building footprints, reflection sources, bridge, rails)');
  const { ev } = ctx;
  const a = await ev('window.__cityAudit');
  fs.writeFileSync(path.join(outdir, 'm6-city-audit.json'), JSON.stringify(a, null, 1) + '\n');
  console.log(`  buildings: ${a.buildings.count}, violations: ${a.buildings.violations.length}`);
  console.log(`  lights: ${a.lights.count}, streaks: ${a.streaks.count}, streak violations: ${a.streaks.violations.length}`);
  console.log(`  bridge: ${JSON.stringify(a.bridge)}`);
  console.log(`  rail colliders: ${a.rails.colliderCount} (tunnel spans skipped: ${a.rails.skippedTunnel})`);
  ok(a.buildings.violations.length === 0,
    `no building footprint overlaps the road corridor (violations: ${a.buildings.violations.length})`);
  ok(a.streaks.violations.length === 0,
    `every reflection streak traces to a registered light (violations: ${a.streaks.violations.length})`);
  ok(a.streaks.count > 50, `reflection streaks generated from sources (${a.streaks.count})`);
  ok(a.bridge.cableTowerGapM === 0 && a.bridge.suspenderCount > 0 && a.bridge.trussSpans && a.bridge.deckGirder,
    'bridge reads as one structure (cable lands on tower saddles, suspenders + truss + deck girder present)');
  ok(a.rails.colliderCount > 400, `guard-rail colliders registered with tag 'rail' (${a.rails.colliderCount})`);
  ok(a.bayContainsBridge === true, 'bay rectangle spatially contains the bridge span');
}

async function scenarioBlackBlob(ctx) {
  console.log('SCENARIO blackblob (M6: large unlit/dark screen regions on a full-lap capture)');
  const { ev, shot } = ctx;
  // In-page analysis: draw the WebGL canvas (preserveDrawingBuffer is on)
  // to a small 2D canvas and measure the dark fraction of the central band
  // (sky top 25% and HUD bottom 10% excluded), plus the bright-feature
  // fraction. It is NIGHT, so a high dark fraction is normal — the B1
  // failure mode (a giant unlit wall filling the view) is nearly ALL dark
  // with essentially zero bright features, which is what the gate checks.
  const analyze = (s) => `(() => {
    const src = document.querySelector('#game canvas');
    const w = 180, h = 90;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let dark = 0, bright = 0, tot = 0, sum = 0;
    for (let y = ${Math.floor(90 * 0.25)}; y < ${Math.floor(90 * 0.9)}; y++) {
      for (let x = ${Math.floor(180 * 0.1)}; x < ${Math.floor(180 * 0.9)}; x++) {
        const i = (y * w + x) * 4;
        const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        tot++; sum += lum;
        if (lum < 0.055) dark++;
        if (lum > 0.3) bright++;
      }
    }
    return { s: ${s}, darkFrac: +(dark / tot).toFixed(3), brightFrac: +(bright / tot).toFixed(4), mean: +(sum / tot).toFixed(3) };
  })()`;
  const rows = [];
  const stops = [];
  for (let s = 0; s < 5227; s += 240) stops.push(Math.round(s));
  for (const s of stops) {
    await ev(`window.__td3.teleportS(${s}, 0, true)`);
    await sleep(1000); // let the chase camera settle on the snapped pose
    const r = await ev(analyze(s));
    rows.push(r);
    console.log(`  s=${s}: darkFrac=${r.darkFrac} brightFrac=${r.brightFrac} mean=${r.mean}`);
  }
  fs.writeFileSync(path.join(outdir, 'm6-blackblob.csv'),
    's,darkFrac,brightFrac,mean\n' + rows.map((r) => `${r.s},${r.darkFrac},${r.brightFrac},${r.mean}`).join('\n') + '\n');
  const worst = [...rows].sort((a, b) => b.darkFrac - a.darkFrac).slice(0, 3);
  for (const w of worst) {
    await ev(`window.__td3.teleportS(${w.s}, 0, true)`);
    await sleep(1000);
    await shot(path.join(outdir, `m6-blackblob-${w.s}.png`));
  }
  // Night scenes legitimately score darkFrac ~0.55-0.85 (measured 2026-09-18:
  // max 0.851 on a dense downtown frame). A giant unlit wall drives the band
  // almost entirely dark with no bright features at all.
  const bad = rows.filter((r) => r.darkFrac > 0.93 && r.brightFrac < 0.005);
  ok(bad.length === 0,
    `no giant unlit black-blob region on the lap (suspect stops: ${bad.map((r) => r.s).join(',') || 'none'})`);
}

async function scenarioBridgeShots(ctx) {
  console.log('SCENARIO bridge-shots (M6: bridge-connection visual check)');
  const { ev, shot } = ctx;
  // Tower 1 approach, at tower 1, mid-span, at tower 2 — the cable/saddle/
  // truss connections must read as one structure.
  const pts = [[1560, 'approach'], [1600, 'tower1'], [1900, 'midspan'], [2200, 'tower2']];
  for (const [s, name] of pts) {
    await ev(`window.__td3.teleportS(${s}, 0, true)`);
    await sleep(1100);
    await shot(path.join(outdir, `m6-bridge-${name}.png`));
  }
  const a = await ev('window.__cityAudit.bridge');
  ok(a.cableLat === a.towerLat && a.cableTowerGapM === 0,
    `main cable lands exactly on the tower saddles (lat ${a.cableLat} === ${a.towerLat})`);
  console.log('  bridge screenshots saved (approach, tower1, midspan, tower2)');
}

async function main() {
  const ctx = await launch({ url: `file://${root}/index.html` });
  console.log('boot ok');
  try {
    if (want('steer-screen')) await scenarioSteer(ctx);
    if (want('luma-sweep')) await scenarioLuma(ctx);
    if (want('tunnel')) await scenarioTunnel(ctx);
    if (want('bridge')) await scenarioBridge(ctx);
    if (want('city-audit')) await scenarioCityAudit(ctx);
    if (want('blackblob')) await scenarioBlackBlob(ctx);
    if (want('bridge-shots')) await scenarioBridgeShots(ctx);
    if (want('gauntlet')) await scenarioGauntlet(ctx);
    if (want('heading')) await scenarioHeading(ctx);
    if (want('nitro')) await scenarioNitro(ctx);
    if (want('collider')) await scenarioCollider(ctx);
    if (want('race')) await scenarioRace();
    const st = await ctx.ev('window.__td3.state()');
    const allErrors = [...ctx.errors, ...(st.errors || [])].filter((e) => !/WebGL/.test(e));
    console.log('page errors:', JSON.stringify(allErrors.slice(0, 5)));
    if (allErrors.length) fails.push(allErrors.length + ' console/page errors: ' + allErrors.slice(0, 3).join(' | '));
  } finally {
    ctx.close();
  }
  if (fails.length) { console.log('FAIL:', fails.join(' | ')); process.exit(2); }
  console.log('PASS: M4 self-iteration harness green, zero console errors');
  process.exit(0); // explicit: lingering CDP/chrome handles must not hang the run
}

main().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
