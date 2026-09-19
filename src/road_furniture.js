// Tokyo Drift 3D — Road furniture from the inspected plan.
// Builds procedural geometry for plan placements with proc- assets:
// zebra crossings, chevron markings, lane arrows, guardrails.
// Reads src/plan_placements.json (the floor-plan gate output).
import * as THREE from 'three';

export async function buildRoadFurniture(scene, track) {
  const counts = {};
  let res;
  try {
    res = await fetch('src/plan_placements.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.warn('[furniture] plan_placements.json failed:', e.message);
    return counts;
  }
  const plan = await res.json();
  const props = plan.props.filter((p) => p.asset.startsWith('proc-'));

  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xffcc33, transparent: true, opacity: 0.85 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.4, metalness: 0.7 });

  const label = (obj, asset) => { obj.userData.asset = asset; return obj; };

  // --- Zebra crossings: white stripes across the road
  {
    const items = props.filter((p) => p.type === 'zebra-crossing');
    const stripeGeo = new THREE.PlaneGeometry(0.6, 12); // stripe width x road width
    stripeGeo.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(stripeGeo, white, Math.max(1, items.length * 8));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let i = 0;
    for (const z of items) {
      // 8 stripes across the road, spaced 1.5 m apart along the road
      for (let k = 0; k < 8; k++) {
        const along = (k - 3.5) * 1.5;
        e.set(0, z.yaw, 0); q.setFromEuler(e);
        // offset along the road direction
        const dx = Math.sin(z.yaw) * along, dz = Math.cos(z.yaw) * along;
        v.set(z.x + dx, z.y + 0.01, z.z + dz);
        m.compose(v, q, sc);
        im.setMatrixAt(i++, m);
      }
    }
    im.count = i;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    label(im, 'proc/zebra-crossing');
    scene.add(im);
    counts['proc-zebra'] = items.length;
  }

  // --- Chevron (hatched) markings: diagonal stripes in a box
  {
    const items = props.filter((p) => p.type === 'chevron');
    const stripeGeo = new THREE.PlaneGeometry(0.5, 8);
    stripeGeo.rotateX(-Math.PI / 2);
    stripeGeo.rotateY(Math.PI / 4); // diagonal
    const im = new THREE.InstancedMesh(stripeGeo, yellow, Math.max(1, items.length * 10));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let i = 0;
    for (const c of items) {
      for (let k = 0; k < 10; k++) {
        const along = (k - 4.5) * 2;
        e.set(0, c.yaw, 0); q.setFromEuler(e);
        const dx = Math.sin(c.yaw) * along, dz = Math.cos(c.yaw) * along;
        v.set(c.x + dx, c.y + 0.01, c.z + dz);
        m.compose(v, q, sc);
        im.setMatrixAt(i++, m);
      }
    }
    im.count = i;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    label(im, 'proc/chevron');
    scene.add(im);
    counts['proc-chevron'] = items.length;
  }

  // --- Lane arrows: arrow shape pointing forward
  {
    const items = props.filter((p) => p.type === 'lane-arrow');
    // Arrow: shaft + head (two triangles)
    const shape = new THREE.Shape();
    shape.moveTo(-0.3, -2); shape.lineTo(0.3, -2); shape.lineTo(0.3, 0.5);
    shape.lineTo(1, 0.5); shape.lineTo(0, 2); shape.lineTo(-1, 0.5);
    shape.lineTo(-0.3, 0.5); shape.lineTo(-0.3, -2);
    const arrowGeo = new THREE.ShapeGeometry(shape);
    arrowGeo.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(arrowGeo, white, Math.max(1, items.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    items.forEach((a, i) => {
      e.set(0, a.yaw, 0); q.setFromEuler(e);
      v.set(a.x, a.y + 0.01, a.z);
      m.compose(v, q, sc);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    label(im, 'proc/lane-arrow');
    scene.add(im);
    counts['proc-arrow'] = items.length;
  }

  // --- Guardrails: steel rail on posts, both sides
  {
    const items = props.filter((p) => p.type === 'guardrail');
    // Rail: horizontal box 4 m long; posts: vertical boxes
    const railGeo = new THREE.BoxGeometry(0.15, 0.35, 4);
    const postGeo = new THREE.BoxGeometry(0.15, 0.75, 0.15);
    const railIM = new THREE.InstancedMesh(railGeo, steel, Math.max(1, items.length));
    const postIM = new THREE.InstancedMesh(postGeo, steel, Math.max(1, items.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    items.forEach((g, i) => {
      e.set(0, g.yaw, 0); q.setFromEuler(e);
      // Rail at 0.6 m height
      v.set(g.x, g.y + 0.6, g.z);
      m.compose(v, q, sc);
      railIM.setMatrixAt(i, m);
      // Post at ground
      v.set(g.x, g.y + 0.375, g.z);
      m.compose(v, q, sc);
      postIM.setMatrixAt(i, m);
    });
    railIM.instanceMatrix.needsUpdate = true;
    postIM.instanceMatrix.needsUpdate = true;
    railIM.frustumCulled = postIM.frustumCulled = false;
    label(railIM, 'proc/guardrail-rail');
    label(postIM, 'proc/guardrail-post');
    scene.add(railIM); scene.add(postIM);
    counts['proc-guardrail'] = items.length;
  }

  console.log('[furniture] built from plan:', JSON.stringify(counts));
  return counts;
}
