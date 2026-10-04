import * as THREE from "three";
import { moduleFootprint } from "../config/scoring";
import type { Body, ModuleType } from "../contracts";

const SHELL = new THREE.MeshStandardMaterial({ color: "#e8e8e8", roughness: 0.5, metalness: 0.2 });
const GLASS = new THREE.MeshStandardMaterial({ color: "#a8e6cf", transparent: true, opacity: 0.45, roughness: 0.1 });
const PAD = new THREE.MeshStandardMaterial({ color: "#5c5c5c", roughness: 0.9 });
const PANEL = new THREE.MeshStandardMaterial({ color: "#1d3b6b", roughness: 0.3, metalness: 0.5 });

// Simple procedural geometry at real size, in site coordinates with z = 0 at the leveled pad.
export function createModuleMesh(type: ModuleType, body: Body): THREE.Group {
  const group = new THREE.Group();
  group.name = `module-${type}`;
  const footprint = moduleFootprint(type, body);

  if (type === "habitat" || type === "tunnel") {
    const length = footprint.shape === "rect" ? footprint.lengthM : 8;
    const radius = footprint.shape === "rect" ? footprint.widthM / 2 : 2;
    const shell = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length - 2 * radius, 8, 24), SHELL);
    shell.rotation.z = Math.PI / 2;
    shell.position.z = radius;
    group.add(shell);
  } else if (type === "greenhouse_dome") {
    const radius = footprint.shape === "circle" ? footprint.diameterM / 2 : 5;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), GLASS);
    dome.rotation.x = Math.PI / 2;
    group.add(dome);
  } else if (type === "landing_pad") {
    const radius = footprint.shape === "circle" ? footprint.diameterM / 2 : 15;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.4, 48), PAD);
    pad.rotation.x = Math.PI / 2;
    pad.position.z = 0.2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.55, radius * 0.62, 48), SHELL);
    ring.position.z = 0.42;
    group.add(pad, ring);
  } else {
    const size = footprint.shape === "rect" ? footprint.lengthM : 20;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(size, size / rows - 1, 0.1), PANEL);
      panel.rotation.x = -0.5;
      panel.position.set(0, (r + 0.5) * (size / rows) - size / 2, 1.2);
      group.add(panel);
    }
  }
  return group;
}
