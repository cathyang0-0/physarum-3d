// All model / UI parameters, with defaults for each mode.
// Provenance of every value is logged in NOTES.md ("from source" vs "tuned, not from source").
// A preset file is just { format, version, params, food } — see ui/presets.js.

// Parameters that change array sizes or initial state: editing them triggers a reset.
export const STRUCTURAL = ['mode', 'model', 'initialAgents', 'maxAgents', 'gridX', 'gridY', 'gridZ', 'agentCount', 'seed', 'collision', 'spawnAt', 'spawnRadius'];

const MODEL_FROM_SOURCE = {
  sensorAngle: 90,     // SA, degrees — arXiv:1511.07654 §3
  rotationAngle: 45,   // RA, degrees — arXiv:1511.07654 §3
  stepSize: 1,         // cells per tick — arXiv:1511.07654 §3
  deposit: 5,          // units per successful move — arXiv:1511.07654 §3
  decay: 0.1,          // "damping" — arXiv:1511.07654 §3 (2012 paper: 0.07); see NOTES.md
  bothSidesBetter: 'towardLarger', // arXiv:1212.0023 Fig. 1b
};

export const DEFAULTS_2D = {
  mode: '2d',
  model: 'jones',      // 'jones' = source model; 'growth' = our extension (src/sim/growth.js)
  gridX: 256, gridY: 256, gridZ: 1,
  agentCount: 9830,    // ≈15% of the 256² lattice — tuned
  seed: 1,
  ...MODEL_FROM_SOURCE,
  sensorOffset: 15,    // SO, cells — arXiv:1511.07654 §3
  collision: true,     // Jones-faithful for the sanity check
  boundary: 'wrap',
  sensorCount: 4,      // 3D only
  steering: 'argmax',  // 3D only
  randomTurnProb: 0,
  // food
  foodStrength: 10, foodRadius: 2, foodPlaneZ: 0, scatterCount: 6,
  spawnAt: 'uniform', spawnRadius: 12,
  // growth model only — all tuned, not from source (see NOTES.md "Growth model")
  initialAgents: 300,    // agents at the inoculation site at t = 0
  maxAgents: 12000,      // population cap (array size)
  foodWeight: 1,         // 0 = off. sensing reads trail + foodWeight · foodField
  foodReach: 30,         // cells; length scale of the food smell exp(−d / reach)
  hungerSensing: true,   // food smell weighted by (1 − energy): fed agents ignore food
  energyCost: 0.001,     // 0 = off (immortal). energy lost per tick; 1 / cost = ticks of life without food
  divideProb: 0.03,      // 0 = off. per-tick chance that a well-fed agent splits
  divideMinEnergy: 0.6,  // only agents with at least this much energy may split
  fedDepositBoost: 1,    // 0 = off. deposit × (1 + boost · energy)
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
  trailThreshold: 0.35,
};

// Applied on top of the current params when switching model (each model needs its own spawn).
// Distances in the growth model are in cells, so 3D (64 cells wide) uses ~¼ of the 2D (256)
// values — with the 2D values, food spheres in 3D overlap into one blob. All tuned.
const MODEL_SWITCH = {
  '2d': {
    jones: { spawnAt: 'uniform', spawnRadius: 12, foodRadius: 2 },
    growth: { spawnAt: 'center', spawnRadius: 6, collision: true, foodRadius: 8, foodReach: 30 },
  },
  '3d': {
    jones: { spawnAt: 'uniform', spawnRadius: 12, foodRadius: 2 },
    growth: { spawnAt: 'center', spawnRadius: 3, collision: true, foodRadius: 3, foodReach: 10 },
  },
};

export function modelSwitch(model, mode) {
  return MODEL_SWITCH[mode === '3d' ? '3d' : '2d'][model];
}

export function defaultsFor(mode) {
  return structuredClone(mode === '3d' ? DEFAULTS_3D : DEFAULTS_2D);
}
