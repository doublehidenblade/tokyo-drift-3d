// Low-poly car meshes. Placeholder procedural art (see textures.js note).
import * as THREE from 'three';

export function buildCarMesh(bodyColor) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.45, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101318, roughness: 0.7 });

  const lower = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.55, 4.4), paint);
  lower.position.y = 0.62;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 2.1), dark);
  cabin.position.set(0, 1.12, -0.25);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.34, 0.7), paint);
  nose.position.set(0, 0.5, 2.35);
  // tail-light strip (rear, -Z)
  const tail = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.12, 0.08),
    new THREE.MeshBasicMaterial({ color: 0xff2a2a })
  );
  tail.position.set(0, 0.72, -2.21);
  // headlights (front, +Z)
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xcfe8ff });
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), hlMat);
    hl.position.set(s * 0.62, 0.62, 2.71);
    g.add(hl);
  }
  g.add(lower, cabin, nose, tail);

  // Wheels: cylinders, positioned every frame from the vehicle controller.
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
  const wheels = [];
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    g.add(w);
    wheels.push(w);
  }
  g.userData.wheels = wheels;
  return g;
}
