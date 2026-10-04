import * as THREE from "three";
import type { SciencePin } from "../contracts";
import { setMarkerScale } from "./markerScale";

const PIN_HEIGHT_M = 12; // at scale 1; the ball's radius is 2 m at scale 1
// About 60 px tall with a 20 px ball at any distance: from 36 cm tall beside the target up close
// to 60 m tall in the 2 km view.
const PIN_SCALE = { perM: 0.0045, min: 0.03, max: 5 };

// One marker per science pin: a vertical stalk with a ball on top, in site coordinates.
export function createPinMarkers(pins: SciencePin[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "pins";
  const material = new THREE.MeshStandardMaterial({ color: "#4fd1ff", emissive: "#0a4a66" });
  // Thin, so the pin does not hide a metre-sized target it stands on; the ball is what shows from afar.
  const stalk = new THREE.CylinderGeometry(0.06, 0.06, PIN_HEIGHT_M, 8).rotateX(Math.PI / 2).translate(0, 0, PIN_HEIGHT_M / 2);
  const ball = new THREE.SphereGeometry(2, 16, 12).translate(0, 0, PIN_HEIGHT_M);

  for (const pin of pins) {
    const marker = new THREE.Group();
    marker.position.set(...pin.position_site);
    marker.add(new THREE.Mesh(stalk, material), new THREE.Mesh(ball, material));
    setMarkerScale(marker, PIN_SCALE);
    group.add(marker);
  }
  return group;
}
