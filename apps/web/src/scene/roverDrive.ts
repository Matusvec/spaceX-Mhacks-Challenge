import * as THREE from "three";
import { ROCKER_PIVOT, TRACK_HALF_M, WHEELBASE_M, WHEEL_RADIUS_M, type RoverModel } from "./roverModel";

// Ground height at site (x, y), or null where there is no terrain.
export type HeightAt = (x: number, y: number) => number | null;

const TURN_RAD_PER_S = 0.9;
const STEER_RAD_PER_S = 2.5;
// Playback speed: short hops are slow enough to watch the wheels, long routes are sped up.
const MIN_SPEED_M_PER_S = 1.2;
const MAX_SPEED_M_PER_S = 40;
const TARGET_DRIVE_S = 10;
const LINK_AXIS = new THREE.Vector3(0, 1, 0);
const a = new THREE.Vector3();
const b = new THREE.Vector3();

const ease = (t: number) => t * t * (3 - 2 * t);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

// A smooth line through route points; the drive and the drawn path both follow it.
export function routeCurve(points: [number, number, number][]): THREE.CatmullRomCurve3 {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, "centripetal");
  curve.arcLengthDivisions = Math.max(200, points.length * 12);
  return curve;
}

function span(link: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3): void {
  link.position.copy(from).add(to).multiplyScalar(0.5);
  b.copy(to).sub(from);
  link.scale.set(1, b.length(), 1);
  link.quaternion.setFromUnitVectors(LINK_AXIS, b.normalize());
}

// Puts the rover at site (x, y) heading `yaw`: each wheel sits on the ground under it,
// the body rides on their average and tilts with them, and the suspension links follow.
export function poseRover(model: RoverModel, heightAt: HeightAt, x: number, y: number, yaw: number): void {
  const { group, chassis, wheels, links, beacon } = model;
  group.position.set(x, y, 0);
  group.rotation.z = yaw;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const centre = heightAt(x, y) ?? 0;
  const h = wheels.map((w) => {
    const ground = heightAt(x + cos * w.x - sin * w.y, y + sin * w.x + cos * w.y) ?? centre;
    w.mount.position.set(w.x, w.y, ground + WHEEL_RADIUS_M);
    return ground;
  });
  const pitch = Math.atan2((h[0] + h[3] - h[2] - h[5]) / 2, WHEELBASE_M);
  const roll = Math.atan2((h[0] + h[1] + h[2] - h[3] - h[4] - h[5]) / 3, 2 * TRACK_HALF_M);
  chassis.position.set(0, 0, h.reduce((sum, v) => sum + v, 0) / h.length);
  chassis.rotation.set(roll, -pitch, 0);
  chassis.updateMatrix();
  beacon.position.z = centre + 0.4;

  links.forEach((side, s) => {
    const sign = s === 0 ? 1 : -1;
    const [front, middle, rear] = wheels.slice(s * 3, s * 3 + 3).map((w) => w.mount.position.clone().setY(sign * (TRACK_HALF_M - 0.24)));
    const pivot = a.set(ROCKER_PIVOT.x, sign * ROCKER_PIVOT.y, ROCKER_PIVOT.z).applyMatrix4(chassis.matrix).clone();
    const bogie = middle.clone().add(rear).multiplyScalar(0.5).setZ((middle.z + rear.z) / 2 + 0.32);
    span(side[0], pivot, front);
    span(side[1], pivot, bogie);
    span(side[2], bogie, middle);
    span(side[3], bogie, rear);
  });
}

// Drives the rover along a route: it turns on the spot to face the route, then follows it.
// Each wheel steers and rolls according to how the ground moves under that wheel.
export class RoverDrive {
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly total: number;
  private readonly turnFrom: number;
  private readonly turnBy: number;
  private readonly turnMs: number;
  private readonly driveMs: number;
  private elapsedMs = 0;
  private along = 0;
  private x: number;
  private y: number;
  private yaw: number;

  constructor(
    private readonly model: RoverModel,
    private readonly heightAt: HeightAt,
    points: [number, number, number][],
    private readonly onDone: () => void,
  ) {
    this.curve = routeCurve(points);
    this.total = this.curve.getLength();
    [this.x, this.y] = points[0];
    this.yaw = this.turnFrom = model.group.rotation.z;
    const tangent = this.curve.getTangentAt(0);
    this.turnBy = this.total > 0.05 ? wrap(Math.atan2(tangent.y, tangent.x) - this.yaw) : 0;
    this.turnMs = (Math.abs(this.turnBy) / TURN_RAD_PER_S) * 1000;
    const speed = Math.min(MAX_SPEED_M_PER_S, Math.max(MIN_SPEED_M_PER_S, this.total / TARGET_DRIVE_S));
    this.driveMs = Math.max(1500, (this.total / speed) * 1000);
  }

  // Advances by dtMs; returns true once the rover has arrived.
  update(dtMs: number): boolean {
    this.elapsedMs += dtMs;
    let moved = 0;
    let yaw = this.yaw;
    if (this.elapsedMs < this.turnMs) {
      yaw = this.turnFrom + this.turnBy * ease(this.elapsedMs / this.turnMs);
    } else {
      const u = ease(Math.min(1, (this.elapsedMs - this.turnMs) / this.driveMs));
      const point = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u);
      [this.x, this.y] = [point.x, point.y];
      yaw = Math.atan2(tangent.y, tangent.x);
      moved = u * this.total - this.along;
      this.along = u * this.total;
    }
    this.rollWheels(moved, wrap(yaw - this.yaw), dtMs / 1000);
    this.yaw = yaw;
    poseRover(this.model, this.heightAt, this.x, this.y, yaw);
    const done = this.elapsedMs >= this.turnMs + this.driveMs;
    if (done) this.onDone();
    return done;
  }

  // The ground under a wheel at (x, y) moves by (moved - turned * y, turned * x) in the rover's frame.
  private rollWheels(moved: number, turned: number, dtS: number): void {
    for (const wheel of this.model.wheels) {
      const vx = moved - turned * wheel.y;
      const vy = turned * wheel.x;
      let roll = vx;
      if (wheel.steers && Math.hypot(vx, vy) > 1e-5) {
        // Point the wheel along its own motion, flipping it rather than steering past 90 degrees.
        let target = Math.atan2(vy, vx);
        roll = Math.hypot(vx, vy);
        if (Math.abs(target) > Math.PI / 2) {
          target = wrap(target + Math.PI);
          roll = -roll;
        }
        const step = STEER_RAD_PER_S * dtS;
        wheel.mount.rotation.z += Math.min(step, Math.max(-step, target - wheel.mount.rotation.z));
      }
      wheel.spin.rotation.y += roll / WHEEL_RADIUS_M;
    }
  }
}
