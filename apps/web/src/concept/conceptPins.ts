import * as THREE from "three";
import { setMarkerScale } from "../scene/markerScale";
import type { ConceptPose } from "./conceptPoses";

const COLOR = "#b392f0"; // violet: not the cyan of science pins, nor a user's pin color
const HEIGHT_M = 9;

// One marker per pinned concept render, at the point its camera looked at, on the ground. Site coordinates.
export function createConceptPins(pinned: ConceptPose[], heightAt: (x: number, y: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = "concept-pins"; // SceneRoot leaves this group out of captures
  const material = new THREE.MeshBasicMaterial({ color: COLOR });
  const stalk = new THREE.CylinderGeometry(0.06, 0.06, HEIGHT_M, 6).rotateX(Math.PI / 2).translate(0, 0, HEIGHT_M / 2);
  const head = new THREE.OctahedronGeometry(1.6).translate(0, 0, HEIGHT_M);
  for (const { pose } of pinned) {
    const [x, y] = pose.target;
    const marker = new THREE.Group();
    marker.position.set(x, y, heightAt(x, y));
    marker.add(new THREE.Mesh(stalk, material), new THREE.Mesh(head, material));
    setMarkerScale(marker, { perM: 0.0045, min: 0.03, max: 5 });
    group.add(marker);
  }
  return group;
}

export function disposeConceptPins(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    (object.material as THREE.Material).dispose();
  });
}
