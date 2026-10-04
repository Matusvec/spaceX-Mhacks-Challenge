import * as THREE from "three";

const BODY = new THREE.MeshStandardMaterial({ color: "#f2f2f2", roughness: 0.6, metalness: 0.3 });
const DARK = new THREE.MeshStandardMaterial({ color: "#2b2b2b", roughness: 0.9 });
const BEACON = new THREE.MeshBasicMaterial({ color: "#ff9f1c", transparent: true, opacity: 0.85 });
const PATH = new THREE.MeshBasicMaterial({ color: "#ff9f1c" });
const PATH_LIFT_M = 1;

// A rover about 3 m long facing +X, in site coordinates with z = 0 at the ground.
export function createRoverMesh(): THREE.Group {
  const group = new THREE.Group();
  group.name = "rover";

  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 0.9), BODY);
  body.position.z = 1.2;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8).rotateX(Math.PI / 2), BODY);
  mast.position.set(1.1, 0.6, 2.4);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), DARK);
  head.position.set(1.1, 0.6, 3.3);
  group.add(body, mast, head);

  const wheel = new THREE.CylinderGeometry(0.26, 0.26, 0.3, 16);
  for (const x of [-1.1, 0, 1.1]) {
    for (const y of [-1.25, 1.25]) {
      const mesh = new THREE.Mesh(wheel, DARK);
      mesh.position.set(x, y, 0.26);
      group.add(mesh);
    }
  }

  // A ground ring so the rover is easy to find from far away.
  const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6.5, 48), BEACON);
  ring.position.z = 0.4;
  group.add(ring);
  return group;
}

export function createPathMesh(points: [number, number, number][]): THREE.Mesh {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < points.length; i++) {
    const [ax, ay, az] = points[i - 1];
    const [bx, by, bz] = points[i];
    curve.add(new THREE.LineCurve3(new THREE.Vector3(ax, ay, az + PATH_LIFT_M), new THREE.Vector3(bx, by, bz + PATH_LIFT_M)));
  }
  const geometry = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), 0.8, 6, false);
  const mesh = new THREE.Mesh(geometry, PATH);
  mesh.name = "rover-path";
  return mesh;
}
