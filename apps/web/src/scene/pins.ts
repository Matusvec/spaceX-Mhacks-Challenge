import * as THREE from "three";
import type { SciencePin } from "../contracts";

const PIN_HEIGHT_M = 12;

// One marker per science pin: a vertical stalk with a ball on top, in site coordinates.
export function createPinMarkers(pins: SciencePin[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pins";
  const material = new THREE.MeshStandardMaterial({ color: "#4fd1ff", emissive: "#0a4a66" });
  const stalk = new THREE.CylinderGeometry(0.4, 0.4, PIN_HEIGHT_M, 8).rotateX(Math.PI / 2);
  const ball = new THREE.SphereGeometry(2, 16, 12);

  for (const pin of pins) {
    const [x, y, z] = pin.position_site;
    const stalkMesh = new THREE.Mesh(stalk, material);
    stalkMesh.position.set(x, y, z + PIN_HEIGHT_M / 2);
    const ballMesh = new THREE.Mesh(ball, material);
    ballMesh.position.set(x, y, z + PIN_HEIGHT_M);
    group.add(stalkMesh, ballMesh);
  }
  return group;
}
