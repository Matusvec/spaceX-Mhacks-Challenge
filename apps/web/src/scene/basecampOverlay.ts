import * as THREE from "three";
import type { CandidateSite, SuitabilityGrid } from "../modules/siteSearch";
import { setMarkerScale } from "./markerScale";

const BAD = new THREE.Color("#d7301f");
const OK = new THREE.Color("#fee08b");
const GOOD = new THREE.Color("#1a9850");

export function gradeColor(grade: number, target = new THREE.Color()): THREE.Color {
  return grade < 50 ? target.lerpColors(BAD, OK, grade / 50) : target.lerpColors(OK, GOOD, (grade - 50) / 50);
}

// A translucent copy of the terrain surface, colored by grade.
export function createSuitabilityOverlay(terrainGeometry: THREE.BufferGeometry, grid: SuitabilityGrid): THREE.Mesh {
  const data = new Uint8Array(grid.cols * grid.rows * 4);
  const color = new THREE.Color();
  grid.grades.forEach((grade, i) => {
    if (Number.isNaN(grade)) return;
    gradeColor(grade, color);
    data.set([color.r * 255, color.g * 255, color.b * 255, 255], i * 4);
  });
  // DataTexture row 0 maps to v = 0, the south edge of the PlaneGeometry, matching the grid.
  const texture = new THREE.DataTexture(data, grid.cols, grid.rows, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return createOverlayMesh(terrainGeometry, texture, "suitability", 0.55);
}

// A translucent copy of the terrain surface showing `texture` (row 0 of the texture is the south edge).
export function createOverlayMesh(
  terrainGeometry: THREE.BufferGeometry,
  texture: THREE.Texture,
  name: string,
  opacity: number,
): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    fog: false, // haze is cosmetic; map colors must keep matching their legend
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(terrainGeometry, material);
  mesh.name = name;
  mesh.userData.opacity = opacity; // the full value, for callers that fade the overlay
  return mesh;
}

// A ring and beam over each candidate site, in site coordinates.
export function createSiteMarkers(sites: (CandidateSite & { z: number })[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "site-markers";
  const material = new THREE.MeshBasicMaterial({ color: "#ffd166", transparent: true, opacity: 0.9 });
  const ring = new THREE.RingGeometry(9, 11, 48);
  const beam = new THREE.CylinderGeometry(0.6, 0.6, 30, 8).rotateX(Math.PI / 2);
  for (const site of sites) {
    // Sized for the wide view (scale 1 at about 1.7 km) and shrinking with it, down to a 1 m ring up close.
    const marker = new THREE.Group();
    marker.position.set(site.x, site.y, site.z);
    const ringMesh = new THREE.Mesh(ring, material);
    ringMesh.position.z = 0.5;
    const beamMesh = new THREE.Mesh(beam, material);
    beamMesh.position.z = 15;
    marker.add(ringMesh, beamMesh);
    setMarkerScale(marker, { perM: 1 / 1700, min: 0.05, max: 1.5 });
    group.add(marker);
  }
  return group;
}
