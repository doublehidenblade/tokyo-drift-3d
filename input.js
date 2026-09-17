// Unified input: touch buttons + keyboard. Harness can inject via setInput.
export const input = { left: false, right: false, gas: false, brake: false };

export function setInput(s) {
  for (const k of ['left', 'right', 'gas', 'brake']) {
    if (k in s) input[k] = !!s[k];
  }
  syncButtonStyles();
}

const BTN = { left: 'btn-left', right: 'btn-right', gas: 'btn-gas', brake: 'btn-brake' };

function syncButtonStyles() {
  for (const k of Object.keys(BTN)) {
    const el = document.getElementById(BTN[k]);
    if (el) el.classList.toggle('on', !!input[k]);
  }
}

function bindHold(id, key) {
  const el = document.getElementById(id);
  const on = (e) => { e.preventDefault(); input[key] = true; syncButtonStyles(); };
  const off = (e) => { e.preventDefault(); input[key] = false; syncButtonStyles(); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function bindInput() {
  bindHold('btn-left', 'left');
  bindHold('btn-right', 'right');
  bindHold('btn-gas', 'gas');
  bindHold('btn-brake', 'brake');

  const keymap = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'gas', KeyW: 'gas',
    ArrowDown: 'brake', KeyS: 'brake', Space: 'brake',
  };
  window.addEventListener('keydown', (e) => {
    const k = keymap[e.code];
    if (k) { e.preventDefault(); input[k] = true; syncButtonStyles(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = keymap[e.code];
    if (k) { e.preventDefault(); input[k] = false; syncButtonStyles(); }
  });
}
