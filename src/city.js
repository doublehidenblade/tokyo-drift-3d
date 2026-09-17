// Night-city scene: road, curbs (visual), buildings (InstancedMesh +
// static colliders), attached neon signs, street lamps, start gantry,
// stars + moon, ground skirt, fog.
import * as THREE from 'three';
import { CFG } from './config.js';
import { mulberry32, makeWindowTexture, makeRoadTexture, makeGantryTexture, makeSignTexture } from './textures.js';

const SIGN_WORDS = [
  ['24H', '#7df9ff'], ['酒', '#ff5fa2'], ['NEON', '#ff9f43'], ['喫茶', '#b6ffe0'],
  ['DRIFT', '#ff5fa2'], ['夜', '#7df9ff'], ['RAMEN', '#ffd27a'], ['東京', '#c4b5fd'],
];

export function buildCity(scene, physics) {
  const rnd = mulberry32(20260917);
  const L = CFG.trackLength;

  // ---- Lighting: dim ambient so emissive windows/neon carry the night ----
  scene.add(new THREE.HemisphereLight(0x2a3a5f, 0x05060a, 0.55));
  const dir = new THREE.DirectionalLight(0x8fb4ff, 0.35);
  dir.position.set(-120, 200, -80);
  scene.add(dir);
  scene.background = new THREE.Color(0x05070f);
  scene.fog = new THREE.Fog(0x05070f, 90, 520);

  // ---- Ground skirt (so gaps between road and buildings aren't void) ----
  const skirt = new THREE.Mesh(
    new THREE.PlaneGeometry(900, L + 600),
    new THREE.MeshBasicMaterial({ color: 0x04050a })
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.position.set(0, -0.08, L / 2);
  scene.add(skirt);

  // ---- Road ----
  const roadTex = makeRoadTexture();
  roadTex.repeat.set(1, (L + 200) / 24);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(30, L + 200),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85, metalness: 0.1 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, L / 2);
  scene.add(road);

  // ---- Curb visuals (physics boxes already in physics.js) ----
  const curbMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 });
  for (const s of [-1, 1]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(1.5, CFG.curbTopY, L + 200), curbMat);
    curb.position.set(s * CFG.curbX, CFG.curbTopY / 2, L / 2);
    scene.add(curb);
    // pale edge strip on top (night visibility)
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.02, L + 200),
      new THREE.MeshBasicMaterial({ color: s < 0 ? 0xcfe0ff : 0xff5040 })
    );
    strip.position.set(s * (CFG.curbX - 0.55), CFG.curbTopY + 0.012, L / 2);
    scene.add(strip);
  }

  // ---- Buildings: 3 texture variants -> 3 InstancedMeshes ----
  const variants = [0, 1, 2].map(v => {
    const tex = makeWindowTexture(v, 1000 + v);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9,
      roughness: 0.95, metalness: 0.0,
    });
    return { tex, mat, list: [] };
  });

  const buildings = []; // {x,z,w,d,h,side} for signs + colliders
  for (const side of [-1, 1]) {
    let z = -50;
    while (z < L + 60) {
      const w = 8 + rnd() * 12, d = 8 + rnd() * 12, h = 10 + rnd() * 38;
      const x = side * (17 + rnd() * 40);
      const b = { x, z: z + d / 2, w, d, h, side };
      buildings.push(b);
      variants[(rnd() * 3) | 0].list.push(b);
      // Static collider: box sitting on the ground.
      physics.addStaticBox(w / 2, h / 2, d / 2, x, h / 2, b.z, 'building');
      z += d + 4 + rnd() * 10;
    }
  }
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const v of variants) {
    const im = new THREE.InstancedMesh(boxGeo, v.mat, v.list.length);
    const m = new THREE.Matrix4();
    v.list.forEach((b, i) => {
      m.makeScale(b.w, b.h, b.d);
      m.setPosition(b.x, b.h / 2, b.z);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
  }

  // ---- Neon signs, physically mounted on building facades facing the road ----
  const signGroup = new THREE.Group();
  const signBackMat = new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.8 });
  let placed = 0;
  for (const b of buildings) {
    if (placed >= 34) break;
    if (rnd() < 0.72) continue;
    const [word, color] = SIGN_WORDS[(rnd() * SIGN_WORDS.length) | 0];
    const sw = 1.4, sh = 3.5 + rnd() * 4;
    const faceX = b.x - b.side * (b.w / 2 + 0.18); // facade plane on the road side
    const y = 5 + rnd() * Math.max(2, b.h - 12);
    const tex = makeSignTexture(word, color);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, sh, sw), signBackMat);
    board.position.set(faceX, y, b.z);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(sw * 0.92, sh * 0.94),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    // face the road: plane normal points toward -side*X
    face.rotation.y = b.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    face.position.set(faceX - b.side * 0.14, y, b.z);
    signGroup.add(board, face);
    placed++;
  }
  scene.add(signGroup);

  // ---- Street lamps (instanced poles + emissive heads) ----
  const lampZ = [];
  for (let z = -20; z < L + 40; z += 46) lampZ.push(z);
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 7.2, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1a1e28, roughness: 0.8 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampZ.length * 2);
  const headGeo = new THREE.SphereGeometry(0.28, 8, 8);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampZ.length * 2);
  {
    const m = new THREE.Matrix4();
    let i = 0;
    lampZ.forEach((z, k) => {
      for (const s of [-1, 1]) {
        const x = s * 14.6;
        m.makeTranslation(x, 3.6, z + (k % 2 ? 0 : 0));
        poles.setMatrixAt(i, m);
        m.makeTranslation(x - s * 0.9, 7.15, z);
        heads.setMatrixAt(i, m);
        i++;
      }
    });
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }
  scene.add(poles, heads);

  // ---- Start gantry at z = 0 ----
  const gantry = new THREE.Group();
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.6, metalness: 0.3 });
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 8, 0.7), postMat);
    post.position.set(s * 10.5, 4, 0);
    gantry.add(post);
  }
  const bannerTex = makeGantryTexture();
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(22, 1.7, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.7 })
  );
  beam.position.set(0, 7.4, 0);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(21.4, 1.6),
    new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide })
  );
  banner.position.set(0, 7.4, 0.26);
  const banner2 = banner.clone();
  banner2.rotation.y = Math.PI;
  banner2.position.z = -0.26;
  gantry.add(beam, banner, banner2);
  scene.add(gantry);

  // ---- Stars + moon ----
  {
    const n = 700, pos = new Float32Array(n * 3);
    const sr = mulberry32(99);
    for (let i = 0; i < n; i++) {
      const th = sr() * Math.PI * 2, ph = sr() * Math.PI * 0.42;
      const r = 950;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      pos[i * 3 + 1] = 60 + Math.sin(ph) * r * 0.6;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r + 600;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaFC4e8, size: 1.6, sizeAttenuation: false })));
    const moon = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false })
    );
    moon.position.set(-260, 260, 1100);
    moon.lookAt(0, 0, 0);
    scene.add(moon);
  }

  return { buildings };
}
