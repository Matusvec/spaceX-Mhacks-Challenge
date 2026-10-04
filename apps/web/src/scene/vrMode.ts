import * as THREE from "three";
import { SparkXr, type SparkRenderer, type SplatMesh, type XrGamepads } from "@sparkjsdev/spark";

// VR is off unless the page address has ?vr=1: without it none of this file runs (docs/vr.md).
const params = new URLSearchParams(window.location.search);
export const VR_ENABLED = params.get("vr") === "1";

// Tunable from the URL, so a headset can be tuned without a redeploy:
//   ?vrsplats=250000  Gaussians drawn per frame in VR (Spark's level of detail picks them)
//   ?vrscale=0.75     render resolution as a share of the headset's native resolution
//   ?vrfoveation=1    fixed foveation, 0 (off) to 1 (strongest)
const numberParam = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(params.get(name));
  return params.has(name) && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};
export const VR_SPLATS = numberParam("vrsplats", 250_000, 20_000, 2_000_000);
const VR_SCALE = numberParam("vrscale", 0.75, 0.3, 1.5);
const VR_FOVEATION = numberParam("vrfoveation", 1, 0, 1);

const WALK_M_PER_S = 1.5; // Spark multiplies by 5 while the right trigger is held
const TURN_RAD_PER_S = 1.5;
export const STAND_ASIDE_M = 2.5; // start beside the rover, not inside it
const SETTLE_PER_S = 8; // how quickly the feet follow the ground

type Hooks = {
  // Ground height (world y) under world (x, z), or null off the data.
  groundY: (x: number, z: number) => number | null;
  // Where to stand and what to face on entering, in world coordinates on the ground plane (x, z).
  start: () => { stand: THREE.Vector2; face: THREE.Vector2 | null };
  // The splat currently shown, if any.
  splat: () => SplatMesh | null;
  onChange: () => void;
};

/**
 * Standing on the terrain in a headset, at true scale. Uses Spark's WebXR helper: it starts the session
 * and moves `rig` (the camera's parent) from the thumbsticks; this class keeps the feet on the ground,
 * switches the splat to level of detail while presenting, and shows a small status panel.
 * Left stick walks, right stick turns, right trigger is fast, left trigger/grip fly up/down, A toggles status.
 */
export class VrMode {
  supported = false;
  presenting = false;
  preparing = false;
  private readonly xr: SparkXr;
  private saved: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number; lodCount: number | undefined } | null = null;
  private readonly head = new THREE.Vector3();
  private readonly status = createStatusPanel();
  private statusButtonDown = false;
  private readonly lodFailed = new WeakSet<object>();
  private frames = 0;
  private framesSince = 0;
  private fps = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly spark: SparkRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly rig: THREE.Group,
    private readonly hooks: Hooks,
  ) {
    this.xr = new SparkXr({
      renderer,
      element: document.createElement("button"), // never shown: the app has its own Enter VR button
      mode: "vr",
      referenceSpaceType: "local-floor",
      frameBufferScaleFactor: VR_SCALE,
      fixedFoveation: VR_FOVEATION,
      allowMobileXr: true,
      controllers: {
        moveSpeed: WALK_M_PER_S,
        rotateSpeed: TURN_RAD_PER_S,
        moveDirection: true, // walk where the head looks, level with the ground
        getMove: (pads) => new THREE.Vector3(pads.left?.axes[2] ?? 0, flyInput(pads), pads.left?.axes[3] ?? 0),
      },
      onReady: (supported) => {
        this.supported = supported;
        hooks.onChange();
      },
      onEnterXr: () => this.enter(),
      onExitXr: () => this.exit(),
    });
    // The status panel rides on the left controller.
    for (const index of [0, 1]) {
      const grip = renderer.xr.getControllerGrip(index);
      grip.addEventListener("connected", (event) => {
        if ((event as unknown as { data: XRInputSource }).data.handedness === "left") grip.add(this.status.mesh);
      });
      rig.add(grip);
    }
  }

  // Builds the splat's level-of-detail tree (once per splat, in a worker). Needed before VR can thin it.
  async prepare(): Promise<void> {
    const packed = this.hooks.splat()?.packedSplats;
    if (!packed || packed.lodSplats || this.preparing || this.lodFailed.has(packed)) return;
    this.preparing = true;
    this.hooks.onChange();
    try {
      await packed.createLodSplats({});
      this.applyLod();
    } catch (err) {
      this.lodFailed.add(packed); // VR still works, with every Gaussian drawn
      console.warn("Could not build the splat's level of detail for VR", err);
    } finally {
      this.preparing = false;
      this.hooks.onChange();
    }
  }

  async toggle(): Promise<void> {
    await this.xr.toggleXr();
  }

  // Level of detail is on only while presenting: per-Gaussian layer colors and search highlights need
  // every Gaussian in file order, which the flat view keeps.
  private applyLod(): void {
    const mesh = this.hooks.splat();
    if (mesh) mesh.enableLod = this.presenting && Boolean(mesh.packedSplats?.lodSplats);
    if (mesh) mesh.updateVersion();
  }

  private enter(): void {
    const { stand, face } = this.hooks.start();
    this.saved = {
      position: this.camera.position.clone(),
      quaternion: this.camera.quaternion.clone(),
      fov: this.camera.fov,
      lodCount: this.spark.lodSplatCount,
    };
    this.presenting = true;
    this.spark.lodSplatCount = VR_SPLATS;
    this.applyLod();
    this.rig.position.set(stand.x, this.hooks.groundY(stand.x, stand.y) ?? 0, stand.y);
    // In a local-floor space the person starts looking down -Z: turn the rig so that is toward `face`.
    this.rig.rotation.set(0, face ? Math.atan2(-(face.x - stand.x), -(face.y - stand.y)) : 0, 0);
    this.hooks.onChange();
  }

  private exit(): void {
    this.presenting = false;
    this.applyLod();
    this.rig.position.set(0, 0, 0);
    this.rig.rotation.set(0, 0, 0);
    this.rig.updateMatrixWorld(true);
    if (this.saved) {
      this.spark.lodSplatCount = this.saved.lodCount;
      this.camera.position.copy(this.saved.position);
      this.camera.quaternion.copy(this.saved.quaternion);
      this.camera.fov = this.saved.fov;
      this.camera.updateProjectionMatrix();
      this.saved = null;
    }
    this.hooks.onChange();
  }

  // Call once per frame while presenting, before rendering.
  update(dtS: number): void {
    this.xr.updateControllers(this.camera);
    const pads = gamepads(this.renderer);

    // Feet on the ground under the head; never below it. Holding a fly control lets go of the ground.
    this.camera.getWorldPosition(this.head);
    const ground = this.hooks.groundY(this.head.x, this.head.z);
    if (ground !== null) {
      if (flyInput(pads) !== 0) this.rig.position.y = Math.max(this.rig.position.y, ground);
      else this.rig.position.y += (ground - this.rig.position.y) * Math.min(1, SETTLE_PER_S * dtS);
    }

    const pressed = pads.right?.buttons[4]?.pressed ?? false; // A on the right controller
    if (pressed && !this.statusButtonDown) this.status.mesh.visible = !this.status.mesh.visible;
    this.statusButtonDown = pressed;

    this.frames++;
    this.framesSince += dtS;
    if (this.framesSince >= 0.5) {
      this.fps = this.frames / this.framesSince;
      this.frames = 0;
      this.framesSince = 0;
      if (this.status.mesh.visible) {
        const lod = this.hooks.splat()?.enableLod ? "lod" : "full";
        this.status.draw([`${this.fps.toFixed(0)} fps`, `${this.spark.activeSplats.toLocaleString()} splats (${lod})`, `budget ${VR_SPLATS.toLocaleString()} · scale ${VR_SCALE}`]);
      }
    }
  }
}

// Left trigger rises, left grip sinks (1 to -1).
function flyInput(pads: XrGamepads): number {
  if (pads.leftIsHand) return 0;
  const value = (pads.left?.buttons[0]?.value ?? 0) - (pads.left?.buttons[1]?.value ?? 0);
  return Math.abs(value) > 0.1 ? value : 0;
}

function gamepads(renderer: THREE.WebGLRenderer): XrGamepads {
  const pads: XrGamepads = {};
  for (const source of renderer.xr.getSession()?.inputSources ?? []) {
    if (!source.gamepad || (source.handedness !== "left" && source.handedness !== "right")) continue;
    pads[source.handedness] = source.gamepad;
    if (source.handedness === "left") pads.leftIsHand = Boolean(source.hand);
  }
  return pads;
}

// A small text card (16 x 8 cm) held just above the controller it is attached to.
function createStatusPanel(): { mesh: THREE.Mesh; draw: (lines: string[]) => void } {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ map: texture, transparent: true, fog: false, depthTest: false }));
  mesh.position.set(0, 0.09, -0.05);
  mesh.rotation.x = -0.6;
  mesh.renderOrder = 20;
  const draw = (lines: string[]) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(11, 13, 18, 0.85)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e8e6e3";
    context.font = "500 44px ui-monospace, monospace";
    lines.forEach((line, i) => context.fillText(line, 20, 70 + i * 72, canvas.width - 40));
    texture.needsUpdate = true;
  };
  draw(["starting…"]);
  return { mesh, draw };
}
