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

// Building facade: dark base + VARIED lit windows — golden-age anime night
// city. Floors vary (dark bands, full-lit rows, scattered singles), with
// vertical neon strips and bright corner edge lines (synthwave). Used as
// map AND emissiveMap. Procedural placeholder art — never designer-drawn.
export function makeWindowTexture(variant, seed) {
  const [c, g] = canvas(128, 256);
  const rnd = mulberry32(seed);
  g.fillStyle = '#060910';
  g.fillRect(0, 0, 128, 256);
  const pal = WIN_PALETTES[variant % WIN_PALETTES.length];
  const cols = 8, rows = 18;
  const ww = 128 / cols, wh = 256 / rows;
  for (let y = 0; y < rows; y++) {
    const fm = rnd();
    const darkFloor = fm < 0.24, fullLit = fm >= 0.24 && fm < 0.42;
    for (let x = 0; x < cols; x++) {
      const px = x * ww + 2, py = y * wh + 3, pw = ww - 4, ph = wh - 6;
      if (darkFloor) {
        const lone = rnd() < 0.045;
        g.fillStyle = lone ? pal[(rnd() * pal.length) | 0] : '#0a0e16';
        g.globalAlpha = lone ? 0.85 : 1;
      } else if (fullLit) {
        g.fillStyle = pal[(rnd() * pal.length) | 0];
        g.globalAlpha = 0.72 + rnd() * 0.28;
      } else if (rnd() < 0.52) {
        g.fillStyle = pal[(rnd() * pal.length) | 0];
        g.globalAlpha = 0.5 + rnd() * 0.5;
      } else {
        g.fillStyle = rnd() < 0.1 ? '#16202e' : '#0c1018';
        g.globalAlpha = 1;
      }
      g.fillRect(px, py, pw, ph);
    }
  }
  g.globalAlpha = 1;
  // Vertical neon strip (synthwave accent) on ~45% of facades.
  if (rnd() < 0.45) {
    const sx = (rnd() < 0.5 ? 1 : cols - 2) * ww + ww / 2;
    const sc = ['#35f2ff', '#ff5fa2'][(rnd() * 2) | 0];
    g.save();
    g.shadowColor = sc; g.shadowBlur = 8;
    g.fillStyle = sc;
    g.fillRect(sx - 1.5, 12, 3, 232);
    g.restore();
  }
  // Bright corner edge lines — each face's vertical edges catch neon.
  const ec = pal[(rnd() * pal.length) | 0];
  g.fillStyle = ec; g.globalAlpha = 0.85;
  g.fillRect(0, 10, 2, 236); g.fillRect(126, 10, 2, 236);
  g.globalAlpha = 1;
  // Parapet band + dim beacon strip along the roofline.
  g.fillStyle = '#04060a'; g.fillRect(0, 0, 128, 10);
  g.fillStyle = '#3a0f16'; g.fillRect(0, 10, 128, 2);
  // Ground-floor shadow + grime gradient.
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.04)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.12)');
  grad.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Rooftop skin: dark membrane, parapet rim, HVAC boxes, vents, a water
// tank, and static red corner markers where the 3D aviation blinkers sit.
// Procedural placeholder art.
export function makeRoofTexture(seed) {
  const [c, g] = canvas(128, 128);
  const rnd = mulberry32(seed);
  g.fillStyle = '#0a0d14';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.28)';
    g.fillRect((rnd() * 128) | 0, (rnd() * 128) | 0, 2, 2);
  }
  // parapet rim
  g.strokeStyle = '#1c2432'; g.lineWidth = 7;
  g.strokeRect(4, 4, 120, 120);
  // HVAC boxes
  const nBox = 2 + ((rnd() * 3) | 0);
  for (let i = 0; i < nBox; i++) {
    const bw = 14 + rnd() * 18, bh = 10 + rnd() * 14;
    const bx = 14 + rnd() * (100 - bw), by = 14 + rnd() * (100 - bh);
    g.fillStyle = '#232b38'; g.fillRect(bx, by, bw, bh);
    g.fillStyle = '#39434f'; g.fillRect(bx, by, bw, 3);
    g.fillStyle = 'rgba(125,249,255,0.5)'; g.fillRect(bx + 3, by + 5, 4, 3);
  }
  // vents
  for (let i = 0; i < 5; i++) {
    g.fillStyle = '#05070b';
    g.beginPath();
    g.arc(14 + rnd() * 100, 14 + rnd() * 100, 2.5 + rnd() * 2, 0, 7);
    g.fill();
  }
  // water tank
  if (rnd() < 0.6) {
    const tx = 16 + rnd() * 70, ty = 16 + rnd() * 70;
    g.fillStyle = '#2b3444';
    g.beginPath(); g.roundRect(tx, ty, 22, 16, 4); g.fill();
    g.fillStyle = '#3c4757'; g.fillRect(tx, ty + 5, 22, 2); g.fillRect(tx, ty + 11, 22, 2);
  }
  // static red corner markers (the animated 3D blinkers mount above these)
  g.fillStyle = '#ff2a2a';
  for (const [qx, qy] of [[8, 8], [120, 8], [8, 120], [120, 120]]) {
    g.beginPath(); g.arc(qx, qy, 3, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Lit shopfront for building bases: neon sign band, glowing glass panes
// with mullions, door, warm interior shelving silhouettes. variant 0 warm
// izakaya / 1 teal cafe / 2 pink bar. Procedural placeholder art.
export function makeStorefrontTexture(variant, seed) {
  const [c, g] = canvas(256, 128);
  const rnd = mulberry32(seed);
  const glowCols = ['#ffca7a', '#9fe8ff', '#ff9fd0'];
  const gc = glowCols[variant % glowCols.length];
  g.fillStyle = '#07080d';
  g.fillRect(0, 0, 256, 128);
  // neon sign band with abstract glyph blocks
  g.fillStyle = '#0a0c12'; g.fillRect(0, 0, 256, 30);
  const blocks = 3 + ((rnd() * 3) | 0);
  for (let i = 0; i < blocks; i++) {
    g.save();
    g.shadowColor = gc; g.shadowBlur = 8;
    g.fillStyle = gc;
    g.globalAlpha = 0.85;
    g.fillRect(14 + i * 34, 7, 16 + rnd() * 10, 16);
    g.restore();
  }
  g.globalAlpha = 1;
  // glowing glass panes
  const panes = 3 + ((rnd() * 2) | 0);
  const pw = 256 / panes;
  for (let i = 0; i < panes; i++) {
    const grad = g.createLinearGradient(0, 36, 0, 128);
    grad.addColorStop(0, gc);
    grad.addColorStop(1, '#1a0f06');
    g.globalAlpha = 0.85;
    g.fillStyle = grad;
    g.fillRect(i * pw + 4, 36, pw - 8, 88);
    g.globalAlpha = 1;
    // interior shelf silhouettes
    g.fillStyle = 'rgba(10,6,3,0.75)';
    for (let sh = 0; sh < 3; sh++)
      g.fillRect(i * pw + 8, 56 + sh * 20, pw - 16, 3);
    // goods dots
    g.fillStyle = gc;
    for (let d = 0; d < 6; d++)
      g.fillRect(i * pw + 8 + rnd() * (pw - 20), 50 + rnd() * 60, 3, 3);
    // mullion
    g.fillStyle = '#0a0c12';
    g.fillRect(i * pw - 2, 34, 4, 92);
  }
  // door
  g.fillStyle = 'rgba(5,4,3,0.9)';
  g.fillRect(256 - pw + 8, 52, pw - 20, 74);
  g.strokeStyle = gc; g.lineWidth = 2;
  g.strokeRect(256 - pw + 8, 52, pw - 20, 74);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Raised sidewalk: light blue-gray concrete tiles with seams + speckle.
export function makeSidewalkTexture(seed) {
  const [c, g] = canvas(128, 128);
  const rnd = mulberry32(seed);
  g.fillStyle = '#2b3140';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 420; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.22)';
    g.fillRect((rnd() * 128) | 0, (rnd() * 128) | 0, 2, 2);
  }
  g.strokeStyle = '#1d2330'; g.lineWidth = 2;
  for (let k = 0; k <= 128; k += 32) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 128); g.stroke();
    g.beginPath(); g.moveTo(0, k); g.lineTo(128, k); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Striped shop awning. Procedural placeholder art.
export function makeAwningTexture(seed) {
  const [c, g] = canvas(128, 64);
  const rnd = mulberry32(seed);
  const cols = ['#c23a4e', '#2a9db8', '#c27a2a', '#7a4ec2'];
  const pick = cols[(rnd() * cols.length) | 0];
  for (let x = 0; x < 128; x += 16) {
    g.fillStyle = (x / 16) % 2 ? pick : '#dfe6f2';
    g.fillRect(x, 0, 16, 64);
  }
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Asphalt with lane markings. Canvas maps 30 m across (u); the road
// geometry repeats along the lap via UV v = s/24 (256 px = 24 m).
// M6 lane layout (B7) — one wide roadway, NO median:
//   solid edge lines at +/-12 m, SOLID center line at 0 (splits the two
//   traffic directions), and dashed lane lines at +/-8, +/-4 with VARIED
//   dash/gap lengths. Every dash cycle divides the 24 m tile (6 m cycles)
//   so the pattern tiles seamlessly along v.
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
  // canvas covers 30 m: px = (x + 15) / 30 * 256 ; 256 px = 24 m along v
  const px = (x) => ((x + 15) / 30) * 256;
  const M_PER_PX = 24 / 256;
  g.fillStyle = '#e8ecf4';
  // solid edge lines at +/-12
  g.fillRect(px(-12) - 2, 0, 4, 256);
  g.fillRect(px(12) - 2, 0, 4, 256);
  // SOLID center line at 0 — splits the two traffic directions (B7).
  // Slightly warm white, a touch wider than the edge lines.
  g.fillStyle = '#f5eeda';
  g.fillRect(px(0) - 3, 0, 6, 256);
  g.fillStyle = '#e8ecf4';
  // Dashed lane lines at +/-8, +/-4 — varied dash/gap per line (B7).
  // [lateral, dashM, gapM]; dash+gap = 6 m so the 24 m tile always closes.
  const DASHES = [
    [-8, 3.0, 3.0],
    [-4, 2.0, 4.0],
    [4, 4.0, 2.0],
    [8, 1.5, 4.5],
  ];
  for (const [x, dashM, gapM] of DASHES) {
    const dashPx = dashM / M_PER_PX, cycPx = (dashM + gapM) / M_PER_PX;
    for (let y = 0; y < 256; y += cycPx)
      g.fillRect(px(x) - 2, y + 2, 4, Math.min(dashPx, 256 - y - 2));
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

// Checkered start/finish line strip, laid flat across the road at s=0.
export function makeStartLineTexture() {
  const [c, g] = canvas(128, 32);
  const n = 16, m = 4, cw = 128 / n, ch = 32 / m;
  for (let y = 0; y < m; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#f2f4f8' : '#0b0d12';
      g.fillRect(x * cw, y * ch, cw, ch);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Small vertical neon sign face (mounted on a building facade).
// Neon-tube look: glowing border + shadowBlur text. Procedural placeholder.
export function makeSignTexture(text, color) {
  const [c, g] = canvas(64, 192);
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, 64, 192);
  g.save();
  g.shadowColor = color; g.shadowBlur = 10;
  g.strokeStyle = color; g.lineWidth = 3;
  g.strokeRect(7, 7, 50, 178);
  g.strokeStyle = color; g.lineWidth = 1; g.globalAlpha = 0.7;
  g.strokeRect(12, 12, 40, 168);
  g.restore();
  g.fillStyle = color;
  g.font = '900 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.shadowColor = color; g.shadowBlur = 14;
  const chars = text.slice(0, 4).split('');
  chars.forEach((ch, i) => {
    g.fillText(ch, 32, 40 + i * 44);
    g.fillText(ch, 32, 40 + i * 44); // double-strike for tube brightness
  });
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Horizontal facade board (mounted flush on a building facade).
// Neon-tube look with glow. Procedural placeholder.
export function makeBoardTexture(text, color) {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#06070c';
  g.fillRect(0, 0, 256, 64);
  g.save();
  g.shadowColor = color; g.shadowBlur = 9;
  g.strokeStyle = color; g.lineWidth = 3;
  g.strokeRect(5, 5, 246, 54);
  g.restore();
  g.fillStyle = color;
  g.font = '900 34px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save();
  g.shadowColor = color; g.shadowBlur = 12;
  g.fillText(text.slice(0, 10), 128, 34);
  g.fillText(text.slice(0, 10), 128, 34);
  g.restore();
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

// Weathered concrete for tunnel portal headwalls / retaining walls.
// Procedural placeholder art.
export function makeConcreteTexture(seed) {
  const [c, g] = canvas(256, 256);
  const rnd = mulberry32(seed);
  g.fillStyle = '#232830';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.22)';
    g.fillRect((rnd() * 256) | 0, (rnd() * 256) | 0, 3, 3);
  }
  // formwork panel seams
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  for (let y = 0; y <= 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  // water staining streaks running down
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 256, w = 3 + rnd() * 8, h = 40 + rnd() * 120;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.save(); g.translate(x, rnd() * 60); g.fillRect(-w / 2, 0, w, h); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Tunnel interior concrete with panel seams.
export function makeTunnelTexture() {  const [c, g] = canvas(256, 256);
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

// Wet-asphalt streak overlay: bright horizontal light streaks, tiled along
// Z — fake neon reflections on the wet road. Procedural placeholder art.
export function makeWetStreakTexture() {
  const [c, g] = canvas(256, 256);
  const rnd = mulberry32(777);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 84; i++) {
    const y = rnd() * 256, w = 40 + rnd() * 170, x = rnd() * 256 - 85;
    const h = 2 + rnd() * 6;
    const hue = ['255,190,120', '150,220,255', '255,140,190', '120,240,230', '200,160,255'][(rnd() * 5) | 0];
    const a = 0.20 + rnd() * 0.30;
    const grad = g.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, `rgba(${hue},0)`);
    grad.addColorStop(0.5, `rgba(${hue},${a})`);
    grad.addColorStop(1, `rgba(${hue},0)`);
    g.fillStyle = grad;
    g.fillRect(x, y, w, h);
    // hot core line
    g.fillStyle = `rgba(255,255,255,${a * 0.45})`;
    g.fillRect(x + w * 0.25, y + h * 0.3, w * 0.5, Math.max(1, h * 0.4));
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
