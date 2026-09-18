// M3 input: no on-screen GAS/BRAKE/steer buttons. The car auto-accelerates;
// holding the left/right half of the screen steers; one TAP on the NITRO
// button burns the whole meter at once (no holding, no regen — nitro comes
// from bottle pickups on the road). Harness can inject via setInput.
export const input = { left: false, right: false, nitroPulse: false };

export function setInput(s) {
  for (const k of ['left', 'right']) {
    if (k in s) input[k] = !!s[k];
  }
  if (s.nitro) pulseNitro();
}

let flashTimer = 0;
function flashNitro() {
  const el = document.getElementById('btn-nitro');
  if (!el) return;
  el.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('on'), 350);
}

export function pulseNitro() {
  input.nitroPulse = true; // consumed by the next physics step
  flashNitro();
}

export function bindInput() {
  const zone = document.getElementById('touchzone');
  const pointers = new Map(); // pointerId -> 'left' | 'right'

  function recompute() {
    let l = false, r = false;
    for (const side of pointers.values()) {
      if (side === 'left') l = true; else r = true;
    }
    input.left = l; input.right = r;
  }

  zone.addEventListener('pointerdown', (e) => {
    // The title overlay covers the zone until the race starts.
    const side = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    pointers.set(e.pointerId, side);
    recompute();
    e.preventDefault();
  });
  const release = (e) => {
    if (pointers.delete(e.pointerId)) recompute();
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
  zone.addEventListener('contextmenu', (e) => e.preventDefault());

  // One tap = burn the whole meter. No hold.
  const nitroBtn = document.getElementById('btn-nitro');
  nitroBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation(); pulseNitro();
  });
  nitroBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  const keymap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (!e.repeat) { e.preventDefault(); pulseNitro(); }
      return;
    }
    const k = keymap[e.code];
    if (k) { e.preventDefault(); input[k] = true; }
  });
  window.addEventListener('keyup', (e) => {
    const k = keymap[e.code];
    if (k) { e.preventDefault(); input[k] = false; }
  });
}
