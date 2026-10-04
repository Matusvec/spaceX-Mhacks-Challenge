import * as THREE from "three";
import type { Body } from "../contracts";

// Presentation fill: sky, haze, ground beyond the data window and fine grain up close. All of it is
// cosmetic and none of it is data. Switched off, the scene renders exactly as it did without it.
const RAW_BACKGROUND = new THREE.Color("#0b0d12");
// Mars: dusty tan sky, paler at the horizon, with haze of the horizon color. Moon: black, no air, no haze.
// The ground beyond the data is dimmed so the real tile stands out: on Mars the edge's average color,
// a little darker, fading into haze; on the Moon the edge's darkest color, falling to black by
// `blackByM` from the edge, so the tile reads as lit ground with darkness beyond.
type Skirt = { from: "average" | "darkest"; shade: number; blackByM: number | null };
const SKY: Record<Body, { zenith: string; horizon: string; hazeDensity: number; skirt: Skirt }> = {
  mars: { zenith: "#a98660", horizon: "#e2c8a2", hazeDensity: 0.00024, skirt: { from: "average", shade: 0.9, blackByM: null } },
  moon: { zenith: "#000000", horizon: "#000000", hazeDensity: 0, skirt: { from: "darkest", shade: 0.7, blackByM: 3000 } },
};
// The skirt: rings of ground beyond the terrain tile, at these distances from its edge. `settle` is how
// far each ring's height has moved from the edge's own height toward the edge's average. Color settles
// to the average within the first ring, so no streak of the tile's detail is drawn past the data.
const SKIRT_RINGS = [
  { beyondM: 0, settle: 0 },
  { beyondM: 120, settle: 0.4 },
  { beyondM: 400, settle: 0.8 },
  { beyondM: 1000, settle: 1 },
  { beyondM: 3000, settle: 1 },
  { beyondM: 18000, settle: 1 },
];
const SKIRT_MOTTLE_SCALE = 500; // the grain pattern enlarged to 150 m, 45 m and 15 m patches, so the skirt reads as ground
const EDGE_SAMPLE_PX = 64; // the tile's photo is averaged down to this before its edge colors are read

const GRAIN_GLSL = /* glsl */ `
  uniform float uGrain;
  uniform float uGrainScale;
  varying vec3 vGrainPos;
  float grainHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float grainNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(grainHash(i), grainHash(i + vec2(1.0, 0.0)), f.x),
               mix(grainHash(i + vec2(0.0, 1.0)), grainHash(i + vec2(1.0, 1.0)), f.x), f.y) - 0.5;
  }
  // Three sizes of zero-mean speckle (0.3 m, 0.09 m, 0.03 m at scale 1), each fading out with
  // distance before it would shimmer.
  float grain(vec2 p, float dist) {
    return 0.24 * grainNoise(p / 0.3) * (1.0 - smoothstep(60.0, 160.0, dist))
         + 0.34 * grainNoise(p / 0.09) * (1.0 - smoothstep(16.0, 45.0, dist))
         + 0.38 * grainNoise(p / 0.03) * (1.0 - smoothstep(5.0, 13.0, dist));
  }
`;

export class SceneLook {
  private body: Body = "mars";
  private enabled = true;
  private overlayShown = false;
  private sky: THREE.Texture | null = null;
  private skirt: THREE.Mesh | null = null;
  private terrainMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly grain = { value: 0 };
  private attachId = 0;

  constructor(private readonly scene: THREE.Scene) {}

  // Call once per bundle, after the terrain mesh exists. `parent` is the site-frame root.
  attach(body: Body, terrain: THREE.Mesh, textureUrl: string | null, parent: THREE.Object3D): void {
    const id = ++this.attachId;
    this.body = body;
    this.overlayShown = false;
    this.skirt = null; // the old one was disposed with the old site root
    this.sky?.dispose();
    this.sky = createSkyTexture(SKY[body]);
    this.terrainMaterial = terrain.material as THREE.MeshStandardMaterial;
    addGrain(this.terrainMaterial, this.grain, 1);
    void edgeColors(terrain, textureUrl).then((colors) => {
      if (id !== this.attachId) return;
      this.skirt = createSkirt(terrain.geometry as THREE.PlaneGeometry, colors, SKY[body].skirt);
      parent.add(this.skirt);
      this.apply();
    });
    this.apply();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.apply();
  }

  // While a science overlay or the suitability map is drawn on the terrain, the tile under it gets
  // neither grain nor haze, so the map looks exactly as it does with the fill off.
  setOverlayShown(shown: boolean): void {
    this.overlayShown = shown;
    this.apply();
  }

  private apply(): void {
    const sky = SKY[this.body];
    this.scene.background = this.enabled && this.sky ? this.sky : RAW_BACKGROUND;
    this.scene.fog = this.enabled && sky.hazeDensity > 0 ? new THREE.FogExp2(sky.horizon, sky.hazeDensity) : null;
    if (this.skirt) this.skirt.visible = this.enabled;
    const dressTile = this.enabled && !this.overlayShown;
    this.grain.value = dressTile ? 1 : 0;
    if (this.terrainMaterial && this.terrainMaterial.fog !== dressTile) {
      this.terrainMaterial.fog = dressTile;
      this.terrainMaterial.needsUpdate = true;
    }
  }
}

// A vertical gradient used as an equirectangular background: zenith at the top, horizon from the middle down.
function createSkyTexture({ zenith, horizon }: { zenith: string; horizon: string }): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, zenith);
  gradient.addColorStop(0.5, horizon);
  gradient.addColorStop(1, horizon);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  return texture;
}

function addGrain(material: THREE.MeshStandardMaterial, grain: { value: number }, scale: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrain = grain;
    shader.uniforms.uGrainScale = { value: scale };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrainPos;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvGrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRAIN_GLSL}`)
      .replace(
        "#include <map_fragment>",
        "#include <map_fragment>\nif (uGrain > 0.0) diffuseColor.rgb *= 1.0 + uGrain * grain(vGrainPos.xz / uGrainScale, distance(vGrainPos, cameraPosition) / uGrainScale);",
      );
  };
  material.needsUpdate = true;
}

// Linear RGB at each perimeter vertex of the terrain tile: from its photo, averaged down so no detail
// is carried past the edge, or from its vertex colors when it has no photo.
async function edgeColors(terrain: THREE.Mesh, textureUrl: string | null): Promise<(u: number, v: number, vertex: number) => THREE.Color> {
  const vertexColors = terrain.geometry.getAttribute("color");
  if (!textureUrl) return (_u, _v, vertex) => new THREE.Color().fromBufferAttribute(vertexColors, vertex);
  const image = await new THREE.ImageLoader().loadAsync(textureUrl);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = EDGE_SAMPLE_PX;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, EDGE_SAMPLE_PX, EDGE_SAMPLE_PX);
  const { data } = context.getImageData(0, 0, EDGE_SAMPLE_PX, EDGE_SAMPLE_PX);
  return (u, v) => {
    const col = Math.min(Math.floor(u * EDGE_SAMPLE_PX), EDGE_SAMPLE_PX - 1);
    const row = Math.min(Math.floor((1 - v) * EDGE_SAMPLE_PX), EDGE_SAMPLE_PX - 1);
    const i = (row * EDGE_SAMPLE_PX + col) * 4;
    return new THREE.Color().setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace);
  };
}

// Ground past the edge of the data, in site coordinates: each perimeter vertex is carried outward
// along a ray from the center, settling to the edge's average height and color. Untextured, so it is
// plainly less detailed than the tile; it is a separate mesh, so picking and overlays never touch it.
function createSkirt(
  tile: THREE.PlaneGeometry,
  colorAt: (u: number, v: number, vertex: number) => THREE.Color,
  { from, shade, blackByM }: Skirt,
): THREE.Mesh {
  const { widthSegments: nx, heightSegments: ny } = tile.parameters;
  const position = tile.getAttribute("position");
  const uv = tile.getAttribute("uv");
  const perimeter: number[] = [];
  for (let c = 0; c < nx; c++) perimeter.push(c); // north edge, west to east
  for (let r = 0; r < ny; r++) perimeter.push(r * (nx + 1) + nx); // east edge, north to south
  for (let c = nx; c > 0; c--) perimeter.push(ny * (nx + 1) + c); // south edge, east to west
  for (let r = ny; r > 0; r--) perimeter.push(r * (nx + 1)); // west edge, south to north

  const edge = perimeter.map((vertex) => ({
    x: position.getX(vertex),
    y: position.getY(vertex),
    z: position.getZ(vertex),
    color: colorAt(uv.getX(vertex), uv.getY(vertex), vertex),
  }));
  const meanZ = edge.reduce((sum, p) => sum + p.z, 0) / edge.length;
  const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const base =
    from === "darkest"
      ? edge.reduce((darkest, p) => (luminance(p.color) < luminance(darkest) ? p.color : darkest), edge[0].color).clone()
      : edge.reduce((sum, p) => sum.add(p.color), new THREE.Color(0, 0, 0)).multiplyScalar(1 / edge.length);
  base.multiplyScalar(shade);

  const n = edge.length;
  const positions = new Float32Array(n * SKIRT_RINGS.length * 3);
  const colors = new Float32Array(n * SKIRT_RINGS.length * 3);
  SKIRT_RINGS.forEach(({ beyondM, settle }, ring) => {
    edge.forEach((p, i) => {
      const reach = 1 + beyondM / Math.hypot(p.x, p.y);
      positions.set([p.x * reach, p.y * reach, p.z + (meanZ - p.z) * settle], (ring * n + i) * 3);
      const light = blackByM === null ? 1 : Math.max(0, 1 - beyondM / blackByM);
      const tint = ring === 0 && from === "average" ? p.color.clone().multiplyScalar(shade) : base;
      tint.clone().multiplyScalar(light).toArray(colors, (ring * n + i) * 3);
    });
  });
  const index: number[] = [];
  for (let ring = 0; ring < SKIRT_RINGS.length - 1; ring++) {
    for (let i = 0; i < n; i++) {
      const a = ring * n + i;
      const b = ring * n + ((i + 1) % n);
      index.push(a, b, a + n, b, b + n, a + n);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  addGrain(material, { value: 1 }, SKIRT_MOTTLE_SCALE);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "skirt";
  return mesh;
}
