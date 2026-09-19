// Probe: check light state + vertexColors mismatches in the climb scene.
'use strict';
import { spawn, execSync } from 'child_process';
import http from 'http';
const CHROME = '/opt/meta-chromium/chrome';
const ROOT = '/home/hatch/workspace/ts-spaces/tokyo-drift';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}
async function main() {
  const udd = `/tmp/wave-climb-probe-${process.pid}`;
  const port = 19777;
  const url = `file://${ROOT}/the-climb-scene.html`;
  let chrome = null;
  const cleanup = () => {
    try { if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL'); } catch (e) {}
    try { execSync(`pkill -f "wav[e]-climb-probe-${process.pid}"`, { stdio: 'ignore' }); } catch (e) {}
    try { execSync(`rm -rf ${udd}`, { stdio: 'ignore' }); } catch (e) {}
  };
  process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);
  try {
    chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--allow-file-access-from-files', `--user-data-dir=${udd}`, `--remote-debugging-port=${port}`,
      '--window-size=1280,720', '--hide-scrollbars', url], { stdio: 'ignore' });
    let wsUrl = null;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (chrome.exitCode !== null) throw new Error('chrome exited early');
      try {
        const list = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json/list`));
        const t = list.find((x) => x.type === 'page' && x.url.includes('the-climb-scene.html'));
        if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
      } catch (e) {}
    }
    if (!wsUrl) throw new Error('no target');
    const ws = new WebSocket(wsUrl);
    let id = 0; const pend = new Map(); let dead = null;
    const killPend = (err) => { if (dead) return; dead = err; for (const [, p] of [...pend]) { pend.delete(p.i); p.rej(err); } };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m); return; }
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error')) {
        console.log('CONSOLE ERROR:', (m.params.args || []).map((x) => x.value ?? x.description ?? '').join(' ').slice(0, 200));
      }
      if (m.method === 'Runtime.exceptionThrown') console.log('EXCEPTION:', JSON.stringify(m.params.exceptionDetails).slice(0, 200));
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onclose = () => killPend(new Error('ws closed'));
    chrome.on('exit', (c) => killPend(new Error(`chrome exited ${c}`)));
    const send = (method, params = {}) => new Promise((res, rej) => {
      if (dead) return rej(dead);
      const i = ++id; pend.set(i, { i, res: (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result), rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('cdp timeout')); } }, 60000);
    });
    const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then((r) => {
      if (r.exceptionDetails) throw new Error('eval threw');
      return r.result.value;
    });
    await send('Runtime.enable'); await send('Page.enable');
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      await sleep(1000);
      try { if (await ev(`!!(window.__cl && window.__cl.ready)`)) break; } catch (e) { if (dead) throw dead; }
    }
    const report = await ev(`(()=>{
      const t = window.__cl; const o = { night: t.night, meshes: 0, vcMismatch: [], lights: [] };
      t.scene.traverse(n => {
        if (n.isLight) o.lights.push(n.type + ':' + n.intensity.toFixed(2));
        if (n.isMesh) { o.meshes++;
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          for (const m of mats) {
            if (m && m.vertexColors && !(n.geometry && n.geometry.getAttribute('color')))
              o.vcMismatch.push((m.name || '?') + ' on ' + (n.name || n.geometry.type));
          }
        }
      });
      o.vcMismatch = o.vcMismatch.slice(0, 25);
      return o;
    })()`);
    console.log('NIGHT STATE:', JSON.stringify(report, null, 1));
    await ev(`window.__cl.setNight(false)`);
    await sleep(500);
    const day = await ev(`(()=>{
      const t = window.__cl; const o = { night: t.night, lights: [] };
      t.scene.traverse(n => { if (n.isLight) o.lights.push(n.type + ':' + n.intensity.toFixed(2)); });
      return o;
    })()`);
    console.log('DAY STATE:', JSON.stringify(day));
    ws.close();
  } finally { cleanup(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
