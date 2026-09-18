// Tokyo Drift v2 — visual inspection loop (Craig's iteration-2 gate).
// Captures: 7 districts + tunnel entry + tunnel exit + bridge, in DAY and
// NIGHT. For each shot records: page errors, mean luma (night darkness
// probe), ground clearance (body Y vs exact surface Y), and city stats.
// Exits nonzero if any hard assertion fails.
// Usage: node harness/autopilot/inspect-v2.mjs [--out=dir]
'use strict';
import { launch } from './cdp.mjs';
import fs from 'fs';
import path from 'path';

const root = new URL('../..', import.meta.url).pathname;
const outArg = process.argv.find((a) => a.startsWith('--out='));
const OUT = outArg ? outArg.slice(6) : path.join(root, 'harness/shots-v2-inspection');
fs.mkdirSync(OUT, { recursive: true });

// [name, s (m)]
const VIEWS = [
  ['district-start-plaza', 500],
  ['district-harbor-west', 4100],
  ['district-the-climb', 1200],
  ['district-waterfront-east', 1800],
  ['district-downtown', 2500],
  ['district-south-ridge', 3500],
  ['district-industrial-edge', 3750],
  ['tunnel-entry', 4339],
  ['tunnel-exit', 5039],
  ['bridge', 2570],
];
const MODES = ['night', 'day'];

async function main() {
  const ctx = await launch({
    url: `file://${root}/index.html`, query: '?world=v2',
    width: 1280, height: 720,
  });
  const { ev, shot, errors } = ctx;
  const report = { views: [], errors: [], failed: false };
  try {
    await ev('window.__td3.start()');
    const stats = await ev('window.__td3.cityStats()');
    report.cityStats = stats;
    console.log('cityStats:', JSON.stringify(stats));

    for (const mode of MODES) {
      await ev(`window.__td3.setDayNight('${mode}')`);
      for (const [name, s] of VIEWS) {
        const tag = `${mode}-${name}`;
        await ev(`window.__td3.teleportS(${s}, 0, true)`);
        await ev('window.__td3.snapCamera()');
        await ev('window.__td3.stepPhysics(12)'); // one beat so the frame renders settled
        const file = path.join(OUT, `${tag}.png`);
        await shot(file);
        const st = await ev(`(() => {
          const d = window.__td3.debug();
          return { luma: window.__td3.luma(), bodyY: +d.bodyY.toFixed(2),
                   groundY: +d.groundY.toFixed(2), s: window.__td3.state().s,
                   dayNight: window.__td3.state().dayNight };
        })()`);
        const clearance = +(st.bodyY - st.groundY).toFixed(2); // expect ~0.4
        const view = { tag, file, luma: st.luma, clearance, s: st.s, dayNight: st.dayNight, problems: [] };
        if (mode === 'night' && st.luma < 0.04) view.problems.push(`night too dark (luma ${st.luma})`);
        if (Math.abs(clearance - 0.4) > 0.25) view.problems.push(`car off ground: clearance ${clearance} (want ~0.4)`);
        if (view.problems.length) report.failed = true;
        report.views.push(view);
        console.log(`${tag}: luma=${st.luma} clearance=${clearance} ${view.problems.join('; ') || 'OK'}`);
      }
    }
  } finally {
    ctx.close();
  }
  report.errors = errors.slice();
  if (errors.length) { report.failed = true; console.log('PAGE ERRORS:', JSON.stringify(errors.slice(0, 10), null, 1)); }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  console.log(report.failed ? 'INSPECT: FAIL' : 'INSPECT: PASS', `(${OUT})`);
  process.exit(report.failed ? 1 : 0);
}
main().catch((e) => { console.error('INSPECT FAIL:', e.message); process.exit(2); });
