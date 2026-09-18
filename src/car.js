// Player car mesh, Milestone 3: 2.8 m wide (70% of the 4 m lane),
// reflective clearcoat paint, headlight light cones + one real
// spotlight, glowing taillight strip. Placeholder procedural art.
import * as THREE from 'three';

export const CAR_W = 2.8;
export const CAR_L = 5.6;
export const WHEEL_SPOTS = [[1.05, 1.9], [-1.05, 1.9], [1.05, -1.9], [-1.05, -1.9]];

export function buildCarMesh(bodyColor) {
  const g = new THREE.Group();
  // Reflective paint: high metalness + clearcoat picks up the procedural
  // night env map (scene.environment).
  const paint = new THREE.MeshPhysicalMaterial({
    color: bodyColor, metalness: 0.9, roughness: 0.24,
    clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.6,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x0b0e14, roughness: 0.35, metalness: 0.6, envMapIntensity: 1.0,
  });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(CAR_W, 0.55, CAR_L), paint);
  lower.position.y = 0.62;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR_W * 0.82, 0.55, 2.6), dark);
  cabin.position.set(0, 1.15, -0.3);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(CAR_W * 0.98, 0.34, 0.9), paint);
  nose.position.set(0, 0.5, CAR_L / 2 + 0.2);
  g.add(lower, cabin, nose);

  // Taillight strip (rear, -Z) + red glow.
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_W * 0.9, 0.12, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  );
  tail.position.set(0, 0.72, -CAR_L / 2 - 0.01);
  g.add(tail);

  // Headlight lenses (front, +Z).
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xd8ecff });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.08), hlMat);
    hl.position.set(s * CAR_W * 0.32, 0.62, CAR_L / 2 + 0.41);
    g.add(hl);
  }

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
    cone.position.set(s * CAR_W * 0.32, 0.55, CAR_L / 2 + 0.4);
    cone.rotation.x = 0.045; // slight downward tilt onto the road
    g.add(cone);
  }

  // One real spotlight so the road ahead is genuinely lit.
  const spot = new THREE.SpotLight(0xcfe4ff, 1400, 70, 0.46, 0.55, 1.6);
  spot.position.set(0, 1.1, CAR_L / 2);
  spot.target.position.set(0, 0, CAR_L / 2 + 30);
  g.add(spot, spot.target);

  // Wheels: cylinders, positioned every frame (front pair steers visually).
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.userData.spot = spot;
  return g;
}
