// Habitable domain: the shape the slime mold lives in. Jones 2010 (p.131) specifies the habitable
// environment with an image ("Specific grayscale values may used to denote certain features
// (habitable areas, obstacle boundaries ...)"); this is the 3D equivalent, as a cell mask.
//
// Shapes are defined on normalised coordinates (x, y, z) ∈ [−1, 1], z = up. In 2D the vertical
// axis is y, so the pyramid and the cone both become a triangle, the sphere a disc, the torus a
// ring, the gyroid its z = 0 slice. 'box' = the whole grid (no mask).

const MARGIN = 0.94; // keep shapes one or two cells away from the grid faces

export const SHAPES = {
  box: null,
  sphere: (x, y, z) => x * x + y * y + z * z <= 1,
  pyramid: (x, y, z) => Math.max(Math.abs(x), Math.abs(y)) <= (1 - z) / 2,
  cone: (x, y, z) => Math.hypot(x, y) <= (1 - z) / 2,
  torus: (x, y, z) => (Math.hypot(x, y) - 0.62) ** 2 + z * z <= 0.32 ** 2,
  // Thickened gyroid sheet: a connected labyrinth of channels (a triply periodic minimal surface).
  gyroid: (x, y, z) => {
    const k = 1.5 * Math.PI;
    const g = Math.sin(k * x) * Math.cos(k * y) + Math.sin(k * y) * Math.cos(k * z) + Math.sin(k * z) * Math.cos(k * x);
    return Math.abs(g) < 0.55;
  },
};

// Returns { mask: Uint8Array | null, fraction } for the grid; mask[i] = 1 where habitable.
export function buildDomain(name, nx, ny, nz) {
  const inside = SHAPES[name];
  if (!inside) return { mask: null, fraction: 1 };
  const is2D = nz === 1;
  const mask = new Uint8Array(nx * ny * nz);
  let count = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const u = ((i + 0.5) / nx * 2 - 1) / MARGIN;
        const v = ((j + 0.5) / ny * 2 - 1) / MARGIN;
        const w = is2D ? 0 : ((k + 0.5) / nz * 2 - 1) / MARGIN;
        if (Math.abs(u) > 1 || Math.abs(v) > 1 || Math.abs(w) > 1) continue;
        // 2D: y plays the role of "up" (so the pyramid / cone become a triangle)
        const ok = is2D && (name === 'pyramid' || name === 'cone') ? inside(u, 0, v) : inside(u, v, w);
        if (ok) { mask[i + nx * (j + ny * k)] = 1; count++; }
      }
  return { mask, fraction: count / mask.length };
}

export const DOMAIN_MARGIN = MARGIN;
