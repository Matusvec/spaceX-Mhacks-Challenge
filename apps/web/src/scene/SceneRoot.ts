import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RgbaArray, SparkRenderer, type SplatMesh } from "@sparkjsdev/spark";
import type { ModuleType } from "../contracts";
import { createModuleMesh } from "../modules/library";
import type { CandidateSite, SuitabilityGrid } from "../modules/siteSearch";
import { createOverlayMesh, createSiteMarkers, createSuitabilityOverlay } from "./basecampOverlay";
import { sampleHeight } from "./heightfield";
import type { LoadedBundle } from "./loadBundle";
import { pickSitePoint } from "./picking";
import { CameraRig, type CameraMode } from "./cameraRig";
import { applyPose, readPose, type CameraPose } from "./cameraPose";
import { scaleMarkers } from "./markerScale";
import { createPinMarkers } from "./pins";
import { SceneLook } from "./presentation";
import { createPathMesh } from "./rover";
import { poseRover, RoverDrive, type HeightAt } from "./roverDrive";
import { createRoverModel, type RoverModel } from "./roverModel";
import { loadSplatMesh, type SplatSource } from "./splat";
import { sampleSurface } from "./splatSurface";
import { setSplatFeather } from "./splatFeather";
import { createTerrainMesh, sinkTerrainUnder } from "./terrain";

export type HoverInfo = { x: number; y: number; z: number } | null;

export type SplatInfo = { count: number; sizeM: [number, number, number] };

export type ModuleView = { type: ModuleType; x: number; y: number; z: number; rotationZDeg: number };

type PathPoint = [number, number, number];


// Demo playback speed for drives (real rovers are far slower); the UI says it is sped up.
// The rover's ground ring is a far-away marker; closer than this it only hides the ground.
const BEACON_MIN_DISTANCE_M = 150;
const GRADE_FULL_ABOVE_M = 300;
const GRADE_GONE_BELOW_M = 80;

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
  private splatFromBundle = false;
  private splatLoadId = 0;
  // Cosmetic sky, haze, ground beyond the data and grain (presentation.ts); off shows the raw data only.
  private readonly look = new SceneLook(this.scene);
  private presentation = true;
  private overlayShown = false;
  private capturedPose: CameraPose | null = null;
  private heldPose: CameraPose | null = null;
  private heldRestore: { fov: number; enabled: boolean } | null = null;
  private readonly basecampRoot = new THREE.Group();
  private suitability: THREE.Mesh | null = null;
  private rasterOverlay: THREE.Mesh | null = null;
  private siteMarkers: THREE.Group | null = null;
  private moduleMesh: THREE.Group | null = null;
  private placeHandler: ((x: number, y: number) => void) | null = null;
  private placing = false;
  private rover: RoverModel | null = null;
  private driveHandler: ((x: number, y: number) => void) | null = null;
  private lastFrameMs = 0;
  private readonly rig: CameraRig;
  private pathMesh: THREE.Mesh | null = null;
  private drive: RoverDrive | null = null;

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
    // The site frame is z-up and the world y-up: site (x, y, z) is world (x, z, -y).
    this.rig = new CameraRig(this.camera, this.controls, () => this.rover, (x, z) => this.heightAt(x, -z));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("dblclick", this.handleDoubleClick);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerUp);
    canvas.addEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.setAnimationLoop((timeMs) => {
      const dtMs = Math.min(100, timeMs - this.lastFrameMs);
      this.lastFrameMs = timeMs;
      this.updateDrive(dtMs);
      if (this.heldPose) {
        // Concept view: the camera stays exactly where a concept render was taken from.
        applyPose(this.heldPose, this.camera, this.controls.target, this.siteRoot);
      } else {
        this.rig.update(dtMs / 1000);
        this.controls.update();
      }
      this.fadeSuitability();
      scaleMarkers(this.scene, this.camera);
      if (this.heldPose) this.renderPlain();
      else this.renderer.render(this.scene, this.camera);
    });
  }

  setBundle(bundle: LoadedBundle): void {
    this.clearSplat();
    this.clearSiteRoot();
    this.bundle = bundle;
    this.terrain = createTerrainMesh(bundle.heightfield, bundle.textureUrl, bundle.manifest.body);
    this.siteRoot.add(this.terrain, createPinMarkers(bundle.pins), this.splatPivot, this.basecampRoot);
    this.look.attach(bundle.manifest.body, this.terrain, bundle.textureUrl, this.siteRoot);
    this.overlayShown = false;
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
    this.standRover();
    this.splatFromBundle = source.kind === "bundle";
    if (this.terrain && this.bundle) sinkTerrainUnder(this.terrain, this.bundle.heightfield, mesh.getBoundingBox());
    this.featherSplat();

    const size = mesh.getBoundingBox().getSize(new THREE.Vector3());
    return { count: mesh.numSplats, sizeM: [size.x, size.y, size.z] };
  }

  clearSplat(): void {
    this.splatLoadId++;
    this.removeSplat();
  }

  // Turns the cosmetic fill on or off. Off renders only the data, as before the fill existed.
  setPresentation(on: boolean): void {
    this.presentation = on;
    this.look.setEnabled(on);
    this.featherSplat();
  }

  // Softens the rim of the bundle's own splat, whose crop is a circle of known radius.
  private featherSplat(): void {
    if (!this.splat) return;
    const radiusM = this.splatFromBundle ? this.bundle?.manifest.splat?.crop_radius_m : undefined;
    const center = this.splat.getBoundingBox().getCenter(new THREE.Vector3());
    setSplatFeather(
      this.splat,
      this.presentation && radiusM ? { x: center.x, y: center.y, radiusM, featherM: Math.min(1.5, radiusM / 2) } : null,
    );
  }

  // Recolors the splat per Gaussian, or restores its own colors with null. `colors` holds 4 bytes
  // per Gaussian in file order: r, g, b (sRGB) and a flag, 0 to keep that Gaussian's own color.
  // Uses Spark's per-splat RGBA override, which also replaces opacity, so that is copied across.
  setSplatColors(colors: Uint8Array | null): void {
    const mesh = this.splat;
    if (!mesh) return;
    mesh.splatRgba?.dispose();
    mesh.splatRgba = null;
    if (colors) {
      const rgba = new Uint8Array(colors.length);
      const byte = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255);
      mesh.forEachSplat((index, _center, _scales, _quaternion, opacity, color) => {
        const o = index * 4;
        if (o >= colors.length) return;
        const own = colors[o + 3] === 0;
        rgba[o] = own ? byte(color.r) : colors[o];
        rgba[o + 1] = own ? byte(color.g) : colors[o + 1];
        rgba[o + 2] = own ? byte(color.b) : colors[o + 2];
        rgba[o + 3] = byte(opacity);
      });
      mesh.splatRgba = new RgbaArray({ array: rgba, count: colors.length / 4 });
    }
    mesh.updateGenerator();
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
      this.suitability.visible = !this.rasterOverlay;
      this.basecampRoot.add(this.suitability);
    }
    this.fadeSuitability();
  }

  // The grade map is for the wide view: full above GRADE_FULL_ABOVE_M from the point the camera looks
  // at, gone below GRADE_GONE_BELOW_M, so the terrain and the splat show their own colors up close.
  // Runs every frame; also tells the presentation fill whether any map is drawn on the tile.
  private fadeSuitability(): void {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const shown = THREE.MathUtils.smoothstep(distance, GRADE_GONE_BELOW_M, GRADE_FULL_ABOVE_M);
    if (this.suitability) {
      (this.suitability.material as THREE.MeshBasicMaterial).opacity = this.suitability.userData.opacity * shown;
      this.suitability.visible = shown > 0 && !this.rasterOverlay;
    }
    const overlayShown = this.rasterOverlay !== null || this.suitability?.visible === true;
    if (overlayShown !== this.overlayShown) {
      this.overlayShown = overlayShown;
      this.look.setOverlayShown(overlayShown);
    }
  }

  // Drapes one raster layer on the terrain (null removes it). One map at a time: while a raster
  // is shown the suitability map is hidden, so colors always match a single legend.
  setRasterOverlay(texture: THREE.Texture | null): void {
    if (this.rasterOverlay) {
      this.basecampRoot.remove(this.rasterOverlay);
      (this.rasterOverlay.material as THREE.MeshBasicMaterial).map?.dispose();
      (this.rasterOverlay.material as THREE.Material).dispose();
      this.rasterOverlay = null;
    }
    if (texture && this.terrain) {
      this.rasterOverlay = createOverlayMesh(this.terrain.geometry, texture, "raster", 0.8);
      this.basecampRoot.add(this.rasterOverlay);
    }
    if (this.suitability) this.suitability.visible = !this.rasterOverlay;
    this.fadeSuitability();
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

  // Shows the rover standing on the terrain at a site position (not while a drive is animating it).
  setRover(position: { x: number; y: number } | null): void {
    if (!position) {
      this.drive = null;
      if (this.rover) {
        this.basecampRoot.remove(this.rover.group);
        disposeObject(this.rover.group);
        this.rover = null;
      }
      return;
    }
    if (!this.rover) {
      this.rover = createRoverModel();
      this.basecampRoot.add(this.rover.group);
    }
    if (!this.drive) poseRover(this.rover, this.heightAt, position.x, position.y, this.rover.group.rotation.z);
  }

  setCameraMode(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  // Double-clicking the terrain calls the handler with that site point (not while placing or driving).
  setDriveHandler(handler: ((x: number, y: number) => void) | null): void {
    this.driveHandler = handler;
  }

  setPath(points: PathPoint[] | null): void {
    if (this.pathMesh) {
      this.basecampRoot.remove(this.pathMesh);
      disposeObject(this.pathMesh);
      this.pathMesh = null;
    }
    if (points && points.length >= 2) {
      this.pathMesh = createPathMesh(points, this.heightAt);
      this.basecampRoot.add(this.pathMesh);
    }
  }

  // Animates the rover along `points`, then calls onDone.
  driveRover(points: PathPoint[], onDone: () => void): void {
    if (!this.rover || points.length < 2) return onDone();
    this.drive = new RoverDrive(this.rover, this.heightAt, points, onDone);
  }

  flyToSite(x: number, y: number, z: number, distanceM: number): void {
    this.scene.updateMatrixWorld(true);
    this.lookAtWorld(this.siteRoot.localToWorld(new THREE.Vector3(x, y, z)), distanceM);
  }

  // Capture/debug hook: puts the camera at `eye` looking at `target`, both in site coordinates.
  setViewSite(eye: [number, number, number], target: [number, number, number]): void {
    this.scene.updateMatrixWorld(true);
    const eyeWorld = this.siteRoot.localToWorld(new THREE.Vector3(...eye));
    this.controls.target.copy(this.siteRoot.localToWorld(new THREE.Vector3(...target)));
    this.camera.near = Math.min(0.5, Math.max(0.05, eyeWorld.distanceTo(this.controls.target) / 100));
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(eyeWorld);
    this.controls.update();
  }

  // Multiplayer (src/multiplayer/sharedMarkers.ts): adds an object drawn in site coordinates that outlives
  // bundle changes. Returns the function that removes it.
  addSiteLayer(layer: THREE.Object3D): () => void {
    layer.rotation.x = this.siteRoot.rotation.x;
    this.scene.add(layer);
    return () => void this.scene.remove(layer);
  }

  // Where this user looks from, in site coordinates: shared with the other people in the scene.
  cameraSite(): { position: THREE.Vector3; direction: THREE.Vector3 } {
    const toSite = this.siteRoot.quaternion.clone().invert();
    return {
      position: this.camera.position.clone().applyQuaternion(toSite),
      direction: this.camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(toSite),
    };
  }

  // Concept render: draws the current view without map tints, site markers, the route, pins or any
  // name label, and returns the canvas. Placed modules stay: they show where the base goes.
  // Read it (drawImage / toDataURL) straight away, in the same task: the next frame draws them again.
  captureView(): HTMLCanvasElement {
    this.capturedPose = this.cameraPose();
    this.renderPlain();
    return this.renderer.domElement;
  }

  // The scene as a concept render sees it: no map tints, markers, route, pins or labels.
  private renderPlain(): void {
    const labels: THREE.Object3D[] = [];
    this.scene.traverse((object) => void (object instanceof THREE.Sprite && labels.push(object)));
    const pins = ["pins", "user-pins", "concept-pins"].map((name) => this.scene.getObjectByName(name));
    const hidden = [this.suitability, this.rasterOverlay, this.siteMarkers, this.pathMesh, ...pins, ...labels].filter((o) => o?.visible);
    hidden.forEach((o) => (o!.visible = false));
    this.renderer.render(this.scene, this.camera);
    hidden.forEach((o) => (o!.visible = true));
  }

  cameraPose(): CameraPose {
    return readPose(this.camera, this.camera.position.distanceTo(this.controls.target), this.siteRoot);
  }

  // The camera pose at the last captureView(): where a concept render was taken from.
  lastCapturedPose(): CameraPose | null {
    return this.capturedPose;
  }

  // Concept view: holds the camera at `pose` with all camera input off, and draws the scene the way
  // captureView() does. Null hands the camera back.
  holdPose(pose: CameraPose | null): void {
    if (pose && !this.heldPose) this.heldRestore = { fov: this.camera.fov, enabled: this.controls.enabled };
    this.heldPose = pose;
    this.controls.enabled = pose ? false : (this.heldRestore?.enabled ?? true);
    if (!pose && this.heldRestore) {
      this.camera.fov = this.heldRestore.fov;
      this.camera.updateProjectionMatrix();
      this.heldRestore = null;
    }
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("dblclick", this.handleDoubleClick);
    canvas.removeEventListener("pointermove", this.handlePointerMove);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    canvas.removeEventListener("pointercancel", this.handlePointerUp);
    canvas.removeEventListener("pointerleave", this.handlePointerLeave);
    this.rig.dispose();
    this.controls.dispose();
    this.clearSplat();
    this.clearSiteRoot();
    this.spark.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  private updateDrive(dtMs: number): void {
    if (!this.rover) return;
    if (this.drive?.update(dtMs)) this.drive = null;
    const away = this.rover.group.getWorldPosition(new THREE.Vector3()).distanceTo(this.camera.position);
    this.rover.beacon.visible = away > BEACON_MIN_DISTANCE_M;
  }

  // Re-seats a parked rover after the ground under it changed (the splat appeared or went away).
  private standRover(): void {
    if (!this.rover || this.drive) return;
    const { position, rotation } = this.rover.group;
    poseRover(this.rover, this.heightAt, position.x, position.y, rotation.z);
  }

  // Ground the rover stands on: the splat's own surface where the splat is shown and has data, else the terrain.
  private readonly heightAt: HeightAt = (x, y) => {
    if (!this.bundle) return null;
    const top = this.splat && this.splatFromBundle && this.bundle.splatSurface ? sampleSurface(this.bundle.splatSurface, x, y) : null;
    return top ?? sampleHeight(this.bundle.heightfield, x, y);
  };

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
    this.standRover();
    if (this.terrain && this.bundle) sinkTerrainUnder(this.terrain, this.bundle.heightfield, null);
  }

  private clearSiteRoot(): void {
    disposeObject(this.siteRoot);
    this.basecampRoot.clear();
    this.siteRoot.clear();
    this.suitability = null;
    this.rasterOverlay = null;
    this.siteMarkers = null;
    this.moduleMesh = null;
    this.rover = null;
    this.pathMesh = null;
    this.drive = null;
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

  private readonly handleDoubleClick = (event: MouseEvent) => {
    if (!this.driveHandler || this.placeHandler || this.drive) return;
    const point = this.pickTerrain(event as PointerEvent);
    if (point) this.driveHandler(point.x, point.y);
  };
}
