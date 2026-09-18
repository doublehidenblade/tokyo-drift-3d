// Player car mesh, Milestone 5: 80s synthwave race car — wide low wedge,
// big F40-style rear wing, white racing stripes, glossy dark glasshouse,
// full-width red taillight strip (always on), pop-up headlights + light
// cones + one real spotlight. All geometry stays inside the Rapier
// collider cuboid: |x| <= 1.4, |z| <= 2.8, 0 <= y <= 1.5 above the road
// (mesh origin sits at road level; the harness checks fixed boxes of the
// same size). Placeholder procedural art — not designer work.
import * as THREE from 'three';

export const CAR_W = 2.8;
export const CAR_L = 5.6;
export const WHEEL_SPOTS = [[1.05, 1.9], [-1.05, 1.9], [1.05, -1.9], [-1.05, -1.9]];

function box(w, h, d, mat, x, y, z, rx) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  return m;
}

export function buildCarMesh(bodyColor) {
  const g = new THREE.Group();
  // Reflective paint: full metalness + clearcoat picks up the procedural
  // night env map (scene.environment) — building lights streak on it.
  const paint = new THREE.MeshPhysicalMaterial({
    color: bodyColor, metalness: 1.0, roughness: 0.18,
    clearcoat: 1.0, clearcoatRoughness: 0.08, envMapIntensity: 1.8,
  });
  // Glossy dark glasshouse: near-mirror so city lights reflect in it.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a0d13, metalness: 0.9, roughness: 0.06,
    clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 2.2,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x0b0e14, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.8,
  });
  const stripeMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4ff, roughness: 0.35, metalness: 0.05,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xb9c0c9, roughness: 0.3, metalness: 1.0, envMapIntensity: 1.4,
  });

  // Main body: low, wide, planted.
  g.add(box(2.76, 0.52, 5.5, paint, 0, 0.58, 0));
  // Wedge nose: dips toward the front (80s supercar stance).
  g.add(box(2.5, 0.28, 0.9, paint, 0, 0.56, 2.3, 0.08));
  // Front splitter + rear diffuser (dark trim).
  g.add(box(2.6, 0.14, 0.3, dark, 0, 0.30, 2.60));
  g.add(box(2.5, 0.22, 0.14, dark, 0, 0.42, -2.71));
  // Cabin: low glasshouse set back.
  g.add(box(2.0, 0.44, 2.3, glass, 0, 1.05, -0.35));
  // Racing stripes: hood + rear deck (split around the cabin).
  g.add(box(0.56, 0.03, 1.05, stripeMat, 0, 0.855, 1.375));
  g.add(box(0.56, 0.03, 1.05, stripeMat, 0, 0.855, -2.075));
  // F40-style rear wing: plane + dark endplates + pylons.
  g.add(box(2.5, 0.07, 0.55, paint, 0, 1.30, -2.45));
  g.add(box(0.07, 0.34, 0.6, dark, 1.22, 1.16, -2.45));
  g.add(box(0.07, 0.34, 0.6, dark, -1.22, 1.16, -2.45));
  g.add(box(0.10, 0.45, 0.35, dark, 0.75, 1.00, -2.45));
  g.add(box(0.10, 0.45, 0.35, dark, -0.75, 1.00, -2.45));
  // Side mirrors.
  g.add(box(0.10, 0.09, 0.18, paint, 1.34, 1.02, 0.55));
  g.add(box(0.10, 0.09, 0.18, paint, -1.34, 1.02, 0.55));
  // Exhaust tips.
  const exGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 10);
  exGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const ex = new THREE.Mesh(exGeo, dark);
    ex.position.set(s * 0.5, 0.42, -2.74);
    g.add(ex);
  }

  // Taillight strip: full-width red, unlit material = always on.
  const tail = box(2.55, 0.15, 0.10,
    new THREE.MeshBasicMaterial({ color: 0xff2020 }), 0, 0.80, -2.73);
  g.add(tail);

  // Pop-up style headlight lenses (front, +Z).
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xd8ecff });
  for (const s of [-1, 1]) g.add(box(0.55, 0.18, 0.10, hlMat, s * 0.85, 0.66, 2.72));

  // Headlight LIGHT CONES: additive geometry (cheap, no extra lights).
  const coneGeo = new THREE.ConeGeometry(2.2, 16, 12, 1, true);
  coneGeo.translate(0, -8, 0);      // apex at origin, opens downward...
  coneGeo.rotateX(-Math.PI / 2);   // ...then point it forward (+Z)
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xbfe0ff, transparent: true, opacity: 0.10,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    fog: false,
  });
  for (const s of [-1, 1]) {
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(s * 0.85, 0.55, 3.1);
    cone.rotation.x = 0.045; // slight downward tilt onto the road
    g.add(cone);
  }

  // One real spotlight so the road ahead is genuinely lit.
  const spot = new THREE.SpotLight(0xcfe4ff, 1400, 70, 0.46, 0.55, 1.6);
  spot.position.set(0, 1.1, 2.6);
  spot.target.position.set(0, 0, 32);
  g.add(spot, spot.target);

  // Wheels: dark cylinders with chrome hubcap discs; positioned every
  // frame by main.js (front pair steers visually).
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.20, 0.20, 0.36, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.add(new THREE.Mesh(hubGeo, chrome)); // hubcap spins/steers with wheel
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.spot = spot;
  return g;
}
