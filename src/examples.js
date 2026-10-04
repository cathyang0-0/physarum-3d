// Built-in example setups (Presets → examples). Each is a set of parameter overrides on top of
// the mode's defaults, plus how many random food sources to scatter (seeded, so reproducible).
// All values tuned on 2026-10-04 — see NOTES.md "Shortest-path networks".

export const EXAMPLES = {
  '2D · Jones sanity (no food)': { mode: '2d', over: {}, food: 0 },

  // Network starts everywhere; food only pins it (strong, small, no long-range smell);
  // a small population lets it contract onto short paths between food (Steiner-like tree).
  '2D · shortest paths between food': {
    mode: '2d',
    over: { agentCount: 3000, collision: true, boundary: 'bounce', foodWeight: 0,
            foodStrength: 100, foodRadius: 3, ticksPerFrame: 10 },
    food: 6,
  },

  // Thin 3D tubes need collision off + partial diffusion; food pins the network.
  '3D · thin network through food': {
    mode: '3d',
    over: { collision: false, diffuse: 0.1, boundary: 'absorb', foodWeight: 0,
            foodStrength: 500, foodRadius: 2, ticksPerFrame: 2 },
    food: 6,
  },

  '2D · growth from inoculum': { mode: '2d', model: 'growth', over: {}, food: 6 },
};
