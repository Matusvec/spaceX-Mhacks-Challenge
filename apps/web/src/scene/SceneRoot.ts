import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, type SplatMesh } from "@sparkjsdev/spark";
import type { ModuleType } from "../contracts";
import { createModuleMesh } from "../modules/library";
import type { CandidateSite, SuitabilityGrid } from "../modules/siteSearch";
import { createSiteMarkers, createSuitabilityOverlay } from "./basecampOverlay";
import { sampleHeight } from "./heightfield";
import type { LoadedBundle } from "./loadBundle";
import { pickSitePoint } from "./picking";
import { createPinMarkers } from "./pins";
import { loadSplatMesh, type SplatSource } from "./splat";
import { createTerrainMesh } from "./terrain";

export type HoverInfo = { x: number; y: number; z: number } | null;

export type SplatInfo = { count: number; sizeM: [number, number, number] };

export type ModuleView = { type: ModuleType; x: number; y: number; z: number; rotationZDeg: number };

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        (material as THREE.MeshBasicMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
}

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
  private readonly basecampRoot = new THREE.Group();
  private suitability: THREE.Mesh | null = null;
  private siteMarkers: THREE.Group | null = null;
  private moduleMesh: THREE.Group | null = null;
  private placeHandler: ((x: number, y: number) => void) | null = null;
  private placing = false;

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

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
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
    this.siteRoot.add(this.terrain, createPinMarkers(bundle.pins), this.splatPivot, this.basecampRoot);
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
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.1);
    this.lookAtWorld(box.getCenter(new THREE.Vector3()), radius * 2.5);
  }

  setSuitability(grid: SuitabilityGrid | null): void {
    if (this.suitability) {
      this.basecampRoot.remove(this.suitability);
      (this.suitability.material as THREE.MeshBasicMaterial).map?.dispose();
      (this.suitability.material as THREE.Material).dispose();
      this.suitability = null;
    }
    if (grid && this.terrain) {
      this.suitability = createSuitabilityOverlay(this.terrain.geometry, grid);
      this.basecampRoot.add(this.suitability);
    }
  }

  setSiteMarkers(sites: CandidateSite[]): void {
    if (this.siteMarkers) {
      this.basecampRoot.remove(this.siteMarkers);
      disposeObject(this.siteMarkers);
      this.siteMarkers = null;
    }
    const field = this.bundle?.heightfield;
    if (!field || sites.length === 0) return;
    this.siteMarkers = createSiteMarkers(sites.map((s) => ({ ...s, z: sampleHeight(field, s.x, s.y) ?? 0 })));
    this.basecampRoot.add(this.siteMarkers);
  }

  setModule(module: ModuleView | null): void {
    if (this.moduleMesh && (!module || this.moduleMesh.userData.type !== module.type)) {
      this.basecampRoot.remove(this.moduleMesh);
      disposeObject(this.moduleMesh);
      this.moduleMesh = null;
    }
    if (!module || !this.bundle) return;
    if (!this.moduleMesh) {
      this.moduleMesh = createModuleMesh(module.type, this.bundle.manifest.body);
      this.moduleMesh.userData.type = module.type;
      this.basecampRoot.add(this.moduleMesh);
    }
    this.moduleMesh.position.set(module.x, module.y, module.z);
    this.moduleMesh.rotation.z = (module.rotationZDeg * Math.PI) / 180;
  }

  // While a handler is set, clicking or dragging on the terrain places instead of orbiting.
  setPlaceHandler(handler: ((x: number, y: number) => void) | null): void {
    this.placeHandler = handler;
    this.placing = false;
    this.controls.enabled = !handler;
    this.renderer.domElement.style.cursor = handler ? "crosshair" : "";
  }

  flyToSite(x: number, y: number, z: number, distanceM: number): void {
    this.scene.updateMatrixWorld(true);
    this.lookAtWorld(this.siteRoot.localToWorld(new THREE.Vector3(x, y, z)), distanceM);
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointercancel", this.handlePointerUp);
    canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.controls.dispose();
    this.clearSplat();
    this.clearSiteRoot();
    this.spark.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // Keeps the current viewing direction and moves the camera to look at `target` from `distance`.
  private lookAtWorld(target: THREE.Vector3, distance: number): void {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camera.near = Math.min(0.5, distance / 100);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.update();
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
    disposeObject(this.siteRoot);
    this.basecampRoot.clear();
    this.siteRoot.clear();
    this.suitability = null;
    this.siteMarkers = null;
    this.moduleMesh = null;
    this.terrain = null;
    this.bundle = null;
  }

  private pickTerrain(event: PointerEvent): THREE.Vector3 | null {
    if (!this.terrain) return null;
    return pickSitePoint(event, this.renderer.domElement, this.camera, this.terrain, this.siteRoot);
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (!this.placeHandler || event.button !== 0) return;
    const point = this.pickTerrain(event);
    if (!point) return;
    this.placing = true;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.placeHandler(point.x, point.y);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.bundle) return;
    const point = this.pickTerrain(event);
    if (!point) return this.onHover(null);
    if (this.placing && this.placeHandler) this.placeHandler(point.x, point.y);
    const z = sampleHeight(this.bundle.heightfield, point.x, point.y) ?? point.z;
    this.onHover({ x: point.x, y: point.y, z });
  };

  private readonly handlePointerUp = () => {
    this.placing = false;
  };

  private readonly handlePointerLeave = () => this.onHover(null);
}
