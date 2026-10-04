import * as THREE from "three";
import { routeCurve, type HeightAt } from "./roverDrive";

const PATH = new THREE.MeshBasicMaterial({ color: "#ff9f1c" });
const PATH_STEP_M = 1.5;
const PATH_MAX_STEPS = 1500;

// The planned route as a tube that follows the ground. Long routes get a thick tube so they
// show from far away; short hops get a thin one that does not bury the ground they cross.
export function createPathMesh(points: [number, number, number][], heightAt: HeightAt): THREE.Mesh {
  const flat = routeCurve(points);
  const total = flat.getLength();
  const radius = Math.min(0.8, Math.max(0.08, total / 400));
  const steps = Math.min(PATH_MAX_STEPS, Math.max(2, Math.ceil(total / PATH_STEP_M)));
  const onGround: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = flat.getPointAt(i / steps);
    onGround.push(p.setZ((heightAt(p.x, p.y) ?? 0) + radius + 0.15));
  }
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(onGround), steps, radius, 6, false);
  const mesh = new THREE.Mesh(geometry, PATH);
  mesh.name = "rover-path";
  return mesh;
}
