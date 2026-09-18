// M2 input: no on-screen GAS/BRAKE/steer buttons. The car auto-accelerates;
// holding the left/right half of the screen steers; a NITRO button
// (bottom-right) boosts. Harness can inject via setInput.
export const input = { left: false, right: false, nitro: false };

export function setInput(s) {
  for (const k of ['left', 'right', 'nitro']) {
    if (k in s) input[k] = !!s[k];
  }
  syncNitroStyle();
}

function syncNitroStyle() {
  const el = document.getElementById('btn-nitro');
  if (el) el.classList.toggle('on', !!input.nitro);
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

  const nitroBtn = document.getElementById('btn-nitro');
  const nOn = (e) => { e.preventDefault(); e.stopPropagation(); input.nitro = true; syncNitroStyle(); };
  const nOff = (e) => { e.preventDefault(); input.nitro = false; syncNitroStyle(); };
  nitroBtn.addEventListener('pointerdown', nOn);
  nitroBtn.addEventListener('pointerup', nOff);
  nitroBtn.addEventListener('pointercancel', nOff);
  nitroBtn.addEventListener('pointerleave', nOff);
  nitroBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  const keymap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'nitro', ShiftLeft: 'nitro', ShiftRight: 'nitro',
  };
  window.addEventListener('keydown', (e) => {
    const k = keymap[e.code];
    if (k) { e.preventDefault(); input[k] = true; syncNitroStyle(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = keymap[e.code];
    if (k) { e.preventDefault(); input[k] = false; syncNitroStyle(); }
  });
}
