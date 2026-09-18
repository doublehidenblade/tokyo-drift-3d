// HUD: speed / lap / lap time / distance / race time + nitro meter.
const el = {};

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  const d = Math.floor((t % 1) * 10);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + d;
}

export function bindHud() {
  el.speed = document.getElementById('hud-speed');
  el.dist = document.getElementById('hud-dist');
  el.time = document.getElementById('hud-time');
  el.lap = document.getElementById('hud-lap');
  el.laptime = document.getElementById('hud-laptime');
  el.nitro = document.getElementById('nitro-fill');
}

export function updateHud(o) {
  if (el.speed) el.speed.textContent = String(Math.round(Math.abs(o.speed) * 3.6));
  if (el.dist) el.dist.textContent = (Math.max(0, o.dist) / 1000).toFixed(2) + ' km';
  if (el.time) el.time.textContent = fmtTime(o.time).slice(0, 5);
  if (el.lap) {
    el.lap.textContent = o.raceDone ? 'FINISH' : ('LAP ' + Math.min(o.lap, o.laps) + '/' + o.laps);
    el.lap.classList.toggle('done', !!o.raceDone);
  }
  if (el.laptime) {
    const cur = o.time - o.lapStartT;
    el.laptime.textContent = 'LAP ' + fmtTime(cur) +
      (o.lastLapT != null ? '  •  LAST ' + fmtTime(o.lastLapT) : '');
  }
  if (el.nitro) {
    el.nitro.style.width = Math.round((o.nitro || 0) * 100) + '%';
    el.nitro.classList.toggle('burn', !!o.nitroOn);
  }
}
