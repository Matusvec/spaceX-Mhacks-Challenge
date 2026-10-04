import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RoverModel } from "./roverModel";

// free: orbit with the mouse and fly with the keyboard. follow: the camera rides along with the
// rover and can still orbit it. rover: the view from the rover's own mast camera.
export type CameraMode = "free" | "follow" | "rover";

const MOVES: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1], ArrowUp: [0, 0, 1], KeyS: [0, 0, -1], ArrowDown: [0, 0, -1],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0], KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyE: [0, 1, 0], KeyQ: [0, -1, 0],
};
const UP = new THREE.Vector3(0, 1, 0);
const EYE_CLEARANCE_M = 0.4;
const CHASE_BACK_M = 7;
const CHASE_UP_M = 3.2;
// Just in front of the mast head (roverModel.ts), so the head itself is not in the picture.
const MAST_EYE = new THREE.Vector3(1.05, 0.5, 2.1);

export class CameraRig {
  private mode: CameraMode = "free";
  private readonly held = new Set<string>();
  private readonly last = new THREE.Vector3();
  private following = false;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls,
    private readonly getRover: () => RoverModel | null,
    // Ground height (world y) under world (x, z), or null off the terrain.
    private readonly groundY: (x: number, z: number) => number | null,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  setMode(mode: CameraMode): void {
    if (this.mode === "rover" && mode !== "rover") {
      // Hand the view back to the orbit controls, looking where the rover camera looked.
      this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(this.a), 8);
    }
    this.mode = mode;
    this.following = false;
    this.controls.enabled = mode !== "rover";
  }

  update(dtS: number): void {
    const rover = this.mode === "free" ? null : this.getRover();
    if (rover && this.mode === "follow") this.follow(rover);
    else if (rover && this.mode === "rover") this.lookFromMast(rover);
    else this.fly(dtS);
    const near = Math.min(0.5, Math.max(0.05, this.camera.position.distanceTo(this.controls.target) / 100));
    if (Math.abs(near - this.camera.near) > 0.1 * this.camera.near) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  // Keys move the camera and its orbit point together, faster the further out the view is.
  private fly(dtS: number): void {
    const move = this.a.set(0, 0, 0);
    for (const code of this.held) {
      const step = MOVES[code];
      if (step) move.add(this.b.set(...step));
    }
    if (move.lengthSq() === 0) return;
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(forward, UP).normalize();
    const direction = right.multiplyScalar(move.x).addScaledVector(UP, move.y).addScaledVector(forward, move.z).normalize();
    const reach = this.camera.position.distanceTo(this.controls.target);
    const speed = Math.min(600, Math.max(1.5, reach * 0.8)) * (this.held.has("ShiftLeft") || this.held.has("ShiftRight") ? 4 : 1);
    const delta = direction.multiplyScalar(speed * dtS);
    const ground = this.groundY(this.camera.position.x + delta.x, this.camera.position.z + delta.z);
    if (ground !== null) delta.y = Math.max(delta.y, ground + EYE_CLEARANCE_M - this.camera.position.y);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
  }

  // Moves the camera by as much as the rover moved, so the user can keep orbiting it.
  private follow(rover: RoverModel): void {
    const at = rover.chassis.getWorldPosition(this.a).addScaledVector(UP, 1);
    if (this.following) {
      this.camera.position.add(this.b.copy(at).sub(this.last));
    } else {
      const back = rover.chassis.getWorldDirection(this.b).set(1, 0, 0).transformDirection(rover.chassis.matrixWorld);
      this.camera.position.copy(at).addScaledVector(back, -CHASE_BACK_M).addScaledVector(UP, CHASE_UP_M);
      this.following = true;
    }
    this.controls.target.copy(at);
    this.last.copy(at);
  }

  private lookFromMast(rover: RoverModel): void {
    rover.chassis.updateWorldMatrix(true, false);
    const eye = rover.chassis.localToWorld(this.a.copy(MAST_EYE));
    const ahead = this.b.set(1, 0, 0).transformDirection(rover.chassis.matrixWorld);
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().addScaledVector(ahead, 10).addScaledVector(UP, -1.5));
    this.controls.target.copy(eye).addScaledVector(ahead, 8);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const el = event.target as HTMLElement | null;
    const typing = el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!(event.code in MOVES) && !event.code.startsWith("Shift")) return;
    this.held.add(event.code);
    if (event.code.startsWith("Arrow")) event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => this.held.delete(event.code);

  private readonly onBlur = () => this.held.clear();
}
