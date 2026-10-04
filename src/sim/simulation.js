// CPU reference implementation (SPEC §5 Step A). Plain JS + typed arrays, no DOM, so it also
// runs headless in Node (tools/headless.mjs).
//
// One tick:
//   1. agents: sense → rotate → move → deposit   (rules2d.js / rules3d.js)
//   2. food sources add attractant to the trail   (Jones model only)
//   3. energy, death, division                     (growth model only, growth.js)
//   4. trail = mean3x3[x3](trail) * (1 - decay)
//
// params.model: 'jones' = the source model; 'growth' = our Physarum-like extension (NOTES.md).

import { mulberry32, shuffle } from './rng.js';
import { updateFoodField, lifeCycle } from './growth.js';
import { adaptPopulation } from './adapt.js';
import { TrailGrid } from './trail.js';
import { stepAgents2D, wrapCoord } from './rules2d.js';
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

  get isGrowth() {
    return this.params.model === 'growth';
  }

  reset() {
    const p = this.params;
    const nx = p.gridX | 0, ny = p.gridY | 0, nz = this.is2D ? 1 : p.gridZ | 0;
    this.trail = new TrailGrid(nx, ny, nz);
    this.rand = mulberry32(p.seed);
    this.foodRand = mulberry32((p.seed ^ 0x9e3779b9) >>> 0); // separate stream for scattering food
    this.tick = 0;

    // With one-agent-per-cell, the population cannot exceed the cell count.
    // Growth needs one-agent-per-cell: crowding is what pushes the colony outwards, and without
    // it divided agents pile up in one spot. So collision is always on in the growth model.
    this.collision = p.collision || this.isGrowth;
    const maxAgents = this.collision ? Math.floor(this.trail.size * 0.9) : Infinity;
    const clamp = (v) => Math.max(1, Math.min(v | 0, maxAgents));
    // Jones: fixed population. Growth: start small, arrays sized for the maximum population.
    // Jones + adapt: start at agentCount, may grow up to maxAgents.
    this.capacity = clamp(this.isGrowth ? p.maxAgents : p.adapt ? Math.max(p.agentCount, p.maxAgents) : p.agentCount);
    this.agentCount = this.isGrowth ? Math.min(clamp(p.initialAgents), this.capacity) : clamp(p.agentCount);
    const n = this.capacity;

    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.heading = new Float32Array(n);        // 2D: angle
    this.hx = new Float32Array(n);             // 3D: unit vector
    this.hy = new Float32Array(n);
    this.hz = new Float32Array(n);
    this.phase = new Float32Array(n);          // 3D: per-agent roll of the sensor cone
    this.order = new Uint32Array(n).map((_, i) => i);
    this.occupancy = this.collision ? new Uint8Array(this.trail.size) : null;

    // Growth model state
    this.energy = this.isGrowth ? new Float32Array(n).fill(1) : null;
    // Long-range food smell — used by both models when foodWeight > 0 (growth.js).
    this.foodField = new Float32Array(this.trail.size);
    this.foodMask = new Uint8Array(this.trail.size);
    this.foodKey = null;

    for (let i = 0; i < this.agentCount; i++) this.spawnAgent(i);
  }

  // Place agent i at a random position (uniform, or around a food source) with a random heading.
  spawnAgent(i) {
    const p = this.params, t = this.trail, r = this.rand;
    const aroundFood = p.spawnAt === 'food' && this.sources.length > 0;
    const aroundCenter = p.spawnAt === 'center';
    // Around food first; if the balls around the food are full (collision on), the remaining
    // agents fall back to uniform placement instead of failing.
    for (let attempt = 0; attempt < 2000; attempt++) {
      let x, y, z;
      if (aroundFood && attempt < 1000) {
        const s = this.sources[Math.floor(r() * this.sources.length)];
        const [dx, dy, dz] = this.randomInBall(p.spawnRadius);
        x = s.x + dx; y = s.y + dy; z = this.is2D ? 0.5 : s.z + dz;
      } else if (aroundCenter && attempt < 1000) {
        const [dx, dy, dz] = this.randomInBall(p.spawnRadius);
        x = t.nx / 2 + dx; y = t.ny / 2 + dy; z = this.is2D ? 0.5 : t.nz / 2 + dz;
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
    if (this.params.foodWeight > 0) updateFoodField(this);
    if (this.is2D) stepAgents2D(this);
    else stepAgents3D(this);
    if (this.isGrowth) lifeCycle(this);
    else this.applySources(); // growth model: food attracts through foodField instead
    if (!this.isGrowth) adaptPopulation(this); // no-op unless params.adapt
    this.trail.diffuseDecay(this.params.decay, this.params.boundary, this.params.diffuse);
    this.tick++;
  }

  // What a sensor reads at a point: trail + fw · foodField (just the trail if foodWeight = 0 —
  // pure Jones, where food only stamps attractant into the trail),
  // where fw is the agent's food weight (see makeFoodWeight).
  makeSampler() {
    const t = this.trail, wrap = this.params.boundary === 'wrap', food = this.foodField;
    // wallRepel (not in Jones): a sensor outside the domain reads −∞ instead of 0, so agents turn
    // away from walls one sensor offset before reaching them.
    const outside = this.params.wallRepel ? -Infinity : 0;
    const useFood = this.params.foodWeight !== 0 && this.sources.length > 0;
    if (!useFood && outside === 0) return (x, y, z) => t.sample(x, y, z, wrap);
    return (x, y, z, fw) => {
      const i = t.cellOf(x, y, z, wrap);
      return i < 0 ? outside : useFood ? t.data[i] + fw * food[i] : t.data[i];
    };
  }

  // How strongly agent i is drawn to the food smell. With hungerSensing, a full agent (energy 1)
  // ignores food and a starving one (energy 0) feels it at full foodWeight.
  makeFoodWeight() {
    const w = this.params.foodWeight, E = this.energy;
    if (!this.isGrowth || !this.params.hungerSensing) return () => w;
    return (i) => w * (1 - E[i]);
  }

  // How much agent i deposits on a successful move. Growth: more energy → stronger trail.
  makeDepositor() {
    const d = this.params.deposit, boost = this.params.fedDepositBoost, E = this.energy;
    if (!this.isGrowth || boost === 0) return () => d;
    return (i) => d * (1 + boost * E[i]);
  }

  // Random processing order over the current population (collision mode).
  shuffledOrder() {
    const n = this.agentCount;
    if (this.isGrowth || this.params.adapt) for (let k = 0; k < n; k++) this.order[k] = k; // population changes
    shuffle(this.order, this.rand, n);
    return this.order;
  }

  // ---- Population changes (growth model) ---------------------------------------------------

  copyAgent(from, to) {
    for (const a of [this.px, this.py, this.pz, this.heading, this.hx, this.hy, this.hz, this.phase, this.energy]) {
      if (a) a[to] = a[from];
    }
  }

  // Move agent i to a uniformly random free cell with a random heading (wallResponse 'respawn').
  respawnAgent(i) {
    const t = this.trail, r = this.rand;
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = r() * t.nx, y = r() * t.ny, z = this.is2D ? 0.5 : r() * t.nz;
      const c = t.cellOf(x, y, z, false);
      if (this.occupancy && this.occupancy[c]) continue;
      if (this.occupancy) {
        this.occupancy[t.cellOf(this.px[i], this.py[i], this.pz[i], false)] = 0;
        this.occupancy[c] = 1;
      }
      this.px[i] = x; this.py[i] = y; this.pz[i] = z;
      this.heading[i] = r() * 2 * Math.PI;
      this.randomizeHeading3D(i);
      return;
    }
  }

  // Remove agent i by moving the last agent into its slot.
  removeAgent(i) {
    if (this.occupancy) {
      const c = this.trail.cellOf(this.px[i], this.py[i], this.pz[i], this.params.boundary === 'wrap');
      if (c >= 0) this.occupancy[c] = 0;
    }
    const last = this.agentCount - 1;
    if (i !== last) this.copyAgent(last, i);
    this.agentCount--;
  }

  // Put a child of agent `parent` into slot j, one cell away in a random direction.
  // Returns false if no free in-bounds neighbour cell was found (collision on).
  placeChild(parent, j) {
    const t = this.trail, r = this.rand, wrap = this.params.boundary === 'wrap';
    for (let attempt = 0; attempt < 8; attempt++) {
      let dx = Math.floor(r() * 3) - 1, dy = Math.floor(r() * 3) - 1;
      let dz = this.is2D ? 0 : Math.floor(r() * 3) - 1;
      if (dx === 0 && dy === 0 && dz === 0) continue;
      let x = this.px[parent] + dx, y = this.py[parent] + dy, z = this.pz[parent] + dz;
      if (wrap) { x = wrapCoord(x, t.nx); y = wrapCoord(y, t.ny); if (!this.is2D) z = wrapCoord(z, t.nz); }
      const c = t.cellOf(x, y, z, wrap);
      if (c < 0 || (this.occupancy && this.occupancy[c])) continue;
      if (this.occupancy) this.occupancy[c] = 1;
      this.copyAgent(parent, j);
      this.px[j] = x; this.py[j] = y; this.pz[j] = z;
      this.heading[j] = r() * 2 * Math.PI; // child heads off in a random direction
      this.randomizeHeading3D(j);
      return true;
    }
    return false;
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
