// Writes Gaussians in the standard 3D Gaussian Splatting PLY layout (the one gsplat
// and the original 3DGS code export), with spherical harmonics degree 0.
const PROPERTIES = [
  "x", "y", "z", "nx", "ny", "nz",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
];
const SH_C0 = 0.28209479177387814;

// Each gaussian: { position: [x,y,z], color: [r,g,b] in 0..1, alpha in 0..1,
// sigma: [sx,sy,sz] in meters, quaternion: [w,x,y,z] }.
export function encode3dgsPly(gaussians) {
  const header =
    "ply\nformat binary_little_endian 1.0\n" +
    `element vertex ${gaussians.length}\n` +
    PROPERTIES.map((name) => `property float ${name}\n`).join("") +
    "end_header\n";
  const headerBytes = Buffer.from(header, "ascii");
  const body = Buffer.alloc(gaussians.length * PROPERTIES.length * 4);

  let offset = 0;
  const put = (value) => {
    body.writeFloatLE(value, offset);
    offset += 4;
  };
  for (const g of gaussians) {
    g.position.forEach(put);
    [0, 0, 0].forEach(put);
    g.color.forEach((c) => put((c - 0.5) / SH_C0)); // stored as the SH DC coefficient
    put(Math.log(g.alpha / (1 - g.alpha))); // stored before the sigmoid
    g.sigma.forEach((s) => put(Math.log(s))); // stored as log scale
    g.quaternion.forEach(put);
  }
  return Buffer.concat([headerBytes, body]);
}
