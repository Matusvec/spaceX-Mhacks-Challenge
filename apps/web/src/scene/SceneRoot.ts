import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, type SplatMesh } from "@sparkjsdev/spark";
import { sampleHeight } from "./heightfield";
import type { LoadedBundle } from "./loadBundle";
import { pickSitePoint } from "./picking";
import { createPinMarkers } from "./pins";
import { loadSplatMesh, type SplatSource } from "./splat";
import { createTerrainMesh } from "./terrain";

export type HoverInfo = { x: number; y: number; z: number } | null;

export type SplatInfo = { count: number; sizeM: [number, number, number] };

// Owns the three.js renderer, camera, and the site-frame root that holds the scene.
export class SceneRoot {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly spark: SparkRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.5, 20000);
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  // Everything inside siteRoot uses site coordinates (+Z up). three.js is +Y up,
  // so this is the one place the frame is rotated (contracts.md section 1).
  private readonly siteRoot = new THREE.Group();
  private bundle: LoadedBundle | null = null;
  private terrain: THREE.Mesh | null = null;
  // The splat sits inside a pivot at its center, so preview rotations turn it in place.
  private readonly splatPivot = new THREE.Group();
  private splat: SplatMesh | null = null;
  private splatLoadId = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly onHover: (info: HoverInfo) => void,
  ) {
    // Spark recommends antialias off: it slows splat rendering without improving it.
    // preserveDrawingBuffer lets the concept-render feature capture the canvas later.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.spark = new SparkRenderer({ renderer: this.renderer });
    this.scene.add(this.spark);

    this.scene.background = new THREE.Color("#0b0d12");
    this.siteRoot.rotation.x = -Math.PI / 2;
    this.scene.add(this.siteRoot);

    this.scene.add(new THREE.HemisphereLight("#ffe9d6", "#2a1a12", 1.2));
    const sun = new THREE.DirectionalLight("#ffffff", 2);
    sun.position.set(800, 600, 300);
    this.scene.add(sun);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  setBundle(bundle: LoadedBundle): void {
    this.clearSplat();
    this.clearSiteRoot();
    this.bundle = bundle;
    this.terrain = createTerrainMesh(bundle.heightfield, bundle.textureUrl);
    this.siteRoot.add(this.terrain, createPinMarkers(bundle.pins), this.splatPivot);
    this.frameCamera(bundle.heightfield.sizeM);
  }

  // Replaces the current splat. Resolves to null if another load or clear started meanwhile.
  async showSplat(source: SplatSource, onProgress: (fraction: number | null) => void): Promise<SplatInfo | null> {
    const loadId = ++this.splatLoadId;
    this.removeSplat();
    const mesh = await loadSplatMesh(source, onProgress);
    if (loadId !== this.splatLoadId) {
      mesh.dispose();
      return null;
    }

    const center = mesh.getBoundingBox().getCenter(new THREE.Vector3());
    this.splatPivot.rotation.set(0, 0, 0);
    this.splatPivot.position.copy(center);
    mesh.position.copy(center).negate();
    this.splatPivot.add(mesh);
    this.splat = mesh;

    const size = mesh.getBoundingBox().getSize(new THREE.Vector3());
    return { count: mesh.numSplats, sizeM: [size.x, size.y, size.z] };
  }

  clearSplat(): void {
    this.splatLoadId++;
    this.removeSplat();
  }

  // Raw training exports are often not +Z up yet; each call turns the splat 90 degrees about X.
  rotateSplat90(): void {
    this.splatPivot.rotation.x = (this.splatPivot.rotation.x + Math.PI / 2) % (2 * Math.PI);
  }

  frameSplat(): void {
    if (!this.splat) return;
    this.scene.updateMatrixWorld(true);
    const box = this.splat.getBoundingBox().applyMatrix4(this.splat.matrixWorld);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    const distance = radius * 2.5;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.near = Math.min(0.5, distance / 100);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.update();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerleave", this.handlePointerLeave);
    this.controls.dispose();
    this.clearSplat();
    this.clearSiteRoot();
    this.spark.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // Looks at the site origin from the south, so north is up the screen and east is right.
  private frameCamera([width, depth]: [number, number]): void {
    const span = Math.max(width, depth);
    this.camera.near = 0.5;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, span * 0.45, span * 0.7);
    this.controls.target.set(0, 0, 0);
    this.controls.maxDistance = span * 3;
    this.controls.update();
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  private removeSplat(): void {
    if (!this.splat) return;
    this.splatPivot.remove(this.splat);
    this.splat.dispose();
    this.splat = null;
  }

  private clearSiteRoot(): void {
    this.siteRoot.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          (material as THREE.MeshStandardMaterial).map?.dispose();
          material.dispose();
        }
      }
    });
    this.siteRoot.clear();
    this.terrain = null;
    this.bundle = null;
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.terrain || !this.bundle) return;
    const point = pickSitePoint(event, this.renderer.domElement, this.camera, this.terrain, this.siteRoot);
    if (!point) return this.onHover(null);
    const z = sampleHeight(this.bundle.heightfield, point.x, point.y) ?? point.z;
    this.onHover({ x: point.x, y: point.y, z });
  };

  private readonly handlePointerLeave = () => this.onHover(null);
}
