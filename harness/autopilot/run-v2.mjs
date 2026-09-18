// V2 layout-demo harness: scripted playtests for the plan-driven world
// (?world=v2, the default) in headless Chrome via CDP. Follows the
// harness/autopilot/run.mjs patterns and reuses cdp.mjs.
//
// Scenarios:
//   boot       page boots, zero page errors, track is the v2 plan
//              (5791.3 m), spawn sits at S/F (s=348).
//   lap        autopilot (?autopilot=1) drives ONE full lap from S/F via
//              __td3.stepAutopilot in a loop (300 game-second budget) and
//              the lap counter must increment (lap >= 2).
//   sections   teleport to the midpoint of each of the 12 named sections
//              (s0/s1 from city_plan_v2.json) and screenshot to
//              harness/shots-v2/section-<id>.png.
//   luma       full-lap luma sweep every 100 m (batched in-page); no sample
//              may read below 0.035, and tunnel-interior samples must stay
//              above 0.05.
//
// Usage: node harness/autopilot/run-v2.mjs [--port=8000] [--only=a,b] [--shots=dir] [--file]
// The static server must already be running:
//   python3 -m http.server 8000   (from ~/workspace/tokyo-drift-3d)
// --file loads the page via file:// instead of http://127.0.0.1:8000 — use it
// when the test browser blocks local-network navigations
// (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, Chromium >= 152).
'use strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { launch, sleep, waitFor } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith('--port='));
const PORT = portArg ? parseInt(portArg.slice(7), 10) : 8000;
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice(7).split(',') : null;
const shotsArg = args.find((a) => a.startsWith('--shots='));
const outdir = shotsArg ? path.resolve(shotsArg.slice(8)) : path.join(root, 'harness', 'shots-v2');
fs.mkdirSync(outdir, { recursive: true });
const USE_FILE = args.includes('--file');
const PAGE_HTTP = `http://127.0.0.1:${PORT}/index.html`;
const PAGE = USE_FILE ? `file://${root}/index.html` : PAGE_HTTP;
// If the test browser blocks local-network navigation
// (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, Chromium >= 152),
// launchPage() retries the same page via file:// automatically.

const plan = JSON.parse(fs.readFileSync(
  path.resolve(process.env.HOME, 'workspace/tokyo-drift-godot/docs/city-design/city_plan_v2.json'), 'utf8'));
const SECTIONS = plan.sections; // [{id, name, s0_m, s1_m, ...}]
const LAP = plan.meta.lap_length_m;
const SF_S = plan.start_finish.s_m;
const TUN = { s0: plan.tunnel.s0_m, s1: plan.tunnel.s1_m };

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg);
  if (!cond) fails.push(msg);
};
const want = (name) => !ONLY || ONLY.includes(name);
const pageErrors = (ctx, st) =>
  [...ctx.errors, ...((st && st.errors) || [])].filter((e) => !/WebGL/.test(e));

// Launch a harness page, falling back from http:// to file:// when the
// browser refuses local-network navigation (Chromium >= 152 local-network
// access checks). The plain `node run-v2.mjs` command therefore works in
// both environments without a manual --file flag.
async function launchPage(query) {
  try {
    return await launch({ url: PAGE, query });
  } catch (e) {
    if (PAGE.startsWith('http') && /navigation blocked by the browser/.test(e.message)) {
      console.log('  (local HTTP blocked by the browser; retrying via file://)');
      return await launch({ url: `file://${root}/index.html`, query });
    }
    throw e;
  }
}

async function scenarioBoot(ctx) {
  console.log('SCENARIO boot (v2 world, zero page errors)');
  const { ev } = ctx;
  const st = await ev('window.__td3.state()');
  const checks = await ev('window.__td3.checks()');
  console.log(`  trackLen=${checks.trackLen} (plan ${LAP}), spawn s=${st.s}, state=${st.state}`);
  ok(Math.abs(checks.trackLen - LAP) < 1, `v2 track length is the plan lap (${checks.trackLen} m)`);
  ok(Math.abs(st.s - SF_S) < 2, `spawn sits at S/F (s=${st.s}, plan ${SF_S})`);
  ok(st.state === 'menu', 'boot lands on the menu');
  const errs = pageErrors(ctx, st);
  ok(errs.length === 0, `zero page errors at boot (got ${errs.length}: ${errs.slice(0, 2).join(' | ')})`);
  // Badge evidence: the v2 badge must be visible on the default world.
  const badgeVisible = await ev(`(() => {
    const b = document.getElementById('v2badge');
    return b && getComputedStyle(b).display !== 'none';
  })()`);
  ok(badgeVisible === true, 'v2 layout-demo badge is visible');
  await sleep(800);
  await ctx.shot(path.join(outdir, 'v2-boot.png'));
  // The classic world must still boot (?world=classic).
  const c2 = await launchPage('?world=classic');
  try {
    const cst = await c2.ev('window.__td3.state()');
    const cch = await c2.ev('window.__td3.checks()');
    const badgeHidden = await c2.ev(`(() => {
      const b = document.getElementById('v2badge');
      return b && getComputedStyle(b).display === 'none';
    })()`);
    console.log(`  classic world: trackLen=${cch.trackLen}, spawn s=${cst.s}`);
    ok(Math.abs(cch.trackLen - 5227) < 60, `classic track length preserved (${cch.trackLen} m)`);
    ok(badgeHidden === true, 'v2 badge hidden in classic mode');
    const cerrs = pageErrors(c2, cst);
    ok(cerrs.length === 0, `zero page errors in classic mode (got ${cerrs.length})`);
  } finally {
    c2.close();
  }
}

async function scenarioLap() {
  console.log('SCENARIO lap (autopilot, one full lap from S/F, 300 game-second budget)');
  const ctx = await launchPage('?world=v2&autopilot=1');
  const { ev } = ctx;
  try {
    await waitFor(async () => {
      const t = await ev('typeof window.__td3.autopilotState').catch(() => 'undefined');
      return t === 'function' ? true : null;
    }, 90000, 'autopilot load', 1000);
    await ev('window.__td3.start()'); // resetGame: state='playing', spawn at S/F
    let lap = 1, s0 = 0, steps = 0;
    const t0 = Date.now();
    for (let i = 0; i < 300; i++) {
      await ev('window.__td3.stepAutopilot(60)'); // 1 game-second per call
      steps += 60;
      const ap = await ev('window.__td3.autopilotState()');
      if (!ap) throw new Error('autopilotState() returned null mid-lap');
      lap = ap.lap; s0 = ap.s;
      if (i % 30 === 0) console.log(`  t=${steps / 60}s wall=${((Date.now() - t0) / 1000).toFixed(0)}s lap=${lap} s=${s0}`);
      if (lap >= 2) break;
    }
    console.log(`  finished: lap=${lap} s=${s0} after ${steps / 60} game-seconds`);
    ok(lap >= 2, `lap counter incremented after one full lap (lap=${lap})`);
    ok(steps / 60 <= 300, `lap completed within the 300 game-second budget (${(steps / 60).toFixed(0)} s)`);
    await ev(`window.__td3.teleportS(${s0}, 0, true)`);
    await sleep(1000);
    await ctx.shot(path.join(outdir, 'v2-lap.png'));
    const st = await ev('window.__td3.state()');
    const errs = pageErrors(ctx, st);
    ok(errs.length === 0, `zero page errors during the lap (got ${errs.length}: ${errs.slice(0, 2).join(' | ')})`);
  } finally {
    ctx.close();
  }
}

async function scenarioSections(ctx) {
  console.log('SCENARIO sections (12 named-section screenshots)');
  const { ev } = ctx;
  ok(SECTIONS.length === 12, `plan has 12 named sections (got ${SECTIONS.length})`);
  for (const sec of SECTIONS) {
    const mid = (sec.s0_m + sec.s1_m) / 2;
    await ev(`window.__td3.teleportS(${mid}, 0, true)`);
    await sleep(1100); // let the chase camera settle on the snapped pose
    await ctx.shot(path.join(outdir, `section-${sec.id}.png`));
    console.log(`  section ${sec.id} (${sec.name.trim()}) s=${mid.toFixed(0)}`);
  }
  ok(true, '12 section screenshots captured');
}

async function scenarioLuma(ctx) {
  console.log('SCENARIO luma (full-lap sweep every 100 m, batched in-page)');
  const { ev } = ctx;
  const samples = await ev('window.__td3.sweepLuma(100)');
  let min = { s: 0, luma: 1 };
  const dark = [];
  const tunnelDark = [];
  for (const { s, luma } of samples) {
    if (luma < min.luma) min = { s, luma };
    if (luma < 0.035) dark.push(`${s}:${luma.toFixed(3)}`);
    if (s > TUN.s0 && s < TUN.s1 && luma < 0.05) tunnelDark.push(`${s}:${luma.toFixed(3)}`);
  }
  console.log(`  ${samples.length} samples, min luma=${min.luma} at s=${min.s}`);
  console.log(`  below 0.035: ${dark.length}${dark.length ? ' (' + dark.slice(0, 6).join(' ') + ')' : ''}`);
  console.log(`  tunnel interior below 0.05: ${tunnelDark.length}`);
  fs.writeFileSync(path.join(outdir, 'v2-luma-sweep.csv'),
    's,luma\n' + samples.map(({ s, luma }) => `${s},${luma}`).join('\n') + '\n');
  if (dark.length) {
    const s0 = parseInt(dark[0].split(':')[0], 10);
    await ev(`window.__td3.teleportS(${s0}, 0, true)`);
    await sleep(1200);
    await ctx.shot(path.join(outdir, 'v2-darkest.png'));
  }
  ok(dark.length === 0, `no near-black stretch on the lap (dark: ${dark.slice(0, 6).join(' ') || 'none'})`);
  ok(tunnelDark.length === 0, `tunnel interior never near-black (below 0.05: ${tunnelDark.length})`);
}

async function main() {
  const ctx = await launchPage('?world=v2');
  console.log('boot ok');
  try {
    if (want('boot')) await scenarioBoot(ctx);
    if (want('sections')) await scenarioSections(ctx);
    if (want('luma')) await scenarioLuma(ctx);
    if (want('lap')) await scenarioLap();
    const st = await ctx.ev('window.__td3.state()');
    const allErrors = pageErrors(ctx, st);
    console.log('page errors:', JSON.stringify(allErrors.slice(0, 5)));
    if (allErrors.length) fails.push(allErrors.length + ' console/page errors: ' + allErrors.slice(0, 3).join(' | '));
  } finally {
    ctx.close();
  }
  if (fails.length) { console.log('FAIL:', fails.join(' | ')); process.exit(2); }
  console.log('PASS: v2 layout-demo harness green, zero console errors');
  process.exit(0); // explicit: lingering CDP/chrome handles must not hang the run
}

main().catch((e) => { console.error('HARNESS FAIL:', e.message); process.exit(1); });
