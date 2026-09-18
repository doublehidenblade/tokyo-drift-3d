// Shared headless-Chrome CDP helper for the M4 self-iteration harness.
'use strict';
import { spawn } from 'child_process';
import http from 'http';

export const CHROME = '/opt/meta-chromium/chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

export async function launch({ url, width = 360, height = 780, query = '' }) {
  const port = 19500 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    `--remote-debugging-port=${port}`, `--window-size=${width},${height}`,
    url + query,
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 110; i++) {
    await sleep(500);
    try {
      const list = JSON.parse(await httpGet(`http://127.0.0.1:${port}/json/list`));
      const t = list.find((x) => x.type === 'page' && x.url.includes('index.html'));
      if (t) { wsUrl = t.webSocketDebuggerUrl; break; }
    } catch (e) { /* not up yet */ }
  }
  if (!wsUrl) { chrome.kill(); throw new Error('no debuggable page'); }

  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const errors = [];
  ws.onmessage = (evm) => {
    const m = JSON.parse(evm.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      p(m); return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('exception: ' + (m.params.exceptionDetails.text ||
        m.params.exceptionDetails.exception?.description || ''));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('log: ' + m.params.entry.text);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pend.has(i)) { pend.delete(i); rej(new Error('cdp timeout ' + method)); }
    }, 300000);
  });
  const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true }).then((r) => {
    if (r.exceptionDetails) {
      throw new Error('eval threw: ' + e.slice(0, 100) + ' :: ' + JSON.stringify(r.exceptionDetails.text));
    }
    return r.result.value;
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');

  // Fail fast when the browser blocked the navigation itself (e.g. local-
  // network access checks in Chromium >= 152): the tab shows chrome's
  // error page and the game can never become ready. Callers may retry
  // with a file:// URL.
  const navHref = await ev('location.href').catch(() => '');
  if (/^chrome-error:\/\//.test(navHref)) {
    chrome.kill();
    throw new Error('navigation blocked by the browser (chrome error page): ' + url);
  }

  for (let i = 0; i < 110; i++) {
    await sleep(500);
    try { if (await ev('!!(window.__td3 && window.__td3.ready)')) break; } catch (e) { /* booting */ }
    if (i === 59) throw new Error('game never became ready');
  }
  // M4: synthesized pointer presses for the steering gate. The game
  // listens for PointerEvents (pointerdown/up) on #touchzone and maps
  // them to left/right by SCREEN HALF — it never checks pointerType.
  // CDP Input.dispatchMouseEvent produces real PointerEvents through the
  // browser input pipeline, so this exercises the exact production
  // touch path (same handler, same hit-testing) minus only the finger
  // itself. We describe these honestly as synthesized pointer presses,
  // not TouchEvents: no Input.dispatchTouchEvent is used. The release
  // reuses the press coordinates so pointer capture ends cleanly.
  const _pressPos = { x: 0, y: 0 };
  return {
    ev,
    errors,
    shot: async (path) => {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      const fs = await import('fs');
      fs.writeFileSync(path, Buffer.from(s.data, 'base64'));
    },
    pressStart: async (x, y) => {
      _pressPos.x = x; _pressPos.y = y;
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x, y,
        button: 'left',
        clickCount: 1,
      });
    },
    pressEnd: async () => {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: _pressPos.x, y: _pressPos.y,
        button: 'left',
        clickCount: 1,
      });
    },
    close: () => { try { ws.close(); } catch (e) {} chrome.kill(); },
  };
}

export async function waitFor(fn, timeoutMs, label, pollMs = 500) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout: ' + label);
    await sleep(pollMs);
  }
}
