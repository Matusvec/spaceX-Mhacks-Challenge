import * as THREE from "three";
import type { Body } from "../contracts";
import { MODULE_LABELS } from "../config/scoring";
import { createModuleMesh } from "../modules/library";
import { setMarkerScale } from "../scene/markerScale";
import type { PeerCursor, SharedModule, UserPin } from "./types";

const PIN_HEIGHT_M = 8;
const LABEL_HEIGHT = 0.022; // sprites keep this share of the view height at any distance
// A user pin's stalk keeps about 50 px on screen: 25 cm tall up close, at most 40 m in the wide view.
const PIN_SCALE = { perM: 0.006, min: 0.03, max: 5 };
const LABEL_FONT = "600 28px system-ui, sans-serif";

function dispose(root: THREE.Object3D): void {
  root.traverse((object) => {
    const { geometry, material } = object as THREE.Mesh;
    geometry?.dispose();
    for (const m of material ? (Array.isArray(material) ? material : [material]) : []) {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    }
  });
}

// A text chip that always faces the camera and keeps its size on screen. `shape` adds a diamond or dot before the text.
function label(text: string, color: string, shape: "diamond" | "dot" | "none"): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const draw = canvas.getContext("2d")!;
  draw.font = LABEL_FONT;
  const lead = shape === "none" ? 12 : 48;
  canvas.width = Math.ceil(lead + draw.measureText(text).width + 14);
  canvas.height = 48;
  draw.font = LABEL_FONT;
  draw.fillStyle = "rgba(11, 13, 18, 0.78)";
  draw.beginPath();
  draw.roundRect(0, 0, canvas.width, canvas.height, 10);
  draw.fill();
  draw.fillStyle = color;
  draw.strokeStyle = "#ffffff";
  draw.lineWidth = 3;
  draw.beginPath();
  if (shape === "diamond") {
    draw.moveTo(24, 6);
    draw.lineTo(40, 24);
    draw.lineTo(24, 42);
    draw.lineTo(8, 24);
    draw.closePath();
  } else if (shape === "dot") {
    draw.arc(24, 24, 13, 0, Math.PI * 2);
  }
  if (shape !== "none") {
    draw.fill();
    draw.stroke();
  }
  draw.fillStyle = "#ffffff";
  draw.textBaseline = "middle";
  draw.fillText(text, lead, 25);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // Drawn over the terrain and the splat, so a marker behind a rock is still found.
  const material = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false, depthWrite: false, fog: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((LABEL_HEIGHT * canvas.width) / canvas.height, LABEL_HEIGHT, 1);
  // Anchor on the shape's centre, so the diamond or dot sits exactly on the point.
  sprite.center.set(shape === "none" ? 0.5 : 24 / canvas.width, 0.5);
  sprite.renderOrder = 10;
  return sprite;
}

const short = (text: string, max = 28) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

type CursorMarker = { sprite: THREE.Sprite; key: string };

/**
 * Everything multiplayer draws in the 3D scene, in site coordinates: user pins (numbered diamonds in the
 * author's colour, unlike the cyan science pins), other people's cursors, and the modules they placed.
 */
export class SharedMarkers {
  readonly root = new THREE.Group();
  private readonly pins = new THREE.Group();
  private readonly modules = new THREE.Group();
  private readonly cursors = new Map<string, CursorMarker>();

  constructor() {
    this.root.name = "shared";
    this.pins.name = "user-pins";
    this.root.add(this.pins, this.modules);
  }

  setPins(pins: UserPin[]): void {
    dispose(this.pins);
    this.pins.clear();
    pins.forEach((pin, index) => {
      const { x, y, z } = pin.position;
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, PIN_HEIGHT_M, 6).rotateX(Math.PI / 2).translate(0, 0, PIN_HEIGHT_M / 2),
        new THREE.MeshBasicMaterial({ color: pin.color }),
      );
      stalk.position.set(x, y, z);
      setMarkerScale(stalk, PIN_SCALE);
      const head = label(`${index + 1}  ${short(pin.note)}`, pin.color, "diamond");
      head.position.set(x, y, z + PIN_HEIGHT_M);
      setMarkerScale(head, { ...PIN_SCALE, lift: { baseZ: z, heightM: PIN_HEIGHT_M } });
      this.pins.add(stalk, head);
    });
  }

  setCursors(cursors: PeerCursor[]): void {
    const seen = new Set<string>();
    for (const cursor of cursors) {
      seen.add(cursor.id);
      const key = `${cursor.name}|${cursor.color}`;
      let marker = this.cursors.get(cursor.id);
      if (marker && marker.key !== key) {
        this.removeCursor(cursor.id);
        marker = undefined;
      }
      if (!marker) {
        // ponytail: name dot only. The table also carries their camera (cursor.camera) for a view cone later.
        const sprite = label(cursor.name, cursor.color, "dot");
        this.root.add(sprite);
        marker = { sprite, key };
        this.cursors.set(cursor.id, marker);
      }
      marker.sprite.position.set(cursor.position.x, cursor.position.y, cursor.position.z);
    }
    for (const id of [...this.cursors.keys()]) if (!seen.has(id)) this.removeCursor(id);
  }

  setModules(modules: SharedModule[], body: Body): void {
    dispose(this.modules);
    this.modules.clear();
    for (const module of modules) {
      const { x, y, z } = module.position;
      const mesh = createModuleMesh(module.type, body);
      mesh.position.set(x, y, z);
      mesh.rotation.z = (module.rotationZDeg * Math.PI) / 180;
      const tag = label(`${MODULE_LABELS[module.type]} · ${short(module.authorName, 16)}`, module.color, "none");
      tag.position.set(x, y, new THREE.Box3().setFromObject(mesh).max.z + 1.5);
      this.modules.add(mesh, tag);
    }
  }

  dispose(): void {
    dispose(this.root);
    this.root.clear();
    this.cursors.clear();
  }

  private removeCursor(id: string): void {
    const marker = this.cursors.get(id);
    if (!marker) return;
    dispose(marker.sprite);
    this.root.remove(marker.sprite);
    this.cursors.delete(id);
  }
}
