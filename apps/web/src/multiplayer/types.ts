import type { ModuleType, Pin, PlacedModule, Vec3 } from "../contracts";

export type ConnectionStatus = "connecting" | "live" | "offline";

export type Person = { id: string; name: string; color: string; isSelf: boolean };
export type UserPin = Pin & { authorName: string; color: string; mine: boolean };
export type SharedModule = PlacedModule & { authorName: string; color: string; mine: boolean };

// The terrain point under someone else's mouse, and the camera they look from.
export type PeerCursor = { id: string; name: string; color: string; position: Vec3; camera: Vec3 };

// One rover per scene. (x, y) is where it is parked, or where the active drive started.
export type SharedRover = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  targetLabel: string;
  driving: boolean;
  seq: number;
  mine: boolean;
};

// One line of the team chat (people to people; not the rover assistant).
export type ChatLine = { id: bigint; name: string; color: string; text: string; sentAtMs: number; mine: boolean };

// A concept render someone shared: the picture is a JPEG data URL carried in the row itself.
export type SharedConcept = { id: bigint; renderId: string; authorName: string; mine: boolean; idea: string; prompt: string; poseJson: string; image: string; createdAtMs: number };
export type ConceptDraft = { renderId: string; idea: string; prompt: string; poseJson: string; image: string };

export type Snapshot = { people: Person[]; pins: UserPin[]; modules: SharedModule[]; rover: SharedRover | null; chat: ChatLine[]; concepts: SharedConcept[] };

export type ModuleDraft = { type: ModuleType; position: Vec3; rotationZDeg: number; scoreJson: string };
export type CursorPose = { position: Vec3; camera: Vec3; direction: Vec3 };

// The same calls work live (Spacetime reducers) and offline (in memory).
export type SharedActions = {
  addPin(position: Vec3, note: string): void;
  renamePin(id: bigint, note: string): void;
  removePin(id: bigint): void;
  placeModule(draft: ModuleDraft): void;
  moveModule(id: bigint, draft: ModuleDraft): void;
  deleteModule(id: bigint): void;
  driveRover(from: { x: number; y: number }, to: { x: number; y: number }, label: string): void;
  roverArrived(seq: number): void;
  resetRover(): void;
  setCursor(pose: CursorPose | null): void;
  sendChat(text: string): void;
  shareConcept(draft: ConceptDraft): void;
  removeConcept(id: bigint): void;
};
