// All model / UI parameters, with defaults for each mode.
// Provenance of every value is logged in NOTES.md ("from source" vs "tuned, not from source").
// A preset file is just { format, version, params, food } — see ui/presets.js.

// Parameters that change array sizes or initial state: editing them triggers a reset.
export const STRUCTURAL = ['mode', 'gridX', 'gridY', 'gridZ', 'agentCount', 'seed', 'collision', 'spawnAt', 'spawnRadius'];

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
  // run / render
  running: true, ticksPerFrame: 1,
  showTrail: true, showAgents: false, displayScale: 0, trailThreshold: 0.25, pointSize: 1.5,
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

export function defaultsFor(mode) {
  return structuredClone(mode === '3d' ? DEFAULTS_3D : DEFAULTS_2D);
}
