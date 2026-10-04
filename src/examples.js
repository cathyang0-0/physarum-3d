// Built-in example setups (Presets → examples). Each is a set of parameter overrides on top of
// the mode's defaults, plus how many random food sources to scatter (seeded, so reproducible).
// All values tuned on 2026-10-04 — see NOTES.md "Shortest-path networks".

export const EXAMPLES = {
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
            shrinkProb: 0.0005, shrinkMinAgents: 3000, ticksPerFrame: 3 },
    food: 6,
  },

  '2D · Jones sanity (no food)': { mode: '2d', over: {}, food: 0 },

  // Network starts everywhere; food only pins it (strong, small, no long-range smell);
  // a small population lets it contract onto short paths between food (Steiner-like tree).
  '2D · shortest paths between food': {
    mode: '2d',
    over: { agentCount: 3000, collision: true, boundary: 'bounce', foodWeight: 0,
            foodStrength: 100, foodRadius: 3, ticksPerFrame: 10 },
    food: 6,
  },

  // Same, but the population adapts (crowded agents removed, sparse ones divide), so the network
  // can stay thin AND connected while it contracts. Our rule, not from Jones.
  '2D · shortest paths + population adaptation': {
    mode: '2d',
    over: { agentCount: 9830, maxAgents: 12000, adapt: true, collision: true, boundary: 'bounce',
            foodWeight: 0, foodStrength: 100, foodRadius: 3, ticksPerFrame: 10 },
    food: 6,
  },

  // Thin 3D tubes need collision off + partial diffusion; food pins the network.
  '3D · thin network through food': {
    mode: '3d',
    over: { collision: false, diffuse: 0.1, boundary: 'absorb', wallRepel: true, wallResponse: 'reflect',
            foodWeight: 0, foodStrength: 500, foodRadius: 2, ticksPerFrame: 2 },
    food: 6,
  },

  // Adaptation in 3D: every food gets connected. SO 4 (instead of 6) gives more, finer links
  // (12/12 food linked, NOTES.md "More connections in 3D"); some tips still reach the walls.
  '3D · network + adaptation (more links)': {
    mode: '3d',
    over: { collision: false, diffuse: 0.1, boundary: 'absorb', wallRepel: true, wallResponse: 'reflect',
            sensorOffset: 4,
            foodWeight: 0, foodStrength: 500, foodRadius: 2, ticksPerFrame: 2,
            adapt: true, adaptRadius: 2, adaptHigh: 10, adaptLow: 2, adaptDivideMin: 1,
            adaptDivideProb: 0.5, adaptRemoveProb: 0.1, maxAgents: 120000 },
    food: 6,
  },

  '2D · growth from inoculum': { mode: '2d', model: 'growth', over: {}, food: 6 },
};
