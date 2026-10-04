// "Growth" model — OUR DESIGN, NOT FROM JONES. See NOTES.md "Growth model".
//
// Goal: Physarum-like behaviour — grow out from an inoculation site, explore, connect food,
// prune branches that lead nowhere. Each rule below is a separate switch so its effect can be
// studied on its own (set its parameter to 0 to turn it off):
//
//   1. inoculation      agents start in a ball around one point             (spawnAt = 'center' | 'food')
//   2. food field       food has its own long-range smell, added to sensing (foodWeight, foodReach)
//      + hunger         only hungry agents follow it: weight × (1 − energy)  (hungerSensing)
//   3. energy / death   every tick costs energy; touching food refills it;  (energyCost)
//                       an agent with no energy left dies
//   4. division         a well-fed agent can split into two                 (divideProb, divideMinEnergy)
//   5. fed deposit      agents with more energy leave a stronger trail      (fedDepositBoost)
//
// The per-agent sensing / turning / moving rules are unchanged (rules2d.js / rules3d.js).

// ---- 2. Food field --------------------------------------------------------------------------
// A static field  food(x) = Σ_sources strength · exp(−|x − source| / foodReach).
// This stands in for the steady state of a slowly decaying, diffusing chemical: computing it
// directly avoids waiting thousands of ticks for a slow diffusion to settle.
// Recomputed only when the sources or the relevant parameters change.
// Also builds `foodMask`: 1 for cells within foodRadius of a source (where agents can eat).

export function updateFoodField(sim) {
  const p = sim.params;
  const key = JSON.stringify([sim.sources, p.foodReach, p.foodRadius]);
  if (key === sim.foodKey) return;
  sim.foodKey = key;

  const { nx, ny, nz } = sim.trail;
  const field = sim.foodField, mask = sim.foodMask;
  field.fill(0);
  mask.fill(0);
  const R2 = p.foodRadius * p.foodRadius, reach = Math.max(1e-6, p.foodReach);
  for (const s of sim.sources) {
    if (s.type !== 'attract') continue;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const dx = x + 0.5 - s.x, dy = y + 0.5 - s.y, dz = sim.is2D ? 0 : z + 0.5 - s.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const i = x + nx * (y + ny * z);
          field[i] += s.strength * Math.exp(-Math.sqrt(d2) / reach);
          if (d2 <= R2) mask[i] = 1;
        }
  }
}

// ---- 3 + 4. Energy, death, division ---------------------------------------------------------
// Runs once per tick after all agents have moved.

export function lifeCycle(sim) {
  const p = sim.params, t = sim.trail, r = sim.rand, wrap = p.boundary === 'wrap';
  const E = sim.energy;

  // Energy: pay the cost of living, refill on food. Death: remove agents with no energy.
  // Iterate backwards so swap-removal does not skip anyone.
  for (let i = sim.agentCount - 1; i >= 0; i--) {
    const cell = t.cellOf(sim.px[i], sim.py[i], sim.pz[i], wrap);
    if (cell >= 0 && sim.foodMask[cell]) E[i] = 1;
    else E[i] -= p.energyCost;
    if (E[i] <= 0 && p.energyCost > 0) sim.removeAgent(i);
  }

  // Division: each well-fed agent may place one child in a free neighbouring cell.
  if (p.divideProb <= 0) return;
  const n = sim.agentCount; // children born this tick do not divide again this tick
  for (let i = 0; i < n && sim.agentCount < sim.capacity; i++) {
    if (E[i] < p.divideMinEnergy || r() >= p.divideProb) continue;
    const j = sim.agentCount;
    if (!sim.placeChild(i, j)) continue; // no free neighbour cell
    sim.agentCount++;
    E[i] *= 0.5; // parent and child share the energy
    E[j] = E[i];
  }
}
