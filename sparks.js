// Pooled spark particles (curb kisses, wall scrapes, rival bumps).
import * as THREE from 'three';

const MAX = 360;

export class Sparks {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX); // remaining seconds
    this.head = 0;
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffb347, size: 0.22, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    // park all points far underground
    for (let i = 0; i < MAX; i++) this.pos[i * 3 + 1] = -50;
  }

  burst(x, y, z, n, spread = 3.2) {
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % MAX;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (Math.random() - 0.5) * spread * 2;
      this.vel[i * 3 + 1] = Math.random() * spread + 1.5;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread * 2;
      this.life[i] = 0.35 + Math.random() * 0.3;
    }
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 12 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -50;
    }
    if (any) this.attr.needsUpdate = true;
  }
}
