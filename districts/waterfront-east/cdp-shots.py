#!/usr/bin/env python3
"""CDP driver: wait for window.__we.ready, then capture view screenshots."""
import json, time, base64, urllib.request, os
import websocket

PORT = 19873
VIEWS = ["street", "wide", "bridge"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)

def pages():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=10) as r:
        return json.load(r)

def main():
    pg = [p for p in pages() if p["type"] == "page" and "waterfront-east-scene" in p["url"]][0]
    ws = websocket.create_connection(pg["webSocketDebuggerUrl"], timeout=90)
    seq = [0]
    def call(method, params=None):
        seq[0] += 1
        i = seq[0]
        ws.send(json.dumps({"id": i, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == i:
                return msg.get("result", {})
    def ev(expr):
        r = call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
        return (r.get("result") or {}).get("result", {}).get("value")
    call("Page.enable"); call("Runtime.enable")

    for v in VIEWS:
        url = f"file:///home/hatch/workspace/ts-spaces/tokyo-drift/waterfront-east-scene.html?view={v}&fx=low"
        call("Page.navigate", {"url": url})
        ready, st, err = False, "?", None
        for _ in range(150):
            time.sleep(2)
            try:
                st = ev("document.getElementById('status').textContent")
                rd = ev("window.__we && window.__we.ready")
                err = ev("window.__we && window.__we.error")
            except Exception as e:
                st, rd = f"eval-fail {e}", False
            if err:
                print(f"{v}: LOAD ERROR: {err}", flush=True); break
            if rd:
                ready = True
                time.sleep(5)
                break
        print(f"{v}: ready={ready} status={st}", flush=True)
        if not ready:
            continue
        shot = call("Page.captureScreenshot", {"format": "png"})
        data = base64.b64decode(shot["data"])
        p = os.path.join(OUT, f"{v}.png")
        with open(p, "wb") as f:
            f.write(data)
        print(f"{v}: saved {len(data)} bytes -> {p}", flush=True)
    ws.close()

main()
