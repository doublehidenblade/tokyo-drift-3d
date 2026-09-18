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
  ['#7df9ff', '#ffd27a', '#ff8a5c'], // cyan-leaning
  ['#c4b5fd', '#9fd8ff', '#ff5fa2'], // violet-leaning
];

// Glass-tower facade: dark reflective base + bright window grid. Used with
// high metalness so it picks up the procedural night env map.
export function makeGlassTexture(seed) {
  const [c, g] = canvas(128, 256);
  const rnd = mulberry32(seed);
  g.fillStyle = '#070b14';
  g.fillRect(0, 0, 128, 256);
  const cols = 10, rows = 22;
  const ww = 128 / cols, wh = 256 / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = rnd() < 0.5;
      g.fillStyle = lit ? (rnd() < 0.6 ? '#bfe6ff' : '#ffe9b8') : '#0d1420';
      g.globalAlpha = lit ? 0.5 + rnd() * 0.5 : 1;
      g.fillRect(x * ww + 1, y * wh + 2, ww - 2, wh - 4);
    }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

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

// Horizontal facade board (mounted flush on a building facade).
export function makeBoardTexture(text, color) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#06070c';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = color; g.lineWidth = 3;
  g.strokeRect(4, 4, 248, 56);
  g.fillStyle = color;
  g.font = '900 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.slice(0, 10), 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Overhead directional gantry panel (bolted to the gantry beam).
export function makeDirPanelTexture(line1, line2) {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#04140a';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#1d5c38'; g.lineWidth = 6;
  g.strokeRect(5, 5, 502, 118);
  g.fillStyle = '#eafff2';
  g.font = '900 44px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(line1, 256, line2 ? 42 : 64);
  if (line2) {
    g.fillStyle = '#7dff9e';
    g.fillText(line2, 256, 92);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Tunnel interior concrete with panel seams.
export function makeTunnelTexture() {
  const [c, g] = canvas(256, 256);
  const rnd = mulberry32(4242);
  g.fillStyle = '#151920';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.2)';
    g.fillRect((rnd() * 256) | 0, (rnd() * 256) | 0, 3, 3);
  }
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.beginPath(); g.moveTo(0, 200); g.lineTo(256, 200); g.stroke();
  // reflective guide strip near the base
  g.fillStyle = '#ffdf6b';
  g.fillRect(0, 216, 256, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Soft radial glow sprite (lamp heads, signs, portals). Used as the map
// for additive THREE.Points systems — cheap fake bloom, no postprocessing.
export function makeGlowTexture() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Wet-asphalt streak overlay: soft horizontal light streaks, tiled along Z.
export function makeWetStreakTexture() {
  const [c, g] = canvas(256, 256);
  const rnd = mulberry32(777);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 46; i++) {
    const y = rnd() * 256, w = 30 + rnd() * 120, x = rnd() * 256 - 60;
    const h = 2 + rnd() * 5;
    const hue = ['255,190,120', '150,210,255', '255,140,180'][(rnd() * 3) | 0];
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, `rgba(${hue},0)`);
    grad.addColorStop(0.5, `rgba(${hue},${0.10 + rnd() * 0.16})`);
    grad.addColorStop(1, `rgba(${hue},0)`);
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Tiny procedural night-sky env map so metallic/reflective surfaces have
// neon to reflect. Equirectangular; assigned to scene.environment.
export function makeEnvTexture() {
  const [c, g] = canvas(128, 64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#0a1024');
  grad.addColorStop(0.55, '#060a18');
  grad.addColorStop(1, '#020306');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  const rnd = mulberry32(31337);
  const cols = ['#ff5fa2', '#7df9ff', '#ffd27a', '#b6ffe0', '#ff9f43'];
  for (let i = 0; i < 90; i++) {
    g.fillStyle = cols[(rnd() * cols.length) | 0];
    g.globalAlpha = 0.25 + rnd() * 0.6;
    const w = 2 + rnd() * 14;
    g.fillRect(rnd() * 128, 20 + rnd() * 22, w, 1 + rnd() * 2);
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}
