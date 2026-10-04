import * as THREE from "three";

// A marker that keeps about the same size on screen: its scale is `perM` times its distance from the
// camera, held between `min` and `max` (so its size in metres has a floor and a ceiling).
// With `lift`, the object is not scaled but raised to `heightM` times that scale above `baseZ`:
// for a label that sits on top of a scaled stalk and keeps its own size.
export type MarkerScale = { perM: number; min: number; max: number; lift?: { baseZ: number; heightM: number } };

export function setMarkerScale(object: THREE.Object3D, scale: MarkerScale): void {
  object.userData.markerScale = scale;
}

const position = new THREE.Vector3();
const eye = new THREE.Vector3();

// Call once per frame, before rendering.
export function scaleMarkers(root: THREE.Object3D, camera: THREE.Camera): void {
  camera.getWorldPosition(eye); // in VR the camera sits inside a moving rig
  root.traverse((object) => {
    const marker = object.userData.markerScale as MarkerScale | undefined;
    if (!marker) return;
    if (marker.lift) {
      // Measured from the foot of the stalk, so the label does not feed back into its own height.
      position.copy(object.position).setZ(marker.lift.baseZ);
      const distance = object.parent!.localToWorld(position).distanceTo(eye);
      object.position.z = marker.lift.baseZ + marker.lift.heightM * THREE.MathUtils.clamp(distance * marker.perM, marker.min, marker.max);
    } else {
      const distance = object.getWorldPosition(position).distanceTo(eye);
      object.scale.setScalar(THREE.MathUtils.clamp(distance * marker.perM, marker.min, marker.max));
    }
  });
}
