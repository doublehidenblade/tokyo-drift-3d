// Procedural canvas textures. NOTE (standing art rule): everything here is
// generated in code at runtime. It is placeholder art — never claim a
// designer drew any of it.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

// Deterministic PRNG so the city looks the same every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WIN_PALETTES = [
  ['#ffd27a', '#9fd8ff', '#ff9ff3'], // warm / cool / pink
  ['#9fd8ff', '#b6ffe0', '#ffd27a'], // cool-leaning
  ['#ff9ff3', '#ffd27a', '#c4b5fd'], // magenta-leaning
];

// Building facade: dark base + grid of lit windows. Used as map AND emissiveMap.
export function makeWindowTexture(variant, seed) {
  const [c, g] = canvas(128, 256);
  const rnd = mulberry32(seed);
  g.fillStyle = '#0a0d16';
  g.fillRect(0, 0, 128, 256);
  // subtle vertical grime gradient
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.05)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  const pal = WIN_PALETTES[variant % WIN_PALETTES.length];
  const cols = 8, rows = 18;
  const ww = 128 / cols, wh = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rnd() < 0.42;
      if (lit) {
        g.fillStyle = pal[(rnd() * pal.length) | 0];
        g.globalAlpha = 0.55 + rnd() * 0.45;
      } else {
        g.fillStyle = '#11141d';
        g.globalAlpha = 1;
      }
      g.fillRect(x * ww + 2, y * wh + 3, ww - 4, wh - 6);
    }
  }
  g.globalAlpha = 1;
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Asphalt with lane markings. Canvas maps 30 m across; road shader repeats along Z.
export function makeRoadTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#14161c';
  g.fillRect(0, 0, 256, 256);
  // noise speckle
  const rnd = mulberry32(7);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.25)';
    g.fillRect((rnd() * 256) | 0, (rnd() * 256) | 0, 2, 2);
  }
  // lane dividers at -6.5, 0, +6.5 m of a 26 m drivable width mapped to 256 px
  // canvas covers 30 m: px = (x + 15) / 30 * 256
  const px = (x) => ((x + 15) / 30) * 256;
  g.fillStyle = '#e8ecf4';
  // edge lines (solid)
  g.fillRect(px(-13) - 2, 0, 4, 256);
  g.fillRect(px(13) - 2, 0, 4, 256);
  // dashed lane lines
  for (const x of [-6.5, 0, 6.5]) {
    for (let y = 0; y < 256; y += 64) g.fillRect(px(x) - 2, y + 8, 4, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Start gantry banner.
export function makeGantryTexture() {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = '#070a12';
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#7dff9e';
  g.font = '900 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('TOKYO DRIFT  •  START', 512, 52);
  // checkered strip
  for (let x = 0; x < 1024; x += 32) {
    for (let y = 96; y < 128; y += 16) {
      g.fillStyle = ((x + y) / 16) % 2 ? '#fff' : '#111';
      g.fillRect(x, y, 32, 16);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Small vertical neon sign face (mounted on a building facade).
export function makeSignTexture(text, color) {
  const [c, g] = canvas(64, 192);
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, 64, 192);
  g.strokeStyle = color; g.lineWidth = 4;
  g.strokeRect(6, 6, 52, 180);
  g.fillStyle = color;
  g.font = '900 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = text.slice(0, 4).split('');
  chars.forEach((ch, i) => g.fillText(ch, 32, 40 + i * 44));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
