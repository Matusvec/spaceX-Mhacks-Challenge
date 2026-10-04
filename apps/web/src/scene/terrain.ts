import * as THREE from "three";
import type { Body } from "../contracts";
import type { Heightfield } from "./heightfield";
import { sampleHeight } from "./heightfield";

const MAX_SEGMENTS = 511; // about 512 x 512 vertices; full-res heights stay in the Heightfield

// pipelines/data/export_scene.py keeps Gaussians down to 0.5 m below the DTM, so this clears all of them.
const SPLAT_SINK_M = 0.6;

// Height tint for terrain that has no texture: [low, high] per body.
const HEIGHT_TINT: Record<Body, [THREE.Color, THREE.Color]> = {
  mars: [new THREE.Color("#5a2e1c"), new THREE.Color("#d9a46c")],
  moon: [new THREE.Color("#4a4a4d"), new THREE.Color("#c9c9c4")],
};

// Builds the terrain mesh in site coordinates (x east, y north, z up).
export function createTerrainMesh(field: Heightfield, textureUrl: string | null, body: Body): THREE.Mesh {
  const [width, depth] = field.sizeM;
  const segX = Math.min(field.cols - 1, MAX_SEGMENTS);
  const segY = Math.min(field.rows - 1, MAX_SEGMENTS);
  // PlaneGeometry lies in the XY plane with vertices ordered from the north-west corner,
  // which matches the heightmap layout.
  const geometry = new THREE.PlaneGeometry(width, depth, segX, segY);

  const position = geometry.getAttribute("position");
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < position.count; i++) {
    const z = sampleHeight(field, position.getX(i), position.getY(i)) ?? 0;
    position.setZ(i, z);
    zMin = Math.min(zMin, z);
    zMax = Math.max(zMax, z);
  }
  geometry.computeVertexNormals();

  let material: THREE.MeshStandardMaterial;
  if (textureUrl) {
    const texture = new THREE.TextureLoader().load(textureUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    material = new THREE.MeshStandardMaterial({ map: texture, roughness: 1 });
  } else {
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
      const t = zMax > zMin ? (position.getZ(i) - zMin) / (zMax - zMin) : 0;
      color.lerpColors(...HEIGHT_TINT[body], t).toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  return mesh;
}

// Lowers the terrain mesh under a splat's footprint (site-frame box), or restores it with null.
// The splat is the ground where it exists and a 1 m DTM cannot follow it: without this, about half
// of a ground-fitted splat is hidden under the mesh. Only the drawn mesh moves; the Heightfield
// that scoring, paths and the readout use is untouched.
export function sinkTerrainUnder(terrain: THREE.Mesh, field: Heightfield, footprint: THREE.Box3 | null): void {
  const position = terrain.geometry.getAttribute("position");
  // One mesh cell of margin, so every quad that touches the footprint is lowered as a whole.
  const margin = Math.max(...field.sizeM) / Math.min(field.cols - 1, field.rows - 1, MAX_SEGMENTS);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const inside =
      footprint !== null &&
      x > footprint.min.x - margin &&
      x < footprint.max.x + margin &&
      y > footprint.min.y - margin &&
      y < footprint.max.y + margin;
    position.setZ(i, (sampleHeight(field, x, y) ?? 0) - (inside ? SPLAT_SINK_M : 0));
  }
  position.needsUpdate = true;
  terrain.geometry.computeVertexNormals();
}
