// CPU reference implementation (SPEC §5 Step A). Plain JS + typed arrays, no DOM, so it also
// runs headless in Node (tools/headless.mjs).
//
// One tick:
//   1. agents: sense → rotate → move → deposit   (rules2d.js / rules3d.js)
//   2. food sources add attractant to the trail
//   3. trail = mean3x3[x3](trail) * (1 - decay)

import { mulberry32 } from './rng.js';
import { TrailGrid } from './trail.js';
import { stepAgents2D } from './rules2d.js';
import { stepAgents3D } from './rules3d.js';

export class Simulation {
  constructor(params) {
    this.params = params; // shared, live object — GUI edits it directly
    this.sources = [];    // food sources, kept across resets
    this.reset();
  }

  get is2D() {
    return this.params.mode === '2d';
  }

  reset() {
    const p = this.params;
    const nx = p.gridX | 0, ny = p.gridY | 0, nz = this.is2D ? 1 : p.gridZ | 0;
    this.trail = new TrailGrid(nx, ny, nz);
    this.rand = mulberry32(p.seed);
    this.foodRand = mulberry32((p.seed ^ 0x9e3779b9) >>> 0); // separate stream for scattering food
    this.tick = 0;

    // With one-agent-per-cell, the population cannot exceed the cell count.
    const maxAgents = p.collision ? Math.floor(this.trail.size * 0.9) : Infinity;
    const n = (this.agentCount = Math.max(1, Math.min(p.agentCount | 0, maxAgents)));

    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.heading = new Float32Array(n);        // 2D: angle
    this.hx = new Float32Array(n);             // 3D: unit vector
    this.hy = new Float32Array(n);
    this.hz = new Float32Array(n);
    this.phase = new Float32Array(n);          // 3D: per-agent roll of the sensor cone
    this.order = new Uint32Array(n).map((_, i) => i);
    this.occupancy = p.collision ? new Uint8Array(this.trail.size) : null;

    for (let i = 0; i < n; i++) this.spawnAgent(i);
  }

  // Place agent i at a random position (uniform, or around a food source) with a random heading.
  spawnAgent(i) {
    const p = this.params, t = this.trail, r = this.rand;
    const aroundFood = p.spawnAt === 'food' && this.sources.length > 0;
    // Around food first; if the balls around the food are full (collision on), the remaining
    // agents fall back to uniform placement instead of failing.
    for (let attempt = 0; attempt < 2000; attempt++) {
      let x, y, z;
      if (aroundFood && attempt < 1000) {
        const s = this.sources[Math.floor(r() * this.sources.length)];
        const [dx, dy, dz] = this.randomInBall(p.spawnRadius);
        x = s.x + dx; y = s.y + dy; z = this.is2D ? 0.5 : s.z + dz;
      } else {
        x = r() * t.nx; y = r() * t.ny; z = this.is2D ? 0.5 : r() * t.nz;
      }
      const cell = t.cellOf(x, y, z, false);
      if (cell < 0) continue;
      if (this.occupancy) {
        if (this.occupancy[cell]) continue;
        this.occupancy[cell] = 1;
      }
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.heading[i] = r() * 2 * Math.PI;
      this.randomizeHeading3D(i);
      this.phase[i] = r() * 2 * Math.PI;
      return;
    }
    throw new Error('Could not place agent — grid too full?');
  }

  randomInBall(radius) {
    const r = this.rand;
    for (;;) {
      const x = 2 * r() - 1, y = 2 * r() - 1, z = this.is2D ? 0 : 2 * r() - 1;
      if (x * x + y * y + z * z <= 1) return [x * radius, y * radius, z * radius];
    }
  }

  // Uniform random unit vector (used at spawn and after a failed move in 3D).
  randomizeHeading3D(i) {
    const z = 2 * this.rand() - 1;
    const a = 2 * Math.PI * this.rand();
    const s = Math.sqrt(1 - z * z);
    this.hx[i] = s * Math.cos(a); this.hy[i] = s * Math.sin(a); this.hz[i] = z;
  }

  step() {
    if (this.is2D) stepAgents2D(this);
    else stepAgents3D(this);
    this.applySources();
    this.trail.diffuseDecay(this.params.decay, this.params.boundary === 'wrap');
    this.tick++;
  }

  // ---- Food sources ------------------------------------------------------------------------
  // Kept behind addSource(pos, strength, type) so a body sensor can drive them later (SPEC §4).
  // `type` reserves 'attract' | 'repel' | 'orient'; only 'attract' is implemented in v0.

  addSource(pos, strength = this.params.foodStrength, type = 'attract') {
    const s = { x: pos.x, y: pos.y, z: this.is2D ? 0.5 : pos.z, strength, type };
    this.sources.push(s);
    return s;
  }

  removeSourceNear(pos, radius) {
    let best = -1, bestD = radius * radius;
    this.sources.forEach((s, k) => {
      const d = (s.x - pos.x) ** 2 + (s.y - pos.y) ** 2 + (this.is2D ? 0 : (s.z - pos.z) ** 2);
      if (d <= bestD) { bestD = d; best = k; }
    });
    if (best >= 0) this.sources.splice(best, 1);
    return best >= 0;
  }

  clearSources() {
    this.sources.length = 0;
  }

  scatterSources(count) {
    const t = this.trail, m = 0.1; // keep 10% away from the walls
    for (let k = 0; k < count; k++) {
      const f = this.foodRand;
      this.addSource({
        x: t.nx * (m + (1 - 2 * m) * f()),
        y: t.ny * (m + (1 - 2 * m) * f()),
        z: t.nz * (m + (1 - 2 * m) * f()),
      });
    }
  }

  // Each tick, every attract source adds `strength` to every cell within `foodRadius`.
  applySources() {
    const t = this.trail, R = Math.max(0, this.params.foodRadius), wrap = this.params.boundary === 'wrap';
    const Rc = Math.ceil(R);
    for (const s of this.sources) {
      if (s.type !== 'attract') continue;
      const cx = Math.floor(s.x), cy = Math.floor(s.y), cz = Math.floor(s.z);
      const zr = this.is2D ? 0 : Rc;
      for (let dz = -zr; dz <= zr; dz++)
        for (let dy = -Rc; dy <= Rc; dy++)
          for (let dx = -Rc; dx <= Rc; dx++) {
            if (dx * dx + dy * dy + dz * dz > R * R) continue;
            const i = t.cellOf(cx + dx + 0.5, cy + dy + 0.5, cz + dz + 0.5, wrap);
            if (i >= 0) t.data[i] += s.strength;
          }
    }
  }
}
