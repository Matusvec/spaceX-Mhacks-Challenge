import * as THREE from "three";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// Returns the site-frame point under the mouse on `target`, or null if it misses.
export function pickSitePoint(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  target: THREE.Object3D,
  siteRoot: THREE.Object3D,
): THREE.Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(target, false)[0];
  return hit ? siteRoot.worldToLocal(hit.point.clone()) : null;
}
