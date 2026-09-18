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

// Pause button (top-right) + PAUSED pill. The button toggles via pointerdown
// (touch-friendly) and never reaches the steering touchzone (it sits above it).
export function bindPauseButton(onToggle) {
  el.pauseBtn = document.getElementById('btn-pause');
  el.pausePill = document.getElementById('paused-pill');
  if (el.pauseBtn) {
    el.pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); onToggle();
    });
    el.pauseBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  setPausedUI(false);
  setPauseVisible(false); // boot lands on the menu; the button appears on START
}

export function setPausedUI(paused) {
  if (el.pauseBtn) el.pauseBtn.textContent = paused ? '▶' : '⏸';
  if (el.pausePill) el.pausePill.classList.toggle('show', !!paused);
}

// Day/Night toggle (top-left). pointerdown for touch, same as pause.
export function bindDayNightButtons(onMode) {
  const bd = document.getElementById('btn-day');
  const bn = document.getElementById('btn-night');
  if (bd) bd.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onMode('day'); });
  if (bn) bn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); onMode('night'); });
  setDayNightVisible(false); // boot lands on the menu; appear on START
}

export function setDayNightVisible(v) {
  const d = document.getElementById('daynight');
  if (d) d.style.display = v ? 'flex' : 'none';
}

// The button lives under the menu overlay (z-30 < z-50) but the retro menu
// is translucent up top, so hide it outright while the menu is shown.
export function setPauseVisible(v) {
  if (el.pauseBtn) el.pauseBtn.style.display = v ? 'flex' : 'none';
}
