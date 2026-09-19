// Climb v2 capture harness: headless chrome + CDP screenshots.
// VM HYGIENE: unique user-data-dir prefix /tmp/wave-climb-*, cleanup pkills scoped to it.
'use strict';
import { spawn, execSync } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';

const CHROME = '/opt/meta-chromium/chrome';
const ROOT = '/home/hatch/workspace/ts-spaces/tokyo-drift';
const SHOTDIR = '/home/hatch/workspace/ts-spaces/tokyo-drift/districts/the-climb/shots';
const UDDP = 'wave-climb';
fs.mkdirSync(SHOTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => res(d)); }).on('error', rej);
  });
}

const VIEWS = [
  { name: 'street-night', night: true, street: true },
  { name: 'wide-night', night: true, view: [-2.61, 1.13, 77, 5, 2, 40] },
  { name: 'houses-night', night: true, view: [1.90, 1.45, 11, -4.82, 3.1, 47.08] },
  { name: 'harbor-night', night: true, view: [2.86, 1.46, 37, 0, 2, 80] },
  { name: 'wide-day', night: false, view: [-2.61, 1.13, 77, 5, 2, 40] },
];

async function main() {
  const udd = `/tmp/${UDDP}-${process.pid}-${Date.now()}`;
  const port = 19800 + Math.floor(Math.random() * 150);
  const url = `file://${ROOT}/the-climb-scene.html`;
  const errors = [];
  let chrome = null;
  const cleanup = () => {
    try { if (chrome && chrome.exitCode === null) chrome.kill('SIGKILL'); } catch (e) {}
    try { execSync(`pkill -f "wav[e]-${UDDP}-${process.pid}-"`, { stdio: 'ignore' }); } catch (e) {}
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
      if (chrome.exitCode !== null) throw new Error(`chrome exited early code=${chrome.exitCode}`);
      try {
        const list = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json/list`));
        const t = list.find((x) => x.type === 'page' && x.url.includes('the-climb-scene.html'));
        if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
      } catch (e) {}
    }
    if (!wsUrl) throw new Error('no page target after 60s');
    const ws = new WebSocket(wsUrl);
    let id = 0; const pend = new Map(); let dead = null;
    const killPend = (err) => { if (dead) return; dead = err; for (const [, p] of [...pend]) { pend.delete(p.i); p.rej(err); } };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); p.res(m); return; }
      if (m.method === 'Runtime.consoleAPICalled') {
        const a = m.params; const txt = (a.args || []).map((x) => x.value ?? x.description ?? '').join(' ');
        if (a.type === 'error' || a.type === 'warning') errors.push(`console.${a.type}: ${txt.slice(0, 300)}`);
      } else if (m.method === 'Runtime.exceptionThrown') {
        errors.push(`exception: ${JSON.stringify(m.params.exceptionDetails).slice(0, 300)}`);
      }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onclose = () => killPend(new Error('ws closed (chrome killed externally?)'));
    chrome.on('exit', (c) => killPend(new Error(`chrome exited code=${c}`)));
    const send = (method, params = {}) => new Promise((res, rej) => {
      if (dead) return rej(dead);
      const i = ++id; pend.set(i, { i, res: (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result), rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('cdp timeout: ' + method)); } }, method === 'Page.captureScreenshot' ? 120000 : 60000);
    });
    const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then((r) => {
      if (r.exceptionDetails) throw new Error('eval threw: ' + e.slice(0, 80));
      return r.result.value;
    });
    await send('Runtime.enable'); await send('Page.enable');

    const t0 = Date.now(); let ready = false, pageErr = null;
    while (Date.now() - t0 < 240000) {
      await sleep(1000);
      try {
        ready = await ev(`!!(window.__cl && window.__cl.ready)`);
        pageErr = await ev(`(window.__cl && window.__cl.error) || null`);
        if (pageErr) break;
        if (ready) break;
      } catch (e) { if (dead) throw dead; }
    }
    if (pageErr) throw new Error('page build error: ' + String(pageErr).slice(0, 400));
    if (!ready) throw new Error('ready timeout 240s');

    await ev(`for(const hid of ['hud','bar','status','hint']){const el=document.getElementById(hid); if(el) el.style.display='none';}`);
    for (const v of VIEWS) {
      await ev(`window.__cl.setNight(${v.night})`);
      if (v.street) await ev(`window.__cl.streetView()`);
      else { const [th, ph, r, tx, ty, tz] = v.view; await ev(`window.__cl.setView(${th},${ph},${r},${tx},${ty},${tz})`); }
      try {
        await ev(`new Promise((res)=>{ let n=0; const f=()=>{ if(++n>=2) res(true); else requestAnimationFrame(f); }; requestAnimationFrame(f); setTimeout(()=>res(false), 60000); })`);
      } catch (e) {}
      await sleep(1200);
      const cap = await send('Page.captureScreenshot', { format: 'png' });
      const p = `${SHOTDIR}/${v.name}.png`;
      fs.writeFileSync(p, Buffer.from(cap.data, 'base64'));
      console.log('shot:', p);
    }
    const state = await ev(`window.__cl.state()`);
    console.log('state:', JSON.stringify(state));
    if (errors.length) console.log('console errors:\n' + errors.slice(0, 10).join('\n'));
    ws.close();
  } finally { cleanup(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
