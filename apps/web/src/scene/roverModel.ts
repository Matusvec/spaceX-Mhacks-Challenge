import * as THREE from "three";

// A Perseverance-sized rover built from primitives: +X forward, +Y left, z = 0 on the ground.
// Sizes follow NASA's published figures (about 3 m long, 2.7 m wide, 2.2 m tall, 52.5 cm wheels);
// the shapes are a sketch of the real vehicle, not a model of it.
export const WHEEL_RADIUS_M = 0.2625;
export const TRACK_HALF_M = 1.17;
export const WHEELBASE_M = 2.2;
const WHEEL_WIDTH_M = 0.34;
const AXLES_X_M = [1.12, 0.02, -1.08]; // front, middle, rear
// Where the suspension hangs from the body, in the chassis frame.
export const ROCKER_PIVOT = new THREE.Vector3(0.1, 0.8, 0.85);

const BODY = new THREE.MeshStandardMaterial({ color: "#ecebe6", roughness: 0.6, metalness: 0.2 });
const DARK = new THREE.MeshStandardMaterial({ color: "#26272b", roughness: 0.85 });
const METAL = new THREE.MeshStandardMaterial({ color: "#9a9ca3", roughness: 0.45, metalness: 0.7 });
const TYRE = new THREE.MeshStandardMaterial({ color: "#4a4b50", roughness: 0.7, metalness: 0.5 });
const BEACON = new THREE.MeshBasicMaterial({ color: "#ff9f1c", transparent: true, opacity: 0.85 });

export type RoverWheel = {
  x: number;
  y: number;
  steers: boolean;
  mount: THREE.Group; // placed on the ground each frame; turns about z to steer
  spin: THREE.Group; // turns about the axle as the wheel rolls
};

export type RoverModel = {
  group: THREE.Group;
  chassis: THREE.Group; // body, mast, arm: rides on the average of the wheels and tilts with them
  wheels: RoverWheel[]; // left front, middle, rear, then right front, middle, rear
  links: THREE.Mesh[][]; // per side: pivot-front wheel, pivot-bogie, bogie-middle wheel, bogie-rear wheel
  beacon: THREE.Mesh; // ground ring so the rover can be found from far away
};

function part(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
}

function createWheel(x: number, y: number, steers: boolean): RoverWheel {
  const mount = new THREE.Group();
  const spin = new THREE.Group();
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, WHEEL_WIDTH_M, 24), TYRE));
  // Spokes that stand a little proud of the tyre, so the rolling is visible.
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_RADIUS_M * 1.8, WHEEL_WIDTH_M + 0.03, 0.045), METAL);
    spoke.rotation.y = (i * Math.PI) / 3;
    spin.add(spoke);
  }
  mount.add(spin);
  mount.position.set(x, y, WHEEL_RADIUS_M);
  return { x, y, steers, mount, spin };
}

function createChassis(): THREE.Group {
  const chassis = new THREE.Group();
  const alongZ = (g: THREE.BufferGeometry) => g.rotateX(Math.PI / 2);
  const alongX = (g: THREE.BufferGeometry) => g.rotateZ(Math.PI / 2);

  chassis.add(part(new THREE.BoxGeometry(2.0, 1.5, 0.5), BODY, 0, 0, 0.95));
  chassis.add(part(new THREE.BoxGeometry(0.9, 0.8, 0.04), DARK, -0.35, 0.2, 1.22)); // instrument panel on the deck
  // Power source at the back, tilted up.
  const rtg = part(alongX(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 16)), METAL, -1.2, 0, 1.12);
  rtg.rotation.y = Math.PI / 6;
  chassis.add(rtg);
  // Camera mast and head with two lenses.
  chassis.add(part(alongZ(new THREE.CylinderGeometry(0.06, 0.06, 0.85, 10)), BODY, 0.8, 0.5, 1.63));
  chassis.add(part(new THREE.BoxGeometry(0.3, 0.5, 0.25), BODY, 0.83, 0.5, 2.1));
  for (const dy of [-0.13, 0.13]) {
    chassis.add(part(alongX(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12)), DARK, 0.99, 0.5 + dy, 2.1));
  }
  // Arm stowed across the front, with its tool turret.
  chassis.add(part(new THREE.BoxGeometry(0.12, 1.0, 0.12), METAL, 1.1, -0.05, 0.9));
  chassis.add(part(new THREE.BoxGeometry(0.32, 0.36, 0.32), DARK, 1.15, 0.55, 0.9));
  // Dish antenna on the deck.
  chassis.add(part(alongZ(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8)), METAL, -0.45, -0.45, 1.37));
  const dish = part(alongZ(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 6)), METAL, -0.45, -0.45, 1.54);
  dish.rotation.y = -0.35;
  chassis.add(dish);
  for (const side of [1, -1]) {
    const hub = new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12);
    chassis.add(part(hub, METAL, ROCKER_PIVOT.x, side * ROCKER_PIVOT.y, ROCKER_PIVOT.z));
  }
  return chassis;
}

export function createRoverModel(): RoverModel {
  const group = new THREE.Group();
  group.name = "rover";
  const chassis = createChassis();
  const wheels = [1, -1].flatMap((side) => AXLES_X_M.map((x, i) => createWheel(x, side * TRACK_HALF_M, i !== 1)));
  const links = [0, 1].map(() =>
    [0, 1, 2, 3].map(() => new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 8), METAL)),
  );
  const beacon = new THREE.Mesh(new THREE.RingGeometry(5, 6.5, 48), BEACON);
  beacon.position.z = 0.4;
  group.add(chassis, beacon, ...wheels.map((w) => w.mount), ...links.flat());
  return { group, chassis, wheels, links, beacon };
}
