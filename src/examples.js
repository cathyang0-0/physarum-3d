// Built-in setups (toolbar → Examples). Each is a set of parameter overrides on top of the mode's
// base parameters (params.js), plus how many random food sources to scatter (seeded, so
// reproducible). The 2D / 3D toggle loads MAIN[mode]. Details and numbers: NOTES.md.

// Overrides that the older 2D setups were tuned with (the 2D base before 2026-10-04).
const OLD_2D_BASE = { gridX: 256, gridY: 256, agentCount: 9830, sensorAngle: 90, sensorOffset: 15 };

export const EXAMPLES = {
  // Jones 2010's dynamic regime (p.135–136): with RA 45 > SA 22.5 the network "never stabilizes
  // completely" — it keeps branching and closing loops ("network length is sacrificed for network
  // connectivity"). Fixed population, so it never fades. All values from Jones 2010 Table 1
  // (200², %p 7.5, SA 22.5, RA 45, SO 9, periodic) except food strength / radius (tuned).
  '2D · organic network (Jones 2010)': {
    mode: '2d',
    over: { agentCount: 3000, sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 9, collision: true,
            boundary: 'wrap', foodWeight: 0, foodStrength: 20, foodRadius: 2, ticksPerFrame: 5 },
    food: 8,
  },

  // The same rules in 3D (our extension: cone sensors, 64³). SO scaled down for the smaller grid,
  // %p ≈3 (8 000 agents). Tuned: SO 4, agent count, food strength / radius.
  '3D · organic network (Jones rules in 3D)': {
    mode: '3d',
    over: { agentCount: 8000, sensorAngle: 22.5, rotationAngle: 45, sensorOffset: 4, collision: true,
            diffuse: 1, boundary: 'wrap', foodWeight: 0, foodStrength: 20, foodRadius: 2, ticksPerFrame: 4 },
    food: 8,
  },

  // Jones 2010 §4.2 "plasmodial shrinkage": a dense sheet (≈50% of cells) loses agents at random
  // (0.00025 per agent per step, never readmitted) and contracts onto the food. Source values:
  // SA 45, RA 45, SO 9, 300×300, removal 0.00025. Tuned: disc-shaped start (instead of the full
  // square, whose corners pin the sheet), food strength, wall options.
  '2D · Jones 2010 shrinkage (sheet → network)': {
    mode: '2d',
    over: { gridX: 300, gridY: 300, agentCount: 28600, spawnAt: 'center', spawnRadius: 135,
            sensorAngle: 45, rotationAngle: 45, sensorOffset: 9, collision: true, boundary: 'bounce',
            wallRepel: true, wallResponse: 'reflect', foodWeight: 0, foodStrength: 20, foodRadius: 2,
            shrinkProb: 0.00025, ticksPerFrame: 20 },
    food: 8,
  },

  // Same method in 3D (our extension; Jones lists 3D as further work). Removal rate doubled for
  // speed and a population floor added — 3D tubes need more agents than 2D lines. All tuned.
  '3D · shrinkage (ball → network)': {
    mode: '3d',
    over: { agentCount: 46000, spawnAt: 'center', spawnRadius: 28, sensorAngle: 45, rotationAngle: 45,
            sensorOffset: 6, collision: true, diffuse: 1, boundary: 'bounce', wallRepel: true,
            wallResponse: 'reflect', foodWeight: 0, foodStrength: 20, foodRadius: 2,
            shrinkProb: 0.0005, shrinkMinAgents: 3000, ticksPerFrame: 4 },
    food: 6,
  },

  // Validation: the base model with Jones 2010 Table 1 values and no food. Networks form,
  // contract and close lacunae (SPEC §7.1).
  '2D · Jones sanity check (no food)': { mode: '2d', over: {}, food: 0 },

  // Our alternative to shrinkage: the population adapts (crowded agents removed, sparse ones
  // divide), so a contracting network stays thin and connected. Not from Jones.
  '2D · population adaptation (ours)': {
    mode: '2d',
    over: { ...OLD_2D_BASE, maxAgents: 12000, adapt: true, collision: true, boundary: 'bounce',
            foodWeight: 0, foodStrength: 100, foodRadius: 3, ticksPerFrame: 10 },
    food: 6,
  },

  // 3D with collision off + partial diffusion + adaptation: all food linked, more links than
  // shrinkage, some tips still reach the walls. SO 4 = more, finer links. All tuned.
  '3D · thin network + adaptation (ours)': {
    mode: '3d',
    over: { collision: false, diffuse: 0.1, boundary: 'absorb', wallRepel: true, wallResponse: 'reflect',
            sensorOffset: 4,
            foodWeight: 0, foodStrength: 500, foodRadius: 2, ticksPerFrame: 2,
            adapt: true, adaptRadius: 2, adaptHigh: 10, adaptLow: 2, adaptDivideMin: 1,
            adaptDivideProb: 0.5, adaptRemoveProb: 0.1, maxAgents: 120000 },
    food: 6,
  },

  // Growth model (ours): grows out from an inoculum, explores, connects some food — but in 3D it
  // can only form blobs (collision crowding). Kept as a documented comparison.
  '2D · growth from inoculum (ours)': { mode: '2d', model: 'growth', over: { ...OLD_2D_BASE }, food: 6 },
};

// What the 2D / 3D toggle loads: the best-performing setup for each mode.
export const MAIN = {
  '2d': '2D · organic network (Jones 2010)',
  '3d': '3D · organic network (Jones rules in 3D)',
};
