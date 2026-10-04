import { SplatMesh } from "@sparkjsdev/spark";

export const SPLAT_EXTENSIONS = [".ply", ".spz", ".splat", ".ksplat"];

export type SplatSource = { kind: "bundle"; url: string; name: string } | { kind: "file"; file: File };

export function isSplatFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SPLAT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function splatSourceName(source: SplatSource): string {
  return source.kind === "bundle" ? source.name : source.file.name;
}

// Loads a splat with Spark. `onProgress` gets a 0..1 fraction, or null if the size is unknown.
export async function loadSplatMesh(
  source: SplatSource,
  onProgress: (fraction: number | null) => void,
): Promise<SplatMesh> {
  const handleProgress = (event: ProgressEvent) =>
    onProgress(event.lengthComputable ? event.loaded / event.total : null);

  const mesh =
    source.kind === "bundle"
      ? new SplatMesh({ url: source.url, onProgress: handleProgress })
      : new SplatMesh({ fileBytes: await source.file.arrayBuffer(), fileName: source.file.name });

  try {
    await mesh.initialized;
  } catch (err) {
    mesh.dispose();
    throw err;
  }
  return mesh;
}
