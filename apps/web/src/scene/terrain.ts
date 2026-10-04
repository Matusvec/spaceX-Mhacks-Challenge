import * as THREE from "three";
import type { Heightfield } from "./heightfield";
import { sampleHeight } from "./heightfield";

const MAX_SEGMENTS = 511; // about 512 x 512 vertices; full-res heights stay in the Heightfield

const LOW_COLOR = new THREE.Color("#5a2e1c");
const HIGH_COLOR = new THREE.Color("#d9a46c");

// Builds the terrain mesh in site coordinates (x east, y north, z up).
export function createTerrainMesh(field: Heightfield, textureUrl: string | null): THREE.Mesh {
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
      color.lerpColors(LOW_COLOR, HIGH_COLOR, t).toArray(colors, i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "terrain";
  return mesh;
}
