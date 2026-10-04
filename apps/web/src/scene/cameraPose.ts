import * as THREE from "three";

type Vec3 = [number, number, number];

// Where the camera was and what it framed, in site coordinates: enough to stand in the same spot again.
export type CameraPose = { position: Vec3; target: Vec3; fovDeg: number; aspect: number };

export function readPose(camera: THREE.PerspectiveCamera, lookAtDistance: number, siteRoot: THREE.Object3D): CameraPose {
  const target = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.max(lookAtDistance, 0.1)).add(camera.position);
  return {
    position: siteRoot.worldToLocal(camera.position.clone()).toArray(),
    target: siteRoot.worldToLocal(target).toArray(),
    fovDeg: camera.fov,
    aspect: camera.aspect,
  };
}

// Puts the camera back at `pose`. When the view is now narrower than the one the pose was taken in,
// the field of view is widened so everything that was in frame then is in frame now: the old picture,
// letterboxed to its own aspect and centered, then lines up with the live view edge to edge.
export function applyPose(pose: CameraPose, camera: THREE.PerspectiveCamera, target: THREE.Vector3, siteRoot: THREE.Object3D): void {
  camera.position.copy(siteRoot.localToWorld(new THREE.Vector3(...pose.position)));
  target.copy(siteRoot.localToWorld(new THREE.Vector3(...pose.target)));
  camera.lookAt(target);
  const widen = Math.max(1, pose.aspect / camera.aspect);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(pose.fovDeg) / 2) * widen));
  camera.near = Math.min(0.5, Math.max(0.05, camera.position.distanceTo(target) / 100));
  camera.updateProjectionMatrix();
}
