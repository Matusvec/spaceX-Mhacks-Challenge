import { dyno, type SplatMesh } from "@sparkjsdev/spark";

// Cosmetic: fades the splat's opacity to nothing over the outer `featherM` of a circular crop, so
// it blends into the terrain instead of ending in a hard rim. `x`, `y` are the crop center in the
// splat's own (site) coordinates. Runs in Spark's shader graph after any per-splat recoloring, so
// layer colors and search highlights fade the same way. Null restores the hard edge.
export function setSplatFeather(mesh: SplatMesh, disc: { x: number; y: number; radiusM: number; featherM: number } | null): void {
  mesh.objectModifier = disc
    ? dyno.dynoBlock({ gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat }, ({ gsplat }) => ({
        gsplat: new dyno.Dyno({
          inTypes: { gsplat: dyno.Gsplat },
          outTypes: { gsplat: dyno.Gsplat },
          statements: ({ inputs, outputs }) =>
            dyno.unindentLines(`
              ${outputs.gsplat} = ${inputs.gsplat};
              float featherR = distance(${inputs.gsplat}.center.xy, vec2(${disc.x.toFixed(4)}, ${disc.y.toFixed(4)}));
              ${outputs.gsplat}.rgba.a *= 1.0 - smoothstep(${(disc.radiusM - disc.featherM).toFixed(4)}, ${disc.radiusM.toFixed(4)}, featherR);
            `),
        }).apply({ gsplat }).gsplat,
      }))
    : undefined;
  mesh.updateGenerator();
}
