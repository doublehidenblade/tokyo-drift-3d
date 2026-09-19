#!/bin/bash
# Headless CDP chrome for waterfront-east verification shots.
# Mirrors the sibling workers' flag set. DO NOT broad-pkill while siblings run.
exec /opt/meta-chromium/chrome --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --no-proxy-server --allow-file-access-from-files --remote-allow-origins='*' \
  --user-data-dir=/tmp/wave-we-cdp3 --remote-debugging-port=19873 --window-size=1280,720 \
  "file:///home/hatch/workspace/ts-spaces/tokyo-drift/waterfront-east-scene.html?view=street" \
  >/tmp/we-cdp3.log 2>&1
