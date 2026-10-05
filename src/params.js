// All model / UI parameters, with defaults for each mode.
// Each value is marked "from source" (with the reference) or "tuned, not from source".
// A preset file is just { format, version, params, food } — see ui/presets.js.

// Parameters that change array sizes or initial state: editing them triggers a reset.
export const STRUCTURAL = ['mode', 'domain', 'model', 'adapt', 'initialAgents', 'maxAgents', 'gridX', 'gridY', 'gridZ', 'agentCount', 'seed', 'collision', 'spawnAt', 'spawnRadius'];

// Base values: Jones 2010 Table 1 (p.134). (Until 2026-10-04 the 2D base used the arXiv:1511.07654
// values SA 90, SO 15 on 256²; examples tuned on that base pin those values explicitly.)
const MODEL_FROM_SOURCE = {
  sensorAngle: 45,     // SA, degrees — Jones 2010 Table 1 ("22.5 or 45 deg"); 45 = minimizing networks
  rotationAngle: 45,   // RA, degrees — Jones 2010 Table 1
  stepSize: 1,         // SS, cells per tick — Jones 2010 Table 1
  deposit: 5,          // depT, per successful move — Jones 2010 Table 1
  decay: 0.1,          // decayT — Jones 2010 Table 1; formula trail = mean · (1 − decay) is our reading
  diffuse: 1,          // 1 = full 3×3 mean (Jones); < 1 = partial blur, tuned, not from source
  bothSidesBetter: 'towardLarger', // arXiv:1212.0023 Fig. 1b
};

export const DEFAULTS_2D = {
  mode: '2d',
  model: 'jones',      // 'jones' = source model; 'growth' = our extension (src/sim/growth.js)
  gridX: 200, gridY: 200, gridZ: 1, // Jones 2010 Table 1: 200 × 200
  domain: 'box',       // habitable shape: box | sphere | pyramid | cone | torus | gyroid (domain.js)
  agentCount: 6000,    // %p 15 of 200² — Jones 2010 Table 1 (%p 3–15)
  seed: 1,
  ...MODEL_FROM_SOURCE,
  sensorOffset: 9,     // SO, cells — Jones 2010 Table 1
  collision: true,     // Jones-faithful for the sanity check
  boundary: 'wrap',
  wallRepel: false,      // sensors outside the walls read −∞ (agents avoid walls). Not in Jones
  wallResponse: 'random', // non-wrap walls: 'random' heading (Jones's failed-move rule) | 'reflect' | 'respawn'
  sensorCount: 4,      // 3D only
  steering: 'argmax',  // 3D only
  randomTurnProb: 0,
  // food
  foodStrength: 10, foodRadius: 2, foodPlaneZ: 0, scatterCount: 6,
  spawnAt: 'uniform', spawnRadius: 12,
  // growth model only — all tuned, not from source (see src/sim/growth.js)
  initialAgents: 300,    // agents at the inoculation site at t = 0
  maxAgents: 12000,      // population cap (array size)
  foodWeight: 0,         // 0 = off (pure Jones). sensing reads trail + foodWeight · foodField
  foodReach: 30,         // cells; length scale of the food smell exp(−d / reach)
  hungerSensing: true,   // food smell weighted by (1 − energy): fed agents ignore food
  energyCost: 0.001,     // 0 = off (immortal). energy lost per tick; 1 / cost = ticks of life without food
  divideProb: 0.03,      // 0 = off. per-tick chance that a well-fed agent splits
  divideMinEnergy: 0.6,  // only agents with at least this much energy may split
  fedDepositBoost: 1,    // 0 = off. deposit × (1 + boost · energy)
  // plasmodial shrinkage — Jones 2010 §4.2 (from source: 0.00025 per agent per step, %p 50)
  shrinkProb: 0,         // 0 = off. per-agent removal probability per tick; removed agents never return
  shrinkMinAgents: 1,    // stop removing below this (not in source; 1 = no floor)
  // population adaptation (Jones model only) — tuned, not from source (src/sim/adapt.js)
  adapt: false,          // off = fixed population (Jones)
  adaptInterval: 5,      // ticks between checks
  adaptRadius: 3,        // window = (2r+1)^d cells
  adaptLow: 0.2,         // density (agents per cell in the window) below this → may divide
  adaptHigh: 0.6,        // density above this → may be removed
  adaptDivideMin: 0,     // ...but only above this density (excludes lone agents; needed in 3D)
  adaptDivideProb: 0.5,  // per check
  adaptRemoveProb: 0.1,  // per check
  adaptMinAgents: 200,
  // run / render
  running: true, ticksPerFrame: 1,
  showTrail: true, showAgents: false, displayScale: 0, trailThreshold: 0.25, pointSize: 0.6,
};

export const DEFAULTS_3D = {
  ...DEFAULTS_2D,
  mode: '3d',
  gridX: 64, gridY: 64, gridZ: 64,
  agentCount: 60000,   // ≈23% of 64³ cells — tuned
  sensorOffset: 6,     // tuned: 15 cells is a quarter of a 64-cell box
  sensorAngle: 45,     // tuned for 3D (2D source value is 90)
  rotationAngle: 30,   // tuned for 3D (2D source value is 45)
  collision: false,    // SPEC §2: default off for speed
  foodStrength: 20,
  foodPlaneZ: 32,
  showAgents: false,
  trailThreshold: 0.3,  // 3D: draw cells above 0.3 × the trail level inside tubes (display only)
  pointSize: 1.0,       // 3D: point size in cells (display only)
};

// Applied on top of the current params when switching model (each model needs its own spawn).
// Distances in the growth model are in cells, so 3D (64 cells wide) uses ~¼ of the 2D (256)
// values — with the 2D values, food spheres in 3D overlap into one blob. All tuned.
const MODEL_SWITCH = {
  '2d': {
    jones: { spawnAt: 'uniform', spawnRadius: 12, foodRadius: 2, foodWeight: 0 },
    growth: { spawnAt: 'center', spawnRadius: 6, collision: true, foodRadius: 8, foodReach: 30, foodWeight: 1 },
  },
  '3d': {
    jones: { spawnAt: 'uniform', spawnRadius: 12, foodRadius: 2, foodWeight: 0 },
    growth: { spawnAt: 'center', spawnRadius: 3, collision: true, foodRadius: 3, foodReach: 10, foodWeight: 1 },
  },
};

export function modelSwitch(model, mode) {
  return MODEL_SWITCH[mode === '3d' ? '3d' : '2d'][model];
}

export function defaultsFor(mode) {
  return structuredClone(mode === '3d' ? DEFAULTS_3D : DEFAULTS_2D);
}
