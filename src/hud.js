// HUD: speed / distance / time.
const el = {};
export function bindHud() {
  el.speed = document.getElementById('hud-speed');
  el.dist = document.getElementById('hud-dist');
  el.time = document.getElementById('hud-time');
}

export function updateHud(speedMs, distM, timeS) {
  if (el.speed) el.speed.textContent = String(Math.round(Math.abs(speedMs) * 3.6));
  if (el.dist) el.dist.textContent = (Math.max(0, distM) / 1000).toFixed(2) + ' km';
  if (el.time) {
    const m = Math.floor(timeS / 60), s = Math.floor(timeS % 60);
    el.time.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
}
